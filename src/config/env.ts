import * as dotenv from 'dotenv';
import { CopyStrategy, CopyStrategyConfig, parseTieredMultipliers } from './copyStrategy';

dotenv.config();

const PREVIEW_MODE = process.env.PREVIEW_MODE === 'true';

const isValidEthereumAddress = (address: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(address);

const isValidPrivateKey = (value: string): boolean => /^[0-9a-fA-F]{64}$/.test(value);

const validateRequiredEnv = (): void => {
    const required = [
        'USER_ADDRESSES',
        'PROXY_WALLET',
        'CLOB_HTTP_URL',
        'CLOB_WS_URL',
        'RPC_URL',
        'USDC_CONTRACT_ADDRESS',
    ];

    if (!PREVIEW_MODE) {
        required.push('PRIVATE_KEY');
    }

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length === 0) {
        return;
    }

    console.error('\nConfiguration error: missing required environment variables.\n');
    console.error(`Missing variables: ${missing.join(', ')}\n`);
    console.error('Quick fix:');
    console.error('  1. Run: npm run setup');
    console.error('  2. Edit .env');
    console.error('  3. Keep PREVIEW_MODE=true for the first validation pass.\n');
    console.error('See docs/QUICK_START.md and docs/WINDOWS_QUICK_START.md for examples.\n');

    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
};

const validateAddresses = (): void => {
    if (process.env.PROXY_WALLET && !isValidEthereumAddress(process.env.PROXY_WALLET)) {
        throw new Error(`Invalid PROXY_WALLET address format: ${process.env.PROXY_WALLET}`);
    }

    if (
        process.env.USDC_CONTRACT_ADDRESS &&
        !isValidEthereumAddress(process.env.USDC_CONTRACT_ADDRESS)
    ) {
        throw new Error(
            `Invalid USDC_CONTRACT_ADDRESS format: ${process.env.USDC_CONTRACT_ADDRESS}`
        );
    }

    if (!PREVIEW_MODE && process.env.PRIVATE_KEY && !isValidPrivateKey(process.env.PRIVATE_KEY)) {
        throw new Error(
            'Invalid PRIVATE_KEY. Expected exactly 64 hexadecimal characters without 0x.'
        );
    }
};

