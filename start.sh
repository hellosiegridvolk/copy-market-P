#!/bin/sh
set -e

echo "🤖 COPY MARKET - Starting..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ensure data directory exists
mkdir -p /app/data

# Start the bot (includes Web UI + API)
exec node dist/index.js
