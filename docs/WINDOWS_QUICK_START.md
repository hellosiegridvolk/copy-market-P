# Windows PowerShell Quick Start

Use this guide if you are running COPY MARKET from Windows PowerShell.

## Important

- Run commands from the repository directory, not from `C:\Users\Asus Willy`
- Paste PR text into GitHub, not into PowerShell
- Use `.env`, not `.env.txt`
- If `.env.txt` contains merge markers like `<<<<<<<`, ignore it and regenerate `.env` from `npm run setup`

## 1. Open the repo directory

```powershell
Set-Location "C:\Users\Asus Willy\Downloads\Projects Tech-20260412T054050Z-3-001\Projects Tech\codex\Projects\Copy Markets\copy-market-P"
```

## 2. Install dependencies

```powershell
npm ci
```

## 3. Create the local env file

```powershell
npm run setup
notepad .env
```

Keep `PREVIEW_MODE=true` for the first validation pass.
You can leave `PRIVATE_KEY` blank until you are ready for live mode.

## 4. Run validation

```powershell
npm run validate:handoff
npm run health
```

If the health check fails on RPC connectivity, compare `.env` with `.env.example` and update `RPC_URL` before retrying.

## 5. Start the app

```powershell
npm start
```

Leave that terminal open while the app runs.

## 6. Check the endpoints from a second PowerShell window

```powershell
Set-Location "C:\Users\Asus Willy\Downloads\Projects Tech-20260412T054050Z-3-001\Projects Tech\codex\Projects\Copy Markets\copy-market-P"
Invoke-WebRequest http://localhost:3000/api/health | Select-Object -ExpandProperty Content
Invoke-WebRequest http://localhost:3000/api/status | Select-Object -ExpandProperty Content
Start-Process http://localhost:3000/docs
```

## 7. Switch to live mode later

Only after preview validation passes:

1. Set a real `PRIVATE_KEY` in `.env`
2. Set `PREVIEW_MODE=false`
3. Re-run `npm run health`
4. Re-run `npm start`