const validateNumericConfig = (): void => {
    const fetchInterval = parseInt(process.env.FETCH_INTERVAL || '1', 10);
    if (isNaN(fetchInterval) || fetchInterval <= 0) {
        throw new Error(
            `Invalid FETCH_INTERVAL: ${process.env.FETCH_INTERVAL}. Must be a positive integer.`
        );
    }

    const retryLimit = parseInt(process.env.RETRY_LIMIT || '3', 10);
    if (isNaN(retryLimit) || retryLimit < 1 || retryLimit > 10) {
        throw new Error(
            `Invalid RETRY_LIMIT: ${process.env.RETRY_LIMIT}. Must be between 1 and 10.`
        );
    }

    const tooOldTimestamp = parseInt(process.env.TOO_OLD_TIMESTAMP || '24', 10);
    if (isNaN(tooOldTimestamp) || tooOldTimestamp < 1) {
        throw new Error(
            `Invalid TOO_OLD_TIMESTAMP: ${process.env.TOO_OLD_TIMESTAMP}. Must be a positive integer (hours).`
        );
    }

    const requestTimeout = parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10);
    if (isNaN(requestTimeout) || requestTimeout < 1000) {
        throw new Error(
            `Invalid REQUEST_TIMEOUT_MS: ${process.env.REQUEST_TIMEOUT_MS}. Must be at least 1000ms.`
        );
    }

    const networkRetryLimit = parseInt(process.env.NETWORK_RETRY_LIMIT || '3', 10);
    if (isNaN(networkRetryLimit) || networkRetryLimit < 1 || networkRetryLimit > 10) {
        throw new Error(
            `Invalid NETWORK_RETRY_LIMIT: ${process.env.NETWORK_RETRY_LIMIT}. Must be between 1 and 10.`
        );
    }

    const port = parseInt(process.env.PORT || '3000', 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid PORT: ${process.env.PORT}. Must be between 1 and 65535.`);
    }

    const dailyLossCap = parseFloat(process.env.DAILY_LOSS_CAP_PCT || '20');
    if (isNaN(dailyLossCap) || dailyLossCap <= 0 || dailyLossCap > 100) {
        throw new Error(
            `Invalid DAILY_LOSS_CAP_PCT: ${process.env.DAILY_LOSS_CAP_PCT}. Must be > 0 and <= 100.`
        );
    }

    const slippageTolerance = parseFloat(process.env.SLIPPAGE_TOLERANCE || '0.05');
    if (isNaN(slippageTolerance) || slippageTolerance < 0 || slippageTolerance > 1) {
        throw new Error(
            `Invalid SLIPPAGE_TOLERANCE: ${process.env.SLIPPAGE_TOLERANCE}. Must be between 0 and 1.`
        );
    }

    const copySize = parseFloat(process.env.COPY_SIZE || '10.0');
    if (isNaN(copySize) || copySize <= 0) {
        throw new Error(`Invalid COPY_SIZE: ${process.env.COPY_SIZE}. Must be greater than 0.`);
    }

    const minOrderSizeUsd = parseFloat(process.env.MIN_ORDER_SIZE_USD || '1.0');
    const maxOrderSizeUsd = parseFloat(process.env.MAX_ORDER_SIZE_USD || '100.0');
    if (isNaN(minOrderSizeUsd) || minOrderSizeUsd <= 0) {
        throw new Error(
            `Invalid MIN_ORDER_SIZE_USD: ${process.env.MIN_ORDER_SIZE_USD}. Must be greater than 0.`
        );
    }

    if (isNaN(maxOrderSizeUsd) || maxOrderSizeUsd < minOrderSizeUsd) {
        throw new Error(
            `Invalid MAX_ORDER_SIZE_USD: ${process.env.MAX_ORDER_SIZE_USD}. Must be greater than or equal to MIN_ORDER_SIZE_USD.`
        );
    }

    if (process.env.MAX_POSITION_SIZE_USD) {
        const maxPositionSizeUsd = parseFloat(process.env.MAX_POSITION_SIZE_USD);
        if (isNaN(maxPositionSizeUsd) || maxPositionSizeUsd <= 0) {
            throw new Error(
                `Invalid MAX_POSITION_SIZE_USD: ${process.env.MAX_POSITION_SIZE_USD}. Must be greater than 0 when set.`
            );
        }
    }

    if (process.env.MAX_DAILY_VOLUME_USD) {
        const maxDailyVolumeUsd = parseFloat(process.env.MAX_DAILY_VOLUME_USD);
        if (isNaN(maxDailyVolumeUsd) || maxDailyVolumeUsd <= 0) {
            throw new Error(
                `Invalid MAX_DAILY_VOLUME_USD: ${process.env.MAX_DAILY_VOLUME_USD}. Must be greater than 0 when set.`
            );
        }
    }

    const killSwitchMaxErrors = parseInt(process.env.KILL_SWITCH_MAX_ERRORS || '5', 10);
    if (isNaN(killSwitchMaxErrors) || killSwitchMaxErrors < 1 || killSwitchMaxErrors > 100) {
        throw new Error(
            `Invalid KILL_SWITCH_MAX_ERRORS: ${process.env.KILL_SWITCH_MAX_ERRORS}. Must be between 1 and 100.`
        );
    }

    const killSwitchEquityFallbackLimit = parseInt(
        process.env.KILL_SWITCH_EQUITY_FALLBACK_LIMIT || '3',
        10
    );
    if (
        isNaN(killSwitchEquityFallbackLimit) ||
        killSwitchEquityFallbackLimit < 1 ||
        killSwitchEquityFallbackLimit > 100
    ) {
        throw new Error(
            `Invalid KILL_SWITCH_EQUITY_FALLBACK_LIMIT: ${process.env.KILL_SWITCH_EQUITY_FALLBACK_LIMIT}. Must be between 1 and 100.`
        );
    }

    const killSwitchMonitorErrorLimit = parseInt(
        process.env.KILL_SWITCH_MONITOR_ERROR_LIMIT || String(killSwitchMaxErrors),
        10
    );
    if (
        isNaN(killSwitchMonitorErrorLimit) ||
        killSwitchMonitorErrorLimit < 1 ||
        killSwitchMonitorErrorLimit > 100
    ) {
        throw new Error(
            `Invalid KILL_SWITCH_MONITOR_ERROR_LIMIT: ${process.env.KILL_SWITCH_MONITOR_ERROR_LIMIT}. Must be between 1 and 100.`
        );
    }

    const killSwitchMonitorStaleSeconds = parseInt(
        process.env.KILL_SWITCH_MONITOR_STALE_SECONDS || '15',
        10
    );
    if (
        isNaN(killSwitchMonitorStaleSeconds) ||
        killSwitchMonitorStaleSeconds < 5 ||
        killSwitchMonitorStaleSeconds > 3600
    ) {
        throw new Error(
            `Invalid KILL_SWITCH_MONITOR_STALE_SECONDS: ${process.env.KILL_SWITCH_MONITOR_STALE_SECONDS}. Must be between 5 and 3600 seconds.`
        );
    }

    const aggregationWindowSeconds = parseInt(
        process.env.TRADE_AGGREGATION_WINDOW_SECONDS || '300',
        10
    );
    if (isNaN(aggregationWindowSeconds) || aggregationWindowSeconds < 1) {
        throw new Error(
            `Invalid TRADE_AGGREGATION_WINDOW_SECONDS: ${process.env.TRADE_AGGREGATION_WINDOW_SECONDS}. Must be a positive integer.`
        );
    }

    const streamTargetRefreshIntervalSeconds = parseInt(
        process.env.STREAM_TARGET_REFRESH_INTERVAL_SECONDS || '15',
        10
    );
    if (isNaN(streamTargetRefreshIntervalSeconds) || streamTargetRefreshIntervalSeconds < 1) {
        throw new Error(
            `Invalid STREAM_TARGET_REFRESH_INTERVAL_SECONDS: ${process.env.STREAM_TARGET_REFRESH_INTERVAL_SECONDS}. Must be a positive integer.`
        );
    }

    const streamHeartbeatIntervalSeconds = parseInt(
        process.env.STREAM_HEARTBEAT_INTERVAL_SECONDS || '10',
        10
    );
    if (isNaN(streamHeartbeatIntervalSeconds) || streamHeartbeatIntervalSeconds < 5) {
        throw new Error(
            `Invalid STREAM_HEARTBEAT_INTERVAL_SECONDS: ${process.env.STREAM_HEARTBEAT_INTERVAL_SECONDS}. Must be at least 5 seconds.`
        );
    }

    const reconciliationIntervalSeconds = parseInt(
        process.env.RECONCILIATION_INTERVAL_SECONDS || '15',
        10
    );
    if (isNaN(reconciliationIntervalSeconds) || reconciliationIntervalSeconds < 1) {
        throw new Error(
            `Invalid RECONCILIATION_INTERVAL_SECONDS: ${process.env.RECONCILIATION_INTERVAL_SECONDS}. Must be a positive integer.`
        );
    }

    const reconciliationStaleOrderSeconds = parseInt(
        process.env.RECONCILIATION_STALE_ORDER_SECONDS || '60',
        10
    );
    if (isNaN(reconciliationStaleOrderSeconds) || reconciliationStaleOrderSeconds < 5) {
        throw new Error(
            `Invalid RECONCILIATION_STALE_ORDER_SECONDS: ${process.env.RECONCILIATION_STALE_ORDER_SECONDS}. Must be at least 5 seconds.`
        );
    }
};

const validateUrls = (): void => {
    if (process.env.CLOB_HTTP_URL && !process.env.CLOB_HTTP_URL.startsWith('http')) {
        throw new Error(
            `Invalid CLOB_HTTP_URL: ${process.env.CLOB_HTTP_URL}. Must be a valid HTTP/HTTPS URL.`
        );
    }

    if (process.env.CLOB_WS_URL && !process.env.CLOB_WS_URL.startsWith('ws')) {
        throw new Error(
            `Invalid CLOB_WS_URL: ${process.env.CLOB_WS_URL}. Must be a valid WebSocket URL (ws:// or wss://).`
        );
    }

    if (process.env.RPC_URL && !process.env.RPC_URL.startsWith('http')) {
        throw new Error(
            `Invalid RPC_URL: ${process.env.RPC_URL}. Must be a valid HTTP/HTTPS URL.`
        );
    }
};

