# LIVE SMOKE TEST

Use this runbook only after preview-mode validation is already complete.

## What this preflight does

- validates that the repo is configured for live mode
- runs the existing local health checks
- authenticates against the Polymarket CLOB
- performs a read-only authenticated open-order lookup

## What this preflight does not do

- it does not place orders
- it does not cancel orders
- it does not prove full end-to-end execution safety

## Required steps before running it

1. `npm run validate:handoff`
2. `npm run health`
3. Back up `data/`
4. Edit `.env`
   - set `PREVIEW_MODE=false`
   - set `LIVE_SMOKE_CONFIRM=I_HAVE_BACKED_UP_DATA`
   - confirm `PRIVATE_KEY` is present

## Run the preflight

1. `npm run smoke:live:preflight`

Expected outcome:

- PASS for database, RPC, Polymarket API, and authenticated CLOB checks
- WARN is acceptable for low balance, but not for missing credentials or failed auth
- FAIL means do not continue into live startup

## After the preflight passes

1. `npm start`
2. Watch the logs continuously
3. Verify:
   - `http://localhost:3000/api/health`
   - `http://localhost:3000/api/status`
4. Stop immediately if:
   - kill switch activates
   - monitor or executor repeatedly errors
   - runtime status looks degraded unexpectedly

## Notes

- The authenticated step may derive or create a CLOB API key if the wallet has not been initialized before
- Keep the first live session short and treat it as observation-first validation
