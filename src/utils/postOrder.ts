import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import {
    TradeLifecycleStatus,
    UserActivityInterface,
    UserPositionInterface,
} from '../interfaces/User';
import { getUserActivityModel } from '../models/userHistory';
import Logger from './logger';
import { calculateOrderSize, getTradeMultiplier } from '../config/copyStrategy';

const RETRY_LIMIT = ENV.RETRY_LIMIT;
const COPY_STRATEGY_CONFIG = ENV.COPY_STRATEGY_CONFIG;
const SLIPPAGE_TOLERANCE = parseFloat(process.env.SLIPPAGE_TOLERANCE || '0.05');
const MIN_ORDER_SIZE_USD = 1.0;
const MIN_ORDER_SIZE_TOKENS = 1.0;

export interface NormalizedOrderResult {
    success: boolean;
    orderId: string | null;
    status: 'executed' | 'failed' | 'partial_fill';
    error: string | null;
    filledSize: number | null;
    averagePrice: number | null;
    rawStatus: string | null;
}

export interface TradeExecutionSummary {
    status: TradeLifecycleStatus;
    attemptsMade: number;
    orderId: string | null;
    orderStatus: string | null;
    lastError: string | null;
    sizeRequested: number;
    sizeExecuted: number;
    executedAt: number | null;
    orderResult: NormalizedOrderResult | null;
    myBoughtSize?: number;
}

const compactRecord = <T extends Record<string, unknown>>(record: T): T =>
    Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

const toOptionalNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

const extractOrderError = (response: unknown): string | null => {
    if (!response) return null;
    if (typeof response === 'string') return response;
    if (typeof response === 'object') {
        const data = response as Record<string, unknown>;
        const nestedError = data.error as Record<string, unknown> | undefined;
        return (
            (typeof data.error === 'string' && data.error) ||
            (typeof nestedError?.error === 'string' && nestedError.error) ||
            (typeof nestedError?.message === 'string' && nestedError.message) ||
            (typeof data.errorMsg === 'string' && data.errorMsg) ||
            (typeof data.message === 'string' && data.message) ||
            null
        );
    }
    return null;
};

const isInsufficientBalanceOrAllowanceError = (message?: string | null): boolean => {
    if (!message) return false;
    const lower = message.toLowerCase();
    return lower.includes('not enough balance') || lower.includes('allowance');
};

export const normalizeOrderResult = (
    result: any,
    requestedAmount?: number
): NormalizedOrderResult => {
    const rawStatus =
        (typeof result?.status === 'string' && result.status) ||
        (typeof result?.orderStatus === 'string' && result.orderStatus) ||
        null;
    const rawStatusLower = rawStatus?.toLowerCase() || '';
    const filledSize = toOptionalNumber(
        result?.filledSize ??
            result?.filledAmount ??
            result?.sizeMatched ??
            result?.matchedAmount ??
            result?.amountFilled
    );
    const averagePrice = toOptionalNumber(result?.avgPrice ?? result?.averagePrice ?? result?.price);
    const partialFill =
        rawStatusLower.includes('partial') ||
        (filledSize !== null &&
            typeof requestedAmount === 'number' &&
            filledSize > 0 &&
            filledSize < requestedAmount);
    const executed =
        Boolean(result?.success) ||
        rawStatusLower === 'executed' ||
        rawStatusLower === 'filled' ||
        rawStatusLower === 'matched';

    return {
        success: partialFill || executed,
        orderId: result?.orderID || result?.orderId || result?.id || null,
        status: partialFill ? 'partial_fill' : executed ? 'executed' : 'failed',
        error: extractOrderError(result),
        filledSize,
        averagePrice,
        rawStatus,
    };
};

const persistTradeOutcome = async (
    userAddress: string,
    trade: UserActivityInterface,
    patch: Record<string, unknown>
) => {
    const UserActivity = getUserActivityModel(userAddress);
    await UserActivity.setById(
        String(trade._id),
        compactRecord({
            side: trade.side,
            tokenId: trade.asset,
            marketSlug: trade.slug,
            sizeRequested: trade.sizeRequested ?? trade.usdcSize,
            lastAttemptAt: Date.now(),
            ...patch,
        })
    );
};