validateRequiredEnv();
validateAddresses();
validateNumericConfig();
validateUrls();

const parseUserAddresses = (input: string): string[] => {
    const trimmed = input.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (!Array.isArray(parsed)) {
                throw new Error('USER_ADDRESSES JSON must be an array.');
            }

            const addresses = parsed
                .map((addr) => String(addr).toLowerCase().trim())
                .filter((addr) => addr.length > 0);

            for (const addr of addresses) {
                if (!isValidEthereumAddress(addr)) {
                    throw new Error(`Invalid Ethereum address in USER_ADDRESSES: ${addr}`);
                }
            }

            return addresses;
        } catch (error) {
            if (error instanceof Error && error.message.includes('Invalid Ethereum address')) {
                throw error;
            }
            throw new Error(
                `Invalid JSON format for USER_ADDRESSES: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    const addresses = trimmed
        .split(',')
        .map((addr) => addr.toLowerCase().trim())
        .filter((addr) => addr.length > 0);

    for (const addr of addresses) {
        if (!isValidEthereumAddress(addr)) {
            throw new Error(`Invalid Ethereum address in USER_ADDRESSES: ${addr}`);
        }
    }

    return addresses;
};

const parseCopyStrategy = (): CopyStrategyConfig => {
    const hasLegacyConfig = process.env.COPY_PERCENTAGE && !process.env.COPY_STRATEGY;

    if (hasLegacyConfig) {
        const copyPercentage = parseFloat(process.env.COPY_PERCENTAGE || '10.0');
        const tradeMultiplier = parseFloat(process.env.TRADE_MULTIPLIER || '1.0');
        const effectivePercentage = copyPercentage * tradeMultiplier;

        const config: CopyStrategyConfig = {
            strategy: CopyStrategy.PERCENTAGE,
            copySize: effectivePercentage,
            maxOrderSizeUSD: parseFloat(process.env.MAX_ORDER_SIZE_USD || '100.0'),
            minOrderSizeUSD: parseFloat(process.env.MIN_ORDER_SIZE_USD || '1.0'),
            maxPositionSizeUSD: process.env.MAX_POSITION_SIZE_USD
                ? parseFloat(process.env.MAX_POSITION_SIZE_USD)
                : undefined,
            maxDailyVolumeUSD: process.env.MAX_DAILY_VOLUME_USD
                ? parseFloat(process.env.MAX_DAILY_VOLUME_USD)
                : undefined,
        };

        if (process.env.TIERED_MULTIPLIERS) {
            config.tieredMultipliers = parseTieredMultipliers(process.env.TIERED_MULTIPLIERS);
        } else if (tradeMultiplier !== 1.0) {
            config.tradeMultiplier = tradeMultiplier;
        }

        return config;
    }

    const strategyStr = (process.env.COPY_STRATEGY || 'PERCENTAGE').toUpperCase();
    const strategy =
        CopyStrategy[strategyStr as keyof typeof CopyStrategy] || CopyStrategy.PERCENTAGE;

    const config: CopyStrategyConfig = {
        strategy,
        copySize: parseFloat(process.env.COPY_SIZE || '10.0'),
        maxOrderSizeUSD: parseFloat(process.env.MAX_ORDER_SIZE_USD || '100.0'),
        minOrderSizeUSD: parseFloat(process.env.MIN_ORDER_SIZE_USD || '1.0'),
        maxPositionSizeUSD: process.env.MAX_POSITION_SIZE_USD
            ? parseFloat(process.env.MAX_POSITION_SIZE_USD)
            : undefined,
        maxDailyVolumeUSD: process.env.MAX_DAILY_VOLUME_USD
            ? parseFloat(process.env.MAX_DAILY_VOLUME_USD)
            : undefined,
    };

    if (strategy === CopyStrategy.ADAPTIVE) {
        config.adaptiveMinPercent = parseFloat(
            process.env.ADAPTIVE_MIN_PERCENT || config.copySize.toString()
        );
        config.adaptiveMaxPercent = parseFloat(
            process.env.ADAPTIVE_MAX_PERCENT || config.copySize.toString()
        );
        config.adaptiveThreshold = parseFloat(process.env.ADAPTIVE_THRESHOLD_USD || '500.0');
    }

    if (process.env.TIERED_MULTIPLIERS) {
        config.tieredMultipliers = parseTieredMultipliers(process.env.TIERED_MULTIPLIERS);
    } else if (process.env.TRADE_MULTIPLIER) {
        const singleMultiplier = parseFloat(process.env.TRADE_MULTIPLIER);
        if (singleMultiplier !== 1.0) {
            config.tradeMultiplier = singleMultiplier;
        }
    }

    return config;
};

export const ENV = {
    PREVIEW_MODE,
    USER_ADDRESSES: parseUserAddresses(process.env.USER_ADDRESSES as string),
    PROXY_WALLET: process.env.PROXY_WALLET as string,
    PRIVATE_KEY: process.env.PRIVATE_KEY as string,
    CLOB_HTTP_URL: process.env.CLOB_HTTP_URL as string,
    CLOB_WS_URL: process.env.CLOB_WS_URL as string,
    FETCH_INTERVAL: parseInt(process.env.FETCH_INTERVAL || '1', 10),
    TOO_OLD_TIMESTAMP: parseInt(process.env.TOO_OLD_TIMESTAMP || '24', 10),
    RETRY_LIMIT: parseInt(process.env.RETRY_LIMIT || '3', 10),
    TRADE_MULTIPLIER: parseFloat(process.env.TRADE_MULTIPLIER || '1.0'),
    COPY_PERCENTAGE: parseFloat(process.env.COPY_PERCENTAGE || '10.0'),
    DAILY_LOSS_CAP_PCT: parseFloat(process.env.DAILY_LOSS_CAP_PCT || '20'),
    KILL_SWITCH_MAX_ERRORS: parseInt(process.env.KILL_SWITCH_MAX_ERRORS || '5', 10),
    KILL_SWITCH_EQUITY_FALLBACK_LIMIT: parseInt(
        process.env.KILL_SWITCH_EQUITY_FALLBACK_LIMIT || '3',
        10
    ),
    KILL_SWITCH_MONITOR_ERROR_LIMIT: parseInt(
        process.env.KILL_SWITCH_MONITOR_ERROR_LIMIT ||
            process.env.KILL_SWITCH_MAX_ERRORS ||
            '5',
        10
    ),
    KILL_SWITCH_MONITOR_STALE_SECONDS: parseInt(
        process.env.KILL_SWITCH_MONITOR_STALE_SECONDS || '15',
        10
    ),
    COPY_STRATEGY_CONFIG: parseCopyStrategy(),
    REQUEST_TIMEOUT_MS: parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10),
    NETWORK_RETRY_LIMIT: parseInt(process.env.NETWORK_RETRY_LIMIT || '3', 10),
    TRADE_AGGREGATION_ENABLED: process.env.TRADE_AGGREGATION_ENABLED === 'true',
    TRADE_AGGREGATION_WINDOW_SECONDS: parseInt(
        process.env.TRADE_AGGREGATION_WINDOW_SECONDS || '300',
        10
    ),
    MARKET_WS_ENABLED: process.env.MARKET_WS_ENABLED !== 'false',
    USER_WS_ENABLED: process.env.USER_WS_ENABLED !== 'false',
    RECONCILIATION_ENABLED: process.env.RECONCILIATION_ENABLED !== 'false',
    STREAM_TARGET_REFRESH_INTERVAL_SECONDS: parseInt(
        process.env.STREAM_TARGET_REFRESH_INTERVAL_SECONDS || '15',
        10
    ),
    STREAM_HEARTBEAT_INTERVAL_SECONDS: parseInt(
        process.env.STREAM_HEARTBEAT_INTERVAL_SECONDS || '10',
        10
    ),
    RECONCILIATION_INTERVAL_SECONDS: parseInt(
        process.env.RECONCILIATION_INTERVAL_SECONDS || '15',
        10
    ),
    RECONCILIATION_STALE_ORDER_SECONDS: parseInt(
        process.env.RECONCILIATION_STALE_ORDER_SECONDS || '60',
        10
    ),
    RPC_URL: process.env.RPC_URL as string,
    USDC_CONTRACT_ADDRESS: process.env.USDC_CONTRACT_ADDRESS as string,
};
