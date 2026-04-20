import { ENV } from '../config/env';
import { getUserActivityModel, getUserPositionModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';
import Logger from '../utils/logger';
import {
    activateKillSwitch,
    updateRiskStatus,
    updateRuntimeStatus,
    updateWorkerStatus,
} from './runtimeStatus';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const TOO_OLD_TIMESTAMP = ENV.TOO_OLD_TIMESTAMP;
const FETCH_INTERVAL = ENV.FETCH_INTERVAL;
const PREVIEW_MODE = ENV.PREVIEW_MODE;
const MAX_MONITOR_ERRORS = ENV.KILL_SWITCH_MONITOR_ERROR_LIMIT;

if (!USER_ADDRESSES || USER_ADDRESSES.length === 0) {
    throw new Error('USER_ADDRESSES is not defined or empty');
}

// Create activity and position models for each user
const userModels = USER_ADDRESSES.map((address) => ({
    address,
    UserActivity: getUserActivityModel(address),
    UserPosition: getUserPositionModel(address),
}));

interface FetchTradeCycleResult {
    newTradesDetected: number;
    hadError: boolean;
}

const buildActivityRecord = (address: string, activity: any) => ({
    proxyWallet: activity.proxyWallet,
    timestamp: activity.timestamp,
    conditionId: activity.conditionId,
    type: activity.type,
    size: activity.size,
    usdcSize: activity.usdcSize,
    transactionHash: activity.transactionHash,
    price: activity.price,
    asset: activity.asset,
    side: activity.side,
    outcomeIndex: activity.outcomeIndex,
    title: activity.title,
    slug: activity.slug,
    icon: activity.icon,
    eventSlug: activity.eventSlug,
    outcome: activity.outcome,
    name: activity.name,
    pseudonym: activity.pseudonym,
    bio: activity.bio,
    profileImage: activity.profileImage,
    profileImageOptimized: activity.profileImageOptimized,
    bot: false,
    botExcutedTime: 0,
    status: 'new',
    retryCount: 0,
    lastError: null,
    lastAttemptAt: null,
    executedAt: null,
    orderId: null,
    orderStatus: null,
    orderResult: null,
    tokenId: activity.asset,
    marketSlug: activity.slug,
    sizeRequested: activity.usdcSize,
    sizeExecuted: 0,
    detectedAt: Date.now(),
    sourceTrader: address,
    sourceTradeId: activity.transactionHash,
});

const init = async () => {
    const counts: number[] = [];
    for (const { address, UserActivity } of userModels) {
        const count = await UserActivity.countDocuments();
        counts.push(count);
    }
    Logger.clearLine();
    Logger.dbConnection(USER_ADDRESSES, counts);

    // Show your own positions first
    try {
        const myPositionsUrl = `https://data-api.polymarket.com/positions?user=${ENV.PROXY_WALLET}`;
        const myPositions = await fetchData(myPositionsUrl);

        // Get current USDC balance
        const getMyBalance = (await import('../utils/getMyBalance')).default;
        const currentBalance = await getMyBalance(ENV.PROXY_WALLET);

        if (Array.isArray(myPositions) && myPositions.length > 0) {
            // Calculate your overall profitability and initial investment
            let totalValue = 0;
            let initialValue = 0;
            let weightedPnl = 0;
            myPositions.forEach((pos: any) => {
                const value = pos.currentValue || 0;
                const initial = pos.initialValue || 0;
                const pnl = pos.percentPnl || 0;
                totalValue += value;
                initialValue += initial;
                weightedPnl += value * pnl;
            });
            const myOverallPnl = totalValue > 0 ? weightedPnl / totalValue : 0;

            // Get top 5 positions by profitability (PnL)
            const myTopPositions = myPositions
                .sort((a: any, b: any) => (b.percentPnl || 0) - (a.percentPnl || 0))
                .slice(0, 5);

            Logger.clearLine();
            Logger.myPositions(
                ENV.PROXY_WALLET,
                myPositions.length,
                myTopPositions,
                myOverallPnl,
                totalValue,
                initialValue,
                currentBalance
            );
        } else {
            Logger.clearLine();
            Logger.myPositions(ENV.PROXY_WALLET, 0, [], 0, 0, 0, currentBalance);
        }
    } catch (error) {
        Logger.error(`Failed to fetch your positions: ${error}`);
    }

    // Show current positions count with details for traders you're copying
    const positionCounts: number[] = [];
    const positionDetails: any[][] = [];
    const profitabilities: number[] = [];
    for (const { address, UserPosition } of userModels) {
        const positions = await UserPosition.find().exec();
        positionCounts.push(positions.length);

        // Calculate overall profitability (weighted average by current value)
        let totalValue = 0;
        let weightedPnl = 0;
        positions.forEach((pos) => {
            const value = pos.currentValue || 0;
            const pnl = pos.percentPnl || 0;
            totalValue += value;
            weightedPnl += value * pnl;
        });
        const overallPnl = totalValue > 0 ? weightedPnl / totalValue : 0;
        profitabilities.push(overallPnl);

        // Get top 3 positions by profitability (PnL)
        const topPositions = positions
            .sort((a, b) => (b.percentPnl || 0) - (a.percentPnl || 0))
            .slice(0, 3)
            .map((position) =>
                typeof (position as { toObject?: () => unknown }).toObject === 'function'
                    ? (position as { toObject: () => unknown }).toObject()
                    : position
            );
        positionDetails.push(topPositions);
    }
    Logger.clearLine();
    Logger.tradersPositions(USER_ADDRESSES, positionCounts, positionDetails, profitabilities);
};

const fetchTradeDataForTrader = async ({
    address,
    UserActivity,
    UserPosition,
}: typeof userModels[number]): Promise<FetchTradeCycleResult> => {
    try {
        let newTradesDetected = 0;

        // Fetch trade activities from Polymarket API
        const apiUrl = `https://data-api.polymarket.com/activity?user=${address}&type=TRADE`;
        const activities = await fetchData(apiUrl);

        if (!Array.isArray(activities) || activities.length === 0) {
            return { newTradesDetected: 0, hadError: false };
        }

        // Process each activity
        const cutoffTimestamp = Date.now() / 1000 - TOO_OLD_TIMESTAMP * 3600;
        for (const activity of activities) {
            if (activity.timestamp < cutoffTimestamp) continue;

            const exists = await UserActivity.findOne({
                transactionHash: activity.transactionHash,
            }).exec();
            if (exists) continue;

            await UserActivity(buildActivityRecord(address, activity)).save();
            newTradesDetected += 1;
            Logger.info(`New trade detected for ${address.slice(0, 6)}...${address.slice(-4)}`);
        }

        // Also fetch and update positions
        const positionsUrl = `https://data-api.polymarket.com/positions?user=${address}`;
        const positions = await fetchData(positionsUrl);

        if (Array.isArray(positions) && positions.length > 0) {
            for (const position of positions) {
                await UserPosition.findOneAndUpdate(
                    { asset: position.asset, conditionId: position.conditionId },
                    {
                        proxyWallet: position.proxyWallet,
                        asset: position.asset,
                        conditionId: position.conditionId,
                        size: position.size,
                        avgPrice: position.avgPrice,
                        initialValue: position.initialValue,
                        currentValue: position.currentValue,
                        cashPnl: position.cashPnl,
                        percentPnl: position.percentPnl,
                        totalBought: position.totalBought,
                        realizedPnl: position.realizedPnl,
                        percentRealizedPnl: position.percentRealizedPnl,
                        curPrice: position.curPrice,
                        redeemable: position.redeemable,
                        mergeable: position.mergeable,
                        title: position.title,
                        slug: position.slug,
                        icon: position.icon,
                        eventSlug: position.eventSlug,
                        outcome: position.outcome,
                        outcomeIndex: position.outcomeIndex,
                        oppositeOutcome: position.oppositeOutcome,
                        oppositeAsset: position.oppositeAsset,
                        endDate: position.endDate,
                        negativeRisk: position.negativeRisk,
                    },
                    { upsert: true }
                );
            }
        }
        return { newTradesDetected, hadError: false };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateWorkerStatus('monitor', { lastError: message, lastErrorAt: Date.now() });
        updateRuntimeStatus({ lastError: message, lastErrorAt: Date.now() });
        Logger.error(
            `Error fetching data for ${address.slice(0, 6)}...${address.slice(-4)}: ${message}`
        );
        return { newTradesDetected: 0, hadError: true };
    }
};

// Parallel fetch for all traders
const fetchTradeData = async () => {
    const results = await Promise.allSettled(userModels.map(fetchTradeDataForTrader));

    return results.reduce(
        (summary, result) => {
            if (result.status === 'fulfilled') {
                summary.newTradesDetected += result.value.newTradesDetected ?? 0;
                summary.hadError = summary.hadError || result.value.hadError;
                return summary;
            }

            summary.hadError = true;
            return summary;
        },
        { newTradesDetected: 0, hadError: false } as FetchTradeCycleResult
    );
};

// Track if this is the first run
let isFirstRun = true;
// Track if monitor should continue running
let isRunning = true;
let consecutiveMonitorErrors = 0;

const markMonitorSuccess = (successAt: number) => {
    consecutiveMonitorErrors = 0;
    updateRiskStatus({
        consecutiveMonitorErrors,
    });
    updateWorkerStatus('monitor', {
        lastSuccessAt: successAt,
        lastError: undefined,
        lastErrorAt: undefined,
    });
    updateRuntimeStatus({
        lastSuccessAt: successAt,
    });
};

const markMonitorFailure = (message: string) => {
    consecutiveMonitorErrors += 1;
    const errorAt = Date.now();

    updateRiskStatus({
        consecutiveMonitorErrors,
    });
    updateWorkerStatus('monitor', {
        lastError: message,
        lastErrorAt: errorAt,
    });
    updateRuntimeStatus({
        lastError: message,
        lastErrorAt: errorAt,
    });

    if (!PREVIEW_MODE && consecutiveMonitorErrors >= MAX_MONITOR_ERRORS) {
        activateKillSwitch('too_many_monitor_errors');
    }
};

/**
 * Stop the trade monitor gracefully
 */
export const stopTradeMonitor = () => {
    isRunning = false;
    updateWorkerStatus('monitor', { running: false });
    Logger.info('Trade monitor shutdown requested...');
};

const tradeMonitor = async () => {
    isRunning = true;
    consecutiveMonitorErrors = 0;
    updateRuntimeStatus({
        mode: PREVIEW_MODE ? 'preview' : 'live',
    });
    updateRiskStatus({
        consecutiveMonitorErrors: 0,
    });
    updateWorkerStatus('monitor', { running: true, lastError: undefined, lastErrorAt: undefined });
    await init();
    Logger.success(`Monitoring ${USER_ADDRESSES.length} trader(s) every ${FETCH_INTERVAL}s`);
    Logger.separator();

    // On first run, mark all existing historical trades as already processed
    if (isFirstRun) {
        Logger.info('First run: marking all historical trades as processed...');
        for (const { address, UserActivity } of userModels) {
            const count = await UserActivity.updateMany(
                { bot: false, status: { $exists: false } },
                {
                    bot: true,
                    botExcutedTime: 999,
                    status: 'skipped',
                    lastError: 'historical_trade_on_first_run',
                }
            );
            if (count.modifiedCount > 0) {
                Logger.info(
                    `Marked ${count.modifiedCount} historical trades as processed for ${address.slice(0, 6)}...${address.slice(-4)}`
                );
            }
        }
        isFirstRun = false;
        Logger.success('\nHistorical trades processed. Now monitoring for new trades only.');
        Logger.separator();
    }

    while (isRunning) {
        try {
            updateWorkerStatus('monitor', { lastLoopAt: Date.now() });
            const { newTradesDetected, hadError } = await fetchTradeData();
            const successAt = Date.now();

            if (hadError) {
                markMonitorFailure('one_or_more_trader_fetches_failed');
            } else {
                markMonitorSuccess(successAt);
            }

            if (newTradesDetected > 0) {
                Logger.info(`Detected ${newTradesDetected} new trade(s) across tracked traders`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            markMonitorFailure(message);
            Logger.error(`Trade monitor loop error: ${message}`);
        }

        if (!isRunning) break;
        await new Promise((resolve) => setTimeout(resolve, FETCH_INTERVAL * 1000));
    }

    updateWorkerStatus('monitor', { running: false });
    Logger.info('Trade monitor stopped');
};

export default tradeMonitor;
