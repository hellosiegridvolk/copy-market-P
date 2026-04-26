import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';

let fakeDbDir = path.join(os.tmpdir(), 'copy-market-status-test-db');

jest.mock('../config/db', () => ({
    getDbDir: jest.fn(() => fakeDbDir),
}));

jest.mock('../config/env', () => ({
    ENV: {
        USER_ADDRESSES: ['0x1234567890abcdef1234567890abcdef12345678'],
    },
}));

import { startServer } from '../server';
import { resetRuntimeStatus, updateRuntimeStatus } from '../services/runtimeStatus';

describe('/api/status truthfulness', () => {
    let server: ReturnType<typeof startServer> | null = null;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        resetRuntimeStatus();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        fakeDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-market-status-test-'));
    });

    afterEach(async () => {
        resetRuntimeStatus();
        consoleLogSpy.mockRestore();

        if (server && server.listening) {
            await new Promise<void>((resolve, reject) => {
                server!.close((error?: Error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
            server = null;
        }

        fs.rmSync(fakeDbDir, { recursive: true, force: true });
    });

    const fetchStatus = async () => {
        server = startServer(0);
        await new Promise<void>((resolve) => {
            if (server!.listening) {
                resolve();
                return;
            }

            server!.once('listening', () => resolve());
        });
        const address = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${address.port}/api/status`);
        return response.json();
    };

    test('reports stopped workers as degraded instead of healthy', async () => {
        updateRuntimeStatus({
            mode: 'live',
            monitor: {
                running: false,
            },
            executor: {
                running: true,
                lastLoopAt: Date.now(),
            },
        });

        const status = await fetchStatus();

        expect(status.running).toBe(true);
        expect(status.healthy).toBe(false);
        expect(status.degraded).toBe(true);
        expect(status.degradedReasons).toContain('monitor_stopped');
    });

    test('reports missing heartbeats while workers claim to be running', async () => {
        updateRuntimeStatus({
            mode: 'live',
            monitor: {
                running: true,
            },
            executor: {
                running: true,
                lastLoopAt: Date.now(),
            },
        });

        const status = await fetchStatus();

        expect(status.healthy).toBe(false);
        expect(status.degradedReasons).toContain('monitor_heartbeat_missing');
    });

    test('counts queue items only for configured tracked traders', async () => {
        const trackedFile = path.join(
            fakeDbDir,
            'user_activities_0x1234567890abcdef1234567890abcdef12345678.db'
        );
        const unrelatedFile = path.join(
            fakeDbDir,
            'user_activities_0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef.db'
        );

        fs.writeFileSync(
            trackedFile,
            `${JSON.stringify({ status: 'skipped', bot: true, botExcutedTime: 999 })}\n`,
            'utf8'
        );
        fs.writeFileSync(
            unrelatedFile,
            `${JSON.stringify({ status: 'new', bot: false, botExcutedTime: 0 })}\n`,
            'utf8'
        );

        const status = await fetchStatus();

        expect(status.queue.skipped).toBe(1);
        expect(status.queue.new).toBe(0);
        expect(status.dataFiles).toBe(1);
    });

    test('surfaces local accounting exposure when pending commitments outrun free balance', async () => {
        updateRuntimeStatus({
            mode: 'live',
            monitor: {
                running: true,
                lastLoopAt: Date.now(),
            },
            executor: {
                running: true,
                lastLoopAt: Date.now(),
            },
            risk: {
                equitySource: 'balance_plus_positions',
                accountingMode: 'api_plus_local_pending',
                freeBalance: 100,
                queuedBuyExposure: 80,
                processingBuyExposure: 50,
                retryableBuyExposure: 0,
                bufferedBuyExposure: 0,
                reservedBuyExposure: 130,
                pendingSellExposure: 0,
                availableBalanceAfterPending: -30,
                activePendingTradeCount: 2,
                activePendingBuyCount: 2,
                bufferedTradeCount: 0,
                consecutiveExecutionErrors: 0,
                consecutiveMonitorErrors: 0,
                consecutiveEquitySnapshotFailures: 0,
            },
        });

        const status = await fetchStatus();

        expect(status.degradedReasons).toContain('pending_exposure_over_limit');
        expect(status.risk.accountingMode).toBe('api_plus_local_pending');
        expect(status.risk.reservedBuyExposure).toBe(130);
        expect(status.risk.availableBalanceAfterPending).toBe(-30);
    });
});
