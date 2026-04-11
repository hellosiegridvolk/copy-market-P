import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';

const DB_DIR = path.join(process.cwd(), 'data');

const ensureDbDir = () => {
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }
};

const connectDB = async () => {
    try {
        ensureDbDir();
        console.log(chalk.green('✓'), `NeDB initialized (${DB_DIR})`);
    } catch (error) {
        console.log(chalk.red('✗'), 'NeDB initialization failed:', error);
        process.exit(1);
    }
};

export const closeDB = async (): Promise<void> => {
    console.log(chalk.green('✓'), 'Database closed');
};

export const getDbDir = () => DB_DIR;

export default connectDB;
