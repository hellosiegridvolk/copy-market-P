describe('env.ts configuration', () => {
    let consoleErrorSpy: jest.SpyInstance;

    const baseEnv = {
        USER_ADDRESSES: '0x1234567890abcdef1234567890abcdef12345678',
        PROXY_WALLET: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        PRIVATE_KEY: 'a'.repeat(64),
        CLOB_HTTP_URL: 'https://clob.polymarket.com/',
        CLOB_WS_URL: 'wss://ws-subscriptions-clob.polymarket.com/ws',
        RPC_URL: 'https://polygon-rpc.com',
        USDC_CONTRACT_ADDRESS: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    };

    const resetEnv = () => {
        for (const key of [
            ...Object.keys(baseEnv),
            'FETCH_INTERVAL',
            'RETRY_LIMIT',
            'TOO_OLD_TIMESTAMP',
            'COPY_STRATEGY',
            'COPY_SIZE',
            'TRADE_MULTIPLIER',
            'COPY_PERCENTAGE',
            'TRADE_AGGREGATION_ENABLED',
            'TRADE_AGGREGATION_WINDOW_SECONDS',
            'REQUEST_TIMEOUT_MS',
            'NETWORK_RETRY_LIMIT',
            'MAX_ORDER_SIZE_USD',
            'MIN_ORDER_SIZE_USD',
            'PREVIEW_MODE',
        ]) {
            delete process.env[key];
        }
    };

    beforeEach(() => {
        jest.resetModules();
        jest.doMock('dotenv', () => ({ config: jest.fn() }));
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        resetEnv();
    });

    afterEach(() => {
        jest.dontMock('dotenv');
        consoleErrorSpy.mockRestore();
        resetEnv();
    });

    const loadEnv = (overrides: Record<string, string> = {}) => {
        resetEnv();
        Object.assign(process.env, baseEnv, overrides);
        let ENV: any;
        jest.isolateModules(() => {
            ENV = require('../config/env').ENV;
        });
        return ENV;
    };

    test('parses single address', () => {
        const env = loadEnv();
        expect(env.USER_ADDRESSES).toEqual(['0x1234567890abcdef1234567890abcdef12345678']);
    });

    test('parses comma-separated addresses', () => {
        const env = loadEnv({
            USER_ADDRESSES:
                '0x1234567890abcdef1234567890abcdef12345678, 0xabcdef1234567890abcdef1234567890abcdef12',
        });
        expect(env.USER_ADDRESSES).toHaveLength(2);
    });

    test('parses JSON array addresses', () => {
        const env = loadEnv({
            USER_ADDRESSES: '["0x1234567890abcdef1234567890abcdef12345678"]',
        });
        expect(env.USER_ADDRESSES).toEqual(['0x1234567890abcdef1234567890abcdef12345678']);
    });

    test('throws on missing required vars', () => {
        expect(() => {
            jest.isolateModules(() => {
                require('../config/env');
            });
        }).toThrow('Missing required environment variables');
    });

    test('allows preview mode without a private key', () => {
        const env = loadEnv({
            PREVIEW_MODE: 'true',
            PRIVATE_KEY: '',
        });
        expect(env.PREVIEW_MODE).toBe(true);
        expect(env.PROXY_WALLET).toBe(baseEnv.PROXY_WALLET);
    });

    test('requires a private key in live mode', () => {
        expect(() =>
            loadEnv({
                PREVIEW_MODE: 'false',
                PRIVATE_KEY: '',
            })
        ).toThrow('Missing required environment variables');
    });

    test('throws on invalid wallet address', () => {
        expect(() => loadEnv({ PROXY_WALLET: 'not-an-address' })).toThrow('Invalid PROXY_WALLET');
    });

    test('throws on invalid USER_ADDRESSES', () => {
        expect(() => loadEnv({ USER_ADDRESSES: 'not-an-address' })).toThrow(
            'Invalid Ethereum address'
        );
    });

    test('throws on invalid RPC_URL', () => {
        expect(() => loadEnv({ RPC_URL: 'ftp://invalid' })).toThrow('Invalid RPC_URL');
    });

    test('parses numeric config correctly', () => {
        const env = loadEnv({ FETCH_INTERVAL: '5', RETRY_LIMIT: '5' });
        expect(env.FETCH_INTERVAL).toBe(5);
        expect(env.RETRY_LIMIT).toBe(5);
    });

    test('defaults work correctly', () => {
        const env = loadEnv();
        expect(env.FETCH_INTERVAL).toBe(1);
        expect(env.RETRY_LIMIT).toBe(3);
        expect(env.TOO_OLD_TIMESTAMP).toBe(24);
        expect(env.TRADE_AGGREGATION_ENABLED).toBe(false);
        expect(env.PREVIEW_MODE).toBe(false);
    });
});
