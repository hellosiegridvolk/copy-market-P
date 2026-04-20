# MULTI TRADER GUIDE

## Overview

COPY MARKET can watch multiple source traders at the same time. Each configured trader gets separate local activity and position files so lifecycle state stays auditable per source wallet.

## Configuration

- Set `USER_ADDRESSES` in `.env`
- Use a comma-separated list or JSON array of Polymarket wallet addresses
- Keep `FETCH_INTERVAL` conservative if you track many traders

## Local storage layout

Each tracked trader gets dedicated NeDB files under `DB_DIR`:

```text
user_activities_<wallet>.db
user_positions_<wallet>.db
```

## Operational guidance

- Start with a small number of traders while validating behavior
- Increase `FETCH_INTERVAL` if API pressure or local processing becomes noisy
- Watch `/api/status` for queue growth, worker staleness, and repeated errors
- Review persisted trade records before enabling live mode

## Troubleshooting

### Bot is not detecting trades

1. Verify the configured trader addresses are correct
2. Confirm the source traders are actively trading
3. Ensure the local NeDB directory is writable
4. Confirm RPC and Polymarket API connectivity with `npm run health`

### Trades are failing

1. Check `PROXY_WALLET` balance and gas funding
2. Review `SLIPPAGE_TOLERANCE`, `RETRY_LIMIT`, and order-size caps
3. Inspect `/api/status` and recent persisted trade records for `lastError`

## Security reminders

- Never commit or share `.env`
- Use a dedicated wallet for the bot
- Keep limited capital in the trading wallet while validating
- Rotate any exposed secrets if older screenshots or docs ever contained them
