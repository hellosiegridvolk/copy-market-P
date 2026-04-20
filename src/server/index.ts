import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { getDbDir } from '../config/db';
import * as fs from 'fs';
import * as path from 'path';
import { TradeLifecycleStatus, UserActivityInterface } from '../interfaces/User';
import { getRuntimeStatus } from '../services/runtimeStatus';

const app = express();
app.use(express.json());

const swaggerDoc = {
    openapi: '3.0.0',
    info: {
        title: 'COPY MARKET API',
        version: '2.0.0',
        description: 'Monitor and manage your copy trading bot',
    },
    paths: {
        '/api/health': {
            get: {
                summary: 'Health check',
                tags: ['System'],
                responses: { 200: { description: 'OK' } },
            },
        },
        '/api/status': {
            get: {
                summary: 'Bot status',
                tags: ['Bot'],
                responses: { 200: { description: 'Bot running status' } },
            },
        },
        '/api/config': {
            get: {
                summary: 'Current configuration',
                tags: ['Config'],
                responses: { 200: { description: 'Config values' } },
            },
        },
        '/api/trades': {
            get: {
                summary: 'Recent trades',
                tags: ['Trading'],
                parameters: [
                    {
                        name: 'limit',
                        in: 'query',
                        schema: { type: 'integer', default: 20 },
                    },
                ],
                responses: { 200: { description: 'Trade list' } },
            },
        },
    },
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

let botStartTime = Date.now();

const deriveLegacyStatus = (trade: UserActivityInterface): TradeLifecycleStatus => {
    if (trade.status) {
        return trade.status;
    }

    if (trade.bot === true) {
        return trade.botExcutedTime === 999 ? 'skipped' : 'executed';
    }

    return 'new';
};

const readPersistedTrades = (): UserActivityInterface[] => {
    const dbDir = getDbDir();
    if (!fs.existsSync(dbDir)) {
        return [];
    }

    const trades: UserActivityInterface[] = [];
    for (const file of fs.readdirSync(dbDir).filter((entry) => entry.startsWith('user_activities_'))) {
        try {
            const content = fs.readFileSync(path.join(dbDir, file), 'utf-8');
            content
                .split('\n')
                .filter(Boolean)
                .forEach((line) => {
                    try {
                        trades.push(JSON.parse(line));
                    } catch {
                        // Ignore malformed rows from local datastore inspection.
                    }
                });
        } catch {
            // Ignore unreadable files so status can still render partial truth.
        }
    }

    return trades;
};

const getQueueCounts = (trades: UserActivityInterface[]) => {
    const queue = {
        new: 0,
        processing: 0,
        failed: 0,
        retryExhausted: 0,
        partialFill: 0,
        executed: 0,
        skipped: 0,
    };

    for (const trade of trades) {
        switch (deriveLegacyStatus(trade)) {
            case 'new':
                queue.new += 1;
                break;
            case 'processing':
                queue.processing += 1;
                break;
            case 'failed':
                queue.failed += 1;
                break;
            case 'retry_exhausted':
                queue.retryExhausted += 1;
                break;
            case 'partial_fill':
                queue.partialFill += 1;
                break;
            case 'executed':
                queue.executed += 1;
                break;
            case 'skipped':
                queue.skipped += 1;
                break;
        }
    }

    return queue;
};

const isWorkerStale = (lastLoopAt?: number | null): boolean => {
    if (!lastLoopAt) {
        return false;
    }

    const fetchIntervalSeconds = parseInt(process.env.FETCH_INTERVAL || '1', 10);
    const staleThresholdMs = Math.max((fetchIntervalSeconds + 5) * 1000, 10000);
    return Date.now() - lastLoopAt > staleThresholdMs;
};

app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - botStartTime) / 1000),
        timestamp: new Date().toISOString(),
    });
});

