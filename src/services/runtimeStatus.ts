export interface WorkerRuntimeStatus {
    running: boolean;
    lastLoopAt?: number;
    lastSuccessAt?: number;
    lastError?: string;
    lastErrorAt?: number;
}

export interface StreamRuntimeStatus extends WorkerRuntimeStatus {
    state: 'disabled' | 'idle' | 'connecting' | 'connected' | 'error';
    endpoint?: string;
    subscribedCount: number;
    reconnectAttempts: number;
    lastConnectAt?: number;
    lastDisconnectAt?: number;
    lastMessageAt?: number;
    lastHeartbeatAt?: number;
    lastPayloadSummary?: string;
}

export interface ReconciliationRuntimeStatus extends WorkerRuntimeStatus {
    enabled: boolean;
    scannedTrades: number;
    pendingTrades: number;
    queuedEvents: number;
    reconciledTrades: number;
    lastOrderId?: string;
    lastEventType?: string;
    lastEventStatus?: string;
}

export type EquitySnapshotSource =
    | 'unknown'
    | 'balance_plus_positions'
    | 'balance_only_fallback'
    | 'balance_unavailable';

export interface RiskRuntimeStatus {
    currentEquity?: number;
    freeBalance?: number;
    openPositionValue?: number;
    dailyStartEquity?: number;
    dailyLossPct?: number;
    equitySource: EquitySnapshotSource;
    accountingMode: 'unknown' | 'api_only' | 'api_plus_local_pending';
    queuedBuyExposure: number;
    processingBuyExposure: number;
    retryableBuyExposure: number;
    bufferedBuyExposure: number;
    reservedBuyExposure: number;
    pendingSellExposure: number;
    availableBalanceAfterPending?: number;
    activePendingTradeCount: number;
    activePendingBuyCount: number;
    bufferedTradeCount: number;
    lastEquityAt?: number;
    lastEquityError?: string;
    lastEquityErrorAt?: number;
    consecutiveExecutionErrors: number;
    consecutiveMonitorErrors: number;
    consecutiveEquitySnapshotFailures: number;
}

export interface RuntimeStatus {
    startedAt: number;
    mode: 'preview' | 'live';
    killSwitchActive: boolean;
    killSwitchReason?: string;
    lastSuccessAt?: number;
    lastError?: string;
    lastErrorAt?: number;
    aggregationQueueDepth: number;
    monitor: WorkerRuntimeStatus;
    executor: WorkerRuntimeStatus;
    marketStream: StreamRuntimeStatus;
    userStream: StreamRuntimeStatus;
    reconciliation: ReconciliationRuntimeStatus;
    risk: RiskRuntimeStatus;
}

const createWorkerState = (): WorkerRuntimeStatus => ({
    running: false,
});

const createStreamState = (endpoint?: string): StreamRuntimeStatus => ({
    running: false,
    state: 'idle',
    endpoint,
    subscribedCount: 0,
    reconnectAttempts: 0,
});

const createReconciliationState = (): ReconciliationRuntimeStatus => ({
    running: false,
    enabled: true,
    scannedTrades: 0,
    pendingTrades: 0,
    queuedEvents: 0,
    reconciledTrades: 0,
});

const createRiskState = (): RiskRuntimeStatus => ({
    equitySource: 'unknown',
    accountingMode: 'unknown',
    queuedBuyExposure: 0,
    processingBuyExposure: 0,
    retryableBuyExposure: 0,
    bufferedBuyExposure: 0,
    reservedBuyExposure: 0,
    pendingSellExposure: 0,
    activePendingTradeCount: 0,
    activePendingBuyCount: 0,
    bufferedTradeCount: 0,
    consecutiveExecutionErrors: 0,
    consecutiveMonitorErrors: 0,
    consecutiveEquitySnapshotFailures: 0,
});

