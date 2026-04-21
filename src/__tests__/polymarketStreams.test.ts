jest.mock('../config/env', () => ({
    ENV: {
        USER_ADDRESSES: [],
        MARKET_WS_ENABLED: true,
        USER_WS_ENABLED: true,
        STREAM_TARGET_REFRESH_INTERVAL_SECONDS: 15,
        STREAM_HEARTBEAT_INTERVAL_SECONDS: 10,
        CLOB_WS_URL: 'wss://ws-subscriptions-clob.polymarket.com/ws',
    },
}));

jest.mock('../models/userHistory', () => ({
    getUserActivityModel: jest.fn(() => ({
        find: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })),
    })),
}));

jest.mock('../services/reconciliation', () => ({
    recordUserStreamEvent: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        warning: jest.fn(),
        error: jest.fn(),
        success: jest.fn(),
    },
}));

import {
    buildChannelEndpoint,
    buildMarketSubscription,
    buildStreamDeltaPayload,
    buildUserSubscription,
    collectStreamTargets,
} from '../services/polymarketStreams';

describe('polymarket websocket groundwork helpers', () => {
    test('buildChannelEndpoint expands the shared ws base URL', () => {
        expect(
            buildChannelEndpoint('wss://ws-subscriptions-clob.polymarket.com/ws', 'market')
        ).toBe('wss://ws-subscriptions-clob.polymarket.com/ws/market');
        expect(
            buildChannelEndpoint('wss://ws-subscriptions-clob.polymarket.com/ws/user', 'user')
        ).toBe('wss://ws-subscriptions-clob.polymarket.com/ws/user');
    });

    test('collectStreamTargets dedupes active trade targets only', () => {
        const targets = collectStreamTargets([
            {
                type: 'TRADE',
                bot: false,
                botExcutedTime: 0,
                status: 'new',
                asset: 'asset-1',
                conditionId: 'market-1',
            } as any,
            {
                type: 'TRADE',
                bot: false,
                botExcutedTime: 0,
                status: 'processing',
                tokenId: 'asset-1',
                conditionId: 'market-1',
            } as any,
            {
                type: 'TRADE',
                bot: true,
                botExcutedTime: 1,
                status: 'executed',
                asset: 'asset-2',
                conditionId: 'market-2',
            } as any,
            {
                type: 'NOTE',
                bot: false,
                botExcutedTime: 0,
                asset: 'asset-3',
                conditionId: 'market-3',
            } as any,
        ]);

        expect(targets.assetIds).toEqual(['asset-1']);
        expect(targets.markets).toEqual(['market-1']);
    });

    test('build subscription payloads match documented channel formats', () => {
        expect(buildMarketSubscription(['asset-1', 'asset-2'])).toEqual({
            assets_ids: ['asset-1', 'asset-2'],
            type: 'market',
            custom_feature_enabled: true,
        });

        expect(
            buildUserSubscription(['market-1'], {
                key: 'api-key',
                secret: 'secret',
                passphrase: 'passphrase',
            })
        ).toEqual({
            auth: {
                apiKey: 'api-key',
                secret: 'secret',
                passphrase: 'passphrase',
            },
            markets: ['market-1'],
            type: 'user',
        });

        expect(buildStreamDeltaPayload('marketStream', ['asset-1'], 'subscribe')).toEqual({
            assets_ids: ['asset-1'],
            operation: 'subscribe',
            custom_feature_enabled: true,
        });
        expect(buildStreamDeltaPayload('userStream', ['market-1'], 'unsubscribe')).toEqual({
            markets: ['market-1'],
            operation: 'unsubscribe',
        });
    });
});
