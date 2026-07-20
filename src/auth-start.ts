#!/usr/bin/env bun
import dotenv from "dotenv";

import { loadEnv } from "./env.js";
import { fetchRequestToken, writePending } from "./auth-core.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(
    "Usage: etrade-mcp-auth-start\n\n" +
      "Step 1 of the scripted two-step OAuth login: fetches a request token, stashes\n" +
      "it as pending, and prints just the E*TRADE authorize URL to stdout. Pair with\n" +
      "etrade-mcp-auth-finish <verifier> to complete the login.\n\n" +
      "Requires E*TRADE developer credentials in the environment first — see\n" +
      "`etrade-mcp-auth --help`.\n",
  );
  process.exit(0);
}

// Loads a .env from the current working directory, if present. Real
// environment variables always take precedence.
dotenv.config();
const cfg = loadEnv(process.env);
console.error(`[etrade-mcp] env=${cfg.env} — requesting request token...`);
const r = await fetchRequestToken(cfg);
writePending(cfg, r);
console.error("[etrade-mcp] ✓ request token stored; authorize URL on stdout:");
console.log(r.authorizeUrl);
