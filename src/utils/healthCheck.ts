import * as fs from 'fs';
import { ENV } from '../config/env';
import { getDbDir } from '../config/db';
import getMyBalance from './getMyBalance';
import fetchData from './fetchData';
import Logger from './logger';

export interface HealthCheckResult {
    healthy: boolean;
    checks: {
        database: { status: 'ok' | 'error'; message: string };
        rpc: { status: 'ok' | 'error'; message: string };
        balance: { status: 'ok' | 'error' | 'warning'; message: string; balance?: number };
        polymarketApi: { status: 'ok' | 'error'; message: string };
    };
    timestamp: number;
}

export const performHealthCheck = async (): Promise<HealthCheckResult> => {
    const checks: HealthCheckResult['checks'] = {
        database: { status: 'error', message: 'Not checked' },
        rpc: { status: 'error', message: 'Not checked' },
        balance: { status: 'error', message: 'Not checked' },
        polymarketApi: { status: 'error', message: 'Not checked' },
    };

    try {
        const dbDir = getDbDir();
        if (fs.existsSync(dbDir)) {
            checks.database = { status: 'ok', message: `NeDB directory: ${dbDir}` };
        } else {
            fs.mkdirSync(dbDir, { recursive: true });
            checks.database = { status: 'ok', message: `NeDB directory created: ${dbDir}` };
        }
    } catch (error) {
        checks.database = {
            status: 'error',
            message: `NeDB error: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    try {
        const response = await fetch(ENV.RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1,
            }),
            signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
            const data = await response.json();
            checks.rpc = data.result
                ? { status: 'ok', message: 'RPC endpoint responding' }
                : { status: 'error', message: 'Invalid RPC response' };
        } else {
            checks.rpc = { status: 'error', message: `HTTP ${response.status}` };
        }
    } catch (error) {
        checks.rpc = {
            status: 'error',
            message: `RPC check failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    try {
        const balance = await getMyBalance(ENV.PROXY_WALLET);
        if (balance > 0) {
            checks.balance =
                balance < 10
                    ? { status: 'warning', message: `Low balance: $${balance.toFixed(2)}`, balance }
                    : { status: 'ok', message: `Balance: $${balance.toFixed(2)}`, balance };
        } else if (ENV.PREVIEW_MODE) {
            checks.balance = {
                status: 'warning',
                message: 'Zero balance is acceptable in preview mode',
                balance,
            };
        } else {
            checks.balance = { status: 'error', message: 'Zero balance' };
        }
    } catch (error) {
        checks.balance = {
            status: 'error',
            message: `Balance check failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    try {
        await fetchData(
            'https://data-api.polymarket.com/positions?user=0x0000000000000000000000000000000000000000'
        );
        checks.polymarketApi = { status: 'ok', message: 'API responding' };
    } catch (error) {
        checks.polymarketApi = {
            status: 'error',
            message: `API check failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    const healthy =
        checks.database.status === 'ok' &&
        checks.rpc.status === 'ok' &&
        checks.balance.status !== 'error' &&
        checks.polymarketApi.status === 'ok';

    return { healthy, checks, timestamp: Date.now() };
};

export const logHealthCheck = (result: HealthCheckResult): void => {
    Logger.separator();
    Logger.header('HEALTH CHECK');
    Logger.info(`Overall Status: ${result.healthy ? 'Healthy' : 'Unhealthy'}`);
    Logger.info(
        `Database: ${result.checks.database.status === 'ok' ? 'OK' : 'ERROR'} ${
            result.checks.database.message
        }`
    );
    Logger.info(
        `RPC: ${result.checks.rpc.status === 'ok' ? 'OK' : 'ERROR'} ${result.checks.rpc.message}`
    );
    Logger.info(
        `Balance: ${
            result.checks.balance.status === 'ok'
                ? 'OK'
                : result.checks.balance.status === 'warning'
                  ? 'WARN'
                  : 'ERROR'
        } ${result.checks.balance.message}`
    );
    Logger.info(
        `Polymarket API: ${
            result.checks.polymarketApi.status === 'ok' ? 'OK' : 'ERROR'
        } ${result.checks.polymarketApi.message}`
    );
    Logger.separator();
};
