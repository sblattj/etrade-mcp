#!/usr/bin/env bun
/**
 * Browser-free re-auth: try to reactivate the stored (idle) access token via E*TRADE's
 * renew_access_token. This is the FIRST thing a scheduled re-auth job should run — if it
 * succeeds, the ~2h idle expiry self-heals with NO browser. Only when it fails (midnight-expired or
 * invalidated) does the caller fall back to the full 3-leg browser consent.
 *
 *   bun run etrade:renew      # exit 0 = token reactivated (skip the browser); exit 3 = must re-consent
 */
import dotenv from "dotenv";

import { loadEnv } from "./env.js";
import { readToken } from "./tokens.js";
import { renewAccessToken } from "./auth-renew.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(
    "Usage: etrade-mcp-renew\n\n" +
      "Browser-free re-auth: tries E*TRADE's renew_access_token endpoint on the\n" +
      "stored access token. Exit 0 = reactivated (idle-expiry self-heal, no browser);\n" +
      "exit 3 = past the midnight-ET hard expiry — run `etrade-mcp-auth` again.\n\n" +
      "Requires E*TRADE developer credentials in the environment first — see\n" +
      "`etrade-mcp-auth --help`.\n",
  );
  process.exit(0);
}

// Loads a .env from the current working directory, if present. Real
// environment variables always take precedence.
dotenv.config();
const cfg = loadEnv(process.env);
const token = readToken(cfg.tokenFilePath);
const r = await renewAccessToken(cfg, token);
if (r.renewed) {
  console.error(`[etrade-mcp] ✓ access token RENEWED (browser-free) — idle clock reset, valid until ${token?.expires_at_midnight_et ?? "midnight ET"}`);
  process.exit(0);
}
console.error(`[etrade-mcp] ✗ renew failed (${r.reason}) — full browser re-consent required`);
process.exit(3);
