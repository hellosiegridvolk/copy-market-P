jest.mock('../config/env', () => ({
    ENV: {
        USER_ADDRESSES: ['0xtrader'],
        RETRY_LIMIT: 2,
        PROXY_WALLET: '0xproxy',
        PREVIEW_MODE: false,
        DAILY_LOSS_CAP_PCT: 20,
        KILL_SWITCH_MAX_ERRORS: 5,
        KILL_SWITCH_EQUITY_FALLBACK_LIMIT: 3,
        KILL_SWITCH_MONITOR_ERROR_LIMIT: 5,
        KILL_SWITCH_MONITOR_STALE_SECONDS: 15,
        KILL_SWITCH_PENDING_EXPOSURE_LIMIT_PCT: 100,
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
import { getRuntimeStatus, resetRuntimeStatus, updateRuntimeStatus } from '../services/runtimeStatus';

const postOrder = require('../utils/postOrder').default as jest.Mock;
const fetchData = require('../utils/fetchData') as jest.Mock;

const waitForExecutorCycle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
};

const waitForExecutorCycles = async (count: number) => {
    for (let index = 0; index < count; index += 1) {
        await waitForExecutorCycle();
    }
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
        resetRuntimeStatus();
        updateRuntimeStatus({
            monitor: {
                running: true,
                lastLoopAt: Date.now(),
            },
        });
        find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
        fetchData.mockResolvedValue([]);
    });

    afterEach(async () => {
        stopTradeExecutor();
        await new Promise((resolve) => setTimeout(resolve, 10));
        resetRuntimeStatus();
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

    test('live mode trips the kill switch after repeated degraded equity snapshots', async () => {
        const trade = makeTrade({ _id: 'trade-5' });
        find.mockReturnValue({ exec: jest.fn().mockResolvedValue([trade]) });
        fetchData.mockRejectedValue(new Error('positions down'));

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycles(4);
        stopTradeExecutor();
        await loop;

        const runtime = getRuntimeStatus();
        expect(postOrder).not.toHaveBeenCalled();
        expect(runtime.killSwitchActive).toBe(true);
        expect(runtime.killSwitchReason).toBe('equity_snapshot_degraded');
        expect(runtime.risk.equitySource).toBe('balance_only_fallback');
        expect(runtime.risk.consecutiveEquitySnapshotFailures).toBeGreaterThanOrEqual(3);
    });

    test('live mode trips the kill switch when the monitor heartbeat is stale', async () => {
        const trade = makeTrade({ _id: 'trade-6' });
        find.mockReturnValue({ exec: jest.fn().mockResolvedValue([trade]) });
        updateRuntimeStatus({
            monitor: {
                running: true,
                lastLoopAt: Date.now() - 20000,
            },
        });

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycle();
        stopTradeExecutor();
        await loop;

        const runtime = getRuntimeStatus();
        expect(postOrder).not.toHaveBeenCalled();
        expect(runtime.killSwitchActive).toBe(true);
        expect(runtime.killSwitchReason).toBe('monitor_worker_stale');
    });

    test('live mode trips the kill switch when the monitor is not running', async () => {
        const trade = makeTrade({ _id: 'trade-7' });
        find.mockReturnValue({ exec: jest.fn().mockResolvedValue([trade]) });
        updateRuntimeStatus({
            monitor: {
                running: false,
            },
        });

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycle();
        stopTradeExecutor();
        await loop;

        const runtime = getRuntimeStatus();
        expect(postOrder).not.toHaveBeenCalled();
        expect(runtime.killSwitchActive).toBe(true);
        expect(runtime.killSwitchReason).toBe('monitor_worker_not_running');
    });

    test('live mode trips the kill switch when local pending exposure exceeds free balance', async () => {
        const firstTrade = makeTrade({ _id: 'trade-8', usdcSize: 60 });
        const secondTrade = makeTrade({ _id: 'trade-9', usdcSize: 50, transactionHash: '0xhash-2' });
        find.mockReturnValue({
            exec: jest.fn().mockResolvedValue([firstTrade, secondTrade]),
        });

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycle();
        stopTradeExecutor();
        await loop;

        const runtime = getRuntimeStatus();
        expect(postOrder).not.toHaveBeenCalled();
        expect(runtime.killSwitchActive).toBe(true);
        expect(runtime.killSwitchReason).toBe('pending_buy_exposure_exceeds_free_balance');
        expect(runtime.risk.reservedBuyExposure).toBe(110);
        expect(runtime.risk.availableBalanceAfterPending).toBe(-10);
    });

    test('live mode pauses execution while reconciliation recovery is still pending after a stream gap', async () => {
        const trade = makeTrade({ _id: 'trade-10' });
        find.mockReturnValue({ exec: jest.fn().mockResolvedValue([trade]) });
        updateRuntimeStatus({
            reconciliation: {
                enabled: true,
                running: true,
                queuedEvents: 1,
                scannedTrades: 1,
                pendingTrades: 1,
                reconciledTrades: 0,
                recoveryPending: true,
                recoveryReason: 'user_stream_disconnected',
                recoveryStartedAt: Date.now() - 5000,
            },
        });

        const loop = tradeExecutor({} as any);
        await waitForExecutorCycle();
        stopTradeExecutor();
        await loop;

        const runtime = getRuntimeStatus();
        expect(postOrder).not.toHaveBeenCalled();
        expect(runtime.killSwitchActive).toBe(false);
        expect(runtime.lastError).toBe(
            'waiting_for_post_gap_reconciliation:user_stream_disconnected'
        );
    });
});
