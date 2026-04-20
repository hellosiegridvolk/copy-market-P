# DEPLOYMENT

## Baseline deployment flow

1. `npm ci`
2. Configure `.env`
3. `npm run validate:handoff`
4. `npm run health`
5. `npm start`

## What to provision

- A writable persistent volume for `DB_DIR`
- Network access to the configured Polygon RPC endpoint
- A secure place to manage `.env` secrets
- Process supervision if you want the bot to restart automatically after a crash

## Truthful runtime notes

- Persistence backend is local NeDB, not MongoDB
- Default API/UI port is `3000` unless `PORT` is overridden
- `npm start` now builds and then launches the compiled app
- `npm run swagger` builds and launches the standalone API/UI server entrypoint

## Suggested operational safeguards

- Start new environments in preview mode first
- Back up `DB_DIR` before changing credentials or moving hosts
- Keep health/status checks in your deployment checklist:
  - `/api/health`
  - `/api/status`
  - `/docs`

## Remaining blockers before broader live confidence

- No websocket market/user stream support yet
- No full reconciliation job for local state versus exchange state
- Kill switch still depends on API-sourced equity estimates rather than a dedicated accounting layer
