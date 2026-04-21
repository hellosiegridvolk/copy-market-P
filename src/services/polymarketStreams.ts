import { ApiKeyCreds, ClobClient } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import { TradeLifecycleStatus, UserActivityInterface } from '../interfaces/User';
import { getUserActivityModel } from '../models/userHistory';
import Logger from '../utils/logger';
import { markReconciliationRecoveryPending, recordUserStreamEvent } from './reconciliation';
import { updateStreamStatus } from './runtimeStatus';

const WebSocket = require('ws');

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const MARKET_WS_ENABLED = ENV.MARKET_WS_ENABLED;
const USER_WS_ENABLED = ENV.USER_WS_ENABLED;
const RECONCILIATION_ENABLED = ENV.RECONCILIATION_ENABLED;
const STREAM_TARGET_REFRESH_MS = ENV.STREAM_TARGET_REFRESH_INTERVAL_SECONDS * 1000;
const STREAM_HEARTBEAT_MS = ENV.STREAM_HEARTBEAT_INTERVAL_SECONDS * 1000;

type StreamName = 'marketStream' | 'userStream';
type Operation = 'subscribe' | 'unsubscribe';
type WsLike = any;

const streamModels = USER_ADDRESSES.map((address) => ({
    address,
    model: getUserActivityModel(address),
}));

const STREAMABLE_STATUSES = new Set<TradeLifecycleStatus>([
    'new',
    'processing',
    'failed',
    'partial_fill',
]);

interface StreamTargets {
    assetIds: string[];
    markets: string[];
}

interface StreamController {
    socket: WsLike | null;
    targets: Set<string>;
    heartbeatTimer: NodeJS.Timeout | null;
    reconnectTimer: NodeJS.Timeout | null;
    reconnectAttempts: number;
}

const controllers: Record<StreamName, StreamController> = {
    marketStream: {
        socket: null,
        targets: new Set<string>(),
        heartbeatTimer: null,
        reconnectTimer: null,
        reconnectAttempts: 0,
    },
    userStream: {
        socket: null,
        targets: new Set<string>(),
        heartbeatTimer: null,
        reconnectTimer: null,
        reconnectAttempts: 0,
    },
};

let activeClobClient: ClobClient | null = null;
let isRunning = false;
let targetRefreshTimer: NodeJS.Timeout | null = null;

const toBaseTrade = (trade: UserActivityInterface): UserActivityInterface => {
    const maybeDoc = trade as UserActivityInterface & { toObject?: () => UserActivityInterface };
    return typeof maybeDoc.toObject === 'function' ? maybeDoc.toObject() : trade;
};

const isStreamableTrade = (trade: UserActivityInterface): boolean => {
    if (trade.type !== 'TRADE') {
        return false;
    }

    if (!trade.status) {
        return !trade.bot && trade.botExcutedTime === 0;
    }

    return STREAMABLE_STATUSES.has(trade.status);
};

export const buildChannelEndpoint = (baseUrl: string, channel: 'market' | 'user'): string => {
    const trimmed = baseUrl.replace(/\/+$/, '');

    if (trimmed.endsWith(`/ws/${channel}`)) {
        return trimmed;
    }

    if (trimmed.endsWith('/ws')) {
        return `${trimmed}/${channel}`;
    }

    return `${trimmed}/ws/${channel}`;
};

export const collectStreamTargets = (trades: UserActivityInterface[]): StreamTargets => {
    const assetIds = new Set<string>();
    const markets = new Set<string>();

    for (const trade of trades) {
        if (!isStreamableTrade(trade)) {
            continue;
        }

        const assetId = trade.tokenId ?? trade.asset;
        if (assetId) {
            assetIds.add(assetId);
        }

        if (trade.conditionId) {
            markets.add(trade.conditionId);
        }
    }

    return {
        assetIds: [...assetIds],
        markets: [...markets],
    };
};

export const buildMarketSubscription = (assetIds: string[]) => ({
    assets_ids: assetIds,
    type: 'market',
    custom_feature_enabled: true,
});

export const buildUserSubscription = (markets: string[], creds: ApiKeyCreds) => ({
    auth: {
        apiKey: creds.key,
        secret: creds.secret,
        passphrase: creds.passphrase,
    },
    markets,
    type: 'user',
});

export const buildStreamDeltaPayload = (
    stream: StreamName,
    targets: string[],
    operation: Operation
) =>
    stream === 'marketStream'
        ? {
              assets_ids: targets,
              operation,
              custom_feature_enabled: true,
          }
        : {
              markets: targets,
              operation,
          };

export const shouldRequireRecoverySync = (
    stream: StreamName,
    targetCount: number
): boolean => stream === 'userStream' && RECONCILIATION_ENABLED && targetCount > 0;

const clearTimer = (timer: NodeJS.Timeout | null) => {
    if (timer) {
        clearInterval(timer);
        clearTimeout(timer);
    }
};

