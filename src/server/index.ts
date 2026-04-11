import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { getDbDir } from '../config/db';
import * as fs from 'fs';
import * as path from 'path';
import { getRuntimeStatus } from '../services/runtimeStatus';

const app = express();
app.use(express.json());

// --- Swagger API Docs ---
const swaggerDoc = {
    openapi: '3.0.0',
    info: { title: 'COPY MARKET API', version: '2.0.0', description: 'Monitor and manage your copy trading bot' },
    paths: {
        '/api/health': { get: { summary: 'Health check', tags: ['System'], responses: { 200: { description: 'OK' } } } },
        '/api/status': { get: { summary: 'Bot status', tags: ['Bot'], responses: { 200: { description: 'Bot running status' } } } },
        '/api/config': { get: { summary: 'Current configuration', tags: ['Config'], responses: { 200: { description: 'Config values' } } } },
        '/api/trades': { get: { summary: 'Recent trades', tags: ['Trading'], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }], responses: { 200: { description: 'Trade list' } } } },
    },
};
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

// --- API Routes ---
let botStartTime = Date.now();

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.floor((Date.now() - botStartTime) / 1000), timestamp: new Date().toISOString() });
});

app.get('/api/status', (_req, res) => {
    const dbDir = getDbDir();
    const dbFiles = fs.existsSync(dbDir) ? fs.readdirSync(dbDir).filter(f => f.endsWith('.db')) : [];
    const runtime = getRuntimeStatus();
    res.json({
        running: runtime.isRunning,
        uptime: Math.floor((Date.now() - botStartTime) / 1000),
        mode: runtime.mode,
        previewMode: runtime.mode === 'preview',
        killSwitchTriggered: runtime.killSwitchTriggered,
        killSwitchReason: runtime.killSwitchReason || null,
        lastPollAt: runtime.lastPollAt || null,
        lastPollSuccessAt: runtime.lastPollSuccessAt || null,
        lastExecutionSuccessAt: runtime.lastExecutionSuccessAt || null,
        lastError: runtime.lastError || null,
        lastErrorAt: runtime.lastErrorAt || null,
        queueDepth: runtime.queueDepth || 0,
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
        previewMode: process.env.PREVIEW_MODE || 'false',
        tradeAggregation: process.env.TRADE_AGGREGATION_ENABLED || 'false',
        telegramEnabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    });
});

app.get('/api/trades', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const dbDir = getDbDir();
    const trades: any[] = [];
    if (fs.existsSync(dbDir)) {
        for (const file of fs.readdirSync(dbDir).filter(f => f.startsWith('user_activities_'))) {
            try {
                const content = fs.readFileSync(path.join(dbDir, file), 'utf-8');
                content.split('\n').filter(Boolean).forEach(line => {
                    try { trades.push(JSON.parse(line)); } catch { /* skip malformed */ }
                });
            } catch { /* skip */ }
        }
    }
    trades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json(trades.slice(0, limit));
});