app.get('/api/status', (_req, res) => {
    const dbDir = getDbDir();
    const dbFiles = fs.existsSync(dbDir)
        ? fs.readdirSync(dbDir).filter((file) => file.endsWith('.db'))
        : [];
    const runtime = getRuntimeStatus();
    const trades = readPersistedTrades();
    const queue = getQueueCounts(trades);
    const monitorStale = runtime.monitor.running && isWorkerStale(runtime.monitor.lastLoopAt);
    const executorStale = runtime.executor.running && isWorkerStale(runtime.executor.lastLoopAt);
    const monitorHeartbeatMissing = runtime.monitor.running && !runtime.monitor.lastLoopAt;
    const executorHeartbeatMissing = runtime.executor.running && !runtime.executor.lastLoopAt;
    const running = runtime.monitor.running || runtime.executor.running;
    const degradedReasons: string[] = [];

    if (!runtime.monitor.running) degradedReasons.push('monitor_stopped');
    if (!runtime.executor.running) degradedReasons.push('executor_stopped');
    if (monitorStale) degradedReasons.push('monitor_stale');
    if (executorStale) degradedReasons.push('executor_stale');
    if (monitorHeartbeatMissing) degradedReasons.push('monitor_heartbeat_missing');
    if (executorHeartbeatMissing) degradedReasons.push('executor_heartbeat_missing');
    if (runtime.risk.consecutiveMonitorErrors > 0) degradedReasons.push('monitor_errors');
    if (runtime.risk.consecutiveExecutionErrors > 0) degradedReasons.push('execution_errors');
    if (runtime.risk.consecutiveEquitySnapshotFailures > 0) {
        degradedReasons.push('equity_snapshot_degraded');
    }
    if (
        runtime.risk.equitySource === 'balance_only_fallback' ||
        runtime.risk.equitySource === 'balance_unavailable'
    ) {
        degradedReasons.push('equity_snapshot_incomplete');
    }

    const healthy =
        runtime.monitor.running &&
        runtime.executor.running &&
        degradedReasons.length === 0 &&
        !runtime.killSwitchActive;

    res.json({
        running,
        healthy,
        degraded: running && !healthy && !runtime.killSwitchActive,
        degradedReasons,
        uptime: Math.floor((Date.now() - botStartTime) / 1000),
        mode: runtime.mode,
        previewMode: runtime.mode === 'preview',
        killSwitchActive: runtime.killSwitchActive,
        killSwitchReason: runtime.killSwitchReason || null,
        lastSuccessAt: runtime.lastSuccessAt || null,
        lastError: runtime.lastError || null,
        lastErrorAt: runtime.lastErrorAt || null,
        monitor: {
            running: runtime.monitor.running,
            stale: monitorStale,
            lastLoopAt: runtime.monitor.lastLoopAt || null,
            lastSuccessAt: runtime.monitor.lastSuccessAt || null,
            lastError: runtime.monitor.lastError || null,
            lastErrorAt: runtime.monitor.lastErrorAt || null,
        },
        executor: {
            running: runtime.executor.running,
            stale: executorStale,
            lastLoopAt: runtime.executor.lastLoopAt || null,
            lastSuccessAt: runtime.executor.lastSuccessAt || null,
            lastError: runtime.executor.lastError || null,
            lastErrorAt: runtime.executor.lastErrorAt || null,
            aggregationQueueDepth: runtime.aggregationQueueDepth || 0,
        },
        queue,
        risk: {
            currentEquity: runtime.risk.currentEquity ?? null,
            freeBalance: runtime.risk.freeBalance ?? null,
            openPositionValue: runtime.risk.openPositionValue ?? null,
            dailyStartEquity: runtime.risk.dailyStartEquity ?? null,
            dailyLossPct: runtime.risk.dailyLossPct ?? null,
            equitySource: runtime.risk.equitySource,
            lastEquityAt: runtime.risk.lastEquityAt ?? null,
            lastEquityError: runtime.risk.lastEquityError ?? null,
            lastEquityErrorAt: runtime.risk.lastEquityErrorAt ?? null,
            consecutiveExecutionErrors: runtime.risk.consecutiveExecutionErrors,
            consecutiveMonitorErrors: runtime.risk.consecutiveMonitorErrors,
            consecutiveEquitySnapshotFailures:
                runtime.risk.consecutiveEquitySnapshotFailures,
        },
        dataFiles: dbFiles.length,
    });
});

