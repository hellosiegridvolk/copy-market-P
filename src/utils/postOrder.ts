import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { getUserActivityModel } from '../models/userHistory';
import Logger from './logger';
import { calculateOrderSize, getTradeMultiplier } from '../config/copyStrategy';

const RETRY_LIMIT = ENV.RETRY_LIMIT;
const COPY_STRATEGY_CONFIG = ENV.COPY_STRATEGY_CONFIG;
const SLIPPAGE_TOLERANCE = parseFloat(process.env.SLIPPAGE_TOLERANCE || '0.05');
const MIN_ORDER_SIZE_USD = 1.0;
const MIN_ORDER_SIZE_TOKENS = 1.0;

const extractOrderError = (response: unknown): string | undefined => {
    if (!response) return undefined;
    if (typeof response === 'string') return response;
    if (typeof response === 'object') {
        const data = response as Record<string, unknown>;
        const nestedError = data.error as Record<string, unknown> | undefined;
        return (typeof data.error === 'string' && data.error) ||
            (typeof nestedError?.error === 'string' && nestedError.error) ||
            (typeof nestedError?.message === 'string' && nestedError.message) ||
            (typeof data.errorMsg === 'string' && data.errorMsg) ||
            (typeof data.message === 'string' && data.message) ||
            undefined;
    }
    return undefined;
};

const isInsufficientBalanceOrAllowanceError = (message?: string): boolean => {
    if (!message) return false;
    const lower = message.toLowerCase();
    return lower.includes('not enough balance') || lower.includes('allowance');
};

export const normalizeOrderResult = (result: any) => ({
    success: Boolean(result?.success),
    orderId: result?.orderID || result?.orderId || result?.id || null,
    status: result?.success ? 'executed' : 'failed',
    error: extractOrderError(result),
});

const persistTradeOutcome = async (
    userAddress: string,
    trade: UserActivityInterface,
    patch: Record<string, unknown>
) => {
    const UserActivity = getUserActivityModel(userAddress);
    await UserActivity.setById(String(trade._id), {
        side: trade.side,
        tokenId: trade.asset,
        marketSlug: trade.slug,
        sizeRequested: trade.usdcSize,
        lastAttemptAt: Date.now(),
        ...patch,
    });
};

