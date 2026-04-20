const fakeDbDir = 'C:\\\\nonexistent-copy-market-status-test-db';

jest.mock('../config/db', () => ({
    getDbDir: jest.fn(() => fakeDbDir),
}));

import { AddressInfo } from 'net';
import { startServer } from '../server';
import { resetRuntimeStatus, updateRuntimeStatus } from '../services/runtimeStatus';

describe('/api/status truthfulness', () => {
    let server: ReturnType<typeof startServer> | null = null;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        resetRuntimeStatus();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
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
});