app.get('/api/config', (_req, res) => {
    res.json({
        copyStrategy: process.env.COPY_STRATEGY || 'PERCENTAGE',
        copySize: process.env.COPY_SIZE || '10.0',
        maxOrderSize: process.env.MAX_ORDER_SIZE_USD || '100.0',
        minOrderSize: process.env.MIN_ORDER_SIZE_USD || '1.0',
        fetchInterval: process.env.FETCH_INTERVAL || '1',
        slippageTolerance: process.env.SLIPPAGE_TOLERANCE || '0.05',
        dailyLossCap: process.env.DAILY_LOSS_CAP_PCT || '20',
        killSwitchMaxErrors: process.env.KILL_SWITCH_MAX_ERRORS || '5',
        killSwitchEquityFallbackLimit:
            process.env.KILL_SWITCH_EQUITY_FALLBACK_LIMIT || '3',
        killSwitchMonitorErrorLimit:
            process.env.KILL_SWITCH_MONITOR_ERROR_LIMIT ||
            process.env.KILL_SWITCH_MAX_ERRORS ||
            '5',
        killSwitchMonitorStaleSeconds:
            process.env.KILL_SWITCH_MONITOR_STALE_SECONDS || '15',
        previewMode: process.env.PREVIEW_MODE || 'false',
        tradeAggregation: process.env.TRADE_AGGREGATION_ENABLED || 'false',
        telegramEnabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    });
});

