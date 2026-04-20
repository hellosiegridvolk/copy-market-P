import { ClobClient } from '@polymarket/clob-client';
import {
    TradeLifecycleStatus,
    UserActivityInterface,
    UserPositionInterface,
} from '../interfaces/User';
import { ENV } from '../config/env';
import { getUserActivityModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';
import postOrder, { TradeExecutionSummary } from '../utils/postOrder';
import Logger from '../utils/logger';
import telegram from '../utils/telegram';
import {
    activateKillSwitch,
    clearKillSwitch,
    getRuntimeStatus,
    updateRiskStatus,
    updateRuntimeStatus,
    updateWorkerStatus,
} from './runtimeStatus';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const PROXY_WALLET = ENV.PROXY_WALLET;
const RETRY_LIMIT = ENV.RETRY_LIMIT;
const TRADE_AGGREGATION_ENABLED = ENV.TRADE_AGGREGATION_ENABLED;
const TRADE_AGGREGATION_WINDOW_SECONDS = ENV.TRADE_AGGREGATION_WINDOW_SECONDS;
const TRADE_AGGREGATION_MIN_TOTAL_USD = 1.0;
const PREVIEW_MODE = ENV.PREVIEW_MODE;
const DAILY_LOSS_CAP_PCT = ENV.DAILY_LOSS_CAP_PCT;
const MAX_EXECUTION_ERRORS = ENV.KILL_SWITCH_MAX_ERRORS;
const MAX_EQUITY_SNAPSHOT_FAILURES = ENV.KILL_SWITCH_EQUITY_FALLBACK_LIMIT;
const MAX_MONITOR_ERRORS = ENV.KILL_SWITCH_MONITOR_ERROR_LIMIT;
const MONITOR_STALE_THRESHOLD_MS = ENV.KILL_SWITCH_MONITOR_STALE_SECONDS * 1000;

let dailyStartEquity: number | null = null;
let dailyStartDate = '';
let killSwitchTriggered = false;
let consecutiveExecutionErrors = 0;
let consecutiveEquitySnapshotFailures = 0;
let isRunning = true;

const TERMINAL_STATUSES = new Set<TradeLifecycleStatus>([
    'executed',
    'skipped',
    'retry_exhausted',
    'partial_fill',
]);

const compactRecord = <T extends Record<string, unknown>>(record: T): T =>
    Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

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

interface AccountEquitySnapshot {
    currentEquity: number;
    freeBalance: number;
    openPositionValue?: number;
    source: 'balance_plus_positions' | 'balance_only_fallback';
    capturedAt: number;
    degraded: boolean;
    errorMessage?: string;
}

const tradeAggregationBuffer: Map<string, AggregatedTrade> = new Map();

const getLifecycleBase = (trade: TradeWithUser) =>
    compactRecord({
        side: trade.side,
        marketSlug: trade.marketSlug ?? trade.slug,
        tokenId: trade.tokenId ?? trade.asset,
        sizeRequested: trade.sizeRequested ?? trade.usdcSize,
        sourceTrader: trade.sourceTrader ?? trade.userAddress,
        sourceTradeId: trade.sourceTradeId ?? trade.transactionHash,
    });

const isPendingTrade = (trade: UserActivityInterface): boolean => {
    if (trade.status === 'new' || trade.status === 'failed') {
        return true;
    }

    if (trade.status) {
        return false;
    }

    return trade.bot !== true && trade.botExcutedTime === 0;
};

const persistTradeStatus = async (
    trade: TradeWithUser,
    status: TradeLifecycleStatus,
    extra: Record<string, unknown> = {}
) => {
    const UserActivity = getUserActivityModel(trade.userAddress);
    const defaultBot = TERMINAL_STATUSES.has(status);
    const patch = compactRecord({
        ...getLifecycleBase(trade),
        status,
        bot: extra.bot ?? defaultBot,
        botExcutedTime:
            extra.botExcutedTime ?? (defaultBot ? Math.max(1, trade.botExcutedTime || 0) : 0),
        retryCount: extra.retryCount ?? trade.retryCount ?? 0,
        lastAttemptAt: extra.lastAttemptAt ?? Date.now(),
        ...extra,
    });

    await UserActivity.setById(String(trade._id), patch);
    Object.assign(trade, patch);
};

const setKillSwitch = (reason: string) => {
    killSwitchTriggered = true;
    activateKillSwitch(reason);
};

const getAccountEquitySnapshot = async (): Promise<AccountEquitySnapshot | null> => {
    const capturedAt = Date.now();

    try {
        const freeBalance = await getMyBalance(PROXY_WALLET);

        try {
            const myPositions: UserPositionInterface[] = await fetchData(
                `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
            );
            const openPositionValue = Array.isArray(myPositions)
                ? myPositions.reduce(
                      (sum, position) => sum + (Number(position.currentValue) || 0),
                      0
                  )
                : 0;
            const currentEquity = freeBalance + openPositionValue;

            consecutiveEquitySnapshotFailures = 0;
            updateRiskStatus({
                currentEquity,
                freeBalance,
                openPositionValue,
                equitySource: 'balance_plus_positions',
                lastEquityAt: capturedAt,
                lastEquityError: undefined,
                lastEquityErrorAt: undefined,
                consecutiveEquitySnapshotFailures,
            });

            return {
                currentEquity,
                freeBalance,
                openPositionValue,
                source: 'balance_plus_positions',
                capturedAt,
                degraded: false,
            };
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : `unknown positions fetch error: ${String(error)}`;

            consecutiveEquitySnapshotFailures += 1;
            updateRiskStatus({
                currentEquity: freeBalance,
                freeBalance,
                openPositionValue: undefined,
                equitySource: 'balance_only_fallback',
                lastEquityAt: capturedAt,
                lastEquityError: message,
                lastEquityErrorAt: capturedAt,
                consecutiveEquitySnapshotFailures,
            });

            Logger.warning(
                `Kill switch equity snapshot degraded; positions were unavailable: ${message}`
            );

            if (!PREVIEW_MODE) {
                if (consecutiveEquitySnapshotFailures >= MAX_EQUITY_SNAPSHOT_FAILURES) {
                    setKillSwitch('equity_snapshot_degraded');
                }

                return null;
            }

            return {
                currentEquity: freeBalance,
                freeBalance,
                source: 'balance_only_fallback',
                capturedAt,
                degraded: true,
                errorMessage: message,
            };
        }
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : `unknown balance fetch error: ${String(error)}`;

        consecutiveEquitySnapshotFailures += 1;
        updateRiskStatus({
            currentEquity: undefined,
            freeBalance: undefined,
            openPositionValue: undefined,
            equitySource: 'balance_unavailable',
            lastEquityAt: capturedAt,
            lastEquityError: message,
            lastEquityErrorAt: capturedAt,
            consecutiveEquitySnapshotFailures,
        });

        Logger.warning(`Kill switch equity snapshot failed: ${message}`);

        if (!PREVIEW_MODE && consecutiveEquitySnapshotFailures >= MAX_EQUITY_SNAPSHOT_FAILURES) {
            setKillSwitch('equity_snapshot_unavailable');
        }

        return null;
    }
};

const checkMonitorHealth = (): boolean => {
    const runtime = getRuntimeStatus();

    if (runtime.killSwitchActive) {
        killSwitchTriggered = true;
        return false;
    }

    if (!runtime.monitor.running) {
        setKillSwitch('monitor_worker_not_running');
        return false;
    }

    if (!runtime.monitor.lastLoopAt) {
        setKillSwitch('monitor_worker_no_heartbeat');
        return false;
    }

    if (runtime.risk.consecutiveMonitorErrors >= MAX_MONITOR_ERRORS) {
        setKillSwitch('too_many_monitor_errors');
        return false;
    }

    if (
        runtime.monitor.running &&
        runtime.monitor.lastLoopAt &&
        Date.now() - runtime.monitor.lastLoopAt > MONITOR_STALE_THRESHOLD_MS
    ) {
        setKillSwitch('monitor_worker_stale');
        return false;
    }

    return true;
};

const checkDailyLoss = async (): Promise<boolean> => {
    const today = new Date().toISOString().split('T')[0];
    const snapshot = await getAccountEquitySnapshot();

    if (!snapshot) {
        return false;
    }

    const currentEquity = snapshot.currentEquity;

    if (dailyStartDate !== today) {
        dailyStartDate = today;
        dailyStartEquity = currentEquity;
    }

    if (dailyStartEquity !== null && dailyStartEquity > 0) {
        const lossPct = ((dailyStartEquity - currentEquity) / dailyStartEquity) * 100;
        updateRiskStatus({
            dailyStartEquity,
            dailyLossPct: Number(lossPct.toFixed(4)),
        });

        if (lossPct >= DAILY_LOSS_CAP_PCT) {
            const reason = `daily_equity_drawdown_${lossPct.toFixed(2)}pct`;
            setKillSwitch(reason);
            telegram.killSwitch(lossPct);
            return false;
        }
    } else {
        updateRiskStatus({
            dailyStartEquity: dailyStartEquity ?? undefined,
            dailyLossPct: 0,
        });
    }

    return true;
};

const canExecuteTrade = async (): Promise<boolean> => {
    if (killSwitchTriggered || getRuntimeStatus().killSwitchActive) {
        killSwitchTriggered = true;
        return false;
    }

    if (PREVIEW_MODE) {
        return true;
    }

    if (!checkMonitorHealth()) {
        return false;
    }

    return checkDailyLoss();
};

const markExecutionSuccess = () => {
    consecutiveExecutionErrors = 0;
    const successAt = Date.now();
    updateRiskStatus({
        consecutiveExecutionErrors,
    });
    updateWorkerStatus('executor', {
        lastSuccessAt: successAt,
        lastError: undefined,
        lastErrorAt: undefined,
    });
    updateRuntimeStatus({
        lastSuccessAt: successAt,
        lastError: undefined,
        lastErrorAt: undefined,
    });
};

const markExecutionFailure = (message: string) => {
    consecutiveExecutionErrors += 1;
    const errorAt = Date.now();
    updateRiskStatus({
        consecutiveExecutionErrors,
    });

    updateWorkerStatus('executor', {
        lastError: message,
        lastErrorAt: errorAt,
    });
    updateRuntimeStatus({
        lastError: message,
        lastErrorAt: errorAt,
    });

    if (consecutiveExecutionErrors >= MAX_EXECUTION_ERRORS) {
        setKillSwitch('too_many_execution_errors');
    }
};

const readTempTrades = async (): Promise<TradeWithUser[]> => {
    const allTrades: TradeWithUser[] = [];

    for (const { address, model } of userActivityModels) {
        const trades = await model.find({ type: 'TRADE' }).exec();

        const pendingTrades = trades
            .filter((trade) => isPendingTrade(trade as UserActivityInterface))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        const tradesWithUser = pendingTrades.map((trade) => {
            const baseTrade =
                typeof (trade as { toObject?: () => UserActivityInterface }).toObject === 'function'
                    ? (trade as { toObject: () => UserActivityInterface }).toObject()
                    : (trade as UserActivityInterface);

            return {
                ...baseTrade,
                userAddress: address,
            };
        });

        allTrades.push(...tradesWithUser);
    }

    return allTrades;
};

const getAggregationKey = (trade: TradeWithUser): string =>
    `${trade.userAddress}:${trade.conditionId}:${trade.asset}:${trade.side}`;

const addToAggregationBuffer = (trade: TradeWithUser): void => {
    const key = getAggregationKey(trade);
    const existing = tradeAggregationBuffer.get(key);
    const now = Date.now();

    if (existing) {
        existing.trades.push(trade);
        existing.totalUsdcSize += trade.usdcSize;
        const totalValue = existing.trades.reduce(
            (sum, bufferedTrade) => sum + bufferedTrade.usdcSize * bufferedTrade.price,
            0
        );
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

const getReadyAggregatedTrades = async (): Promise<AggregatedTrade[]> => {
    const ready: AggregatedTrade[] = [];
    const now = Date.now();
    const windowMs = TRADE_AGGREGATION_WINDOW_SECONDS * 1000;

    for (const [key, aggregation] of tradeAggregationBuffer.entries()) {
        if (now - aggregation.firstTradeTime >= windowMs) {
            if (aggregation.totalUsdcSize >= TRADE_AGGREGATION_MIN_TOTAL_USD) {
                ready.push(aggregation);
            } else {
                for (const trade of aggregation.trades) {
                    await persistTradeStatus(trade, 'skipped', {
                        bot: true,
                        botExcutedTime: 1,
                        lastError: 'below_minimum_aggregated_size',
                    });
                }
            }
            tradeAggregationBuffer.delete(key);
        }
    }

    return ready;
};

const handleRetryableExecutionFailure = async (trade: TradeWithUser, message: string) => {
    const nextRetryCount = (trade.retryCount || 0) + 1;
    const terminal = nextRetryCount >= RETRY_LIMIT;

    await persistTradeStatus(trade, terminal ? 'retry_exhausted' : 'failed', {
        bot: terminal,
        botExcutedTime: terminal ? nextRetryCount : 0,
        retryCount: nextRetryCount,
        lastError: message,
    });

    markExecutionFailure(message);
};

const handleOrderSummary = (summary: TradeExecutionSummary) => {
    if (summary.status === 'failed' || summary.status === 'retry_exhausted') {
        markExecutionFailure(summary.lastError || 'order_failed');
        return;
    }

    markExecutionSuccess();
};

const applyAggregatedSummary = async (
    aggregation: AggregatedTrade,
    summary: TradeExecutionSummary
) => {
    for (const trade of aggregation.trades) {
        const sizeRatio =
            aggregation.totalUsdcSize > 0 ? trade.usdcSize / aggregation.totalUsdcSize : 0;
        const proportionalExecutedSize = Number(
            (summary.sizeExecuted * sizeRatio).toFixed(8)
        );

        await persistTradeStatus(trade, summary.status, {
            bot: true,
            botExcutedTime: summary.attemptsMade,
            orderId: summary.orderId,
            orderStatus: summary.orderStatus,
            orderResult: summary.orderResult,
            executedAt: summary.executedAt,
            lastError: summary.lastError,
            sizeRequested: trade.usdcSize,
            sizeExecuted: proportionalExecutedSize,
            myBoughtSize:
                typeof summary.myBoughtSize === 'number'
                    ? Number((summary.myBoughtSize * sizeRatio).toFixed(8))
                    : undefined,
            aggregated: true,
            aggregatedTradeCount: aggregation.trades.length,
        });
    }
};

const executeSingleTrade = async (clobClient: ClobClient | null, trade: TradeWithUser) => {
    if (!(await canExecuteTrade())) return;

    await persistTradeStatus(trade, 'processing', {
        bot: false,
        botExcutedTime: 0,
        lastError: null,
    });

    if (PREVIEW_MODE) {
        await persistTradeStatus(trade, 'skipped', {
            bot: true,
            botExcutedTime: 1,
            lastError: 'preview_mode',
        });
        markExecutionSuccess();
        return;
    }

    if (!clobClient) {
        await handleRetryableExecutionFailure(trade, 'live_client_not_initialized');
        return;
    }

    try {
        const myPositions: UserPositionInterface[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
        );
        const userPositions: UserPositionInterface[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${trade.userAddress}`
        );
        const myPosition = myPositions.find(
            (position: UserPositionInterface) => position.conditionId === trade.conditionId
        );
        const userPosition = userPositions.find(
            (position: UserPositionInterface) => position.conditionId === trade.conditionId
        );
        const myBalance = await getMyBalance(PROXY_WALLET);

        const summary = await postOrder(
            clobClient,
            trade.side === 'BUY' ? 'buy' : 'sell',
            myPosition,
            userPosition,
            trade,
            myBalance,
            trade.userAddress
        );

        Object.assign(trade, {
            status: summary.status,
            orderId: summary.orderId,
            orderStatus: summary.orderStatus,
            lastError: summary.lastError,
            executedAt: summary.executedAt,
            sizeExecuted: summary.sizeExecuted,
            myBoughtSize: summary.myBoughtSize,
        });
        handleOrderSummary(summary);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handleRetryableExecutionFailure(trade, message);
    }
};

const doTrading = async (clobClient: ClobClient | null, trades: TradeWithUser[]) => {
    for (const trade of trades) {
        await executeSingleTrade(clobClient, trade);
    }
};

const doAggregatedTrading = async (
    clobClient: ClobClient | null,
    aggregatedTrades: AggregatedTrade[]
) => {
    for (const aggregation of aggregatedTrades) {
        if (!(await canExecuteTrade())) return;

        for (const trade of aggregation.trades) {
            await persistTradeStatus(trade, 'processing', {
                bot: false,
                botExcutedTime: 0,
                lastError: null,
            });
        }

        if (PREVIEW_MODE) {
            for (const trade of aggregation.trades) {
                await persistTradeStatus(trade, 'skipped', {
                    bot: true,
                    botExcutedTime: 1,
                    lastError: 'preview_mode',
                    aggregated: true,
                    aggregatedTradeCount: aggregation.trades.length,
                });
            }
            markExecutionSuccess();
            continue;
        }

        if (!clobClient) {
            for (const trade of aggregation.trades) {
                await handleRetryableExecutionFailure(trade, 'live_client_not_initialized');
            }
            continue;
        }

        try {
            const syntheticTrade: UserActivityInterface = {
                ...aggregation.trades[0],
                usdcSize: aggregation.totalUsdcSize,
                price: aggregation.averagePrice,
                side: aggregation.side as 'BUY' | 'SELL',
            };

            const myPositions: UserPositionInterface[] = await fetchData(
                `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
            );
            const userPositions: UserPositionInterface[] = await fetchData(
                `https://data-api.polymarket.com/positions?user=${aggregation.userAddress}`
            );
            const myPosition = myPositions.find(
                (position: UserPositionInterface) =>
                    position.conditionId === aggregation.conditionId
            );
            const userPosition = userPositions.find(
                (position: UserPositionInterface) =>
                    position.conditionId === aggregation.conditionId
            );
            const myBalance = await getMyBalance(PROXY_WALLET);

            const summary = await postOrder(
                clobClient,
                aggregation.side === 'BUY' ? 'buy' : 'sell',
                myPosition,
                userPosition,
                syntheticTrade,
                myBalance,
                aggregation.userAddress
            );

            await applyAggregatedSummary(aggregation, summary);
            handleOrderSummary(summary);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            for (const trade of aggregation.trades) {
                await handleRetryableExecutionFailure(trade, message);
            }
        }
    }
};

export const stopTradeExecutor = () => {
    isRunning = false;
    updateWorkerStatus('executor', { running: false });
};

const tradeExecutor = async (clobClient: ClobClient | null) => {
    isRunning = true;
    killSwitchTriggered = false;
    consecutiveExecutionErrors = 0;
    consecutiveEquitySnapshotFailures = 0;
    dailyStartEquity = null;
    dailyStartDate = '';
    clearKillSwitch();
    updateRuntimeStatus({
        mode: PREVIEW_MODE ? 'preview' : 'live',
        lastError: undefined,
        lastErrorAt: undefined,
        aggregationQueueDepth: tradeAggregationBuffer.size,
    });
    updateRiskStatus({
        currentEquity: undefined,
        freeBalance: undefined,
        openPositionValue: undefined,
        dailyStartEquity: undefined,
        dailyLossPct: undefined,
        equitySource: 'unknown',
        lastEquityAt: undefined,
        lastEquityError: undefined,
        lastEquityErrorAt: undefined,
        consecutiveExecutionErrors: 0,
        consecutiveEquitySnapshotFailures: 0,
    });
    updateWorkerStatus('executor', {
        running: true,
        lastError: undefined,
        lastErrorAt: undefined,
    });

    let lastCheck = Date.now();
    while (isRunning) {
        try {
            updateWorkerStatus('executor', { lastLoopAt: Date.now() });
            updateRuntimeStatus({ aggregationQueueDepth: tradeAggregationBuffer.size });
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

            updateRuntimeStatus({ aggregationQueueDepth: tradeAggregationBuffer.size });
            updateWorkerStatus('executor', { lastSuccessAt: Date.now() });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            markExecutionFailure(message);
            Logger.error(`Trade executor loop error: ${message}`);
        }

        if (Date.now() - lastCheck > 300) {
            Logger.waiting(USER_ADDRESSES.length);
            lastCheck = Date.now();
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    updateWorkerStatus('executor', { running: false });
};

export default tradeExecutor;
