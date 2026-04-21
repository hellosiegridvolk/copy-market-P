import * as dotenv from 'dotenv';
dotenv.config();

import connectDB, { closeDB } from '../config/db';
import { ENV } from '../config/env';
import createClobClient from '../utils/createClobClient';
import { performHealthCheck, logHealthCheck } from '../utils/healthCheck';
import {
    getLiveSmokeGuardErrors,
    LiveSmokeCheck,
    LIVE_SMOKE_CONFIRM_VALUE,
    summarizeLiveSmokeChecks,
} from '../utils/liveSmokePreflight';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

const toSmokeStatus = (status: 'ok' | 'warning' | 'error') =>
    status === 'ok' ? 'pass' : status === 'warning' ? 'warn' : 'fail';

const printHeader = () => {
    console.log(`\n${colors.cyan}${colors.bright}`);
    console.log('============================================================');
    console.log('                 COPY MARKET LIVE SMOKE PREFLIGHT           ');
    console.log('============================================================');
    console.log(`${colors.reset}\n`);
    console.log('This command does not place or cancel orders.');
    console.log('It validates live-mode prerequisites, authenticates against the CLOB,');
    console.log('and performs read-only account queries before you start the bot.\n');
};

const printGuardHelp = (errors: string[]) => {
    console.log(`${colors.red}${colors.bright}Preflight blocked${colors.reset}\n`);
    errors.forEach((error) => console.log(`  - ${error}`));
    console.log('');
    console.log(`${colors.yellow}Before retrying:${colors.reset}`);
    console.log('  1. Finish preview-mode validation first');
    console.log('  2. Back up the local data directory');
    console.log('  3. Set PREVIEW_MODE=false');
    console.log(`  4. Set LIVE_SMOKE_CONFIRM=${LIVE_SMOKE_CONFIRM_VALUE}`);
    console.log('');
};

const printCheckResults = (checks: LiveSmokeCheck[]) => {
    console.log(`${colors.cyan}${colors.bright}Read-only checks${colors.reset}\n`);

    for (const check of checks) {
        const prefix =
            check.status === 'pass'
                ? `${colors.green}PASS${colors.reset}`
                : check.status === 'warn'
                  ? `${colors.yellow}WARN${colors.reset}`
                  : `${colors.red}FAIL${colors.reset}`;

        console.log(`  ${prefix} ${check.name}: ${check.message}`);
    }

    console.log('');
};

const printSummary = (checks: LiveSmokeCheck[]) => {
    const summary = summarizeLiveSmokeChecks(checks);
    console.log(`${colors.cyan}${colors.bright}Summary${colors.reset}`);
    console.log(`  PASS: ${summary.passCount}`);
    console.log(`  WARN: ${summary.warnCount}`);
    console.log(`  FAIL: ${summary.failCount}\n`);

    if (summary.ready) {
        console.log(`${colors.green}${colors.bright}Next step${colors.reset}`);
        console.log('  - Start the app with npm start');
        console.log('  - Verify /api/status shows live mode, healthy workers, and no kill switch');
        console.log('  - Keep the first live session short and watch logs continuously');
        console.log('');
    } else {
        console.log(`${colors.yellow}${colors.bright}Next step${colors.reset}`);
        console.log('  - Fix FAIL items above before attempting any live-mode startup');
        console.log('  - Re-run npm run smoke:live:preflight after each env or wallet change');
        console.log('');
    }

    return summary;
};

const main = async () => {
    const guardErrors = getLiveSmokeGuardErrors({
        previewMode: ENV.PREVIEW_MODE,
        confirmation: process.env.LIVE_SMOKE_CONFIRM,
    });

    printHeader();

    if (guardErrors.length > 0) {
        printGuardHelp(guardErrors);
        process.exit(1);
    }

    const checks: LiveSmokeCheck[] = [];

    try {
        await connectDB();

        const healthResult = await performHealthCheck();
        logHealthCheck(healthResult);

        checks.push({
            name: 'database',
            status: toSmokeStatus(healthResult.checks.database.status),
            message: healthResult.checks.database.message,
        });
        checks.push({
            name: 'rpc',
            status: toSmokeStatus(healthResult.checks.rpc.status),
            message: healthResult.checks.rpc.message,
        });
        checks.push({
            name: 'balance',
            status: toSmokeStatus(healthResult.checks.balance.status),
            message: healthResult.checks.balance.message,
        });
        checks.push({
            name: 'polymarket-api',
            status: toSmokeStatus(healthResult.checks.polymarketApi.status),
            message: healthResult.checks.polymarketApi.message,
        });

        try {
            const clobClient = await createClobClient();
            const apiKeys = await clobClient.getApiKeys();
            const openOrders = await clobClient.getOpenOrders({}, true);

            checks.push({
                name: 'clob-auth',
                status: 'pass',
                message: `Authenticated API key lookup succeeded (${apiKeys.apiKeys.length} key(s))`,
            });
            checks.push({
                name: 'open-orders',
                status: 'pass',
                message: `Authenticated open-order query succeeded (${openOrders.length} order(s))`,
            });
        } catch (error) {
            checks.push({
                name: 'clob-auth',
                status: 'fail',
                message: error instanceof Error ? error.message : String(error),
            });
        }

        printCheckResults(checks);
        const summary = printSummary(checks);
        process.exit(summary.ready ? 0 : 1);
    } catch (error) {
        console.log(`${colors.red}${colors.bright}Live preflight error${colors.reset}\n`);
        console.log(error instanceof Error ? error.message : String(error));
        process.exit(1);
    } finally {
        await closeDB();
    }
};

main();
