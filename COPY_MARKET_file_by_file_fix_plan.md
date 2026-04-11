# COPY MARKET — File-by-File Fix Plan to Full Readiness

## Goal

Turn the current COPY MARKET build from a feature-rich beta into a handoff-clean, testable, safer Polymarket bot by fixing correctness, packaging, runtime visibility, and integration maturity in the right order.

## Current Readiness

**Estimated readiness: 62%**

## Target State

**Phase target:** 90%+ readiness  
**Principle:** Fix correctness and handoff trust first, then execution reliability, then Polymarket maturity, then operator safety.

---

# Recommended Execution Order

1. **Fix persistence correctness**
2. **Fix packaging and docs inconsistencies**
3. **Make runtime status truthful**
4. **Harden execution flow and state transitions**
5. **Upgrade Polymarket integration**
6. **Expand testing and validation**
7. **Add operator-grade risk controls**

---

# Phase 1 — Critical Correctness and Trust Fixes

## 1. `src/models/db.ts`
### Problems
- `updateOne()` currently returns an object with `.exec()` instead of a Promise.
- This design is causing incorrect call-site usage across the codebase.
- Current API shape invites silent no-op writes when `.exec()` is forgotten.

### Fix
Choose one of these approaches:

#### Preferred
Refactor `updateOne()` to return a Promise directly.

Example target behavior:
```ts
updateOne(query, update) {
  return ds.updateAsync(query, update, {});
}
```

Then all call sites can safely use:
```ts
await UserActivity.updateOne(...)
```

#### Acceptable alternative
Keep `.exec()` but then patch every caller consistently.

### Also add
- `updateOneSet(query, fields)` helper to enforce `$set` updates.
- Optional wrapper helpers:
  - `setById(id, fields)`
  - `incById(id, fields)`
  - `replaceOne(query, doc)` only when full replacement is intentional

### Validation
- Unit test that `updateOne()` really writes.
- Unit test that a field-only update does not erase the rest of the document.
- Unit test for `$set` and `$inc` behavior.

### Exit criteria
- No write path can silently fail because `.exec()` was forgotten.
- All partial updates are explicit and safe.

---

## 2. `src/monitor/tradeExecutor.ts`
### Problems
- Likely incorrect `updateOne()` usage.
- Risk of partial document overwrite without `$set`.
- State transitions are too implicit.
- Failures and retries need clearer persistence.

### Fix
Patch all DB writes.

Replace patterns like:
```ts
await UserActivity.updateOne({ _id: trade._id }, { bot: true });
```

With:
```ts
await UserActivity.updateOne({ _id: trade._id }, { $set: { bot: true } });
```

Or use helper:
```ts
await UserActivity.setById(trade._id, { bot: true });
```

### Add explicit state machine fields
Suggested fields:
- `status: "new" | "processing" | "executed" | "skipped" | "failed" | "retry_exhausted" | "partial_fill"`
- `retryCount`
- `lastError`
- `lastAttemptAt`
- `executedAt`
- `orderId`
- `side`
- `marketSlug`
- `tokenId`
- `sizeRequested`
- `sizeExecuted`

### Add execution flow rules
Before order:
- mark `processing`
- persist timestamp
- persist intended action

After success:
- mark `executed`
- store order id
- store executed size
- clear last error

After retryable failure:
- increment retry count
- store last error
- revert to retryable state

After terminal failure:
- mark `retry_exhausted`

### Validation
- Simulated success writes proper executed state.
- Simulated failure increments retries.
- Simulated terminal failure ends in terminal state.
- Re-running executor does not duplicate already executed trades.

### Exit criteria
- Every trade has an auditable lifecycle.
- Reprocessing is idempotent.

---

## 3. `src/processor/postOrder.ts`
### Problems
- Same DB update risk as above.
- Potential partial overwrite.
- Order result persistence likely incomplete or inconsistent.

### Fix
Patch every update call to use safe update semantics.

### Add
Persist full order outcome envelope:
- request summary
- execution summary
- side
- market
- order type
- expected price
- actual average price if available
- fees if available
- token amount
- status
- error payload if failed

### Add reconciliation helpers
- `isOrderSuccess(result)`
- `normalizeOrderResult(result)`
- `extractOrderIdentifiers(result)`

### Validation
- Mock successful order response
- Mock rejected order response
- Mock partial fill response
- Confirm DB stores normalized result in each case

### Exit criteria
- Order outcomes are recorded in a way that later accounting and debugging can trust.

---

