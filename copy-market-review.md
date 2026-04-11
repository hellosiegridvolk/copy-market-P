# COPY MARKET Build Review

## Summary
- Build package opened and inspected from uploaded ZIPs.
- Static code review completed across `src`, `dist`, docs, scripts, tests, config, and packaging.
- Attempted test execution failed because Jest/dev dependencies are not installed in the uploaded bundle.

## Readiness
- Estimated readiness: **68%**

## Strong points
- Real TypeScript codebase with compiled `dist/`
- Multi-trader config parsing
- Copy sizing strategies: percentage, fixed, adaptive, tiered multipliers
- Health check utility
- Basic API + web UI
- Preview mode, Telegram hooks, aggregation path, many utility scripts
- Unit tests exist for sizing/env/postOrder logic

## Critical blockers
1. `package.json` contains a broken script:
   - `"setup": "ts-node src/scripts/setup.ts"`
   - `src/scripts/setup.ts` is missing.
2. Test command cannot run from uploaded bundle because dev dependencies are absent:
   - `npm test` -> `sh: 1: jest: not found`
3. Database writes are often not actually executed:
   - custom `updateOne()` returns an object with `.exec()`
   - many call sites use `await UserActivity.updateOne(...)` without `.exec()`
4. Several NeDB updates risk replacing entire documents instead of `$set` patching them:
   - calls such as `updateOne({ _id }, { bot: true })`
5. API/UI status is optimistic rather than truthful:
   - `/api/status` always returns `running: true`
6. Default port mismatch risk:
   - server defaults to `3000`, while earlier workflows/frontend examples often target `3001`
7. Daily loss kill switch uses wallet USDC balance only, not full account equity.

## High-risk code patterns found
### Missing `.exec()` on writes
Examples include:
- `src/services/tradeExecutor.ts`
- `src/utils/postOrder.ts`

### Replacement updates instead of `$set`
Examples include:
- `src/utils/postOrder.ts`
- `src/services/tradeExecutor.ts`

## Recommended next fixes
1. Fix model API or call sites:
   - either make `updateOne()` return a Promise directly
   - or add `.exec()` everywhere consistently
2. Wrap all partial updates in `$set`
3. Add the missing `src/scripts/setup.ts` or remove the script
4. Make `/api/status` reflect actual worker state and last successful loop time
5. Standardize app port and docs/frontend assumptions
6. Add integration tests for:
   - trade detection -> mark processing -> order attempt -> persisted result
   - preview mode
   - aggregation flow
   - sell path proportionality
7. Use account equity for kill switch, not only free USDC
8. Ship either:
   - `node_modules` for a portable offline handoff, or
   - a clean install script with verified install/build steps

## What is implemented but still fragile
- Trade monitor and executor loop structure exist
- Position fetch + trade copy path exist
- Orderbook-based slippage guard exists
- Aggregation exists for small BUY trades
- Logging/UI/docs are decent
- But persistence correctness is currently too fragile for “production-ready” status

## Conclusion
The project is **past prototype stage** and closer to a serious beta, but it is **not yet full-ready** because of the persistence bugs, missing setup script, and unverified packaged test/install path.
