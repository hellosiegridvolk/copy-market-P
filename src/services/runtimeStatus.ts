export interface WorkerRuntimeStatus {
    running: boolean;
    lastLoopAt?: number;
    lastSuccessAt?: number;
    lastError?: string;
    lastErrorAt?: number;
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
    risk: RiskRuntimeStatus;
}

const createWorkerState = (): WorkerRuntimeStatus => ({
    running: false,
});

const createRiskState = (): RiskRuntimeStatus => ({
    equitySource: 'unknown',
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
    risk: createRiskState(),
};

export const getRuntimeStatus = (): RuntimeStatus => ({
    ...runtimeStatus,
    monitor: { ...runtimeStatus.monitor },
    executor: { ...runtimeStatus.executor },
    risk: { ...runtimeStatus.risk },
});

export const updateRuntimeStatus = (patch: Partial<RuntimeStatus>): RuntimeStatus => {
    if (patch.monitor) {
        Object.assign(runtimeStatus.monitor, patch.monitor);
    }

    if (patch.executor) {
        Object.assign(runtimeStatus.executor, patch.executor);
    }

    if (patch.risk) {
        Object.assign(runtimeStatus.risk, patch.risk);
    }

    const { monitor, executor, risk, ...topLevelPatch } = patch;
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
    runtimeStatus.risk = createRiskState();

    return getRuntimeStatus();
};
