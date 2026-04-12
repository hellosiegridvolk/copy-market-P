# Logging And Status Preview

This document shows the current style of terminal and API output. It is informational only and should not be treated as an exact transcript.

## Health check output

`npm run health` prints a plain summary with PASS, WARN, and FAIL style guidance.

Example:

```text
Configuration summary:
  Mode: preview (no live orders)
  Trading wallet: 0xabcd...1234
  Tracked traders: 1
  Poll interval: 1s

Summary:
  PASS: 3
  WARN: 1
  FAIL: 0
```

## Startup output

With `PREVIEW_MODE=true`, startup now clearly states that authenticated order signing is skipped:

```text
PREVIEW MODE is enabled.
  Live order signing is skipped until PREVIEW_MODE=false.

Performing initial health check...
Starting trade monitor...
Starting trade executor...
```

## Status API example

`GET /api/status` is the authoritative runtime view. A typical response shape is:

```json
{
  "running": true,
  "healthy": true,
  "mode": "preview",
  "previewMode": true,
  "killSwitchActive": false,
  "lastSuccessAt": 1712900000000,
  "lastError": null,
  "monitor": {
    "running": true,
    "lastLoopAt": 1712900000000,
    "lastSuccessAt": 1712900000000,
    "stale": false
  },
  "executor": {
    "running": true,
    "lastLoopAt": 1712900000000,
    "lastSuccessAt": 1712900000000,
    "stale": false
  },
  "queue": {
    "new": 0,
    "processing": 0,
    "failed": 0,
    "retryExhausted": 0,
    "partialFill": 0,
    "executed": 0,
    "skipped": 0
  }
}
```

## Notes

- The runtime uses local NeDB files, not MongoDB.
- Preview mode may show zero wallet balance as a warning instead of a hard failure.
- Use `/api/status` for truth and the terminal output for operator guidance.
