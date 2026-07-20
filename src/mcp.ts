#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadEnv } from "./env.js";
import { readToken, isTokenExpired, type StoredToken } from "./tokens.js";
import { createClient, type EtradeClient } from "./client.js";
import { registerListAccounts } from "./tools/list-accounts.js";
import { registerGetBalance } from "./tools/get-balance.js";
import { registerGetPortfolio } from "./tools/get-portfolio.js";
import { registerListTransactions } from "./tools/list-transactions.js";
import { registerGetTransaction } from "./tools/get-transaction.js";
import { registerSnapshot } from "./tools/snapshot.js";
import { registerListOrders } from "./tools/list-orders.js";
import { registerPreviewOrder } from "./tools/preview-order.js";
import { registerPreviewSpread } from "./tools/preview-spread.js";
import { registerPlaceOrder } from "./tools/place-order.js";
import { registerCancelOrder } from "./tools/cancel-order.js";

// Read the server version from package.json rather than hardcoding a string that can
// drift from the published npm version. Node-portable: no Bun-only APIs. Resolves
// correctly both in dev (this file at <repo>/src/mcp.ts) and once built (the
// compiled entrypoint at <repo>/dist/index.js) — both sit exactly one directory
// below the repo root, where package.json lives. Read BEFORE the --help/--version
// guard below, which needs it.
const __dirname = dirname(fileURLToPath(import.meta.url));
const { version: SERVER_VERSION } = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf8"),
) as { version: string };

// --help/--version MUST run before any env loading or server construction. Without
// this guard, `etrade-mcp --help` with no creds in the environment threw a raw
// uncaught stack trace, and with creds present it silently ignored --help and booted
// the real MCP server on stdio instead.
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(
    "Usage: etrade-mcp\n\n" +
      "MCP server for the E*TRADE Account + Order APIs. Speaks the Model Context\n" +
      "Protocol over stdio — run it from an MCP client (e.g. Claude Code), not\n" +
      "interactively from a shell.\n\n" +
      "Reads (accounts/balances/positions/transactions/orders) are always on; order\n" +
      "placement (preview/place/cancel) is a separate, explicit opt-in.\n\n" +
      "Requires E*TRADE developer credentials and a stored access token in the environment:\n" +
      "  ETRADE_ENV=sandbox|prod (default prod)\n" +
      "  ETRADE_SANDBOX_API_KEY / ETRADE_SANDBOX_API_KEY_SECRET   (sandbox)\n" +
      "  ETRADE_PROD_API_KEY / ETRADE_PROD_API_SECRET             (prod)\n" +
      "  ETRADE_ALLOW_ORDERS=1                                    (opt-in: enable order tools)\n\n" +
      "Run `etrade-mcp-auth --help` first for the one-time OAuth login that writes the\n" +
      "access token this server reads. Full docs: https://github.com/sblattj/etrade-mcp\n",
  );
  process.exit(0);
}
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.error(`etrade-mcp ${SERVER_VERSION}`);
  process.exit(0);
}

// Load a .env from the current working directory, if present. Real environment
// variables (e.g. set by the MCP client config) always take precedence over
// anything dotenv loads.
dotenv.config();

const cfg = loadEnv(process.env);

// Cached client + token, invalidated on token-file mtime change.
let cachedToken: StoredToken | null = null;
let cachedMtimeMs = 0;
let cachedClient: EtradeClient | null = null;

function getClient(): EtradeClient | Error {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(cfg.tokenFilePath).mtimeMs;
  } catch {
    return new Error(
      `ETRADE token missing for env=${cfg.env}. Run: ETRADE_ENV=${cfg.env} bun run auth`,
    );
  }
  if (mtimeMs !== cachedMtimeMs) {
    cachedToken = readToken(cfg.tokenFilePath);
    cachedMtimeMs = mtimeMs;
    cachedClient = null;
  }
  if (!cachedToken) {
    return new Error(
      `ETRADE token unreadable for env=${cfg.env}. Run: ETRADE_ENV=${cfg.env} bun run auth`,
    );
  }
  if (isTokenExpired(cachedToken)) {
    return new Error(
      `ETRADE token expired for env=${cfg.env} (expired ${cachedToken.expires_at_midnight_et}). ` +
        `Run: ETRADE_ENV=${cfg.env} bun run auth`,
    );
  }
  if (!cachedClient) {
    cachedClient = createClient(cfg, {
      oauth_token: cachedToken.oauth_token,
      oauth_token_secret: cachedToken.oauth_token_secret,
    });
  }
  return cachedClient;
}

const server = new McpServer({ name: "etrade-mcp", version: SERVER_VERSION });
registerListAccounts(server, getClient);
registerGetBalance(server, getClient);
registerGetPortfolio(server, getClient);
registerListTransactions(server, getClient);
registerGetTransaction(server, getClient);
registerSnapshot(server, cfg.env, getClient);
registerListOrders(server, getClient); // read-only; always available

// Order placement (writes) is opt-in. The preview/place/cancel tools are only
// registered when ETRADE_ALLOW_ORDERS=1, so without that flag the server can
// read orders but cannot create or cancel them.
if (cfg.allowOrders) {
  registerPreviewOrder(server, cfg, getClient);
  registerPreviewSpread(server, cfg, getClient);
  registerPlaceOrder(server, cfg, getClient);
  registerCancelOrder(server, cfg, getClient);
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[etrade-mcp] connected (env=${cfg.env})`);
if (cfg.allowOrders) {
  console.error(
    `[etrade-mcp] ⚠ ORDER PLACEMENT ENABLED (env=${cfg.env}) — preview/place/cancel tools are live`,
  );
}
