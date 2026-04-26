# COPY MARKET test report

## Validation commands

```bash
npm ci
npm test -- --runInBand
npm run build
```

## Result

- Jest suites: 3 passed
- Tests: 40 passed, 0 failed
- TypeScript build: passed

## Scope of validation

This confirms the packaged source installs cleanly, passes the included unit tests, and compiles to `dist/` successfully.

## Not included in this validation

- Live wallet execution against Polymarket
- Real order placement
- Real Telegram delivery
- Production Docker publish flow

Those require your own funded wallet, environment variables, and network access.
