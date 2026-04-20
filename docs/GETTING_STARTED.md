# GETTING STARTED

## Prerequisites

- Node.js 20+
- npm
- A Polygon wallet you control
- Polymarket-compatible credentials for the configured wallet

## Required setup

1. Install dependencies:
   - `npm ci`
2. Create a starter env file:
   - `npm run setup`
3. Fill in `.env` using `.env.example`
4. Keep `PREVIEW_MODE=true` for your first end-to-end run

## What the runtime actually uses

- Persistence: local NeDB files in `DB_DIR`
- Monitor path: `src/services/tradeMonitor.ts`
- Executor path: `src/services/tradeExecutor.ts`
- Order posting and persistence path: `src/utils/postOrder.ts`
- Status/UI path: `src/server/index.ts`

## Startup sequence

1. `npm run validate:handoff`
2. `npm run health`
3. `npm start`

## Mode expectations

- Preview mode:
  - live order submission is skipped
  - lifecycle persistence and status reporting still run
  - websocket/reconciliation groundwork can stay enabled, or you can disable it temporarily for a pure polling validation pass
  - best choice for first local validation
- Live mode:
  - set `PREVIEW_MODE=false`
  - only do this after preview validation, wallet funding, and backup preparation

## Optional stream controls

- `MARKET_WS_ENABLED=true` enables public market subscriptions
- `USER_WS_ENABLED=true` enables authenticated user subscriptions
- `RECONCILIATION_ENABLED=true` enables the fallback reconciliation worker for unresolved orders
- `STREAM_TARGET_REFRESH_INTERVAL_SECONDS`, `STREAM_HEARTBEAT_INTERVAL_SECONDS`, `RECONCILIATION_INTERVAL_SECONDS`, and `RECONCILIATION_STALE_ORDER_SECONDS` tune the groundwork behavior

## Runtime checks

- `GET /api/health` confirms the process is up
- `GET /api/status` shows:
  - whether monitor and executor loops are running
  - whether websocket and reconciliation workers are connected or stale
  - whether either worker is stale
  - kill switch state
  - queue counts by lifecycle status
  - last success and last error

## Known limitations for the next PR

- The websocket/reconciliation layer is groundwork only; it does not replace a full recovery/replay engine
- No full portfolio accounting engine beyond API-reported balances and positions
- Secondary documentation outside the core startup/deployment guides still needs a broader editorial pass
