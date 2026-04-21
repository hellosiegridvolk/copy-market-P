import { ClobClient, OpenOrder } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import { TradeLifecycleStatus, UserActivityInterface } from '../interfaces/User';
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

type StreamEventKind = 'order' | 'trade';

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

export interface NormalizedUserStreamEvent {
    orderId: string;
    kind: StreamEventKind;
    status: string;
    sizeMatched: number | null;
    market?: string;
    assetId?: string;
    timestamp: number | null;
}

const TERMINAL_TRADE_STATUSES = new Set<TradeLifecycleStatus>([
    'executed',
    'skipped',
    'retry_exhausted',
]);

const activeEventQueue = new Map<string, NormalizedUserStreamEvent>();

let isRunning = false;
let totalReconciledTrades = 0;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const markReconciliationRecoveryPending = (reason: string) => {
    const now = Date.now();
    const runtime = getRuntimeStatus();

    updateReconciliationStatus({
        recoveryPending: true,
        recoveryReason: reason,
        recoveryStartedAt: runtime.reconciliation.recoveryStartedAt ?? now,
    });
};

export const clearReconciliationRecoveryPending = () => {
    if (!getRuntimeStatus().reconciliation.recoveryPending) {
        return;
    }

    updateReconciliationStatus({
        recoveryPending: false,
        recoveryReason: undefined,
        recoveryStartedAt: undefined,
        lastRecoveredAt: Date.now(),
    });
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

export const recordUserStreamEvent = (payload: unknown): number => {
    const normalizedEvents = extractUserStreamEvents(payload);

    for (const event of normalizedEvents) {
        queueEvent(event);
        updateReconciliationStatus({
            queuedEvents: activeEventQueue.size,
            lastOrderId: event.orderId,
            lastEventType: event.kind,
            lastEventStatus: event.status,
            lastSuccessAt: Date.now(),
        });
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
    });

    for (const trade of candidates) {
        if (!trade.orderId) {
            continue;
        }

        const queuedEvent = activeEventQueue.get(trade.orderId);
        if (queuedEvent) {
            const patch = buildPatchFromStreamEvent(trade, queuedEvent);
            await applyPatch(trade, patch);
            activeEventQueue.delete(trade.orderId);
            reconciledThisCycle += 1;

            updateReconciliationStatus({
                queuedEvents: activeEventQueue.size,
                lastOrderId: trade.orderId,
                lastEventType: queuedEvent.kind,
                lastEventStatus: queuedEvent.status,
            });
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

    const successAt = Date.now();
    updateReconciliationStatus({
        lastSuccessAt: successAt,
        reconciledTrades: totalReconciledTrades,
        queuedEvents: activeEventQueue.size,
        pendingTrades: candidates.length,
    });

    if (getRuntimeStatus().reconciliation.recoveryPending) {
        clearReconciliationRecoveryPending();
    }
};

export const stopTradeReconciliation = () => {
    isRunning = false;
    updateReconciliationStatus({ running: false });
};

export const startTradeReconciliation = (clobClient: ClobClient | null) => {
    totalReconciledTrades = 0;
    activeEventQueue.clear();

    if (!RECONCILIATION_ENABLED) {
        updateReconciliationStatus({
            enabled: false,
            running: false,
            queuedEvents: 0,
            recoveryPending: false,
            recoveryReason: undefined,
            recoveryStartedAt: undefined,
        });
        return;
    }

    if (isRunning) {
        return;
    }

    isRunning = true;
    updateReconciliationStatus({
        enabled: true,
        running: true,
        queuedEvents: 0,
        scannedTrades: 0,
        pendingTrades: 0,
        reconciledTrades: 0,
        recoveryPending: false,
        recoveryReason: undefined,
        recoveryStartedAt: undefined,
        lastRecoveredAt: undefined,
        lastError: undefined,
        lastErrorAt: undefined,
    });

    const loop = async () => {
        while (isRunning) {
            try {
                await runReconciliationCycle(clobClient);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                updateReconciliationStatus({
                    lastError: message,
                    lastErrorAt: Date.now(),
                });
                Logger.error(`Trade reconciliation error: ${message}`);
            }

            await delay(RECONCILIATION_INTERVAL_MS);
        }
    };

    void loop();
};