const postOrder = async (
    clobClient: ClobClient,
    condition: string,
    my_position: UserPositionInterface | undefined,
    user_position: UserPositionInterface | undefined,
    trade: UserActivityInterface,
    my_balance: number,
    userAddress: string
) => {
    const UserActivity = getUserActivityModel(userAddress);
    let retry = 0;

    if (condition === 'buy') {
        const currentPositionValue = my_position ? my_position.size * my_position.avgPrice : 0;
        const orderCalc = calculateOrderSize(COPY_STRATEGY_CONFIG, trade.usdcSize, my_balance, currentPositionValue);

        if (orderCalc.finalAmount === 0) {
            await persistTradeOutcome(userAddress, trade, { bot: true, status: 'skipped', lastError: orderCalc.reasoning });
            return;
        }

        let remaining = orderCalc.finalAmount;
        let totalBoughtTokens = 0;
        let abortDueToFunds = false;

        while (remaining > 0 && retry < RETRY_LIMIT) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.asks?.length) break;

            const minPriceAsk = orderBook.asks.reduce((min, ask) => parseFloat(ask.price) < parseFloat(min.price) ? ask : min, orderBook.asks[0]);
            if (parseFloat(minPriceAsk.price) - SLIPPAGE_TOLERANCE > trade.price) break;
            if (remaining < MIN_ORDER_SIZE_USD) break;

            const orderSize = Math.min(remaining, parseFloat(minPriceAsk.size) * parseFloat(minPriceAsk.price));
            const orderArgs = { side: Side.BUY, tokenID: trade.asset, amount: orderSize, price: parseFloat(minPriceAsk.price) };
            const signedOrder = await clobClient.createMarketOrder(orderArgs);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            const normalized = normalizeOrderResult(resp);

            if (normalized.success) {
                const tokensBought = orderArgs.amount / orderArgs.price;
                totalBoughtTokens += tokensBought;
                remaining -= orderArgs.amount;
                retry = 0;
                await persistTradeOutcome(userAddress, trade, {
                    status: remaining > 0 ? 'partial_fill' : 'executed',
                    orderId: normalized.orderId,
                    sizeExecuted: totalBoughtTokens,
                    executedAt: Date.now(),
                    lastError: null,
                });
            } else {
                if (isInsufficientBalanceOrAllowanceError(normalized.error || undefined)) {
                    abortDueToFunds = true;
                    break;
                }
                retry += 1;
                await UserActivity.incById(String(trade._id), { retryCount: 1 });
                await persistTradeOutcome(userAddress, trade, { status: retry >= RETRY_LIMIT ? 'retry_exhausted' : 'failed', lastError: normalized.error || 'order_failed' });
            }
        }

        await persistTradeOutcome(userAddress, trade, {
            bot: true,
            botExcutedTime: retry,
            myBoughtSize: totalBoughtTokens,
            status: abortDueToFunds ? 'failed' : retry >= RETRY_LIMIT ? 'retry_exhausted' : totalBoughtTokens > 0 ? 'executed' : 'skipped',
        });
        return;
    }

    if (condition === 'sell') {
        if (!my_position) {
            await persistTradeOutcome(userAddress, trade, { bot: true, status: 'skipped', lastError: 'no_position_to_sell' });
            return;
        }

        const previousBuys = await UserActivity.find({ asset: trade.asset, conditionId: trade.conditionId, side: 'BUY', bot: true, myBoughtSize: { $exists: true, $gt: 0 } }).exec();
        const totalBoughtTokens = previousBuys.reduce((sum, buy) => sum + (buy.myBoughtSize || 0), 0);

        let remaining = !user_position
            ? my_position.size
            : (totalBoughtTokens > 0 ? totalBoughtTokens : my_position.size) * (trade.size / (user_position.size + trade.size)) * getTradeMultiplier(COPY_STRATEGY_CONFIG, trade.usdcSize);

        if (remaining < MIN_ORDER_SIZE_TOKENS) {
            await persistTradeOutcome(userAddress, trade, { bot: true, status: 'skipped', lastError: 'below_min_order_size' });
            return;
        }

        remaining = Math.min(remaining, my_position.size);
        let totalSoldTokens = 0;
        let abortDueToFunds = false;

        while (remaining > 0 && retry < RETRY_LIMIT) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.bids?.length) break;

            const maxPriceBid = orderBook.bids.reduce((max, bid) => parseFloat(bid.price) > parseFloat(max.price) ? bid : max, orderBook.bids[0]);
            const sellAmount = Math.min(remaining, parseFloat(maxPriceBid.size));
            if (sellAmount < MIN_ORDER_SIZE_TOKENS) break;

            const orderArgs = { side: Side.SELL, tokenID: trade.asset, amount: sellAmount, price: parseFloat(maxPriceBid.price) };
            const signedOrder = await clobClient.createMarketOrder(orderArgs);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            const normalized = normalizeOrderResult(resp);

            if (normalized.success) {
                retry = 0;
                totalSoldTokens += orderArgs.amount;
                remaining -= orderArgs.amount;
                await persistTradeOutcome(userAddress, trade, {
                    status: remaining > 0 ? 'partial_fill' : 'executed',
                    orderId: normalized.orderId,
                    sizeExecuted: totalSoldTokens,
                    executedAt: Date.now(),
                    lastError: null,
                });
            } else {
                if (isInsufficientBalanceOrAllowanceError(normalized.error || undefined)) {
                    abortDueToFunds = true;
                    break;
                }
                retry += 1;
                await UserActivity.incById(String(trade._id), { retryCount: 1 });
                await persistTradeOutcome(userAddress, trade, { status: retry >= RETRY_LIMIT ? 'retry_exhausted' : 'failed', lastError: normalized.error || 'order_failed' });
            }
        }

        if (totalSoldTokens > 0 && totalBoughtTokens > 0) {
            const sellPercentage = totalSoldTokens / totalBoughtTokens;
            if (sellPercentage >= 0.99) {
                await UserActivity.updateMany({ asset: trade.asset, conditionId: trade.conditionId, side: 'BUY', bot: true, myBoughtSize: { $exists: true, $gt: 0 } }, { $set: { myBoughtSize: 0 } });
            } else {
                for (const buy of previousBuys) {
                    await UserActivity.setById(String(buy._id), { myBoughtSize: (buy.myBoughtSize || 0) * (1 - sellPercentage) });
                }
            }
        }

        await persistTradeOutcome(userAddress, trade, {
            bot: true,
            botExcutedTime: retry,
            status: abortDueToFunds ? 'failed' : retry >= RETRY_LIMIT ? 'retry_exhausted' : totalSoldTokens > 0 ? 'executed' : 'skipped',
        });
        return;
    }

    Logger.error(`Unknown condition: ${condition}`);
};

export default postOrder;
