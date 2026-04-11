import { ClobClient } from '@polymarket/clob-client';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { ENV } from '../config/env';
import { getUserActivityModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';
import postOrder from '../utils/postOrder';
import Logger from '../utils/logger';
import telegram from '../utils/telegram';
import { updateRuntimeStatus } from './runtimeStatus';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const PROXY_WALLET = ENV.PROXY_WALLET;
const TRADE_AGGREGATION_ENABLED = ENV.TRADE_AGGREGATION_ENABLED;
const TRADE_AGGREGATION_WINDOW_SECONDS = ENV.TRADE_AGGREGATION_WINDOW_SECONDS;
const TRADE_AGGREGATION_MIN_TOTAL_USD = 1.0;
const PREVIEW_MODE = process.env.PREVIEW_MODE === 'true';
const DAILY_LOSS_CAP_PCT = parseFloat(process.env.DAILY_LOSS_CAP_PCT || '20');
const MAX_EXECUTION_ERRORS = parseInt(process.env.KILL_SWITCH_MAX_ERRORS || '5', 10);

let dailyStartBalance: number | null = null;
let dailyStartDate = '';
let killSwitchTriggered = false;
let consecutiveExecutionErrors = 0;

const checkDailyLoss = async (): Promise<boolean> => {
    const today = new Date().toISOString().split('T')[0];
    const currentBalance = await getMyBalance(PROXY_WALLET);

    if (dailyStartDate !== today) {
        dailyStartDate = today;
        dailyStartBalance = currentBalance;
    }

    if (dailyStartBalance !== null && dailyStartBalance > 0) {
        const lossPct = ((dailyStartBalance - currentBalance) / dailyStartBalance) * 100;
        if (lossPct >= DAILY_LOSS_CAP_PCT) {
            const reason = `daily_loss_${lossPct.toFixed(2)}pct`;
            killSwitchTriggered = true;
            updateRuntimeStatus({ killSwitchTriggered: true, killSwitchReason: reason });
            telegram.killSwitch(lossPct);
            return false;
        }
    }
    return true;
};

const userActivityModels = USER_ADDRESSES.map((address) => ({
    address,
    model: getUserActivityModel(address),
}));

interface TradeWithUser extends UserActivityInterface {
    userAddress: string;
}

interface AggregatedTrade {
    userAddress: string;
    conditionId: string;
    asset: string;
    side: string;
    slug?: string;
    trades: TradeWithUser[];
    totalUsdcSize: number;
    averagePrice: number;
    firstTradeTime: number;
}

const tradeAggregationBuffer: Map<string, AggregatedTrade> = new Map();

const getLifecycleBase = (trade: TradeWithUser) => ({
    side: trade.side,
    marketSlug: trade.slug,
    tokenId: trade.asset,
    sizeRequested: trade.usdcSize,
});

const readTempTrades = async (): Promise<TradeWithUser[]> => {
    const allTrades: TradeWithUser[] = [];
    for (const { address, model } of userActivityModels) {
        const trades = await model
            .find({
                $and: [{ type: 'TRADE' }, { bot: false }, { botExcutedTime: 0 }],
            })
            .exec();

        const tradesWithUser = trades.map((trade) => ({
            ...(trade.toObject() as UserActivityInterface),
            userAddress: address,
        }));
        allTrades.push(...tradesWithUser);
    }
    return allTrades;
};

const getAggregationKey = (trade: TradeWithUser): string => `${trade.userAddress}:${trade.conditionId}:${trade.asset}:${trade.side}`;

const addToAggregationBuffer = (trade: TradeWithUser): void => {
    const key = getAggregationKey(trade);
    const existing = tradeAggregationBuffer.get(key);
    const now = Date.now();
    if (existing) {
        existing.trades.push(trade);
        existing.totalUsdcSize += trade.usdcSize;
        const totalValue = existing.trades.reduce((sum, t) => sum + t.usdcSize * t.price, 0);
        existing.averagePrice = totalValue / existing.totalUsdcSize;
    } else {
        tradeAggregationBuffer.set(key, {
            userAddress: trade.userAddress,
            conditionId: trade.conditionId,
            asset: trade.asset,
            side: trade.side || 'BUY',
            slug: trade.slug,
            trades: [trade],
            totalUsdcSize: trade.usdcSize,
            averagePrice: trade.price,
            firstTradeTime: now,
        });
    }
};

const setTradeStatus = async (trade: TradeWithUser, status: string, extra: Record<string, unknown> = {}) => {
    const UserActivity = getUserActivityModel(trade.userAddress);
    await UserActivity.setById(String(trade._id), {
        ...getLifecycleBase(trade),
        status,
        lastAttemptAt: Date.now(),
        ...extra,
    });
};

const getReadyAggregatedTrades = async (): Promise<AggregatedTrade[]> => {
    const ready: AggregatedTrade[] = [];
    const now = Date.now();
    const windowMs = TRADE_AGGREGATION_WINDOW_SECONDS * 1000;

    for (const [key, agg] of tradeAggregationBuffer.entries()) {
        if (now - agg.firstTradeTime >= windowMs) {
            if (agg.totalUsdcSize >= TRADE_AGGREGATION_MIN_TOTAL_USD) {
                ready.push(agg);
            } else {
                for (const trade of agg.trades) {
                    await setTradeStatus(trade, 'skipped', { bot: true, botExcutedTime: 1, lastError: 'below_minimum_aggregated_size' });
                }
            }
            tradeAggregationBuffer.delete(key);
        }
    }

    return ready;
};

const doTrading = async (clobClient: ClobClient, trades: TradeWithUser[]) => {
    for (const trade of trades) {
        if (killSwitchTriggered || !(await checkDailyLoss())) return;

        if (trade.status === 'executed' || trade.bot === true) {
            await setTradeStatus(trade, 'skipped', { lastError: 'already_processed' });
            continue;
        }

        await setTradeStatus(trade, 'processing', { botExcutedTime: 1 });

        if (PREVIEW_MODE) {
            await setTradeStatus(trade, 'skipped', { bot: true, lastError: 'preview_mode' });
            continue;
        }

        try {
            const my_positions: UserPositionInterface[] = await fetchData(`https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`);
            const user_positions: UserPositionInterface[] = await fetchData(`https://data-api.polymarket.com/positions?user=${trade.userAddress}`);
            const my_position = my_positions.find((position: UserPositionInterface) => position.conditionId === trade.conditionId);
            const user_position = user_positions.find((position: UserPositionInterface) => position.conditionId === trade.conditionId);
            const my_balance = await getMyBalance(PROXY_WALLET);

            await postOrder(clobClient, trade.side === 'BUY' ? 'buy' : 'sell', my_position, user_position, trade, my_balance, trade.userAddress);
            consecutiveExecutionErrors = 0;
            updateRuntimeStatus({ lastExecutionSuccessAt: Date.now(), lastError: undefined, lastErrorAt: undefined });
        } catch (error) {
            consecutiveExecutionErrors += 1;
            const message = error instanceof Error ? error.message : String(error);
            const UserActivity = getUserActivityModel(trade.userAddress);
            await UserActivity.incById(String(trade._id), { retryCount: 1 });
            await setTradeStatus(trade, consecutiveExecutionErrors >= MAX_EXECUTION_ERRORS ? 'retry_exhausted' : 'failed', {
                bot: true,
                lastError: message,
            });
            updateRuntimeStatus({ lastError: message, lastErrorAt: Date.now() });
            if (consecutiveExecutionErrors >= MAX_EXECUTION_ERRORS) {
                killSwitchTriggered = true;
                updateRuntimeStatus({ killSwitchTriggered: true, killSwitchReason: 'too_many_execution_errors' });
            }
        }
    }
};

const doAggregatedTrading = async (clobClient: ClobClient, aggregatedTrades: AggregatedTrade[]) => {
    for (const agg of aggregatedTrades) {
        for (const trade of agg.trades) {
            await setTradeStatus(trade, 'processing', { botExcutedTime: 1 });
        }

        const syntheticTrade: UserActivityInterface = {
            ...agg.trades[0],
            usdcSize: agg.totalUsdcSize,
            price: agg.averagePrice,
            side: agg.side as 'BUY' | 'SELL',
        };

        const my_positions: UserPositionInterface[] = await fetchData(`https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`);
        const user_positions: UserPositionInterface[] = await fetchData(`https://data-api.polymarket.com/positions?user=${agg.userAddress}`);
        const my_position = my_positions.find((position: UserPositionInterface) => position.conditionId === agg.conditionId);
        const user_position = user_positions.find((position: UserPositionInterface) => position.conditionId === agg.conditionId);
        const my_balance = await getMyBalance(PROXY_WALLET);

        await postOrder(clobClient, agg.side === 'BUY' ? 'buy' : 'sell', my_position, user_position, syntheticTrade, my_balance, agg.userAddress);
    }
};

let isRunning = true;
export const stopTradeExecutor = () => {
    isRunning = false;
    updateRuntimeStatus({ isRunning: false });
};

const tradeExecutor = async (clobClient: ClobClient) => {
    updateRuntimeStatus({ isRunning: true, mode: PREVIEW_MODE ? 'preview' : 'live' });
    let lastCheck = Date.now();
    while (isRunning) {
        try {
            updateRuntimeStatus({ lastPollAt: Date.now(), queueDepth: tradeAggregationBuffer.size });
            const trades = await readTempTrades();
            if (TRADE_AGGREGATION_ENABLED) {
                for (const trade of trades) {
                    if (trade.side === 'BUY' && trade.usdcSize < TRADE_AGGREGATION_MIN_TOTAL_USD) {
                        addToAggregationBuffer(trade);
                    } else {
                        await doTrading(clobClient, [trade]);
                    }
                }
                const readyAggregations = await getReadyAggregatedTrades();
                if (readyAggregations.length > 0) {
                    await doAggregatedTrading(clobClient, readyAggregations);
                }
            } else if (trades.length > 0) {
                await doTrading(clobClient, trades);
            }

            updateRuntimeStatus({ lastPollSuccessAt: Date.now(), queueDepth: tradeAggregationBuffer.size });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            updateRuntimeStatus({ lastError: message, lastErrorAt: Date.now() });
            Logger.error(`Trade executor loop error: ${message}`);
        }

        if (Date.now() - lastCheck > 300) {
            Logger.waiting(USER_ADDRESSES.length);
            lastCheck = Date.now();
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
    }
};

export default tradeExecutor;
