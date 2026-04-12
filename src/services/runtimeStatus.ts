export interface WorkerRuntimeStatus {
    running: boolean;
    lastLoopAt?: number;
    lastSuccessAt?: number;
    lastError?: string;
    lastErrorAt?: number;
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
}

const createWorkerState = (): WorkerRuntimeStatus => ({
    running: false,
});

const runtimeStatus: RuntimeStatus = {
    startedAt: Date.now(),
    mode: process.env.PREVIEW_MODE === 'true' ? 'preview' : 'live',
    killSwitchActive: false,
    aggregationQueueDepth: 0,
    monitor: createWorkerState(),
    executor: createWorkerState(),
};

export const getRuntimeStatus = (): RuntimeStatus => ({
    ...runtimeStatus,
    monitor: { ...runtimeStatus.monitor },
    executor: { ...runtimeStatus.executor },
});

export const updateRuntimeStatus = (patch: Partial<RuntimeStatus>): RuntimeStatus => {
    if (patch.monitor) {
        Object.assign(runtimeStatus.monitor, patch.monitor);
    }

    if (patch.executor) {
        Object.assign(runtimeStatus.executor, patch.executor);
    }

    const { monitor, executor, ...topLevelPatch } = patch;
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

    return getRuntimeStatus();
};
