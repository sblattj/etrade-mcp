#!/usr/bin/env bun
import dotenv from "dotenv";

import { loadEnv } from "./env.js";
import { exchangeVerifier, readPending, clearPending } from "./auth-core.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(
    "Usage: etrade-mcp-auth-finish <verifier>   (or ETRADE_VERIFIER=<verifier>)\n\n" +
      "Step 2 of the scripted two-step OAuth login: exchanges the 5-digit verifier\n" +
      "E*TRADE showed you for an access token, using the pending request token\n" +
      "etrade-mcp-auth-start stashed. Writes the access token to\n" +
      "~/.config/etrade-mcp/tokens.<env>.json.\n\n" +
      "Requires E*TRADE developer credentials in the environment first — see\n" +
      "`etrade-mcp-auth --help`.\n",
  );
  process.exit(0);
}

// Loads a .env from the current working directory, if present. Real
// environment variables always take precedence.
dotenv.config();
const cfg = loadEnv(process.env);
const verifier = (process.argv[2] ?? process.env.ETRADE_VERIFIER ?? "").trim();
if (!verifier) {
  console.error("[etrade-mcp] ✗ usage: auth:finish <verifier>   (or ETRADE_VERIFIER=...)");
  process.exit(1);
}
const pending = readPending(cfg);
if (!pending) {
  console.error("[etrade-mcp] ✗ no pending request token — run auth:start first");
  process.exit(1);
}
const { expiresAt } = await exchangeVerifier(cfg, pending, verifier);
clearPending(cfg);
console.error(`[etrade-mcp] ✓ stored at ${cfg.tokenFilePath} (valid until ${expiresAt})`);