## 4. `src/monitor/tradeMonitor.ts`
### Problems
- Monitor loop looks real, but needs better state discipline.
- Need clearer dedupe and intake semantics.
- Needs stronger resilience around malformed source trades and API hiccups.

### Fix
### Add intake states
Suggested fields at creation:
- `status: "new"`
- `sourceTrader`
- `sourceTradeId`
- `detectedAt`
- `copied: false`
- `aggregated: false`

### Add dedupe rules
Before inserting a new trade:
- dedupe by source trader + source trade id
- dedupe by transaction hash + token + side where relevant

### Add monitor metrics
- `lastPollAt`
- `lastPollSuccessAt`
- `lastPollError`
- `newTradesDetectedCount`

### Validation
- Same source trade does not insert twice.
- Monitor survives malformed record and continues.
- API failure sets error metrics without crashing the loop.

### Exit criteria
- Intake is durable, deduplicated, and observable.

---

# Phase 2 — Packaging and Handoff Cleanliness

## 5. `package.json`
### Problems
- `setup` script points to a missing file.
- Handoff is not clean.
- Script surface may not match actual repo contents.

### Fix
Either:
- add `src/scripts/setup.ts`

or:
- remove `"setup": "ts-node src/scripts/setup.ts"`

### Also review
- `start`
- `dev`
- `build`
- `test`
- `lint`
- `health`
- `swagger`
- any script referencing MongoDB or removed components

### Add
Recommended scripts:
```json
"validate:handoff": "npm run build && npm test",
"health": "ts-node src/scripts/healthCheck.ts"
```

### Validation
- Every package script points to a real file.
- Fresh user can run the documented command path without hitting missing-file errors.

### Exit criteria
- No broken advertised scripts remain.

---

## 6. `README.md`
### Problems
- Needs alignment with the actual app.
- Should reflect NeDB, not MongoDB if that is the true runtime.

### Fix
Rewrite the README around:
- what the bot does
- architecture
- required env vars
- storage model: local NeDB
- preview mode vs live mode
- startup steps
- dashboard/API access
- risk disclaimer
- known limitations

### Add sections
- “What is implemented”
- “What is not yet production-grade”
- “Local data location”
- “How to validate before going live”

### Exit criteria
- README matches current reality and does not promise removed infrastructure.

---

## 7. `docs/QUICK_START.md`
## 8. `docs/GETTING_STARTED.md`
## 9. `docs/DEPLOYMENT.md`
### Problems
- Still reference MongoDB / `MONGO_URI`
- Conflict with actual code using NeDB
- Reduce trust in the build

### Fix
Update all three docs to:
- remove MongoDB setup if no longer needed
- document local datastore behavior
- document data folder persistence
- explain backup/restore of local DB files
- clearly separate:
  - local beta mode
  - paper mode / preview mode
  - real-money mode

### Add
Deployment guidance for the actual build:
- PM2/systemd/Docker only if truly supported
- environment variable checklist
- API credential checklist
- backup strategy for local DB
- log rotation guidance

### Exit criteria
- No operational doc instructs users to configure infrastructure the code does not use.

---

## 10. `src/scripts/healthCheck.ts`
### Problems
- Health check still reportedly references MongoDB troubleshooting.
- Likely not aligned with real runtime dependencies.

### Fix
Update health check to validate only real dependencies:
- required env vars
- wallet private key format
- funder/proxy wallet format
- network RPC connectivity
- Polymarket API credential status
- CLOB auth readiness
- local data directory writable
- API server reachability
- dashboard reachability if applicable

### Add output sections
- `PASS`
- `WARN`
- `FAIL`
- recommended next action

### Exit criteria
- Health check reflects current architecture only.

---

# Phase 3 — Truthful Runtime Visibility

## 11. `src/api/server.ts`
### Problems
- `/api/status` is too optimistic.
- It should not always say `running: true`.

### Fix
Make status dynamic.

Suggested status shape:
```ts
{
  running: boolean,
  previewMode: boolean,
  killSwitchActive: boolean,
  monitor: {
    running: boolean,
    lastPollAt: string | null,
    lastSuccessAt: string | null,
    lastError: string | null
  },
  executor: {
    running: boolean,
    lastLoopAt: string | null,
    lastSuccessAt: string | null,
    lastError: string | null
  },
  queue: {
    newTrades: number,
    processingTrades: number,
    failedTrades: number
  }
}
```

### Add
A shared in-memory runtime registry or heartbeat module.

