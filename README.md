# COPY MARKET

COPY MARKET is a TypeScript Polymarket copy-trading bot using **local NeDB files** (not MongoDB) for activity and position persistence.

## Runtime architecture
- `src/index.ts`: app entrypoint (monitor + executor + API server)
- `src/services/tradeMonitor.ts`: ingests source trader activity
- `src/services/tradeExecutor.ts`: executes queued trades with lifecycle persistence
- `src/utils/postOrder.ts`: order placement + normalized persistence
- `src/models/userHistory.ts`: NeDB wrapper with safe update helpers
- `src/server/index.ts`: API + status UI

## Quick start
1. `npm install`
2. `npm run setup` (copies `.env.example` to `.env`)
3. Edit `.env` with real values
4. `npm run build`
5. `npm start`

## Validation flow
- `npm test`
- `npm run health`
- `curl http://localhost:3000/api/status`

## Truthful operational notes
- Default port is `3000`.
- `PREVIEW_MODE=true` means no live orders are submitted.
- Status endpoint now reflects runtime loop signals (`lastPollAt`, `lastPollSuccessAt`, `lastError`, kill switch state).
- Trade lifecycle persistence uses explicit statuses: `new`, `processing`, `executed`, `skipped`, `failed`, `retry_exhausted`, `partial_fill`.
