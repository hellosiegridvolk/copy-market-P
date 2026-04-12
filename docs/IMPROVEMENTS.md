# Improvements

This document summarizes the current handoff-focused improvements in COPY MARKET.

## What changed

- Persistence safety
  - NeDB updates now default to safe field patches instead of accidental full-document replacement.
  - Explicit helpers exist for `$set`, `$inc`, and intentional replacement behavior.
- Trade lifecycle truthfulness
  - Trades now persist explicit lifecycle state, retry counts, last errors, attempt timestamps, order ids, and executed size.
  - Reprocessing is idempotent for already completed trades.
- Post-order normalization
  - Successful, rejected, and partial-fill outcomes are persisted explicitly.
  - Aggregated trades now fan normalized results back across every underlying trade record.
- Runtime truthfulness
  - `/api/status` reports separate monitor and executor worker state.
  - Queue counts are derived from persisted data.
  - Kill switch state, last success, last error, and worker staleness are visible.
- Preview-safe startup
  - `PREVIEW_MODE=true` no longer requires a live private key just to run validation and a dry-run startup.
  - Preview mode skips authenticated client initialization and can complete a local smoke test safely.
- Script and handoff cleanup
  - `start` builds before launch.
  - `swagger` launches the real compiled server entrypoint.
  - `validate:handoff` is a clean build-and-test gate.
- Docs cleanup
  - README and the core operational docs now describe the actual NeDB-based runtime.
  - A Windows PowerShell quick-start guide is included.

## What did not change

- This PR does not add a websocket reconciliation architecture.
- This PR does not add a full independent accounting engine.
- Live trading still requires a valid private key, funded wallet, and a deliberate switch to `PREVIEW_MODE=false`.

## Recommended next checks

1. `npm run setup`
2. Edit `.env`
3. `npm run validate:handoff`
4. `npm run health`
5. `npm start`
6. Check `http://localhost:3000/api/status`
