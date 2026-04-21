jest.mock('../config/env', () => ({
    ENV: {
        USER_ADDRESSES: ['0x1234567890abcdef1234567890abcdef12345678'],
        TOO_OLD_TIMESTAMP: 24,
        FETCH_INTERVAL: 1,
        PREVIEW_MODE: false,
        KILL_SWITCH_MONITOR_ERROR_LIMIT: 5,
        PROXY_WALLET: '0x0ddd79f578e8eff43ca4901c81c09d3220e76d68',
    },
}));

jest.mock('../models/userHistory', () => ({
    getUserActivityModel: jest.fn(() => ({
        countDocuments: jest.fn().mockResolvedValue(0),
    })),
    getUserPositionModel: jest.fn(() => ({
        find: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })),
    })),
}));

jest.mock('../utils/fetchData', () => jest.fn());

jest.mock('../utils/logger', () => ({
    __esModule: true,
    default: {
        clearLine: jest.fn(),
        dbConnection: jest.fn(),
        myPositions: jest.fn(),
        tradersPositions: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        success: jest.fn(),
        separator: jest.fn(),
    },
}));

import {
    buildActivityRecord,
    shouldBootstrapHistoricalImport,
} from '../services/tradeMonitor';

describe('trade monitor bootstrap safety', () => {
    const sampleActivity = {
        proxyWallet: '0xproxy',
        timestamp: 1700000000,
        conditionId: 'condition-1',
        type: 'TRADE',
        size: 12,
        usdcSize: 12,
        transactionHash: '0xhash',
        price: 0.55,
        asset: 'asset-1',
        side: 'BUY',
        outcomeIndex: 0,
        title: 'Example market',
        slug: 'example-market',
        icon: 'icon',
        eventSlug: 'example-market',
        outcome: 'YES',
        name: 'Example Trader',
        pseudonym: 'example',
        bio: 'bio',
        profileImage: 'profile',
        profileImageOptimized: 'profile-optimized',
    };

    test('bootstrap detection only enables history import on an empty datastore', () => {
        expect(shouldBootstrapHistoricalImport([0, 0])).toBe(true);
        expect(shouldBootstrapHistoricalImport([0, 1])).toBe(false);
    });

    test('normal imports create actionable new trades', () => {
        const record = buildActivityRecord(
            '0x1234567890abcdef1234567890abcdef12345678',
            sampleActivity,
            false
        );

        expect(record.status).toBe('new');
        expect(record.bot).toBe(false);
        expect(record.botExcutedTime).toBe(0);
        expect(record.lastError).toBeNull();
    });

    test('bootstrap imports quarantine historical trades as skipped', () => {
        const record = buildActivityRecord(
            '0x1234567890abcdef1234567890abcdef12345678',
            sampleActivity,
            true
        );

        expect(record.status).toBe('skipped');
        expect(record.bot).toBe(true);
        expect(record.botExcutedTime).toBe(999);
        expect(record.lastError).toBe('historical_trade_on_first_run');
    });
});
