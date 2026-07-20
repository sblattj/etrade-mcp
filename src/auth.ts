#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import dotenv from "dotenv";

import { loadEnv } from "./env.js";
import { fetchRequestToken, exchangeVerifier } from "./auth-core.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(
    "Usage: etrade-mcp-auth\n\n" +
      "One-time interactive E*TRADE OAuth 1.0a login: fetches a request token, prints\n" +
      "the E*TRADE authorize URL, waits for you to open it and paste back the 5-digit\n" +
      "verifier, and writes the access token to ~/.config/etrade-mcp/tokens.<env>.json.\n\n" +
      "Requires E*TRADE developer credentials in the environment first:\n" +
      "  ETRADE_ENV=sandbox|prod (default prod)\n" +
      "  ETRADE_SANDBOX_API_KEY / ETRADE_SANDBOX_API_KEY_SECRET   (sandbox)\n" +
      "  ETRADE_PROD_API_KEY / ETRADE_PROD_API_SECRET             (prod)\n",
  );
  process.exit(0);
}

// Loads a .env from the current working directory, if present. Real
// environment variables always take precedence.
dotenv.config();
const cfg = loadEnv(process.env);
console.error(`[etrade-mcp] env=${cfg.env}`);
console.error(`[etrade-mcp] requesting request token from ${cfg.apiBaseUrl}...`);

const { requestToken, requestTokenSecret, authorizeUrl } = await fetchRequestToken(cfg);
console.error("[etrade-mcp] ✓ got request token");
console.error("");
console.error("Open this URL in your browser:");
console.error(`  ${authorizeUrl}`);
console.error("");
console.error("After authorizing, E*TRADE will show you a 5-digit verifier code.");

const rl = createInterface({ input: process.stdin, output: process.stderr });
const verifier = (await rl.question("Paste it here: ")).trim();
rl.close();
if (!verifier) {
  console.error("[etrade-mcp] ✗ empty verifier");
  process.exit(1);
}

console.error("[etrade-mcp] exchanging verifier for access token...");
const { expiresAt } = await exchangeVerifier(cfg, { requestToken, requestTokenSecret }, verifier);
const mins = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000);
console.error(`[etrade-mcp] ✓ stored at ${cfg.tokenFilePath}`);
console.error(`[etrade-mcp] token valid until midnight ET (~${Math.floor(mins / 60)}h ${mins % 60}m)`);
