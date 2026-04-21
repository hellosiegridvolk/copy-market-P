import { ClobClient, OpenOrder } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import {
    NormalizedUserStreamEvent,
    PersistedUserStreamEvent,
    ReconciliationSnapshot,
} from '../interfaces/Reconciliation';
import { TradeLifecycleStatus, UserActivityInterface } from '../interfaces/User';
import {
    listPersistedReconciliationEvents,
    loadReconciliationSnapshot,
    removePersistedReconciliationEvent,
    saveReconciliationSnapshot,
    upsertPersistedReconciliationEvent,
} from '../models/runtimeState';
import { getUserActivityModel } from '../models/userHistory';
import Logger from '../utils/logger';
import { getRuntimeStatus, updateReconciliationStatus } from './runtimeStatus';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const RETRY_LIMIT = ENV.RETRY_LIMIT;
const RECONCILIATION_ENABLED = ENV.RECONCILIATION_ENABLED;
const RECONCILIATION_INTERVAL_MS = ENV.RECONCILIATION_INTERVAL_SECONDS * 1000;
const RECONCILIATION_STALE_ORDER_MS = ENV.RECONCILIATION_STALE_ORDER_SECONDS * 1000;

const userActivityModels = USER_ADDRESSES.map((address) => ({
    address,
    model: getUserActivityModel(address),
}));

interface UserTradeMakerOrder {
    order_id?: string;
}

interface RawUserTradeEvent {
    event_type?: string;
    status?: string;
    size?: string | number;
    timestamp?: string | number;
    matchtime?: string | number;
    market?: string;
    asset_id?: string;
    taker_order_id?: string;
    maker_orders?: UserTradeMakerOrder[];
}

interface RawUserOrderEvent {
    event_type?: string;
    type?: string;
    id?: string;
    size_matched?: string | number;
    timestamp?: string | number;
    market?: string;
    asset_id?: string;
}

const TERMINAL_TRADE_STATUSES = new Set<TradeLifecycleStatus>([
    'executed',
    'skipped',
    'retry_exhausted',
]);

const activeEventQueue = new Map<string, NormalizedUserStreamEvent>();

let isRunning = false;
let totalReconciledTrades = 0;
let lastRestoredQueuedEvents = 0;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toPersistedEvent = (event: NormalizedUserStreamEvent): PersistedUserStreamEvent => ({
    _id: event.orderId,
    ...event,
    savedAt: Date.now(),
});

const buildSnapshot = (): ReconciliationSnapshot => {
    const reconciliation = getRuntimeStatus().reconciliation;

    return {
        savedAt: Date.now(),
        scannedTrades: reconciliation.scannedTrades,
        pendingTrades: reconciliation.pendingTrades,
        queuedEvents: reconciliation.queuedEvents,
        persistedQueuedEvents: reconciliation.persistedQueuedEvents,
        restoredQueuedEvents: reconciliation.restoredQueuedEvents,
        reconciledTrades: reconciliation.reconciledTrades,
        lastLoopAt: reconciliation.lastLoopAt,
        lastSuccessAt: reconciliation.lastSuccessAt,
        lastError: reconciliation.lastError,
        lastErrorAt: reconciliation.lastErrorAt,
        lastOrderId: reconciliation.lastOrderId,
        lastEventType: reconciliation.lastEventType,
        lastEventStatus: reconciliation.lastEventStatus,
    };
};

