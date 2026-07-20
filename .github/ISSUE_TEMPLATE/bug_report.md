---
name: Bug report
about: Something isn't working the way it should
title: "[bug] "
labels: bug
---

**Do not paste your E*TRADE API key, OAuth token/secret, account number, or any other
credential/secret into this issue.** If a log line contains one, redact it (e.g. `ETRADE_PROD_API_KEY=***`)
before pasting.

## What happened

<!-- What did you run, and what happened? Include the exact command/tool call if you can. -->

## What you expected

<!-- What should have happened instead? -->

## Environment

- `etrade-mcp` version: <!-- from `etrade-mcp --version`, or the npm/package.json version -->
- E*TRADE environment: <!-- sandbox or prod (ETRADE_ENV) -->
- Node version: <!-- `node --version` -->
- Bun version (if running from source): <!-- `bun --version` -->
- OS: <!-- macOS / Linux / Windows(WSL) -->
- MCP client: <!-- Claude Code, Claude Desktop, other -->

## Logs / error output

<!-- Paste the relevant stderr/stdout, with any secrets redacted. -->

```
paste here
```

## Anything else

<!-- Config, order type, contract details (no account numbers), etc. -->
