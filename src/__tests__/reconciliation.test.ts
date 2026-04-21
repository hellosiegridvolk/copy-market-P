jest.mock('../config/env', () => ({
    ENV: {
        USER_ADDRESSES: [],
        RETRY_LIMIT: 2,
        RECONCILIATION_ENABLED: true,
        RECONCILIATION_INTERVAL_SECONDS: 15,
        RECONCILIATION_STALE_ORDER_SECONDS: 60,
    },
}));

jest.mock('../models/userHistory', () => ({
    getUserActivityModel: jest.fn(() => ({
        find: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })),
        setById: jest.fn(),
    })),
}));

const listPersistedReconciliationEvents = jest.fn().mockResolvedValue([]);
const loadReconciliationSnapshot = jest.fn().mockResolvedValue(null);
const removePersistedReconciliationEvent = jest.fn().mockResolvedValue(undefined);
const saveReconciliationSnapshot = jest.fn().mockResolvedValue(undefined);
const upsertPersistedReconciliationEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('../models/runtimeState', () => ({
    listPersistedReconciliationEvents,
    loadReconciliationSnapshot,
    removePersistedReconciliationEvent,
    saveReconciliationSnapshot,
    upsertPersistedReconciliationEvent,
}));

jest.mock('../utils/logger', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        warning: jest.fn(),
        error: jest.fn(),
        success: jest.fn(),
    },
}));

import {
    buildPatchFromOpenOrder,
    buildPatchFromStreamEvent,
    extractUserStreamEvents,
    recordUserStreamEvent,
    restorePersistedReconciliationState,
} from '../services/reconciliation';
import { getRuntimeStatus, resetRuntimeStatus } from '../services/runtimeStatus';

const makeTrade = (overrides: Record<string, unknown> = {}) =>
    ({
        _id: 'trade-1',
        type: 'TRADE',
        bot: false,
        botExcutedTime: 0,
        status: 'processing',
        retryCount: 0,
        usdcSize: 10,
        sizeRequested: 10,
        sizeExecuted: 0,
        asset: 'asset-1',
        tokenId: 'asset-1',
        conditionId: 'market-1',
        orderId: 'order-1',
        ...overrides,
    }) as any;

describe('reconciliation groundwork helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetRuntimeStatus();
        listPersistedReconciliationEvents.mockResolvedValue([]);
        loadReconciliationSnapshot.mockResolvedValue(null);
    });

    test('extractUserStreamEvents expands trade payloads by referenced order ids', () => {
        const events = extractUserStreamEvents({
            event_type: 'trade',
            status: 'CONFIRMED',
            size: '4',
            market: 'market-1',
            asset_id: 'asset-1',
            taker_order_id: 'order-1',
            maker_orders: [{ order_id: 'order-2' }],
            timestamp: '1672290701',
        });

        expect(events).toEqual([
            expect.objectContaining({
                orderId: 'order-1',
                kind: 'trade',
                status: 'CONFIRMED',
                sizeMatched: 4,
            }),
            expect.objectContaining({
                orderId: 'order-2',
                kind: 'trade',
                status: 'CONFIRMED',
                sizeMatched: 4,
            }),
        ]);
    });

    test('confirmed trade events reconcile to executed', () => {
        const patch = buildPatchFromStreamEvent(makeTrade(), {
            orderId: 'order-1',
            kind: 'trade',
            status: 'CONFIRMED',
            sizeMatched: 10,
            timestamp: 1700000000000,
        });

        expect(patch).toEqual(
            expect.objectContaining({
                status: 'executed',
                orderStatus: 'CONFIRMED',
                sizeExecuted: 10,
                bot: true,
                lastError: null,
            })
        );
    });

    test('cancellation with a partial fill reconciles to partial_fill', () => {
        const patch = buildPatchFromStreamEvent(makeTrade(), {
            orderId: 'order-1',
            kind: 'order',
            status: 'CANCELLATION',
            sizeMatched: 3,
            timestamp: 1700000000000,
        });

        expect(patch).toEqual(
            expect.objectContaining({
                status: 'partial_fill',
                orderStatus: 'CANCELLATION',
                sizeExecuted: 3,
                lastError: 'remaining_size_cancelled',
            })
        );
    });

    test('open-order reconciliation marks partial fills from matched size', () => {
        const patch = buildPatchFromOpenOrder(makeTrade(), {
            id: 'order-1',
            status: 'LIVE',
            owner: 'owner',
            maker_address: 'maker',
            market: 'market-1',
            asset_id: 'asset-1',
            side: 'BUY',
            original_size: '10',
            size_matched: '4',
            price: '0.5',
            associate_trades: [],
            outcome: 'YES',
            created_at: 1700000000,
            expiration: '0',
            order_type: 'FAK',
        });

        expect(patch).toEqual(
            expect.objectContaining({
                status: 'partial_fill',
                orderStatus: 'LIVE',
                sizeExecuted: 4,
                lastError: 'remaining_size_unfilled',
            })
        );
    });

    test('recordUserStreamEvent persists normalized events for restart recovery', async () => {
        const persisted = await recordUserStreamEvent({
            event_type: 'order',
            type: 'PLACEMENT',
            id: 'order-1',
            size_matched: '0',
            timestamp: '1672290701',
            market: 'market-1',
            asset_id: 'asset-1',
        });

        expect(persisted).toBe(1);
        expect(upsertPersistedReconciliationEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'order-1',
                orderId: 'order-1',
                kind: 'order',
                status: 'PLACEMENT',
                market: 'market-1',
                assetId: 'asset-1',
            })
        );

        const runtime = getRuntimeStatus();
        expect(runtime.reconciliation.queuedEvents).toBe(1);
        expect(runtime.reconciliation.persistedQueuedEvents).toBe(1);
        expect(saveReconciliationSnapshot).toHaveBeenCalled();
    });

    test('restorePersistedReconciliationState hydrates runtime truth from disk', async () => {
        loadReconciliationSnapshot.mockResolvedValue({
            savedAt: 1700000005000,
            scannedTrades: 4,
            pendingTrades: 2,
            queuedEvents: 1,
            persistedQueuedEvents: 1,
            restoredQueuedEvents: 0,
            reconciledTrades: 8,
            lastLoopAt: 1700000004000,
            lastSuccessAt: 1700000004500,
            lastOrderId: 'order-1',
            lastEventType: 'trade',
            lastEventStatus: 'CONFIRMED',
        });
        listPersistedReconciliationEvents.mockResolvedValue([
            {
                _id: 'order-1',
                orderId: 'order-1',
                kind: 'trade',
                status: 'CONFIRMED',
                sizeMatched: 10,
                market: 'market-1',
                assetId: 'asset-1',
                timestamp: 1700000000000,
                savedAt: 1700000001000,
            },
        ]);

        await restorePersistedReconciliationState();

        const runtime = getRuntimeStatus();
        expect(runtime.reconciliation.queuedEvents).toBe(1);
        expect(runtime.reconciliation.persistedQueuedEvents).toBe(1);
        expect(runtime.reconciliation.restoredQueuedEvents).toBe(1);
        expect(runtime.reconciliation.reconciledTrades).toBe(8);
        expect(runtime.reconciliation.lastOrderId).toBe('order-1');
        expect(runtime.reconciliation.lastPersistenceAt).toBe(1700000005000);
        expect(runtime.reconciliation.restoredFromDiskAt).toEqual(expect.any(Number));
    });
});
