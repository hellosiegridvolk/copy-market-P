# QUICK START

## Recommended first run

1. `npm ci`
2. `npm run setup`
3. Edit `.env`
4. Confirm `PREVIEW_MODE=true`
5. `npm run validate:handoff`
6. `npm run health`
7. `npm start`

## Verify locally

- API health: `http://localhost:3000/api/health`
- Runtime truth: `http://localhost:3000/api/status`
- Swagger UI: `http://localhost:3000/docs`

## Storage

- COPY MARKET uses local NeDB files, not MongoDB
- Default storage path is `./data`
- Override with `DB_DIR` if you need a different persistent volume

## Before switching to live mode

- Keep preview mode on until the status endpoint shows healthy worker heartbeats
- Inspect persisted trade records to confirm `status`, `retryCount`, `lastError`, `orderId`, and `sizeExecuted` are being written as expected
- Back up the local data directory before running with live credentials
