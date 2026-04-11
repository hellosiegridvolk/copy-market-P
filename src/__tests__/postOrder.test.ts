jest.mock('../config/env', () => ({
    ENV: {
        RETRY_LIMIT: 2,
        COPY_STRATEGY_CONFIG: {
            strategy: 'PERCENTAGE',
            copySize: 10.0,
            maxOrderSizeUSD: 100.0,
            minOrderSizeUSD: 1.0,
        },
        TRADE_MULTIPLIER: 1.0,
        COPY_PERCENTAGE: 10.0,
    },
}));

jest.mock('../models/userHistory', () => ({
    getUserActivityModel: jest.fn(() => ({
        updateOne: jest.fn().mockResolvedValue(1),
        setById: jest.fn().mockResolvedValue(1),
        incById: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    })),
}));

const mockLogger = { info: jest.fn(), warning: jest.fn(), error: jest.fn(), success: jest.fn(), orderResult: jest.fn(), separator: jest.fn(), trade: jest.fn(), balance: jest.fn(), header: jest.fn(), clearLine: jest.fn(), waiting: jest.fn() };
jest.mock('../utils/logger', () => ({ __esModule: true, default: mockLogger }));

import postOrder from '../utils/postOrder';
import { Side } from '@polymarket/clob-client';

const makeTrade = (overrides = {}) => ({
    _id: 'test-id-' + Math.random().toString(36).slice(2),
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
        asks: [{ price: '0.52', size: '1000' }],
        bids: [{ price: '0.48', size: '1000' }],
    }),
    createMarketOrder: jest.fn().mockResolvedValue({ signed: true }),
    postOrder: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
});

describe('postOrder', () => {
    beforeEach(() => jest.clearAllMocks());

    test('BUY: executes order when conditions are met', async () => {
        const client = makeClobClient();
        await postOrder(client as any, 'buy', undefined, undefined, makeTrade(), 1000, '0xtrader');
        expect(client.createMarketOrder).toHaveBeenCalled();
        expect(client.postOrder).toHaveBeenCalled();
    });

    test('BUY: skips when slippage too high', async () => {
        const client = makeClobClient({
            getOrderBook: jest.fn().mockResolvedValue({
                asks: [{ price: '0.60', size: '1000' }], // 0.60 - 0.50 = 0.10 > 0.05
                bids: [{ price: '0.48', size: '1000' }],
            }),
        });
        await postOrder(client as any, 'buy', undefined, undefined, makeTrade({ price: 0.50 }), 1000, '0xtrader');
        expect(client.createMarketOrder).not.toHaveBeenCalled();
    });

    test('BUY: skips when no asks available', async () => {
        const client = makeClobClient({
            getOrderBook: jest.fn().mockResolvedValue({ asks: [], bids: [] }),
        });
        await postOrder(client as any, 'buy', undefined, undefined, makeTrade(), 1000, '0xtrader');
        expect(client.createMarketOrder).not.toHaveBeenCalled();
    });

    test('BUY: skips when calculated amount is 0 (below minimum)', async () => {
        const client = makeClobClient();
        // 10% of $5 = $0.50 < $1.0 minimum
        await postOrder(client as any, 'buy', undefined, undefined, makeTrade({ usdcSize: 5 }), 1000, '0xtrader');
        expect(client.createMarketOrder).not.toHaveBeenCalled();
    });

    test('BUY: retries on failure then stops', async () => {
        const client = makeClobClient({
            postOrder: jest.fn().mockResolvedValue({ success: false, error: 'temporary error' }),
        });
        await postOrder(client as any, 'buy', undefined, undefined, makeTrade({ usdcSize: 100 }), 1000, '0xtrader');
        // RETRY_LIMIT is 2, so should attempt 2 times
        expect(client.postOrder).toHaveBeenCalledTimes(2);
    });

    test('BUY: aborts immediately on insufficient balance error', async () => {
        const client = makeClobClient({
            postOrder: jest.fn().mockResolvedValue({ success: false, error: 'not enough balance' }),
        });
        await postOrder(client as any, 'buy', undefined, undefined, makeTrade({ usdcSize: 100 }), 1000, '0xtrader');
        expect(client.postOrder).toHaveBeenCalledTimes(1); // stops after first attempt
    });

    test('SELL: sells proportional to trader sell percentage', async () => {
        const myPosition = { size: 50, avgPrice: 0.5, conditionId: 'cond1', asset: '0xasset1' };
        const userPosition = { size: 80, conditionId: 'cond1', asset: '0xasset1' }; // trader has 80 left after selling 20
        const trade = makeTrade({ side: 'SELL', size: 20, usdcSize: 10 });
        const client = makeClobClient();

        await postOrder(client as any, 'sell', myPosition as any, userPosition as any, trade, 1000, '0xtrader');
        expect(client.createMarketOrder).toHaveBeenCalled();
        const orderArgs = client.createMarketOrder.mock.calls[0][0];
        expect(orderArgs.side).toBe(Side.SELL);
    });

    test('SELL: sells entire position when trader closes entirely', async () => {
        const myPosition = { size: 50, avgPrice: 0.5, conditionId: 'cond1', asset: '0xasset1' };
        const trade = makeTrade({ side: 'SELL', size: 100, usdcSize: 50 });
        const client = makeClobClient();

        // user_position is undefined = trader closed entirely
        await postOrder(client as any, 'sell', myPosition as any, undefined, trade, 1000, '0xtrader');
        expect(client.createMarketOrder).toHaveBeenCalled();
    });

    test('SELL: skips when no position to sell', async () => {
        const client = makeClobClient();
        await postOrder(client as any, 'sell', undefined, undefined, makeTrade({ side: 'SELL' }), 1000, '0xtrader');
        expect(client.createMarketOrder).not.toHaveBeenCalled();
    });

    test('SELL: skips when sell amount below minimum', async () => {
        const myPosition = { size: 0.5, avgPrice: 0.5, conditionId: 'cond1', asset: '0xasset1' };
        const userPosition = { size: 1000, conditionId: 'cond1', asset: '0xasset1' };
        // trader selling 1 out of 1001 = 0.1% → 0.5 * 0.001 = 0.0005 tokens < 1.0 minimum
        const trade = makeTrade({ side: 'SELL', size: 1, usdcSize: 0.5 });
        const client = makeClobClient();

        await postOrder(client as any, 'sell', myPosition as any, userPosition as any, trade, 1000, '0xtrader');
        expect(client.createMarketOrder).not.toHaveBeenCalled();
    });
});
