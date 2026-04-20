import connectDB, { closeDB } from './config/db';
import { ENV } from './config/env';
import createClobClient from './utils/createClobClient';
import tradeExecutor, { stopTradeExecutor } from './services/tradeExecutor';
import tradeMonitor, { stopTradeMonitor } from './services/tradeMonitor';
import { startServer } from './server';
import Logger from './utils/logger';
import { performHealthCheck, logHealthCheck } from './utils/healthCheck';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const PROXY_WALLET = ENV.PROXY_WALLET;
const PREVIEW_MODE = ENV.PREVIEW_MODE;

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
        Logger.warning('Shutdown already in progress, forcing exit...');
        process.exit(1);
    }

    isShuttingDown = true;
    Logger.separator();
    Logger.info(`Received ${signal}, initiating graceful shutdown...`);

    try {
        stopTradeMonitor();
        stopTradeExecutor();

        Logger.info('Waiting for services to finish current operations...');
        await new Promise((resolve) => setTimeout(resolve, 2000));

        await closeDB();

        Logger.success('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        Logger.error(`Error during shutdown: ${error}`);
        process.exit(1);
    }
};

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    Logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (error: Error) => {
    Logger.error(`Uncaught Exception: ${error.message}`);
    gracefulShutdown('uncaughtException').catch(() => {
        process.exit(1);
    });
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const printStartupNotice = () => {
    const colors = {
        reset: '\x1b[0m',
        red: '\x1b[31m',
        yellow: '\x1b[33m',
        cyan: '\x1b[36m',
    };

    if (PREVIEW_MODE) {
        console.log(`\n${colors.yellow}PREVIEW MODE is enabled.${colors.reset}`);
        console.log('   Live order signing is skipped until PREVIEW_MODE=false.');
        console.log(`   Read the guide: ${colors.cyan}GETTING_STARTED.md${colors.reset}`);
        console.log(
            `   Windows guide: ${colors.cyan}docs/WINDOWS_QUICK_START.md${colors.reset}\n`
        );
        return;
    }

    const pk = ENV.PRIVATE_KEY;
    if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
        console.error('\nPRIVATE_KEY must be exactly 64 hex characters (without 0x prefix)\n');
        process.exit(1);
    }

    console.log(
        `\n${colors.red}SECURITY: Your private key controls real funds. Never share it.${colors.reset}`
    );
    console.log(`${colors.yellow}First time running the bot?${colors.reset}`);
    console.log(`   Read the guide: ${colors.cyan}GETTING_STARTED.md${colors.reset}`);
    console.log(`   Run health check: ${colors.cyan}npm run health-check${colors.reset}\n`);
};

export const main = async () => {
    try {
        printStartupNotice();

        await connectDB();
        Logger.startup(USER_ADDRESSES, PROXY_WALLET);

        Logger.info('Performing initial health check...');
        const healthResult = await performHealthCheck();
        logHealthCheck(healthResult);

        if (!healthResult.healthy) {
            Logger.warning('Health check failed, but continuing startup...');
        }

        let clobClient = null;
        if (PREVIEW_MODE) {
            Logger.info('Preview mode enabled: skipping authenticated CLOB client initialization.');
        } else {
            Logger.info('Initializing CLOB client...');
            clobClient = await createClobClient();
            Logger.success('CLOB client ready');
        }

        Logger.separator();
        Logger.info('Starting trade monitor...');
        tradeMonitor();

        Logger.info('Starting trade executor...');
        tradeExecutor(clobClient);

        startServer();
    } catch (error) {
        Logger.error(`Fatal error during startup: ${error}`);
        await gracefulShutdown('startup-error');
    }
};

main();
