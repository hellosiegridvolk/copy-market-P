# COPY MARKET

COPY MARKET is a local-first TypeScript Polymarket copy-trading bot. It monitors one or more source traders, persists detected trades into local NeDB files, executes eligible copies, and exposes a lightweight API/UI for health and runtime visibility.

This repository now contains the unpacked application source. The runtime does not depend on MongoDB. Persistence is file-backed under `DB_DIR` (default `./data`).

## Current runtime architecture

- `src/index.ts`: application entrypoint and graceful shutdown wiring
- `src/services/tradeMonitor.ts`: polls source trader activity and persists new trades
- `src/services/tradeExecutor.ts`: processes pending trades, enforces lifecycle transitions, and updates runtime heartbeat state
- `src/utils/postOrder.ts`: posts orders, normalizes exchange results, and persists final order outcomes
- `src/models/userHistory.ts`: NeDB wrapper with safe update helpers and explicit replacement escape hatch
- `src/server/index.ts`: API, Swagger docs, and status dashboard

## What is implemented

- Multi-trader monitoring from Polymarket activity endpoints
- Copy sizing strategies with configurable caps
- Preview mode and live mode
- Local NeDB persistence for activities and tracked positions
- Optional Polymarket market/user websocket groundwork with reconciliation fallback polling
- Explicit persisted trade lifecycle:
  - `new`
  - `processing`
  - `executed`
  - `skipped`
  - `failed`
  - `retry_exhausted`
  - `partial_fill`
- Runtime status API with separate monitor/executor heartbeats, websocket/reconciliation state, and queue counts
- Health-check script for local storage, RPC, balance, and Polymarket API reachability
- Jest coverage for DB wrapper behavior, env validation, post-order persistence, copy strategy sizing, and executor lifecycle handling

## What is not yet production-grade

- Websocket market and user subscriptions now exist as groundwork, but they are still best-effort visibility/reconciliation helpers rather than a full exchange-grade recovery layer
- Kill-switch equity checks are materially better than free-USDC-only, but they still rely on API-reported position values rather than a full independent reconciliation engine
- Local file persistence needs explicit backup and log-rotation discipline in any long-running deployment
- Some secondary historical docs remain informational rather than fully updated operational guides

## Storage model

- Local datastore: NeDB files in `DB_DIR`
- Default data directory: `./data`
- No MongoDB setup is required
- Partial updates are protected by safe helpers:
  - `updateOne(...)` treats plain objects as `$set` patches
  - `updateOneSet(query, fields)` for explicit field patches
  - `setById(id, fields)` for document patches by `_id`
  - `incById(id, fields)` for counters
  - `replaceOne(query, doc)` for intentional full-document replacement only

## Preview vs live mode

- `PREVIEW_MODE=true` is the recommended first run
- `PREVIEW_MODE=false` enables live order posting
- `npm run smoke:live:preflight` is the guarded read-only check to run immediately before the first live startup
- `MARKET_WS_ENABLED`, `USER_WS_ENABLED`, and `RECONCILIATION_ENABLED` let you disable the groundwork streams if you need a polling-only validation pass
- The status API reports the effective mode, worker heartbeats, stream/reconciliation state, queue state, last success, and last error
- Default API/UI port is `3000` unless `PORT` is set

## Local validation flow

1. `npm ci`
2. `npm run setup`
3. Edit `.env`
   - leave `PREVIEW_MODE=true` for the first pass
   - `PRIVATE_KEY` can stay blank in preview mode
4. `npm run validate:handoff`
5. `npm run health`
   - if RPC connectivity fails, refresh `.env` from the current `.env.example` or update `RPC_URL`
6. Optional live-only step after preview validation:
   - set `PREVIEW_MODE=false`
   - back up `data/`
   - set `LIVE_SMOKE_CONFIRM=I_HAVE_BACKED_UP_DATA`
   - run `npm run smoke:live:preflight`
7. `npm start`
8. Check:
   - `http://localhost:3000/api/health`
   - `http://localhost:3000/api/status`
   - `http://localhost:3000/docs`

### Windows note

- Run the commands from the repository directory, not from `C:\Users\Asus Willy`
- Paste the PR description into GitHub, not into PowerShell
- Ignore stray `.env.txt` files and use `.env`
- For a PowerShell-safe runbook, use `docs/WINDOWS_QUICK_START.md`

## Runtime API surface

- `GET /api/health`: process uptime and timestamp
- `GET /api/status`: runtime truth, worker heartbeat state, stream/reconciliation state, kill switch state, and queue counts
- `GET /api/config`: effective runtime configuration values
- `GET /api/trades`: recent persisted trades
- `GET /docs`: Swagger UI

## Handoff notes

- Start in preview mode and validate the lifecycle fields in the local datastore before enabling live orders
- Use `npm run smoke:live:preflight` before the first live startup; it performs read-only live checks and does not place or cancel orders
- Back up the `data/` directory before any live testing or deployment changes
- Review `CODEX_FIX_SUMMARY.md` for the exact files inspected, mismatches reconciled, remaining blockers, and the next verification commands
