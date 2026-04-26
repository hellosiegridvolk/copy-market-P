import {
    deriveTradeLifecycleStatus,
    exceedsPendingBuyExposureLimit,
    summarizeLocalAccounting,
} from '../services/accounting';

describe('local accounting snapshot', () => {
    test('derives legacy statuses for non-lifecycle rows', () => {
        expect(deriveTradeLifecycleStatus({ bot: false, botExcutedTime: 0 })).toBe('new');
        expect(deriveTradeLifecycleStatus({ bot: true, botExcutedTime: 999 })).toBe('skipped');
        expect(deriveTradeLifecycleStatus({ bot: true, botExcutedTime: 1 })).toBe('executed');
    });

    test('summarizes pending buy exposure across active local states and buffers', () => {
        const snapshot = summarizeLocalAccounting(
            [
                { status: 'new', side: 'BUY', usdcSize: 10 },
                { status: 'processing', side: 'BUY', sizeRequested: 20, usdcSize: 1 },
                { status: 'failed', side: 'BUY', sizeRequested: 30, usdcSize: 1 },
                { status: 'new', side: 'SELL', usdcSize: 15 },
                { status: 'executed', side: 'BUY', usdcSize: 999 },
            ],
            [{ side: 'BUY', totalUsdcSize: 12, tradeCount: 2 }]
        );

        expect(snapshot.queuedBuyExposure).toBe(10);
        expect(snapshot.processingBuyExposure).toBe(20);
        expect(snapshot.retryableBuyExposure).toBe(30);
        expect(snapshot.bufferedBuyExposure).toBe(12);
        expect(snapshot.reservedBuyExposure).toBe(72);
        expect(snapshot.pendingSellExposure).toBe(15);
        expect(snapshot.activePendingTradeCount).toBe(4);
        expect(snapshot.activePendingBuyCount).toBe(3);
        expect(snapshot.bufferedTradeCount).toBe(2);
    });

    test('flags pending exposure when local commitments exceed free balance', () => {
        const snapshot = summarizeLocalAccounting([
            { status: 'new', side: 'BUY', usdcSize: 80 },
            { status: 'failed', side: 'BUY', usdcSize: 40 },
        ]);

        expect(exceedsPendingBuyExposureLimit(100, snapshot, 100)).toBe(true);
        expect(exceedsPendingBuyExposureLimit(150, snapshot, 100)).toBe(false);
        expect(exceedsPendingBuyExposureLimit(100, snapshot, 125)).toBe(false);
    });
});