const closeStream = (stream: StreamName, nextState: 'idle' | 'disabled' = 'idle') => {
    const controller = controllers[stream];

    clearTimer(controller.heartbeatTimer);
    controller.heartbeatTimer = null;

    if (controller.socket) {
        controller.socket.removeAllListeners?.();
        controller.socket.close?.();
        controller.socket = null;
    }

    controller.targets.clear();
    updateStreamStatus(stream, {
        running: false,
        state: nextState,
        subscribedCount: 0,
        lastDisconnectAt: Date.now(),
    });
};

const markStreamError = (stream: StreamName, message: string) => {
    if (shouldRequireRecoverySync(stream, controllers[stream].targets.size)) {
        markReconciliationRecoveryPending('user_stream_error');
    }

    updateStreamStatus(stream, {
        running: false,
        state: 'error',
        lastError: message,
        lastErrorAt: Date.now(),
    });
};

const scheduleReconnect = (stream: StreamName, callback: () => Promise<void>) => {
    if (!isRunning) {
        return;
    }

    const controller = controllers[stream];
    clearTimer(controller.reconnectTimer);

    controller.reconnectAttempts += 1;
    updateStreamStatus(stream, {
        reconnectAttempts: controller.reconnectAttempts,
    });

    controller.reconnectTimer = setTimeout(() => {
        void callback();
    }, 2000);
};

const sendPayload = (stream: StreamName, payload: Record<string, unknown>) => {
    const controller = controllers[stream];
    if (!controller.socket || controller.socket.readyState !== WebSocket.OPEN) {
        return;
    }

    controller.socket.send(JSON.stringify(payload));
    updateStreamStatus(stream, {
        lastPayloadSummary:
            stream === 'marketStream'
                ? `assets=${Array.isArray(payload.assets_ids) ? payload.assets_ids.length : 0}`
                : `markets=${Array.isArray(payload.markets) ? payload.markets.length : 0}`,
    });
};

const startHeartbeat = (stream: StreamName) => {
    const controller = controllers[stream];
    clearTimer(controller.heartbeatTimer);

    controller.heartbeatTimer = setInterval(() => {
        if (controller.socket && controller.socket.readyState === WebSocket.OPEN) {
            controller.socket.send('PING');
            updateStreamStatus(stream, {
                lastHeartbeatAt: Date.now(),
            });
        }
    }, STREAM_HEARTBEAT_MS);
};

const handleMessage = (stream: StreamName, data: unknown) => {
    const raw =
        typeof data === 'string'
            ? data
            : Buffer.isBuffer(data)
              ? data.toString('utf8')
              : String(data);

    const now = Date.now();
    if (raw === 'PONG') {
        updateStreamStatus(stream, {
            lastHeartbeatAt: now,
        });
        return;
    }

    updateStreamStatus(stream, {
        lastMessageAt: now,
    });

    try {
        const parsed = JSON.parse(raw);
        const payloads = Array.isArray(parsed) ? parsed : [parsed];

        if (stream === 'userStream') {
            for (const payload of payloads) {
                recordUserStreamEvent(payload);
            }
        }
    } catch {
        // Ignore non-JSON frames beyond the heartbeat.
    }
};

const connectStream = async (
    stream: StreamName,
    endpoint: string,
    initialPayload: Record<string, unknown>,
    syncCallback: () => Promise<void>
) => {
    const controller = controllers[stream];
    if (controller.socket && controller.socket.readyState === WebSocket.OPEN) {
        return;
    }

    updateStreamStatus(stream, {
        running: true,
        state: 'connecting',
        endpoint,
    });

    const socket = new WebSocket(endpoint);
    controller.socket = socket;

    socket.on('open', () => {
        controller.reconnectAttempts = 0;
        updateStreamStatus(stream, {
            running: true,
            state: 'connected',
            lastConnectAt: Date.now(),
            reconnectAttempts: 0,
            lastError: undefined,
            lastErrorAt: undefined,
            subscribedCount:
                stream === 'marketStream'
                    ? Array.isArray(initialPayload.assets_ids)
                        ? initialPayload.assets_ids.length
                        : 0
                    : Array.isArray(initialPayload.markets)
                      ? initialPayload.markets.length
                      : 0,
        });
        sendPayload(stream, initialPayload);
        startHeartbeat(stream);
    });

    socket.on('message', (data: unknown) => handleMessage(stream, data));

    socket.on('error', (error: Error) => {
        markStreamError(stream, error.message);
    });

    socket.on('close', () => {
        clearTimer(controller.heartbeatTimer);
        controller.heartbeatTimer = null;
        controller.socket = null;

        if (shouldRequireRecoverySync(stream, controller.targets.size)) {
            markReconciliationRecoveryPending('user_stream_disconnected');
        }

        updateStreamStatus(stream, {
            running: false,
            state: controller.targets.size > 0 ? 'error' : 'idle',
            lastDisconnectAt: Date.now(),
        });

        if (controller.targets.size > 0) {
            scheduleReconnect(stream, syncCallback);
        }
    });
};

