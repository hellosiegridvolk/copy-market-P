import * as dotenv from 'dotenv';
dotenv.config();

import connectDB, { closeDB } from '../config/db';
import { performHealthCheck, logHealthCheck } from '../utils/healthCheck';
import { ENV } from '../config/env';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

function printHeader() {
    console.log(`\n${colors.cyan}${colors.bright}`);
    console.log('============================================================');
    console.log('                     COPY MARKET HEALTH CHECK               ');
    console.log('============================================================');
    console.log(`${colors.reset}\n`);
}

function printConfiguration() {
    console.log(`${colors.cyan}Configuration summary:${colors.reset}\n`);
    console.log(
        `  Mode: ${process.env.PREVIEW_MODE === 'true' ? 'preview (no live orders)' : 'live'}`
    );
    console.log(`  Trading wallet: ${ENV.PROXY_WALLET.slice(0, 6)}...${ENV.PROXY_WALLET.slice(-4)}`);
    console.log(`  Tracked traders: ${ENV.USER_ADDRESSES.length}`);
    console.log(`  Poll interval: ${ENV.FETCH_INTERVAL}s`);
    console.log(`  Trade multiplier: ${ENV.TRADE_MULTIPLIER}x`);
    console.log('');
}

function printRecommendations(result: any) {
    const checkValues = Object.values(result.checks) as Array<{ status: string; balance?: number }>;
    const passCount = checkValues.filter((check) => check.status === 'ok').length;
    const warnCount = checkValues.filter((check) => check.status === 'warning').length;
    const failCount = checkValues.filter((check) => check.status === 'error').length;

    console.log(`${colors.cyan}Summary:${colors.reset}`);
    console.log(`  PASS: ${passCount}`);
    console.log(`  WARN: ${warnCount}`);
    console.log(`  FAIL: ${failCount}\n`);

    if (result.checks.database.status === 'error') {
        console.log(`${colors.red}${colors.bright}FAIL - Local storage${colors.reset}`);
        console.log('  - Check DB_DIR in .env');
        console.log('  - Verify the process can create and write NeDB files');
        console.log('');
    }

    if (result.checks.rpc.status === 'error') {
        console.log(`${colors.red}${colors.bright}FAIL - RPC connectivity${colors.reset}`);
        console.log('  - Check RPC_URL');
        console.log('  - Verify any provider API key or rate limit');
        console.log('');
    }

    if (result.checks.balance.status === 'error') {
        console.log(`${colors.red}${colors.bright}FAIL - Trading balance${colors.reset}`);
        console.log('  - Wallet balance is zero');
        console.log('  - Fund USDC and gas before attempting live mode');
        console.log('');
    } else if (result.checks.balance.status === 'warning') {
        console.log(`${colors.yellow}${colors.bright}WARN - Trading balance${colors.reset}`);
        console.log(`  - Balance detected: $${result.checks.balance.balance?.toFixed(2) || '0.00'}`);
        console.log('  - Low balances can cause skipped trades or risk tighter caps');
        console.log('');
    }

    if (result.checks.polymarketApi.status === 'error') {
        console.log(`${colors.red}${colors.bright}FAIL - Polymarket API${colors.reset}`);
        console.log('  - Confirm internet access and Polymarket availability');
        console.log('');
    }

    if (failCount === 0) {
        console.log(`${colors.green}${colors.bright}Next action:${colors.reset}`);
        console.log(
            `  - Run ${colors.green}npm start${colors.reset} to launch COPY MARKET in ${
                process.env.PREVIEW_MODE === 'true' ? 'preview' : 'live'
            } mode`
        );
        console.log('  - Verify /api/status after startup');
        console.log('');
    } else {
        console.log(`${colors.yellow}${colors.bright}Next action:${colors.reset}`);
        console.log('  - Fix FAIL items above before starting the bot');
        console.log('  - Re-run npm run health after each config change');
        console.log('');
    }
}

const main = async () => {
    try {
        printHeader();
        console.log(`${colors.yellow}Running diagnostic checks...${colors.reset}\n`);

        await connectDB();
        const result = await performHealthCheck();

        logHealthCheck(result);
        printConfiguration();
        printRecommendations(result);

        process.exit(result.healthy ? 0 : 1);
    } catch (error) {
        console.error(`\n${colors.red}${colors.bright}Health check error${colors.reset}\n`);
        if (error instanceof Error) {
            console.error(`${error.message}\n`);
            console.error(`${colors.yellow}Tip:${colors.reset} run ${colors.cyan}npm run setup${colors.reset} to refresh your starter .env\n`);
        } else {
            console.error(error);
        }
        process.exit(1);
    } finally {
        await closeDB();
    }
};

main();
