jest.mock('../config/env', () => ({
    ENV: {
        RETRY_LIMIT: 2,
        COPY_STRATEGY_CONFIG: {
            strategy: 'PERCENTAGE',
            copySize: 100.0,
            maxOrderSizeUSD: 100.0,
            minOrderSizeUSD: 1.0,
        },
        TRADE_MULTIPLIER: 1.0,
        COPY_PERCENTAGE: 100.0,
    },
}));

const setById = jest.fn().mockResolvedValue(1);
const incById = jest.fn().mockResolvedValue(1);
const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
const find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

jest.mock('../models/userHistory', () => ({
    getUserActivityModel: jest.fn(() => ({
        setById,
        incById,
        updateMany,
        find,
    })),
}));

jest.mock('../utils/logger', () => ({
    __esModule: true,
    default: {
        error: jest.fn(),
    },
}));

import postOrder, { normalizeOrderResult } from '../utils/postOrder';

const makeTrade = (overrides: Record<string, unknown> = {}) => ({
    _id: 'test-trade',
    proxyWallet: '0xtrader',
    timestamp: Date.now() / 1000,
    conditionId: 'cond1',
    type: 'TRADE',
    size: 100,
    usdcSize: 50,
    transactionHash: '0xtx1',
    price: 0.5,
    asset: '0xasset1',
    side: 'BUY',
    outcomeIndex: 0,
    title: 'Test Market',
    slug: 'test-market',
    icon: '',
    eventSlug: 'test-event',
    outcome: 'Yes',
    name: 'Trader',
    pseudonym: '',
    bio: '',
    profileImage: '',
    profileImageOptimized: '',
    bot: false,
    botExcutedTime: 0,
    ...overrides,
});

const makeClobClient = (overrides: Record<string, unknown> = {}) => ({
    getOrderBook: jest.fn().mockResolvedValue({
        asks: [{ price: '0.50', size: '1000' }],
        bids: [{ price: '0.48', size: '1000' }],
    }),
    createMarketOrder: jest.fn().mockResolvedValue({ signed: true }),
    postOrder: jest.fn().mockResolvedValue({ success: true, orderID: 'order-1' }),
    ...overrides,
});

describe('postOrder persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    });

    test('normalizeOrderResult classifies successful executions', () => {
        expect(normalizeOrderResult({ success: true, orderID: 'abc' }, 50)).toEqual(
            expect.objectContaining({
                success: true,
                status: 'executed',
                orderId: 'abc',
                error: null,
            })
        );
    });

    test('successful buy persists executed state with normalized order details', async () => {
        const client = makeClobClient({
            postOrder: jest.fn().mockResolvedValue({ success: true, orderID: 'order-success' }),
        });

        const summary = await postOrder(
            client as any,
            'buy',
            undefined,
            undefined,
            makeTrade(),
            1000,
            '0xtrader'
        );

        expect(summary.status).toBe('executed');
        expect(summary.orderId).toBe('order-success');
        expect(summary.sizeExecuted).toBeGreaterThan(0);
        expect(setById).toHaveBeenLastCalledWith(
            'test-trade',
            expect.objectContaining({
                status: 'executed',
                bot: true,
                orderId: 'order-success',
                orderStatus: 'executed',
                lastError: null,
            })
        );
    });

    test('rejected orders persist retry exhaustion and retry count', async () => {
        const client = makeClobClient({
            postOrder: jest.fn().mockResolvedValue({ success: false, error: 'rejected' }),
        });

        const summary = await postOrder(
            client as any,
            'buy',
            undefined,
            undefined,
            makeTrade({ _id: 'test-trade-rejected' }),
            1000,
            '0xtrader'
        );

        expect(summary.status).toBe('retry_exhausted');
        expect(summary.lastError).toBe('rejected');
        expect(incById).toHaveBeenCalledTimes(2);
        expect(setById).toHaveBeenLastCalledWith(
            'test-trade-rejected',
            expect.objectContaining({
                status: 'retry_exhausted',
                bot: true,
                lastError: 'rejected',
            })
        );
    });

    test('partial fills remain partial_fill and preserve normalized order status', async () => {
        const client = makeClobClient({
            getOrderBook: jest
                .fn()
                .mockResolvedValueOnce({
                    asks: [{ price: '0.50', size: '1000' }],
                    bids: [{ price: '0.48', size: '1000' }],
                })
                .mockResolvedValueOnce({ asks: [], bids: [] }),
            postOrder: jest.fn().mockResolvedValue({
                success: true,
                status: 'partially_filled',
                orderID: 'order-partial',
                filledSize: 25,
            }),
        });

        const summary = await postOrder(
            client as any,
            'buy',
            undefined,
            undefined,
            makeTrade({ _id: 'test-trade-partial' }),
            1000,
            '0xtrader'
        );

        expect(summary.status).toBe('partial_fill');
        expect(summary.orderStatus).toBe('partial_fill');
        expect(summary.orderResult).toEqual(
            expect.objectContaining({
                success: true,
                status: 'partial_fill',
                orderId: 'order-partial',
            })
        );
        expect(setById).toHaveBeenLastCalledWith(
            'test-trade-partial',
            expect.objectContaining({
                status: 'partial_fill',
                bot: true,
                orderStatus: 'partial_fill',
            })
        );
    });
});
