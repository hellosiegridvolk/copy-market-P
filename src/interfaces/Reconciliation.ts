export type StreamEventKind = 'order' | 'trade';

export interface NormalizedUserStreamEvent {
    orderId: string;
    kind: StreamEventKind;
    status: string;
    sizeMatched: number | null;
    market?: string;
    assetId?: string;
    timestamp: number | null;
}

export interface PersistedUserStreamEvent extends NormalizedUserStreamEvent {
    _id?: string;
    savedAt: number;
}

export interface ReconciliationSnapshot {
    savedAt: number;
    scannedTrades: number;
    pendingTrades: number;
    queuedEvents: number;
    persistedQueuedEvents: number;
    restoredQueuedEvents: number;
    reconciledTrades: number;
    lastLoopAt?: number;
    lastSuccessAt?: number;
    lastError?: string;
    lastErrorAt?: number;
    lastOrderId?: string;
    lastEventType?: string;
    lastEventStatus?: string;
}
