export interface RuntimeStatus {
    startedAt: number;
    isRunning: boolean;
    mode: 'preview' | 'live';
    killSwitchTriggered: boolean;
    killSwitchReason?: string;
    lastPollAt?: number;
    lastPollSuccessAt?: number;
    lastExecutionSuccessAt?: number;
    lastError?: string;
    lastErrorAt?: number;
    queueDepth?: number;
}

const runtimeStatus: RuntimeStatus = {
    startedAt: Date.now(),
    isRunning: false,
    mode: process.env.PREVIEW_MODE === 'true' ? 'preview' : 'live',
    killSwitchTriggered: false,
};

export const getRuntimeStatus = (): RuntimeStatus => ({ ...runtimeStatus });

export const updateRuntimeStatus = (patch: Partial<RuntimeStatus>): RuntimeStatus => {
    Object.assign(runtimeStatus, patch);
    return getRuntimeStatus();
};