app.get('/api/trades', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const trades = readPersistedTrades();
    trades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json(trades.slice(0, limit));
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>COPY MARKET</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #0d1117;
  --card: #161b22;
  --border: #30363d;
  --text: #c9d1d9;
  --accent: #58a6ff;
  --green: #238636;
  --yellow: #9e6a03;
  --red: #da3633;
}
body {
  font-family: "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
  padding: 20px;
}
.container { max-width: 1200px; margin: 0 auto; }
h1 { color: var(--accent); margin-bottom: 20px; font-size: 1.5rem; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}
.card h3 {
  color: var(--accent);
  margin-bottom: 12px;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.stat {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.9rem;
}
.stat:last-child { border-bottom: none; }
.label { color: #8b949e; }
.value { font-weight: 600; text-align: right; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  color: #fff;
}
.badge.green { background: var(--green); }
.badge.yellow { background: var(--yellow); }
.badge.red { background: var(--red); }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
th { color: #8b949e; font-weight: 500; }
.buy { color: #3fb950; }
.sell { color: #f85149; }
.links { margin-top: 16px; font-size: 0.85rem; }
.links a {
  color: var(--accent);
  margin-right: 16px;
  text-decoration: none;
}
.links a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="container">
  <h1>COPY MARKET</h1>
  <div class="grid">
    <div class="card">
      <h3>Runtime status</h3>
      <div id="status">Loading...</div>
    </div>
    <div class="card">
      <h3>Configuration</h3>
      <div id="config">Loading...</div>
    </div>
    <div class="card">
      <h3>Queue</h3>
      <div id="queue">Loading...</div>
    </div>
  </div>
  <div class="card">
    <h3>Recent trades</h3>
    <div id="trades">Loading...</div>
  </div>
  <div class="links">
    <a href="/docs">API Docs</a>
    <a href="/api/health">Health Check</a>
    <a href="/api/trades?limit=100">All Trades (JSON)</a>
  </div>
</div>
<script>
const formatSeconds = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm ' + s + 's';
};

const formatTime = (value) => value ? new Date(value).toLocaleString() : 'n/a';
const formatMoney = (value) => value === null || value === undefined ? 'n/a' : '$' + Number(value).toFixed(2);
const formatPct = (value) => value === null || value === undefined ? 'n/a' : Number(value).toFixed(2) + '%';

const badge = (label, tone) => '<span class="badge ' + tone + '">' + label + '</span>';

async function refresh() {
  try {
    const [status, config, trades] = await Promise.all([
      fetch('/api/status').then((response) => response.json()),
      fetch('/api/config').then((response) => response.json()),
      fetch('/api/trades?limit=10').then((response) => response.json())
    ]);

    const overallBadge = status.healthy
      ? badge('healthy', 'green')
      : status.killSwitchActive
        ? badge('kill switch', 'red')
        : status.running
          ? badge('degraded', 'yellow')
          : badge('stopped', 'red');

    document.getElementById('status').innerHTML = [
      ['overall', overallBadge],
      ['uptime', formatSeconds(status.uptime)],
      ['mode', status.mode],
      ['last success', formatTime(status.lastSuccessAt)],
      ['last error', status.lastError || 'none'],
      ['degraded reasons', status.degradedReasons && status.degradedReasons.length ? status.degradedReasons.join(', ') : 'none'],
      ['monitor', (status.monitor.running ? 'running' : 'stopped') + (status.monitor.stale ? ' (stale)' : '')],
      ['monitor heartbeat', formatTime(status.monitor.lastLoopAt)],
      ['executor', (status.executor.running ? 'running' : 'stopped') + (status.executor.stale ? ' (stale)' : '')],
      ['executor heartbeat', formatTime(status.executor.lastLoopAt)],
      ['kill switch', status.killSwitchActive ? (status.killSwitchReason || 'active') : 'inactive'],
      ['equity source', status.risk.equitySource],
      ['current equity', formatMoney(status.risk.currentEquity)],
      ['free balance', formatMoney(status.risk.freeBalance)],
      ['open positions', formatMoney(status.risk.openPositionValue)],
      ['daily loss', formatPct(status.risk.dailyLossPct)],
      ['risk counters', 'exec ' + status.risk.consecutiveExecutionErrors + ' / monitor ' + status.risk.consecutiveMonitorErrors + ' / equity ' + status.risk.consecutiveEquitySnapshotFailures]
    ].map(([label, value]) => '<div class="stat"><span class="label">' + label + '</span><span class="value">' + value + '</span></div>').join('');

    document.getElementById('config').innerHTML = Object.entries(config)
      .map(([key, value]) => '<div class="stat"><span class="label">' + key + '</span><span class="value">' + value + '</span></div>')
      .join('');

    document.getElementById('queue').innerHTML = Object.entries(status.queue)
      .map(([key, value]) => '<div class="stat"><span class="label">' + key + '</span><span class="value">' + value + '</span></div>')
      .join('');

    if (!trades.length) {
      document.getElementById('trades').innerHTML = '<p style="padding:12px;color:#8b949e">No trades yet</p>';
      return;
    }

    document.getElementById('trades').innerHTML =
      '<table><tr><th>Time</th><th>Status</th><th>Side</th><th>Amount</th><th>Market</th></tr>' +
      trades.map((trade) => {
        const sideClass = (trade.side || '').toLowerCase();
        return '<tr>' +
          '<td>' + new Date((trade.timestamp || 0) * 1000).toLocaleString() + '</td>' +
          '<td>' + (trade.status || 'legacy') + '</td>' +
          '<td class="' + sideClass + '">' + (trade.side || '-') + '</td>' +
          '<td>$' + Number(trade.usdcSize || 0).toFixed(2) + '</td>' +
          '<td>' + ((trade.title || trade.slug || '-').slice(0, 40)) + '</td>' +
        '</tr>';
      }).join('') +
      '</table>';
  } catch (error) {
    document.getElementById('status').innerHTML = badge('error', 'red');
  }
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

app.get('/', (_req, res) => {
    res.type('html').send(html);
});

export const startServer = (port: number = parseInt(process.env.PORT || '3000', 10)) => {
    botStartTime = Date.now();
    return app.listen(port, '0.0.0.0', () => {
        console.log(`\nWeb UI:  http://0.0.0.0:${port}`);
        console.log(`Swagger: http://0.0.0.0:${port}/docs`);
        console.log(`API:     http://0.0.0.0:${port}/api/health\n`);
    });
};

if (require.main === module) {
    startServer();
}

export default app;
