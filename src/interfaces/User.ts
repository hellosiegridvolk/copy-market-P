export type TradeLifecycleStatus =
    | 'new'
    | 'processing'
    | 'executed'
    | 'skipped'
    | 'failed'
    | 'retry_exhausted'
    | 'partial_fill';

export interface UserActivityInterface {
    _id?: string;
    proxyWallet: string;
    timestamp: number;
    conditionId: string;
    type: string;
    size: number;
    usdcSize: number;
    transactionHash: string;
    price: number;
    asset: string;
    side: string;
    outcomeIndex: number;
    title: string;
    slug: string;
    icon: string;
    eventSlug: string;
    outcome: string;
    name: string;
    pseudonym: string;
    bio: string;
    profileImage: string;
    profileImageOptimized: string;
    bot: boolean;
    botExcutedTime: number;
    myBoughtSize?: number;
    status?: TradeLifecycleStatus;
    retryCount?: number;
    lastError?: string | null;
    lastAttemptAt?: number | null;
    executedAt?: number | null;
    orderId?: string | null;
    orderStatus?: string | null;
    orderResult?: Record<string, unknown> | null;
    tokenId?: string | null;
    marketSlug?: string | null;
    sizeRequested?: number | null;
    sizeExecuted?: number | null;
    detectedAt?: number | null;
    sourceTrader?: string | null;
    sourceTradeId?: string | null;
    aggregated?: boolean;
    aggregatedTradeCount?: number;
    streamEventType?: string | null;
    streamEventStatus?: string | null;
    streamLastUpdateAt?: number | null;
    reconciledAt?: number | null;
}

export interface UserPositionInterface {
    _id?: string;
    proxyWallet: string;
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    initialValue: number;
    currentValue: number;
    cashPnl: number;
    percentPnl: number;
    totalBought: number;
    realizedPnl: number;
    percentRealizedPnl: number;
    curPrice: number;
    redeemable: boolean;
    mergeable: boolean;
    title: string;
    slug: string;
    icon: string;
    eventSlug: string;
    outcome: string;
    outcomeIndex: number;
    oppositeOutcome: string;
    oppositeAsset: string;
    endDate: string;
    negativeRisk: boolean;
}
