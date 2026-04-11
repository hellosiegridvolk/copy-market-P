# GETTING STARTED

## Required
- Node 20+
- A funded Polygon wallet
- Polymarket-compatible keypair

## Setup
- `npm install`
- `npm run setup`
- Fill `.env`
- `npm run build`
- `npm start`

## Modes
- `PREVIEW_MODE=true`: observe only, no real orders
- `PREVIEW_MODE=false`: live order posting enabled

## Health + status
- `npm run health`
- `GET /api/health`
- `GET /api/status`