// --- Web UI ---
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>COPY MARKET</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#c9d1d9;--accent:#58a6ff;--green:#3fb950;--red:#f85149;--yellow:#d29922}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);padding:20px}
.container{max-width:1200px;margin:0 auto}
h1{color:var(--accent);margin-bottom:20px;font-size:1.5em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px}
.card h3{color:var(--accent);margin-bottom:12px;font-size:0.9em;text-transform:uppercase;letter-spacing:1px}
.stat{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.9em}
.stat:last-child{border:none}
.stat .label{color:#8b949e}
.stat .value{font-weight:600}
.badge{padding:2px 8px;border-radius:12px;font-size:0.8em}
.badge.green{background:#238636;color:#fff}
.badge.yellow{background:#9e6a03;color:#fff}
.badge.red{background:#da3633;color:#fff}
table{width:100%;border-collapse:collapse;font-size:0.85em}
th,td{padding:8px;text-align:left;border-bottom:1px solid var(--border)}
th{color:#8b949e;font-weight:500}
.buy{color:var(--green)}.sell{color:var(--red)}
.links{margin-top:16px;font-size:0.85em}
.links a{color:var(--accent);margin-right:16px;text-decoration:none}
.links a:hover{text-decoration:underline}
#lang{float:right;background:var(--card);color:var(--text);border:1px solid var(--border);padding:4px 8px;border-radius:4px}
</style>
</head>
<body>
<div class="container">
<select id="lang" onchange="setLang(this.value)"><option value="en">English</option><option value="zh">中文</option><option value="ja">日本語</option></select>
<h1>🤖 COPY MARKET</h1>
<div class="grid">
<div class="card" id="status-card"><h3 data-i18n="status">Status</h3><div id="status">Loading...</div></div>
<div class="card" id="config-card"><h3 data-i18n="config">Configuration</h3><div id="config">Loading...</div></div>
</div>
<div class="card"><h3 data-i18n="trades">Recent Trades</h3><div id="trades">Loading...</div></div>
<div class="links">
<a href="/docs" data-i18n="swagger">📖 API Docs (Swagger)</a>
<a href="/api/health">🏥 Health Check</a>
<a href="/api/trades?limit=100">📊 All Trades (JSON)</a>
</div>
</div>
<script>
const i18n={en:{status:'Status',config:'Configuration',trades:'Recent Trades',swagger:'📖 API Docs',uptime:'Uptime',running:'Running',preview:'Preview Mode',dataFiles:'Data Files',noTrades:'No trades yet'},zh:{status:'状态',config:'配置',trades:'最近交易',swagger:'📖 API 文档',uptime:'运行时间',running:'运行中',preview:'预览模式',dataFiles:'数据文件',noTrades:'暂无交易'},ja:{status:'ステータス',config:'設定',trades:'最近の取引',swagger:'📖 APIドキュメント',uptime:'稼働時間',running:'実行中',preview:'プレビューモード',dataFiles:'データファイル',noTrades:'取引なし'}};
let lang='en';
function setLang(l){lang=l;document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=i18n[l][e.dataset.i18n]||e.textContent);refresh()}
function fmt(s){const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h>0?h+'h '+m+'m':m+'m '+s%60+'s'}
async function refresh(){
try{
const[st,cfg,tr]=await Promise.all([fetch('/api/status').then(r=>r.json()),fetch('/api/config').then(r=>r.json()),fetch('/api/trades?limit=10').then(r=>r.json())]);
document.getElementById('status').innerHTML=\`<div class="stat"><span class="label">\${i18n[lang].running}</span><span class="badge green">✓</span></div><div class="stat"><span class="label">\${i18n[lang].uptime}</span><span class="value">\${fmt(st.uptime)}</span></div><div class="stat"><span class="label">\${i18n[lang].preview}</span><span class="value">\${st.previewMode?'✅':'❌'}</span></div><div class="stat"><span class="label">\${i18n[lang].dataFiles}</span><span class="value">\${st.dataFiles}</span></div>\`;
document.getElementById('config').innerHTML=Object.entries(cfg).map(([k,v])=>\`<div class="stat"><span class="label">\${k}</span><span class="value">\${v}</span></div>\`).join('');
if(tr.length===0){document.getElementById('trades').innerHTML='<p style="padding:12px;color:#8b949e">'+i18n[lang].noTrades+'</p>';return}
document.getElementById('trades').innerHTML='<table><tr><th>Time</th><th>Side</th><th>Amount</th><th>Price</th><th>Market</th></tr>'+tr.map(t=>\`<tr><td>\${new Date(t.timestamp*1000).toLocaleString()}</td><td class="\${(t.side||'').toLowerCase()}">\${t.side||'-'}</td><td>$\${(t.usdcSize||0).toFixed(2)}</td><td>\${(t.price||0).toFixed(4)}</td><td>\${(t.title||t.slug||'-').slice(0,40)}</td></tr>\`).join('')+'</table>';
}catch(e){document.getElementById('status').innerHTML='<span class="badge red">Error</span>'}
}
refresh();setInterval(refresh,5000);
</script>
</body></html>`;

app.get('/', (_req, res) => { res.type('html').send(html); });

export const startServer = (port: number = parseInt(process.env.PORT || '3000')) => {
    botStartTime = Date.now();
    app.listen(port, '0.0.0.0', () => {
        console.log(`\n🌐 Web UI:  http://0.0.0.0:${port}`);
        console.log(`📖 Swagger: http://0.0.0.0:${port}/docs`);
        console.log(`🔌 API:     http://0.0.0.0:${port}/api/health\n`);
    });
};

export default app;