### Validation
- Kill monitor loop intentionally and confirm status degrades.
- Force API error and confirm `lastError` updates.
- Trigger kill switch and confirm API reflects it.

### Exit criteria
- Dashboard/API status can be trusted operationally.

---

## 12. `src/web/*` or dashboard UI files
### Problems
- UI may display cosmetic health instead of real health.

### Fix
Update dashboard cards to reflect:
- loop heartbeat timestamps
- kill switch state
- pending queue size
- last error
- preview/live mode
- current port and base URL

### Add
Visible warnings:
- “Preview mode active”
- “Kill switch active”
- “Monitor stale”
- “Executor stale”

### Exit criteria
- Operator can tell within seconds whether the bot is healthy.

---

# Phase 4 — Execution Reliability and State Discipline

## 13. `src/lib/copyStrategy.ts`
### Status
One of the stronger files. Logic exists and is useful.

### Remaining fixes
- Add explicit handling for:
  - minimum notional after fees
  - low-liquidity rejection
  - exposure cap per market
  - total portfolio cap
  - duplicate position cap

### Add tests
- exact edge around minimum size
- exposure limit reached
- adaptive reduction with low balance
- multiple open positions on same market

### Exit criteria
- Sizing engine is deterministic and risk-aware.

---

## 14. `src/utils/killSwitch.ts`
### Problems
- Daily loss logic appears too shallow.
- Likely balance-based, not full-equity-based.

### Fix
Redesign kill switch to account for:
- free USDC
- open position marked value
- realized PnL
- unrealized PnL
- daily notional loss
- repeated failed orders
- API outage conditions

### Add triggers
- max daily realized drawdown
- max daily total equity drawdown
- max consecutive execution failures
- max stale data interval

### Exit criteria
- Kill switch behaves like a real safety system, not just a balance check.

---

## 15. `src/utils/positionSummary.ts` or equivalent position/accounting files
### Problems
- Need stronger position reconciliation
- Need clarity between intended fills and actual fills

### Fix
Add consistent position summary model:
- market
- token
- side
- net size
- average entry
- current bid/ask
- marked value
- realized pnl
- unrealized pnl

### Add reconciliation jobs
- compare local DB vs onchain/CLOB account state
- detect orphan positions
- detect stale processing records
- detect impossible negative sizes

### Exit criteria
- Bot can explain what it thinks it owns and why.

---

## 16. `src/scripts/closeStalePositions.ts`
### Fixes
- Verify it uses safe status transitions
- Require dry-run preview before actual close
- Record reason for close
- Record observed liquidity and expected slippage before action

### Exit criteria
- Recovery tooling is auditable and safe.

---

# Phase 5 — Polymarket Integration Maturity

## 17. `src/lib/createClobClient.ts`
### Problems
- Current auth flow is workable but optimistic.
- Needs clearer lifecycle around create/derive API credentials.
- Safe/EOA handling should be more explicit and validated.

### Fix
Strengthen auth flow:
1. validate wallet / proxy / funder semantics
2. initialize client with explicit signature type
3. attempt derive when credentials exist
4. create only when needed
5. persist credentials securely
6. verify with a lightweight authenticated call

### Add explicit logging
- signature type chosen
- proxy wallet used
- funder used
- credential source: env / created / derived

### Validation
- EOA path test
- proxy/safe path test
- missing creds test
- invalid creds fallback behavior

### Exit criteria
- Auth is deterministic and diagnosable.

---

## 18. `src/lib/polymarket.ts` and orderbook helpers
### Problems
- REST polling is functional but not enough for a more mature bot.
- Need better market metadata and tick-size discipline.

### Fix
Add:
- market metadata cache
- tick size awareness
- min order size awareness
- neg-risk flag awareness where relevant
- book freshness timestamps

### Add safeguards
- reject order if book is stale
- reject order if spread too wide
- reject order if depth too thin for intended size

### Exit criteria
- Order construction respects current market microstructure.

---

## 19. New files to add
### `src/ws/marketStream.ts`
Purpose:
- subscribe to market websocket for real-time book/top-of-book updates

### `src/ws/userStream.ts`
Purpose:
- subscribe to user websocket for order/trade lifecycle

### `src/runtime/heartbeat.ts`
Purpose:
- shared runtime status registry for API/dashboard

### `src/runtime/stateMachine.ts`
Purpose:
- explicit trade-state transition helpers

### Exit criteria
- Bot is less dependent on blunt polling and more aware of real execution state.

---

# Phase 6 — Testing Expansion