const persistSnapshot = async () => {
    try {
        await saveReconciliationSnapshot(buildSnapshot());
    } catch (error) {
        Logger.warning(
            `Unable to persist reconciliation snapshot: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
};

const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

const toTimestamp = (value: unknown): number | null => {
    const parsed = toNumber(value);
    if (parsed === null) {
        return null;
    }

    return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
};

const normalizeOrderId = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const toBaseTrade = (trade: UserActivityInterface): UserActivityInterface => {
    const maybeDoc = trade as UserActivityInterface & { toObject?: () => UserActivityInterface };
    return typeof maybeDoc.toObject === 'function' ? maybeDoc.toObject() : trade;
};

const isCandidateTrade = (trade: UserActivityInterface): boolean => {
    if (trade.type !== 'TRADE') {
        return false;
    }

    if (!trade.orderId) {
        return trade.status === 'processing';
    }

    if (!trade.status) {
        return true;
    }

    return !TERMINAL_TRADE_STATUSES.has(trade.status);
};

export const restorePersistedReconciliationState = async () => {
    const [snapshot, persistedEvents] = await Promise.all([
        loadReconciliationSnapshot(),
        listPersistedReconciliationEvents(),
    ]);

    activeEventQueue.clear();
    for (const event of persistedEvents) {
        activeEventQueue.set(event.orderId, {
            orderId: event.orderId,
            kind: event.kind,
            status: event.status,
            sizeMatched: event.sizeMatched,
            market: event.market,
            assetId: event.assetId,
            timestamp: event.timestamp,
        });
    }

    lastRestoredQueuedEvents = persistedEvents.length;
    totalReconciledTrades = snapshot?.reconciledTrades ?? 0;

    updateReconciliationStatus({
        scannedTrades: snapshot?.scannedTrades ?? 0,
        pendingTrades: snapshot?.pendingTrades ?? 0,
        queuedEvents: activeEventQueue.size,
        persistedQueuedEvents: activeEventQueue.size,
        restoredQueuedEvents: lastRestoredQueuedEvents,
        reconciledTrades: totalReconciledTrades,
        lastLoopAt: snapshot?.lastLoopAt,
        lastSuccessAt: snapshot?.lastSuccessAt,
        lastError: snapshot?.lastError,
        lastErrorAt: snapshot?.lastErrorAt,
        lastOrderId: snapshot?.lastOrderId,
        lastEventType: snapshot?.lastEventType,
        lastEventStatus: snapshot?.lastEventStatus,
        lastPersistenceAt: snapshot?.savedAt,
        restoredFromDiskAt: snapshot || persistedEvents.length > 0 ? Date.now() : undefined,
    });

    return {
        snapshot,
        persistedEvents,
    };
};

export const extractUserStreamEvents = (payload: unknown): NormalizedUserStreamEvent[] => {
    if (!payload || typeof payload !== 'object') {
        return [];
    }

    const record = payload as Record<string, unknown>;
    const eventType =
        typeof record.event_type === 'string' ? record.event_type.toLowerCase().trim() : '';

    if (eventType === 'order') {
        const orderEvent = payload as RawUserOrderEvent;
        const orderId = normalizeOrderId(orderEvent.id);
        if (!orderId) {
            return [];
        }

        return [
            {
                orderId,
                kind: 'order',
                status: String(orderEvent.type || '').toUpperCase(),
                sizeMatched: toNumber(orderEvent.size_matched),
                market: orderEvent.market,
                assetId: orderEvent.asset_id,
                timestamp: toTimestamp(orderEvent.timestamp),
            },
        ];
    }

    if (eventType === 'trade') {
        const tradeEvent = payload as RawUserTradeEvent;
        const orderIds = new Set<string>();
        const takerOrderId = normalizeOrderId(tradeEvent.taker_order_id);
        if (takerOrderId) {
            orderIds.add(takerOrderId);
        }

        for (const makerOrder of tradeEvent.maker_orders || []) {
            const makerOrderId = normalizeOrderId(makerOrder.order_id);
            if (makerOrderId) {
                orderIds.add(makerOrderId);
            }
        }

        return [...orderIds].map((orderId) => ({
            orderId,
            kind: 'trade',
            status: String(tradeEvent.status || '').toUpperCase(),
            sizeMatched: toNumber(tradeEvent.size),
            market: tradeEvent.market,
            assetId: tradeEvent.asset_id,
            timestamp: toTimestamp(tradeEvent.matchtime ?? tradeEvent.timestamp),
        }));
    }

    return [];
};

export const buildPatchFromStreamEvent = (
    trade: UserActivityInterface,
    event: NormalizedUserStreamEvent
): Record<string, unknown> => {
    const now = Date.now();
    const sizeRequested = trade.sizeRequested ?? trade.usdcSize;
    const sizeExecuted =
        event.sizeMatched !== null
            ? Math.min(sizeRequested, event.sizeMatched)
            : (trade.sizeExecuted ?? 0);

    const basePatch: Record<string, unknown> = {
        orderStatus: event.status || null,
        streamEventType: event.kind,
        streamEventStatus: event.status || null,
        streamLastUpdateAt: event.timestamp ?? now,
        reconciledAt: now,
        lastAttemptAt: now,
    };

    if (event.market) {
        basePatch.marketSlug = trade.marketSlug ?? trade.slug;
    }

    if (event.assetId) {
        basePatch.tokenId = trade.tokenId ?? trade.asset;
    }

    if (event.sizeMatched !== null) {
        basePatch.sizeExecuted = sizeExecuted;
    }

    if (event.kind === 'trade') {
        switch (event.status) {
            case 'CONFIRMED':
                return {
                    ...basePatch,
                    status: 'executed',
                    bot: true,
                    botExcutedTime: Math.max(1, trade.botExcutedTime || 1),
                    executedAt: event.timestamp ?? now,
                    lastError: null,
                };
            case 'FAILED':
                return {
                    ...basePatch,
                    status:
                        (trade.retryCount || 0) >= RETRY_LIMIT ? 'retry_exhausted' : 'failed',
                    bot: (trade.retryCount || 0) >= RETRY_LIMIT,
                    lastError: 'user_stream_trade_failed',
                };
            case 'MATCHED':
            case 'MINED':
            case 'RETRYING':
                return {
                    ...basePatch,
                    status: 'processing',
                    bot: false,
                    lastError: event.status === 'RETRYING' ? 'user_stream_retrying' : null,
                };
            default:
                return basePatch;
        }
    }

    switch (event.status) {
        case 'PLACEMENT':
            return {
                ...basePatch,
                status: trade.status ?? 'processing',
                bot: false,
            };
        case 'UPDATE':
            if (sizeExecuted >= sizeRequested && sizeRequested > 0) {
                return {
                    ...basePatch,
                    status: 'executed',
                    bot: true,
                    botExcutedTime: Math.max(1, trade.botExcutedTime || 1),
                    executedAt: event.timestamp ?? now,
                    lastError: null,
                };
            }

            if (sizeExecuted > 0) {
                return {
                    ...basePatch,
                    status: 'partial_fill',
                    bot: true,
                    botExcutedTime: Math.max(1, trade.botExcutedTime || 1),
                    executedAt: event.timestamp ?? now,
                    lastError: 'remaining_size_unfilled',
                };
            }

            return {
                ...basePatch,
                status: 'processing',
                bot: false,
            };
        case 'CANCELLATION':
            if (sizeExecuted > 0) {
                return {
                    ...basePatch,
                    status: 'partial_fill',
                    bot: true,
                    botExcutedTime: Math.max(1, trade.botExcutedTime || 1),
                    executedAt: event.timestamp ?? now,
                    lastError: 'remaining_size_cancelled',
                };
            }

            return {
                ...basePatch,
                status: (trade.retryCount || 0) >= RETRY_LIMIT ? 'retry_exhausted' : 'failed',
                bot: (trade.retryCount || 0) >= RETRY_LIMIT,
                lastError: 'order_cancelled',
            };
        default:
            return basePatch;
    }
};

export const buildPatchFromOpenOrder = (
    trade: UserActivityInterface,
    order: OpenOrder
): Record<string, unknown> => {
    const sizeMatched = toNumber(order.size_matched) ?? 0;
    const sizeRequested = trade.sizeRequested ?? trade.usdcSize;
    const now = Date.now();

    if (sizeMatched >= sizeRequested && sizeRequested > 0) {
        return {
            orderStatus: order.status,
            sizeExecuted: sizeRequested,
            status: 'executed',
            executedAt: now,
            streamEventType: 'rest_reconciliation',
            streamEventStatus: order.status,
            streamLastUpdateAt: now,
            reconciledAt: now,
            lastError: null,
            bot: true,
            botExcutedTime: Math.max(1, trade.botExcutedTime || 1),
        };
    }

    if (sizeMatched > 0) {
        return {
            orderStatus: order.status,
            sizeExecuted: Math.min(sizeRequested, sizeMatched),
            status: 'partial_fill',
            executedAt: now,
            streamEventType: 'rest_reconciliation',
            streamEventStatus: order.status,
            streamLastUpdateAt: now,
            reconciledAt: now,
            lastError: 'remaining_size_unfilled',
            bot: true,
            botExcutedTime: Math.max(1, trade.botExcutedTime || 1),
        };
    }

    return {
        orderStatus: order.status,
        status: 'processing',
        streamEventType: 'rest_reconciliation',
        streamEventStatus: order.status,
        streamLastUpdateAt: now,
        reconciledAt: now,
        bot: false,
    };
};

const queueEvent = (event: NormalizedUserStreamEvent) => {
    activeEventQueue.set(event.orderId, event);
};

export const recordUserStreamEvent = async (payload: unknown): Promise<number> => {
    const normalizedEvents = extractUserStreamEvents(payload);

    for (const event of normalizedEvents) {
        queueEvent(event);
        await upsertPersistedReconciliationEvent(toPersistedEvent(event));
        updateReconciliationStatus({
            queuedEvents: activeEventQueue.size,
            persistedQueuedEvents: activeEventQueue.size,
            lastOrderId: event.orderId,
            lastEventType: event.kind,
            lastEventStatus: event.status,
            lastSuccessAt: Date.now(),
            lastPersistenceAt: Date.now(),
        });
        await persistSnapshot();
    }

    return normalizedEvents.length;
};

const readCandidateTrades = async (): Promise<Array<UserActivityInterface & { userAddress: string }>> => {
    const candidates: Array<UserActivityInterface & { userAddress: string }> = [];

    for (const { address, model } of userActivityModels) {
        const trades = await model.find({ type: 'TRADE' }).exec();
        for (const trade of trades) {
            const baseTrade = toBaseTrade(trade as UserActivityInterface);
            if (isCandidateTrade(baseTrade)) {
                candidates.push({
                    ...baseTrade,
                    userAddress: address,
                });
            }
        }
    }

    return candidates;
};

const applyPatch = async (
    trade: UserActivityInterface & { userAddress: string },
    patch: Record<string, unknown>
) => {
    const UserActivity = getUserActivityModel(trade.userAddress);
    await UserActivity.setById(String(trade._id), patch);
    Object.assign(trade, patch);
};

const runReconciliationCycle = async (clobClient: ClobClient | null) => {
    const candidates = await readCandidateTrades();
    let reconciledThisCycle = 0;

    updateReconciliationStatus({
        running: true,
        enabled: RECONCILIATION_ENABLED,
        lastLoopAt: Date.now(),
        scannedTrades: candidates.length,
        pendingTrades: candidates.length,
        queuedEvents: activeEventQueue.size,
        persistedQueuedEvents: activeEventQueue.size,
    });
    await persistSnapshot();

    for (const trade of candidates) {
        if (!trade.orderId) {
            continue;
        }

        const queuedEvent = activeEventQueue.get(trade.orderId);
        if (queuedEvent) {
            const patch = buildPatchFromStreamEvent(trade, queuedEvent);
            await applyPatch(trade, patch);
            activeEventQueue.delete(trade.orderId);
            await removePersistedReconciliationEvent(trade.orderId);
            reconciledThisCycle += 1;

            updateReconciliationStatus({
                queuedEvents: activeEventQueue.size,
                persistedQueuedEvents: activeEventQueue.size,
                lastOrderId: trade.orderId,
                lastEventType: queuedEvent.kind,
                lastEventStatus: queuedEvent.status,
                lastPersistenceAt: Date.now(),
            });
            await persistSnapshot();
            continue;
        }

        if (
            clobClient &&
            trade.lastAttemptAt &&
            Date.now() - trade.lastAttemptAt >= RECONCILIATION_STALE_ORDER_MS
        ) {
            try {
                const openOrder = await clobClient.getOrder(trade.orderId);
                const patch = buildPatchFromOpenOrder(trade, openOrder);
                await applyPatch(trade, patch);
                reconciledThisCycle += 1;

                updateReconciliationStatus({
                    lastOrderId: trade.orderId,
                    lastEventType: 'rest_reconciliation',
                    lastEventStatus: String(openOrder.status || ''),
                });
                await persistSnapshot();
            } catch (error) {
                Logger.warning(
                    `Reconciliation lookup failed for order ${trade.orderId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }
    }

    totalReconciledTrades += reconciledThisCycle;

    updateReconciliationStatus({
        lastSuccessAt: Date.now(),
        reconciledTrades: totalReconciledTrades,
        queuedEvents: activeEventQueue.size,
        persistedQueuedEvents: activeEventQueue.size,
        pendingTrades: candidates.length,
    });
    await persistSnapshot();
};

export const stopTradeReconciliation = () => {
    isRunning = false;
    updateReconciliationStatus({ running: false });
    void persistSnapshot();
};

export const startTradeReconciliation = (clobClient: ClobClient | null) => {
    totalReconciledTrades = 0;
    lastRestoredQueuedEvents = 0;
    activeEventQueue.clear();

    if (!RECONCILIATION_ENABLED) {
        updateReconciliationStatus({
            enabled: false,
            running: false,
            queuedEvents: 0,
            persistedQueuedEvents: 0,
            restoredQueuedEvents: 0,
        });
        void persistSnapshot();
        return;
    }

    if (isRunning) {
        return;
    }

    isRunning = true;
    const loop = async () => {
        try {
            await restorePersistedReconciliationState();
        } catch (error) {
            Logger.warning(
                `Unable to restore reconciliation state from disk: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        updateReconciliationStatus({
            enabled: true,
            running: true,
            queuedEvents: activeEventQueue.size,
            persistedQueuedEvents: activeEventQueue.size,
            restoredQueuedEvents: lastRestoredQueuedEvents,
            scannedTrades: getRuntimeStatus().reconciliation.scannedTrades || 0,
            pendingTrades: getRuntimeStatus().reconciliation.pendingTrades || 0,
            reconciledTrades: totalReconciledTrades,
        });
        await persistSnapshot();

        while (isRunning) {
            try {
                await runReconciliationCycle(clobClient);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                updateReconciliationStatus({
                    lastError: message,
                    lastErrorAt: Date.now(),
                });
                await persistSnapshot();
                Logger.error(`Trade reconciliation error: ${message}`);
            }

            await delay(RECONCILIATION_INTERVAL_MS);
        }
    };

    void loop();
};
