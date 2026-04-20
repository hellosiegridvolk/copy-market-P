[English](README.md) | [Simplified Chinese](README_CN.md) | [Traditional Chinese](README_TW.md) | [Japanese](README_JP.md)

# COPY MARKET

This localized README is a short handoff summary for the current fork.

## Current status

- The authoritative setup guide is `README.md`
- The runtime uses local NeDB files, not MongoDB
- Start with `PREVIEW_MODE=true`
- Use `docs/WINDOWS_QUICK_START.md` for PowerShell commands on Windows

## Quick start

```bash
git clone https://github.com/hellosiegridvolk/copy-market-P.git
cd copy-market-P
npm ci
npm run setup
# edit .env (keep PREVIEW_MODE=true; PRIVATE_KEY can stay blank in preview)
npm run validate:handoff
npm run health
npm start
```

## Notes

- `/api/status` is the source of runtime truth
- `/docs` serves the Swagger UI after startup
- Switch to live mode only after preview validation passes
