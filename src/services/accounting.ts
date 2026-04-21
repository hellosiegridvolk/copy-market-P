import { TradeLifecycleStatus, UserActivityInterface } from '../interfaces/User';

export interface BufferedTradeExposure {
    side: string;
    totalUsdcSize: number;
    tradeCount?: number;
}

export interface LocalAccountingSnapshot {
    accountingMode: 'api_only' | 'api_plus_local_pending';
    queuedBuyExposure: number;
    processingBuyExposure: number;
    retryableBuyExposure: number;
    bufferedBuyExposure: number;
    reservedBuyExposure: number;
    pendingSellExposure: number;
    activePendingTradeCount: number;
    activePendingBuyCount: number;
    bufferedTradeCount: number;
}

type AccountingTradeLike = Pick<UserActivityInterface, 'side' | 'sizeRequested' | 'usdcSize'> & {
    status?: TradeLifecycleStatus;
    bot?: boolean;
    botExcutedTime?: number;
};

const isTerminalStatus = (status?: TradeLifecycleStatus): boolean =>
    status === 'executed' ||
    status === 'skipped' ||
    status === 'retry_exhausted' ||
    status === 'partial_fill';

export const deriveTradeLifecycleStatus = (
    trade: Pick<AccountingTradeLike, 'status' | 'bot' | 'botExcutedTime'>
): TradeLifecycleStatus => {
    if (trade.status) {
        return trade.status;
    }

    if (trade.bot === true) {
        return trade.botExcutedTime === 999 ? 'skipped' : 'executed';
    }

    return 'new';
};

const getRequestedExposureUsd = (
    trade: Pick<UserActivityInterface, 'sizeRequested' | 'usdcSize'>
): number => {
    const requested = Number(trade.sizeRequested ?? trade.usdcSize ?? 0);
    return Number.isFinite(requested) && requested > 0 ? requested : 0;
};

const isBuySide = (side?: string | null): boolean => String(side || '').toUpperCase() === 'BUY';

export const summarizeLocalAccounting = (
    trades: AccountingTradeLike[],
    bufferedTrades: BufferedTradeExposure[] = []
): LocalAccountingSnapshot => {
    const snapshot: LocalAccountingSnapshot = {
        accountingMode: 'api_plus_local_pending',
        queuedBuyExposure: 0,
        processingBuyExposure: 0,
        retryableBuyExposure: 0,
        bufferedBuyExposure: 0,
        reservedBuyExposure: 0,
        pendingSellExposure: 0,
        activePendingTradeCount: 0,
        activePendingBuyCount: 0,
        bufferedTradeCount: 0,
    };

    for (const trade of trades) {
        const status = deriveTradeLifecycleStatus(trade);
        if (isTerminalStatus(status)) {
            continue;
        }

        const exposureUsd = getRequestedExposureUsd(trade);
        snapshot.activePendingTradeCount += 1;

        if (isBuySide(trade.side)) {
            snapshot.activePendingBuyCount += 1;

            if (status === 'processing') {
                snapshot.processingBuyExposure += exposureUsd;
            } else if (status === 'failed') {
                snapshot.retryableBuyExposure += exposureUsd;
            } else {
                snapshot.queuedBuyExposure += exposureUsd;
            }
        } else {
            snapshot.pendingSellExposure += exposureUsd;
        }
    }

    for (const bufferedTrade of bufferedTrades) {
        const tradeCount = Number(bufferedTrade.tradeCount ?? 0);
        if (tradeCount > 0) {
            snapshot.bufferedTradeCount += tradeCount;
        }

        if (!isBuySide(bufferedTrade.side)) {
            continue;
        }

        const bufferedExposure = Number(bufferedTrade.totalUsdcSize || 0);
        if (Number.isFinite(bufferedExposure) && bufferedExposure > 0) {
            snapshot.bufferedBuyExposure += bufferedExposure;
        }
    }

    snapshot.reservedBuyExposure =
        snapshot.queuedBuyExposure +
        snapshot.processingBuyExposure +
        snapshot.retryableBuyExposure +
        snapshot.bufferedBuyExposure;

    return snapshot;
};

export const exceedsPendingBuyExposureLimit = (
    freeBalance: number,
    snapshot: LocalAccountingSnapshot,
    limitPct: number
): boolean => {
    if (!Number.isFinite(freeBalance) || freeBalance <= 0) {
        return snapshot.reservedBuyExposure > 0;
    }

    const normalizedLimitPct = Number.isFinite(limitPct) && limitPct > 0 ? limitPct : 100;
    return snapshot.reservedBuyExposure > freeBalance * (normalizedLimitPct / 100);
};