## 20. `tests/copyStrategy.test.ts`
### Keep and expand
Add:
- low-balance edge cases
- exposure caps
- duplicate-market entries
- low-liquidity rejection

---

## 21. `tests/postOrder.test.ts`
### Expand
Add:
- safe DB update assertions
- failed order result persistence
- partial fill normalization
- retryable vs terminal error classification

---

## 22. New test file: `tests/dbWrapper.test.ts`
### Add
Test:
- updateOne writes
- updateOne with `$set`
- partial update does not erase document
- helper methods work

### This is mandatory
The DB wrapper is currently one of the largest correctness risks.

---

## 23. New test file: `tests/tradeExecutor.test.ts`
### Add
Test:
- new trade -> processing -> executed
- new trade -> processing -> retry -> executed
- new trade -> processing -> retry_exhausted
- already executed trade does not run twice

---

## 24. New integration harness
### Add
Suggested file:
- `src/scripts/paperTradeReplay.ts`

Purpose:
- replay stored source trades into the system
- run full monitor/executor path in preview mode
- produce summary report:
  - trades detected
  - trades skipped
  - trades executed
  - errors
  - average slippage proxy

### Exit criteria
- You can shadow-test the bot before live deployment.

---

# Phase 7 — Risk and Operator Safety

## 25. `src/config/env.ts`
### Fixes
- clarify required vs optional env vars
- separate preview-only from live-only requirements
- validate ports consistently
- validate wallet addresses more strictly
- validate percentages and caps more strictly

### Add variables
Examples:
- `MAX_TOTAL_EXPOSURE_USD`
- `MAX_MARKET_EXPOSURE_USD`
- `MAX_CONSECUTIVE_ERRORS`
- `MAX_BOOK_STALENESS_MS`
- `MIN_BOOK_DEPTH_USD`
- `ENABLE_USER_WS`
- `ENABLE_MARKET_WS`

### Exit criteria
- Bad configs fail fast and clearly.

---

## 26. `.env.example`
### Fix
Make it match actual runtime exactly.

### Remove
- dead variables like `MONGO_URI` if unused

### Add comments
- which vars are required for preview
- which vars are required for live trading
- which vars are optional tuning parameters

### Exit criteria
- New user can bootstrap without guessing.

---

## 27. Logging module / logger files
### Fixes
Add structured log fields:
- component
- trade id
- market slug
- token id
- side
- source trader
- retry count
- status transition
- error class

### Exit criteria
- Failures can be traced quickly.

---

# Definition of Done by File Group

## Group A — Must be fixed before any live capital
- `src/models/db.ts`
- `src/monitor/tradeExecutor.ts`
- `src/processor/postOrder.ts`
- `package.json`
- `README.md`
- `docs/QUICK_START.md`
- `docs/GETTING_STARTED.md`
- `docs/DEPLOYMENT.md`
- `src/scripts/healthCheck.ts`
- `src/api/server.ts`
- `.env.example`

## Group B — Should be fixed before broader live use
- `src/monitor/tradeMonitor.ts`
- `src/lib/createClobClient.ts`
- `src/lib/polymarket.ts`
- `src/utils/killSwitch.ts`
- position/accounting files
- dashboard UI files

## Group C — Needed for 90%+ readiness
- websocket files
- heartbeat/runtime registry
- state machine helper
- integration replay harness
- expanded tests

---

# Fastest Path to 80%

If you want the shortest high-impact patch sequence, do this in order:

1. Refactor `src/models/db.ts`
2. Patch all `updateOne()` call sites in:
   - `src/monitor/tradeExecutor.ts`
   - `src/processor/postOrder.ts`
3. Add explicit trade statuses
4. Fix `package.json` broken setup script
5. Rewrite MongoDB references out of docs and health check
6. Make `/api/status` real
7. Update `.env.example`
8. Add DB wrapper tests
9. Add executor lifecycle tests

This sequence should move the project roughly from **62% to 80%**.

---

# Fastest Path to 90%+

After the above, do:

1. Add heartbeat/runtime registry
2. Add full kill switch redesign
3. Add market metadata cache
4. Add book freshness / depth / spread checks
5. Add websocket market stream
6. Add websocket user stream
7. Add paper replay harness
8. Add reconciliation tools and tests

This sequence should move the build into the **90–95%** range.

---

# Final Recommendation

Do **not** spend time polishing the UI first.

The highest-return fixes are:
1. **DB correctness**
2. **safe state transitions**
3. **docs/package truthfulness**
4. **runtime observability**
5. **Polymarket execution maturity**

Everything else should come after those.