const runtimeStatus: RuntimeStatus = {
    startedAt: Date.now(),
    mode: process.env.PREVIEW_MODE === 'true' ? 'preview' : 'live',
    killSwitchActive: false,
    aggregationQueueDepth: 0,
    monitor: createWorkerState(),
    executor: createWorkerState(),
    marketStream: createStreamState(process.env.CLOB_WS_URL),
    userStream: createStreamState(process.env.CLOB_WS_URL),
    reconciliation: createReconciliationState(),
    risk: createRiskState(),
};

export const getRuntimeStatus = (): RuntimeStatus => ({
    ...runtimeStatus,
    monitor: { ...runtimeStatus.monitor },
    executor: { ...runtimeStatus.executor },
    marketStream: { ...runtimeStatus.marketStream },
    userStream: { ...runtimeStatus.userStream },
    reconciliation: { ...runtimeStatus.reconciliation },
    risk: { ...runtimeStatus.risk },
});

export const updateRuntimeStatus = (patch: Partial<RuntimeStatus>): RuntimeStatus => {
    if (patch.monitor) {
        Object.assign(runtimeStatus.monitor, patch.monitor);
    }

    if (patch.executor) {
        Object.assign(runtimeStatus.executor, patch.executor);
    }

    if (patch.marketStream) {
        Object.assign(runtimeStatus.marketStream, patch.marketStream);
    }

    if (patch.userStream) {
        Object.assign(runtimeStatus.userStream, patch.userStream);
    }

    if (patch.reconciliation) {
        Object.assign(runtimeStatus.reconciliation, patch.reconciliation);
    }

    if (patch.risk) {
        Object.assign(runtimeStatus.risk, patch.risk);
    }

    const { monitor, executor, marketStream, userStream, reconciliation, risk, ...topLevelPatch } =
        patch;
    Object.assign(runtimeStatus, topLevelPatch);

    return getRuntimeStatus();
};

export const updateWorkerStatus = (
    worker: 'monitor' | 'executor',
    patch: Partial<WorkerRuntimeStatus>
): RuntimeStatus => {
    runtimeStatus[worker] = {
        ...runtimeStatus[worker],
        ...patch,
    };

    return getRuntimeStatus();
};

export const updateStreamStatus = (
    stream: 'marketStream' | 'userStream',
    patch: Partial<StreamRuntimeStatus>
): RuntimeStatus => {
    runtimeStatus[stream] = {
        ...runtimeStatus[stream],
        ...patch,
    };

    return getRuntimeStatus();
};

export const updateReconciliationStatus = (
    patch: Partial<ReconciliationRuntimeStatus>
): RuntimeStatus => {
    runtimeStatus.reconciliation = {
        ...runtimeStatus.reconciliation,
        ...patch,
    };

    return getRuntimeStatus();
};

export const updateRiskStatus = (patch: Partial<RiskRuntimeStatus>): RuntimeStatus => {
    runtimeStatus.risk = {
        ...runtimeStatus.risk,
        ...patch,
    };

    return getRuntimeStatus();
};

export const activateKillSwitch = (reason: string): RuntimeStatus =>
    updateRuntimeStatus({ killSwitchActive: true, killSwitchReason: reason });

export const clearKillSwitch = (): RuntimeStatus =>
    updateRuntimeStatus({ killSwitchActive: false, killSwitchReason: undefined });

export const resetRuntimeStatus = (): RuntimeStatus => {
    runtimeStatus.startedAt = Date.now();
    runtimeStatus.mode = process.env.PREVIEW_MODE === 'true' ? 'preview' : 'live';
    runtimeStatus.killSwitchActive = false;
    runtimeStatus.killSwitchReason = undefined;
    runtimeStatus.lastSuccessAt = undefined;
    runtimeStatus.lastError = undefined;
    runtimeStatus.lastErrorAt = undefined;
    runtimeStatus.aggregationQueueDepth = 0;
    runtimeStatus.monitor = createWorkerState();
    runtimeStatus.executor = createWorkerState();
    runtimeStatus.marketStream = createStreamState(process.env.CLOB_WS_URL);
    runtimeStatus.userStream = createStreamState(process.env.CLOB_WS_URL);
    runtimeStatus.reconciliation = createReconciliationState();
    runtimeStatus.risk = createRiskState();

    return getRuntimeStatus();
};