const readStreamTargetsFromDb = async (): Promise<StreamTargets> => {
    const trades: UserActivityInterface[] = [];

    for (const { model } of streamModels) {
        const docs = await model.find({ type: 'TRADE' }).exec();
        for (const doc of docs) {
            trades.push(toBaseTrade(doc as UserActivityInterface));
        }
    }

    return collectStreamTargets(trades);
};

const syncMarketStream = async (targets: StreamTargets) => {
    const desiredTargets = new Set(targets.assetIds);
    const controller = controllers.marketStream;

    if (!MARKET_WS_ENABLED) {
        closeStream('marketStream', 'disabled');
        return;
    }

    if (desiredTargets.size === 0) {
        closeStream('marketStream', 'idle');
        return;
    }

    if (!controller.socket || controller.socket.readyState !== WebSocket.OPEN) {
        controller.targets = desiredTargets;
        await connectStream(
            'marketStream',
            buildChannelEndpoint(ENV.CLOB_WS_URL, 'market'),
            buildMarketSubscription([...desiredTargets]),
            syncAllStreams
        );
        return;
    }

    const additions = [...desiredTargets].filter((target) => !controller.targets.has(target));
    const removals = [...controller.targets].filter((target) => !desiredTargets.has(target));

    if (additions.length > 0) {
        sendPayload('marketStream', buildStreamDeltaPayload('marketStream', additions, 'subscribe'));
    }

    if (removals.length > 0) {
        sendPayload(
            'marketStream',
            buildStreamDeltaPayload('marketStream', removals, 'unsubscribe')
        );
    }

    controller.targets = desiredTargets;
    updateStreamStatus('marketStream', {
        subscribedCount: desiredTargets.size,
    });
};

const syncUserStream = async (targets: StreamTargets) => {
    const desiredTargets = new Set(targets.markets);
    const controller = controllers.userStream;
    const creds = activeClobClient?.creds;

    if (!USER_WS_ENABLED) {
        closeStream('userStream', 'disabled');
        return;
    }

    if (!creds) {
        closeStream('userStream', 'idle');
        updateStreamStatus('userStream', {
            lastError: 'user_stream_requires_live_client',
            lastErrorAt: Date.now(),
        });
        return;
    }

    if (desiredTargets.size === 0) {
        closeStream('userStream', 'idle');
        return;
    }

    if (!controller.socket || controller.socket.readyState !== WebSocket.OPEN) {
        controller.targets = desiredTargets;
        await connectStream(
            'userStream',
            buildChannelEndpoint(ENV.CLOB_WS_URL, 'user'),
            buildUserSubscription([...desiredTargets], creds),
            syncAllStreams
        );
        return;
    }

    const additions = [...desiredTargets].filter((target) => !controller.targets.has(target));
    const removals = [...controller.targets].filter((target) => !desiredTargets.has(target));

    if (additions.length > 0) {
        sendPayload('userStream', buildStreamDeltaPayload('userStream', additions, 'subscribe'));
    }

    if (removals.length > 0) {
        sendPayload('userStream', buildStreamDeltaPayload('userStream', removals, 'unsubscribe'));
    }

    controller.targets = desiredTargets;
    updateStreamStatus('userStream', {
        subscribedCount: desiredTargets.size,
    });
};

const syncAllStreams = async () => {
    if (!isRunning) {
        return;
    }

    try {
        const targets = await readStreamTargetsFromDb();
        await syncMarketStream(targets);
        await syncUserStream(targets);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Logger.error(`Stream target sync failed: ${message}`);
        markStreamError('marketStream', message);
        markStreamError('userStream', message);
    }
};

export const stopPolymarketStreams = () => {
    isRunning = false;
    clearTimer(targetRefreshTimer);
    targetRefreshTimer = null;
    clearTimer(controllers.marketStream.reconnectTimer);
    clearTimer(controllers.userStream.reconnectTimer);
    closeStream('marketStream', MARKET_WS_ENABLED ? 'idle' : 'disabled');
    closeStream('userStream', USER_WS_ENABLED ? 'idle' : 'disabled');
};

export const startPolymarketStreams = (clobClient: ClobClient | null) => {
    activeClobClient = clobClient;
    isRunning = true;

    updateStreamStatus('marketStream', {
        state: MARKET_WS_ENABLED ? 'idle' : 'disabled',
        endpoint: buildChannelEndpoint(ENV.CLOB_WS_URL, 'market'),
        running: false,
        subscribedCount: 0,
        reconnectAttempts: 0,
        lastError: undefined,
        lastErrorAt: undefined,
    });
    updateStreamStatus('userStream', {
        state: USER_WS_ENABLED ? 'idle' : 'disabled',
        endpoint: buildChannelEndpoint(ENV.CLOB_WS_URL, 'user'),
        running: false,
        subscribedCount: 0,
        reconnectAttempts: 0,
        lastError: undefined,
        lastErrorAt: undefined,
    });

    clearTimer(targetRefreshTimer);
    targetRefreshTimer = setInterval(() => {
        void syncAllStreams();
    }, STREAM_TARGET_REFRESH_MS);

    void syncAllStreams();
};
