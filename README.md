# etrade-mcp

[![npm version](https://img.shields.io/npm/v/etrade-mcp.svg)](https://www.npmjs.com/package/etrade-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/sblattj/etrade-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/sblattj/etrade-mcp/actions/workflows/ci.yml)

**MCP server for E\*TRADE — OAuth 1.0a + VIP-TOTP auto-renew, account reads always-on, order
placement strictly opt-in.**

Talk to your E\*TRADE account from Claude Code (or any MCP client): list accounts, check balances
and positions, pull transactions and open orders — and, only if you turn it on, preview and place
equity/option orders (including multi-leg spreads) through a code-enforced two-step handshake.

![etrade-mcp demo](docs/demo.gif)

## Is this for you?

- You have (or can get) an E\*TRADE brokerage account and an MCP-compatible AI client.
- You want your assistant to read balances, positions, transactions, and orders directly, instead
  of pasting screenshots into a chat.
- You may *also* want it to place orders — but only behind an explicit, separate opt-in, never by
  default.
- You're fine getting your own E\*TRADE developer API key. This project ships no credentials, no
  shared account, no proxy service — every install talks straight to E\*TRADE with keys you own.

**Probably not for you** if you want a broker-agnostic tool (this wraps the E\*TRADE Account + Order
APIs specifically) or a "fully autonomous, no human review" trading bot — the write tools exist
precisely so nothing reaches the market without a preview you can read first.

## Safety model

This is a tool that can, if you ask it to, put real orders into a real brokerage account. The
safety properties below are enforced in code (`src/mcp.ts`, `src/orders.ts`, `src/order-store.ts`,
`src/tools/`), not just written down:

- **Read-only unless you opt in.** `etrade_preview_order`, `etrade_preview_spread`,
  `etrade_place_order`, and `etrade_cancel_order` are only *registered* with the MCP server when
  `ETRADE_ALLOW_ORDERS=1` is set. Without it, the server can read accounts, balances, positions,
  transactions, and orders — and cannot create, modify, or cancel anything.
- **Two-step preview → place, enforced server-side.** `etrade_place_order` accepts *only* a
  `previewId` (plus `confirm: true`) from a recent `etrade_preview_order` / `etrade_preview_spread`
  call. It replays the exact envelope that was previewed — there is no code path that lets a place
  call carry raw, un-previewed order parameters.
- **Previews are single-use and short-lived.** Each `previewId` is consumed on first use and expires
  ~3 minutes after issue (mirroring E\*TRADE's own preview window); a second attempt or a stale one
  is rejected and you have to re-preview.
- **Explicit confirmation.** `etrade_place_order` and `etrade_cancel_order` both require
  `confirm: true` — a Zod `literal(true)`, re-checked again in the handler.
- **Sandbox and prod can't cross.** A preview minted while the server is running against
  `ETRADE_ENV=sandbox` is refused if you try to place it against a `prod` server, and vice versa.
- **No bulk or irreversible operations.** One order per call. There is no "cancel all" or
  "liquidate everything" tool.
- **Ambiguous outcomes are never silently retried.** If E\*TRADE's place/cancel response comes back
  without a clear success or an explicit error (a network timeout, an odd payload), the tool reports
  the outcome as UNKNOWN and tells you to check `etrade_list_orders` before doing anything else —
  it never auto-retries a place, which could double an order.
- **Order shaping is validated before anything reaches E\*TRADE** — quantity/action/price-field
  combinations, E\*TRADE's own coupling rules (e.g. `MARKET` orders must be `GOOD_FOR_DAY`,
  extended-hours orders must be `LIMIT`, all-or-none needs 300+ shares), and, for spreads, that every
  leg is a distinct contract on the same underlying. Bad input fails locally with a specific message
  instead of round-tripping to E\*TRADE first.
- **Not LIMIT-only.** To be precise about what the code does and doesn't do: `MARKET`, `LIMIT`,
  `STOP`, and `STOP_LIMIT` are all supported order price types — this package does not force
  limit-only discipline on you. If you want that discipline, enforce it in whatever is calling these
  tools.

**Your keys, your account, your risk.** This is not investment advice, and nothing here is a
recommendation about what to trade. You are responsible for every order this places.

## Quickstart

etrade-mcp needs its own E\*TRADE developer API key and a one-time OAuth login before it can do
anything — there is no bundled or shared credential (see [Getting an E\*TRADE developer
key](#getting-an-etrade-developer-key) below).

**1. Get sandbox credentials** at [developer.etrade.com](https://developer.etrade.com) (see below).

**2. Log in once.** E\*TRADE's OAuth authorize step is an interactive browser login, but the CLI that
drives it runs straight from npm — no clone needed:

```bash
ETRADE_ENV=sandbox ETRADE_SANDBOX_API_KEY=<your-key> ETRADE_SANDBOX_API_KEY_SECRET=<your-secret> \
  npx -y --package=etrade-mcp etrade-mcp-auth
```

`--package=etrade-mcp` is required here: a bare `npx etrade-mcp` runs the package's *default* bin
(`etrade-mcp`, the MCP server itself), not this non-default `etrade-mcp-auth` bin — the
`--package=<name>` form is npx's way of installing one package and running a *different* named bin
from it. `bunx --package=etrade-mcp etrade-mcp-auth` works the same way if you're on Bun.

This opens (prints) an E\*TRADE authorize URL, and once you approve it and paste back the 5-digit
verifier, writes an access token to `~/.config/etrade-mcp/tokens.sandbox.json` (`0600`
permissions). See [Auth model & token lifecycle](#auth-model--token-lifecycle) for renewal and the
other auth CLIs. (Contributing, or want to run from source instead? `git clone` the repo — see
[Testing](#testing).)

**3. Register the published server** with your MCP client — reads are always on; writes need the
explicit opt-in:

```bash
claude mcp add etrade \
  --env ETRADE_ENV=sandbox \
  --env ETRADE_SANDBOX_API_KEY=<your-key> \
  --env ETRADE_SANDBOX_API_KEY_SECRET=<your-secret> \
  -- npx -y etrade-mcp
```

`bunx -y etrade-mcp` works the same way if you're on Bun. The credential env vars sign requests;
the actual session token comes from the file step 2 wrote to disk. To also enable order placement,
add `--env ETRADE_ALLOW_ORDERS=1` and register it as a *separate*, deliberately-named server (e.g.
`etrade-trade`) so the read-only server can stay registered without the write surface attached —
see [Tools](#tools) below.

Once you've validated the flow against sandbox, repeat with a production key (`ETRADE_ENV=prod`,
`ETRADE_PROD_API_KEY` / `ETRADE_PROD_API_SECRET`) — `ETRADE_ENV` defaults to `prod`, so a bare
install targets your real account unless you explicitly opt into sandbox.

## Getting an E\*TRADE developer key

E\*TRADE's API is not a shared or public API — every consumer needs their own key, scoped to their
own account. This project ships no credentials of any kind.

1. **Sandbox key (start here):** request one at [developer.etrade.com](https://developer.etrade.com).
   Sandbox targets E\*TRADE's canned test data — it validates the request/response shape, not real
   fills or real account data.
2. **Production key:** once you're happy against sandbox, request a production key at the same site.
   Order placement specifically requires signing E\*TRADE's API Developer Agreement and completing a
   User Intent Survey.
3. Put the resulting consumer key + secret in your environment — a local `.env` in the clone, your
   shell profile, or your MCP client's `--env` flags — under the names in the [Environment
   variables](#environment-variables) table below.

## Auth model & token lifecycle

E\*TRADE uses OAuth 1.0a (not OAuth2): a 3-legged flow — request a token, a human authorizes it in a
browser, exchange a short verifier code for an access token. This package implements that directly
(`oauth-1.0a` + HMAC-SHA1 request signing), no vendor SDK:

- `npx -y --package=etrade-mcp etrade-mcp-auth` (or, from a clone, `bun run auth`) — the interactive
  one-shot: fetches a request token, prints the E\*TRADE authorize URL, waits for you to open it and
  log in, and reads back the 5-digit verifier E\*TRADE shows you.
- `etrade-mcp-auth-start` / `etrade-mcp-auth-finish <verifier>` (both via
  `npx -y --package=etrade-mcp <bin>`, or from a clone `bun run auth:start` /
  `bun run auth:finish <verifier>`) — the same flow split in two for scripting: `auth-start` prints
  just the authorize URL and stashes the pending request token; `auth-finish` (verifier as an
  argument, or `ETRADE_VERIFIER`) completes it later.

The resulting access token is written to `~/.config/etrade-mcp/tokens.<env>.json` with `0600`
permissions.

**Expiry.** E\*TRADE access tokens expire at midnight US Eastern (there is no refresh token) and go
idle after about 2 hours without an API call.

- `npx -y --package=etrade-mcp etrade-mcp-renew` (or, from a clone, `bun run renew`) tries E\*TRADE's
  browser-free `renew_access_token` endpoint first. If the token has only gone idle (not past the
  midnight-ET hard expiry), this reactivates the *same* token with zero browser interaction — exit
  code `0` means it worked, exit code `3` means the token is past saving and you need the full
  `etrade-mcp-auth` browser flow again.
- Past midnight ET, only the full 3-legged browser flow can mint a new token — an E\*TRADE platform
  limit (no refresh tokens), not something this package can route around. Re-run `etrade-mcp-auth`
  (or the `etrade-mcp-auth-start`/`etrade-mcp-auth-finish` pair) once a day.

### Optional: VIP TOTP (2FA code) helper

E\*TRADE's 2FA is Symantec VIP Access. If you provision a VIP soft-token credential (e.g. via the
`vipaccess` CLI's `provision` command) you get a base32 secret. Store it as `ETRADE_TOTP_SECRET` and
`npx -y --package=etrade-mcp etrade-mcp-totp` (or, from a clone, `bun run totp`) prints the current
6-digit code — RFC 6238 TOTP generated locally with `node:crypto` only (no network call, no
third-party TOTP dependency) — so you don't need your phone during the browser login step.

### Optional: browser auto-fill for the login page

`npx -y --package=etrade-mcp etrade-mcp-login-fill` (or, from a clone, `bun run login:fill`; reads
`ETRADE_LOGIN_USERNAME` / `ETRADE_LOGIN_PASSWORD`) drives a
Chromium-family browser already open on E\*TRADE's login page over the Chrome DevTools Protocol
(`CDP_PORT`, default `9333`), filling the username and password fields with trusted input events. It
fills only those two fields — never the 2FA/verifier step — and never prints the credential values,
only their lengths. It's a building block for your own re-auth automation, not a turnkey unattended
login.

## Tools

### Read (always registered)

| Tool | Description |
|---|---|
| `etrade_list_accounts` | List all E\*TRADE accounts for the authenticated user. |
| `etrade_get_balance` | Cash balance, buying power, and NAV for one account. |
| `etrade_get_portfolio` | Current positions for one account. |
| `etrade_list_transactions` | Transactions for one account in a date range. |
| `etrade_get_transaction` | Detail for a single transaction. |
| `etrade_list_orders` | Orders for one account. `status=OPEN` shows working orders; `status=EXECUTED` confirms a fill before placing a paired stop. |
| `etrade_snapshot` | Fan-out snapshot across all accounts: balances + positions (+ optional recent transactions). |

### Write (only registered when `ETRADE_ALLOW_ORDERS=1`)

| Tool | Description |
|---|---|
| `etrade_preview_order` | **Step 1 (single leg).** Validates an equity or single-option order and returns E\*TRADE's own cost/commission estimate plus a `previewId`. Nothing is sent to market. |
| `etrade_preview_spread` | **Step 1 (multi-leg).** Validates a 2–4-leg option spread (verticals, calendars, straddles) on one underlying, priced on the net (`NET_DEBIT`/`NET_CREDIT`/`NET_EVEN`), and returns the net cost estimate plus a `previewId`. |
| `etrade_place_order` | **Step 2.** Sends the order. Accepts only a `previewId` + `confirm: true`, and replays the exact previewed order — executes both single-leg and spread previews. |
| `etrade_cancel_order` | Cancels an open order by `orderId` + `confirm: true`. An order already routed to or filled at market can't be cancelled. |

Equities, single options, and multi-leg option spreads (2–4 legs, e.g. a defined-risk vertical) are
all supported — a spread is one E\*TRADE `SPREADS` order whose legs fill as a unit at the net price,
distinct from placing separate single-leg orders. The API has no native bracket/OCO/contingent order
type — a "stop attached to an entry" is done client-side: place the entry, confirm the fill with
`etrade_list_orders`, then place the stop as its own order.

`accountIdKey` (used across every account-scoped tool) is the obfuscated key `etrade_list_accounts`
returns — not the plain account number.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ETRADE_ENV` | optional | `sandbox` or `prod`. Defaults to `prod`. |
| `ETRADE_SANDBOX_API_KEY` / `ETRADE_SANDBOX_API_KEY_SECRET` | for `ETRADE_ENV=sandbox` | Your E\*TRADE sandbox consumer key/secret. |
| `ETRADE_PROD_API_KEY` / `ETRADE_PROD_API_SECRET` | for `ETRADE_ENV=prod` | Your E\*TRADE production consumer key/secret. |
| `ETRADE_ALLOW_ORDERS` | optional | Set to `1` to register the write tools (`preview`/`place`/`cancel`). Anything else, or unset, is read-only. |
| `ETRADE_VERIFIER` | optional | Verifier code for `auth:finish` (or pass it as a CLI argument). |
| `ETRADE_TOTP_SECRET` | optional | Base32 VIP TOTP secret, for `bun run totp`. |
| `ETRADE_LOGIN_USERNAME` / `ETRADE_LOGIN_PASSWORD` | optional | Used only by `bun run login:fill`'s browser automation. |
| `CDP_PORT` | optional | Debug port for `login:fill`'s browser automation. Defaults to `9333`. |

## Why this exists

There are a handful of independent E\*TRADE MCP servers already on GitHub, mostly small, Python-based
projects with a handful of stars or fewer. None of them are published to npm, so none are
`npx`-installable — every one requires cloning and a Python toolchain (`uvx`/`pip`). The most
established of them, [`davdunc/mcp_etrade`](https://github.com/davdunc/mcp_etrade), is a good
reference point:

| | `etrade-mcp` (this project) | `davdunc/mcp_etrade` |
|---|---|---|
| Runtime | TypeScript on Node/Bun | Python 3.11+ |
| Install | `npx -y etrade-mcp` (published to npm) | `uvx --from git+...` (not on npm/PyPI) |
| Order safety | Code-enforced two-step preview → place, single-use ~3-min `previewId`, sandbox/prod isolation | Order validation via risk-guardrail tools |
| Multi-leg option spreads | Yes (2–4-leg `SPREADS`) | Not documented |
| 2FA helper | Built-in VIP TOTP generator + optional CDP login-fill | Not documented |
| Watch lists / R-multiple risk sizing | No | Yes |

This project's focus is narrower and deeper on one thing — a safe, well-tested order-placement
handshake, installable in one command — rather than a broader feature surface. If you want watch
lists or built-in position-sizing math, `mcp_etrade` covers ground this one doesn't.

## Testing

```bash
bun test                          # Unit tests (fast, no network) — 147 pass / 5 skip
bun test:integration              # Manual: requires a valid sandbox token on disk

# Opt-in, PREVIEW-ONLY order smoke (never places an order) — run with the market closed:
ETRADE_RUN_INTEGRATION=1 ETRADE_RUN_ORDER_PREVIEW=1 \
  ETRADE_TEST_ACCOUNT_KEY=<accountIdKey> ETRADE_TEST_SYMBOL=AAPL \
  bun test src/__tests__/integration.test.ts

# Opt-in, PREVIEW-ONLY multi-leg SPREAD smoke (never places) — validates the SPREADS
# envelope against the live preview endpoint. Defaults to a SOXX Jul-17 $630/$660 call
# vertical; override the contract with the ETRADE_TEST_SPREAD_* vars:
ETRADE_RUN_INTEGRATION=1 ETRADE_RUN_ORDER_SPREAD_PREVIEW=1 \
  ETRADE_TEST_ACCOUNT_KEY=<accountIdKey> \
  [ETRADE_TEST_SPREAD_SYMBOL=SOXX ETRADE_TEST_SPREAD_EXPIRY=2026-07-17 \
   ETRADE_TEST_SPREAD_LONG_STRIKE=630 ETRADE_TEST_SPREAD_SHORT_STRIKE=660] \
  bun test src/__tests__/integration.test.ts
```

`src/index.ts` also exports the client/auth/order-shaping/token/TOTP layer directly, so you can use
this as a library instead of (or alongside) the MCP server — see the file's header comment for what
is and isn't included.

## Dependencies

Four runtime dependencies: `@modelcontextprotocol/sdk`, `oauth-1.0a`, `zod`, `dotenv`. No database,
no external service beyond E\*TRADE's own API.

## License

[MIT](LICENSE) © 2026 Stephen Blatt
