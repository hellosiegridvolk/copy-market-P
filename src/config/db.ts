import * as path from 'path';
import * as fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');

const ensureDbDir = () => {
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }
};

const connectDB = async () => {
    try {
        ensureDbDir();
        console.log('✓', `NeDB initialized (${DB_DIR})`);
    } catch (error) {
        console.log('✗', 'NeDB initialization failed:', error);
        process.exit(1);
    }
};

export const closeDB = async (): Promise<void> => {
    console.log('✓', 'Database closed');
};

export const getDbDir = () => DB_DIR;

export default connectDB;
