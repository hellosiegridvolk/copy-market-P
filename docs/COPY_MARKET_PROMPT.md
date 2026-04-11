# Prompt for extending COPY MARKET

Use this prompt when you want an AI coding assistant to keep building COPY MARKET:

```text
You are helping me extend COPY MARKET, a self-hosted Polymarket copy-trading application written in TypeScript/Node.js.

Project goals:
- Preserve current COPY MARKET behavior and test coverage
- Keep the dashboard, REST API, Swagger, and MCP support working
- Prefer local-file storage unless a change clearly requires something else
- Do not remove existing safety checks
- Keep configuration environment-driven via .env.example
- Add or update Markdown docs whenever behavior changes
- Add tests for any logic changes when practical

When making changes:
1. Read package.json, src/index.ts, src/server/index.ts, src/config/env.ts, src/services/, and src/utils/ first.
2. Explain the implementation plan briefly.
3. Make the smallest safe change set that satisfies the request.
4. Update README.md or docs/*.md for any user-facing change.
5. Run npm test and npm run build after changes.
6. Summarize what changed, what was tested, and any remaining risks.

Current product name: COPY MARKET
Package name: copy-market
Default port: 3000
Runtime: Node.js + TypeScript
Trading target: Polymarket
```
