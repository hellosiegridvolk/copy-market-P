jest.mock('../config/env', () => ({
    ENV: {
        USER_ADDRESSES: ['0xtrader'],
        RETRY_LIMIT: 2,
        PROXY_WALLET: '0xproxy',
        TRADE_AGGREGATION_ENABLED: false,
        TRADE_AGGREGATION_WINDOW_SECONDS: 10,
    },
}));

const setById = jest.fn().mockResolvedValue(1);
const find = jest.fn();

jest.mock('../models/userHistory', () => ({
    getUserActivityModel: jest.fn(() => ({ setById, find })),
}));

jest.mock('../utils/fetchData', () => jest.fn().mockResolvedValue([]));
jest.mock('../utils/getMyBalance', () => jest.fn().mockResolvedValue(100));
jest.mock('../utils/postOrder', () => ({
    __esModule: true,
    default: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    __esModule: true,
    default: {
        error: jest.fn(),
        waiting: jest.fn(),
        warning: jest.fn(),
    },
}));
jest.mock('../utils/telegram', () => ({
    __esModule: true,
    default: { killSwitch: jest.fn() },
}));

import tradeExecutor, { stopTradeExecutor } from '../services/tradeExecutor';

const postOrder = require('../utils/postOrder').default as jest.Mock;

const waitForExecutorCycle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
};

const makeTrade = (overrides: Record<string, unknown> = {}) => ({
    _id: 'trade-1',
    type: 'TRADE',
    bot: false,
    botExcutedTime: 0,
    status: 'new',
    retryCount: 0,
    side: 'BUY',
    usdcSize: 10,
    asset: 'asset-1',
    slug: 'market-1',
    conditionId: 'condition-1',
    transactionHash: '0xhash',
    toObject() {
        return this;
    },
    ...overrides,
});

describe('trade executor lifecycle persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    });

    afterEach(async () => {
        stopTradeExecutor();
        await new Promise((resolve) => setTimeout(resolve, 10));
    });

    test('new trade moves from processing to executed', async () => {
        const trade = makeTrade();
        find.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([trade]) });
        postOrder.mockImplementationOnce(async () => {
            await setById('trade-1', {
                status: 'executed',
                bot: true,
                orderId: 'order-1',
                sizeExecuted: 4,
            });
            return {
                status: 'executed',
                attemptsMade: 1,
                orderId: 'order-1',
                orderStatus: 'executed',
                lastError: null,
                sizeRequested: 10,
                sizeExecuted: 4,
                executedAt: Date.now(),
                orderResult: {
                    success: true,
                    orderId: 'order-1',
                    status: 'executed',
                    error: null,
                    filledSize: 10,
                    averagePrice: 0.5,
                    rawStatus: 'filled',
                },
            };
        });

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycle();
        stopTradeExecutor();
        await loop;

        expect(setById).toHaveBeenCalledWith(
            'trade-1',
            expect.objectContaining({
                status: 'processing',
                bot: false,
            })
        );
        expect(setById).toHaveBeenCalledWith(
            'trade-1',
            expect.objectContaining({
                status: 'executed',
                bot: true,
                orderId: 'order-1',
            })
        );
    });

    test('retryable failure increments retry count and stays failed', async () => {
        const trade = makeTrade({ _id: 'trade-2' });
        find.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([trade]) });
        postOrder.mockRejectedValueOnce(new Error('boom'));

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycle();
        stopTradeExecutor();
        await loop;

        expect(setById).toHaveBeenCalledWith(
            'trade-2',
            expect.objectContaining({
                status: 'failed',
                retryCount: 1,
                bot: false,
                lastError: 'boom',
            })
        );
    });

    test('terminal failure transitions to retry_exhausted', async () => {
        const trade = makeTrade({
            _id: 'trade-3',
            status: 'failed',
            retryCount: 1,
        });
        find.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([trade]) });
        postOrder.mockRejectedValueOnce(new Error('still broken'));

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycle();
        stopTradeExecutor();
        await loop;

        expect(setById).toHaveBeenCalledWith(
            'trade-3',
            expect.objectContaining({
                status: 'retry_exhausted',
                retryCount: 2,
                bot: true,
                lastError: 'still broken',
            })
        );
    });

    test('already executed trade is ignored on reprocessing', async () => {
        const trade = makeTrade({
            _id: 'trade-4',
            bot: true,
            botExcutedTime: 1,
            status: 'executed',
        });
        find.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([trade]) });

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycle();
        stopTradeExecutor();
        await loop;

        expect(postOrder).not.toHaveBeenCalled();
        expect(setById).not.toHaveBeenCalledWith(
            'trade-4',
            expect.objectContaining({ status: 'processing' })
        );
    });
});