const buildSummary = (
    trade: UserActivityInterface,
    status: TradeLifecycleStatus,
    attemptsMade: number,
    orderResult: NormalizedOrderResult | null,
    sizeExecuted: number,
    executedAt: number | null,
    lastError: string | null,
    myBoughtSize?: number
): TradeExecutionSummary => ({
    status,
    attemptsMade,
    orderId: orderResult?.orderId || null,
    orderStatus: orderResult?.status || null,
    lastError,
    sizeRequested: trade.sizeRequested ?? trade.usdcSize,
    sizeExecuted,
    executedAt,
    orderResult,
    myBoughtSize,
});

const postOrder = async (
    clobClient: ClobClient,
    condition: string,
    my_position: UserPositionInterface | undefined,
    user_position: UserPositionInterface | undefined,
    trade: UserActivityInterface,
    my_balance: number,
    userAddress: string
): Promise<TradeExecutionSummary> => {
    const UserActivity = getUserActivityModel(userAddress);
    let retry = 0;
    let attemptsMade = 0;

    if (condition === 'buy') {
        const currentPositionValue = my_position ? my_position.size * my_position.avgPrice : 0;
        const orderCalc = calculateOrderSize(
            COPY_STRATEGY_CONFIG,
            trade.usdcSize,
            my_balance,
            currentPositionValue
        );

        if (orderCalc.finalAmount === 0) {
            const summary = buildSummary(
                trade,
                'skipped',
                0,
                null,
                0,
                null,
                orderCalc.reasoning
            );
            await persistTradeOutcome(userAddress, trade, {
                bot: true,
                botExcutedTime: 0,
                status: summary.status,
                sizeExecuted: summary.sizeExecuted,
                lastError: summary.lastError,
            });
            return summary;
        }

        let remaining = orderCalc.finalAmount;
        let totalBoughtTokens = 0;
        let abortDueToFunds = false;
        let skipReason: string | null = null;
        let executedAt: number | null = null;
        let lastOrderResult: NormalizedOrderResult | null = null;

        while (remaining > 0 && retry < RETRY_LIMIT) {
            attemptsMade += 1;

            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.asks?.length) {
                skipReason = 'no_asks_available';
                break;
            }

            const minPriceAsk = orderBook.asks.reduce(
                (min, ask) =>
                    parseFloat(ask.price) < parseFloat(min.price) ? ask : min,
                orderBook.asks[0]
            );
            if (parseFloat(minPriceAsk.price) - SLIPPAGE_TOLERANCE > trade.price) {
                skipReason = 'slippage_too_high';
                break;
            }
            if (remaining < MIN_ORDER_SIZE_USD) {
                skipReason = 'below_min_order_size';
                break;
            }

            const orderSize = Math.min(
                remaining,
                parseFloat(minPriceAsk.size) * parseFloat(minPriceAsk.price)
            );
            if (orderSize < MIN_ORDER_SIZE_USD) {
                skipReason = 'below_min_order_size';
                break;
            }

            const orderArgs = {
                side: Side.BUY,
                tokenID: trade.asset,
                amount: orderSize,
                price: parseFloat(minPriceAsk.price),
            };
            const signedOrder = await clobClient.createMarketOrder(orderArgs);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            const normalized = normalizeOrderResult(resp, orderArgs.amount);
            lastOrderResult = normalized;

            if (normalized.success) {
                const executedAmount = Math.max(
                    0,
                    Math.min(orderArgs.amount, normalized.filledSize ?? orderArgs.amount)
                );
                if (executedAmount === 0) {
                    skipReason = 'zero_fill';
                    break;
                }

                const tokensBought = executedAmount / orderArgs.price;
                totalBoughtTokens += tokensBought;
                remaining = Math.max(0, remaining - executedAmount);
                retry = 0;
                executedAt = Date.now();

                await persistTradeOutcome(userAddress, trade, {
                    status: remaining > 0 ? 'partial_fill' : 'executed',
                    orderId: normalized.orderId,
                    orderStatus: normalized.status,
                    orderResult: normalized,
                    sizeExecuted: totalBoughtTokens,
                    executedAt,
                    lastError: remaining > 0 ? 'remaining_size_unfilled' : null,
                });
            } else {
                if (isInsufficientBalanceOrAllowanceError(normalized.error)) {
                    abortDueToFunds = true;
                    skipReason = normalized.error || 'insufficient_balance_or_allowance';
                    break;
                }

                retry += 1;
                await UserActivity.incById(String(trade._id), { retryCount: 1 });
                await persistTradeOutcome(userAddress, trade, {
                    status: retry >= RETRY_LIMIT ? 'retry_exhausted' : 'failed',
                    orderId: normalized.orderId,
                    orderStatus: normalized.status,
                    orderResult: normalized,
                    lastError: normalized.error || 'order_failed',
                });
            }
        }

        const finalStatus: TradeLifecycleStatus = abortDueToFunds
            ? 'failed'
            : retry >= RETRY_LIMIT
              ? 'retry_exhausted'
              : totalBoughtTokens > 0 && remaining > 0
                ? 'partial_fill'
                : totalBoughtTokens > 0
                  ? 'executed'
                  : 'skipped';
        const finalError =
            abortDueToFunds || finalStatus === 'retry_exhausted'
                ? lastOrderResult?.error || skipReason || 'order_failed'
                : finalStatus === 'partial_fill'
                  ? skipReason || 'remaining_size_unfilled'
                  : finalStatus === 'skipped'
                    ? skipReason
                    : null;
        const summary = buildSummary(
            trade,
            finalStatus,
            attemptsMade,
            lastOrderResult,
            totalBoughtTokens,
            executedAt,
            finalError,
            totalBoughtTokens
        );

        await persistTradeOutcome(userAddress, trade, {
            bot: true,
            botExcutedTime: attemptsMade,
            myBoughtSize: totalBoughtTokens,
            status: summary.status,
            orderId: summary.orderId,
            orderStatus: summary.orderStatus,
            orderResult: summary.orderResult,
            sizeExecuted: summary.sizeExecuted,
            executedAt: summary.executedAt,
            lastError: summary.lastError,
        });
        return summary;
    }

    if (condition === 'sell') {
        if (!my_position) {
            const summary = buildSummary(
                trade,
                'skipped',
                0,
                null,
                0,
                null,
                'no_position_to_sell'
            );
            await persistTradeOutcome(userAddress, trade, {
                bot: true,
                botExcutedTime: 0,
                status: summary.status,
                sizeExecuted: 0,
                lastError: summary.lastError,
            });
            return summary;
        }

        const previousBuys = await UserActivity.find({
            asset: trade.asset,
            conditionId: trade.conditionId,
            side: 'BUY',
            bot: true,
            myBoughtSize: { $exists: true, $gt: 0 },
        }).exec();
        const totalBoughtTokens = previousBuys.reduce(
            (sum, buy) => sum + (buy.myBoughtSize || 0),
            0
        );

        let remaining = !user_position
            ? my_position.size
            : (totalBoughtTokens > 0 ? totalBoughtTokens : my_position.size) *
              (trade.size / Math.max(user_position.size + trade.size, 1)) *
              getTradeMultiplier(COPY_STRATEGY_CONFIG, trade.usdcSize);

        if (remaining < MIN_ORDER_SIZE_TOKENS) {
            const summary = buildSummary(
                trade,
                'skipped',
                0,
                null,
                0,
                null,
                'below_min_order_size'
            );
            await persistTradeOutcome(userAddress, trade, {
                bot: true,
                botExcutedTime: 0,
                status: summary.status,
                sizeExecuted: 0,
                lastError: summary.lastError,
            });
            return summary;
        }

        remaining = Math.min(remaining, my_position.size);
        let totalSoldTokens = 0;
        let abortDueToFunds = false;
        let skipReason: string | null = null;
        let executedAt: number | null = null;
        let lastOrderResult: NormalizedOrderResult | null = null;

        while (remaining > 0 && retry < RETRY_LIMIT) {
            attemptsMade += 1;

            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.bids?.length) {
                skipReason = 'no_bids_available';
                break;
            }

            const maxPriceBid = orderBook.bids.reduce(
                (max, bid) =>
                    parseFloat(bid.price) > parseFloat(max.price) ? bid : max,
                orderBook.bids[0]
            );
            const sellAmount = Math.min(remaining, parseFloat(maxPriceBid.size));
            if (sellAmount < MIN_ORDER_SIZE_TOKENS) {
                skipReason = 'below_min_order_size';
                break;
            }

            const orderArgs = {
                side: Side.SELL,
                tokenID: trade.asset,
                amount: sellAmount,
                price: parseFloat(maxPriceBid.price),
            };
            const signedOrder = await clobClient.createMarketOrder(orderArgs);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            const normalized = normalizeOrderResult(resp, orderArgs.amount);
            lastOrderResult = normalized;

            if (normalized.success) {
                const executedAmount = Math.max(
                    0,
                    Math.min(orderArgs.amount, normalized.filledSize ?? orderArgs.amount)
                );
                if (executedAmount === 0) {
                    skipReason = 'zero_fill';
                    break;
                }

                retry = 0;
                totalSoldTokens += executedAmount;
                remaining = Math.max(0, remaining - executedAmount);
                executedAt = Date.now();

                await persistTradeOutcome(userAddress, trade, {
                    status: remaining > 0 ? 'partial_fill' : 'executed',
                    orderId: normalized.orderId,
                    orderStatus: normalized.status,
                    orderResult: normalized,
                    sizeExecuted: totalSoldTokens,
                    executedAt,
                    lastError: remaining > 0 ? 'remaining_size_unfilled' : null,
                });
            } else {
                if (isInsufficientBalanceOrAllowanceError(normalized.error)) {
                    abortDueToFunds = true;
                    skipReason = normalized.error || 'insufficient_balance_or_allowance';
                    break;
                }

                retry += 1;
                await UserActivity.incById(String(trade._id), { retryCount: 1 });
                await persistTradeOutcome(userAddress, trade, {
                    status: retry >= RETRY_LIMIT ? 'retry_exhausted' : 'failed',
                    orderId: normalized.orderId,
                    orderStatus: normalized.status,
                    orderResult: normalized,
                    lastError: normalized.error || 'order_failed',
                });
            }
        }

        if (totalSoldTokens > 0 && totalBoughtTokens > 0) {
            const sellPercentage = totalSoldTokens / totalBoughtTokens;
            if (sellPercentage >= 0.99) {
                await UserActivity.updateMany(
                    {
                        asset: trade.asset,
                        conditionId: trade.conditionId,
                        side: 'BUY',
                        bot: true,
                        myBoughtSize: { $exists: true, $gt: 0 },
                    },
                    { myBoughtSize: 0 }
                );
            } else {
                for (const buy of previousBuys) {
                    await UserActivity.setById(String(buy._id), {
                        myBoughtSize: (buy.myBoughtSize || 0) * (1 - sellPercentage),
                    });
                }
            }
        }

        const finalStatus: TradeLifecycleStatus = abortDueToFunds
            ? 'failed'
            : retry >= RETRY_LIMIT
              ? 'retry_exhausted'
              : totalSoldTokens > 0 && remaining > 0
                ? 'partial_fill'
                : totalSoldTokens > 0
                  ? 'executed'
                  : 'skipped';
        const finalError =
            abortDueToFunds || finalStatus === 'retry_exhausted'
                ? lastOrderResult?.error || skipReason || 'order_failed'
                : finalStatus === 'partial_fill'
                  ? skipReason || 'remaining_size_unfilled'
                  : finalStatus === 'skipped'
                    ? skipReason
                    : null;
        const summary = buildSummary(
            trade,
            finalStatus,
            attemptsMade,
            lastOrderResult,
            totalSoldTokens,
            executedAt,
            finalError
        );

        await persistTradeOutcome(userAddress, trade, {
            bot: true,
            botExcutedTime: attemptsMade,
            status: summary.status,
            orderId: summary.orderId,
            orderStatus: summary.orderStatus,
            orderResult: summary.orderResult,
            sizeExecuted: summary.sizeExecuted,
            executedAt: summary.executedAt,
            lastError: summary.lastError,
        });
        return summary;
    }

    Logger.error(`Unknown condition: ${condition}`);
    const summary = buildSummary(trade, 'failed', 0, null, 0, null, `unknown_condition:${condition}`);
    await persistTradeOutcome(userAddress, trade, {
        bot: true,
        botExcutedTime: 0,
        status: summary.status,
        sizeExecuted: 0,
        lastError: summary.lastError,
    });
    return summary;
};

export default postOrder;
