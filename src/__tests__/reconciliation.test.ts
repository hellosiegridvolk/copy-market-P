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
} from '../services/reconciliation';

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
});
