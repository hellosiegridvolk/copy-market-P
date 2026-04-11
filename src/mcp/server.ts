#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

const readDbFile = (filename: string): any[] => {
    const fp = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fp)) return [];
    return fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
};

const server = new McpServer({ name: 'copy-market', version: '2.0.0' });

server.tool('get_bot_status', 'Get current bot status and uptime', {}, async () => {
    const dbFiles = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.db')) : [];
    return { content: [{ type: 'text', text: JSON.stringify({
        running: true,
        dataDir: DATA_DIR,
        dataFiles: dbFiles.length,
        previewMode: process.env.PREVIEW_MODE === 'true',
    }, null, 2) }] };
});

server.tool('get_recent_trades', 'Get recent copy trades', { limit: z.number().optional().describe('Max trades to return (default 20)') }, async ({ limit }) => {
    const trades: any[] = [];
    if (fs.existsSync(DATA_DIR)) {
        for (const f of fs.readdirSync(DATA_DIR).filter(f => f.startsWith('user_activities_'))) {
            trades.push(...readDbFile(f));
        }
    }
    trades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return { content: [{ type: 'text', text: JSON.stringify(trades.slice(0, limit || 20), null, 2) }] };
});

server.tool('get_positions', 'Get current tracked positions', {}, async () => {
    const positions: any[] = [];
    if (fs.existsSync(DATA_DIR)) {
        for (const f of fs.readdirSync(DATA_DIR).filter(f => f.startsWith('user_positions_'))) {
            positions.push(...readDbFile(f));
        }
    }
    return { content: [{ type: 'text', text: JSON.stringify(positions, null, 2) }] };
});

server.tool('get_config', 'Get current bot configuration', {}, async () => {
    return { content: [{ type: 'text', text: JSON.stringify({
        copyStrategy: process.env.COPY_STRATEGY || 'PERCENTAGE',
        copySize: process.env.COPY_SIZE || '10.0',
        maxOrderSize: process.env.MAX_ORDER_SIZE_USD || '100.0',
        fetchInterval: process.env.FETCH_INTERVAL || '1',
        slippageTolerance: process.env.SLIPPAGE_TOLERANCE || '0.05',
        dailyLossCap: process.env.DAILY_LOSS_CAP_PCT || '20',
        previewMode: process.env.PREVIEW_MODE || 'false',
    }, null, 2) }] };
});

const main = async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
};
main().catch(console.error);
