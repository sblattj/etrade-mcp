# Contributing

Thanks for looking at `etrade-mcp`. This is a small, focused project — the bar for a change is
"it makes the MCP server more correct or more useful," not "it adds a feature."

## Dev setup

```bash
bun install              # install deps
bun test src/__tests__   # run the unit test suite (integration test is separate, see below)
bun run build             # bundle dist/ (node-portable, target: node, format: esm)
bun run typecheck         # tsc --noEmit
```

`bun test src/__tests__` should show all tests passing (a handful of integration-only cases are
skipped by default — see below). `bun run build` writes `dist/` (gitignored; it's build output,
never committed).

### Running the E*TRADE integration test

`src/__tests__/integration.test.ts` hits the real E*TRADE sandbox/prod API and is skipped unless
you opt in with your own credentials:

```bash
ETRADE_RUN_INTEGRATION=1 bun test src/__tests__/integration.test.ts
```

You don't need this to open a PR — it requires your own E*TRADE developer API key and a stored
OAuth token, and CI does not run it.

### Running the handshake smoke locally

`docs/demo-handshake.mjs` is a zero-dependency MCP stdio client: it sends `initialize` +
`tools/list` to a running server binary and prints what came back. It's what CI runs as the final
build-sanity check, and it's useful on its own for verifying any MCP stdio server, not just this
one.

```bash
bun run build
ETRADE_PROD_API_KEY=dummy ETRADE_PROD_API_SECRET=dummy \
  node docs/demo-handshake.mjs node dist/mcp.js
```

The dummy key/secret are enough — `loadEnv()` only checks they're non-empty at startup; no network
call happens before the handshake's `tools/list` response, so no real E*TRADE credentials are
needed just to prove the server boots and lists its tools.

## Before opening a PR

- `bun test src/__tests__` passes.
- `bun run build` succeeds.
- No secrets, tokens, or `.env` files in the diff — this repo ships no credentials and never will.
  If you're not sure something's safe to commit, ask in the PR description rather than guessing.
- Commit subjects are short and describe the *why*, roughly conventional-commit style
  (`fix: ...`, `feat: ...`, `docs: ...`, `test: ...`) — not required verbatim, just legible in
  `git log --oneline`.
- Keep the PR scoped to one change. Small, reviewable PRs get merged faster than large ones.

## Reporting a bug or requesting a feature

Use the issue templates. Please never include your E*TRADE API key, OAuth token, account number,
or any other credential in an issue — redact it before pasting logs.
