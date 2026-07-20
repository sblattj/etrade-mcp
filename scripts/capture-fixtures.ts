#!/usr/bin/env bun
// Re-capture test fixtures against the live sandbox.
// Run after a successful `bun run auth --env sandbox` to refresh hand-crafted fixtures
// with real response shapes. Writes to src/__tests__/fixtures/.
//
// WARNING: this OVERWRITES the four committed fixtures with real sandbox data,
// including real accountId / accountIdKey values and balance/position numbers.
// Always `git diff` the fixtures before committing — redact or revert anything
// you don't want checked in.

import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { loadEnv } from "../src/env.js";
import { readToken, isTokenExpired } from "../src/tokens.js";
import { createClient } from "../src/client.js";

// Loads a .env from the current working directory, if present. Real
// environment variables always take precedence.
dotenv.config();
const cfg = loadEnv(process.env);
if (cfg.env !== "sandbox") {
  console.error("Refuse: only capture against sandbox.");
  process.exit(1);
}
const token = readToken(cfg.tokenFilePath);
if (!token || isTokenExpired(token)) {
  console.error("No valid sandbox token. Run `bun run auth` first.");
  process.exit(1);
}
const client = createClient(cfg, token);
const fixturesDir = resolve(import.meta.dir, "../src/__tests__/fixtures");

const accounts = (await client.listAccounts()) as {
  AccountListResponse?: { Accounts?: { Account?: Array<{ accountIdKey?: string }> } };
};
writeFileSync(`${fixturesDir}/list-accounts.json`, JSON.stringify(accounts, null, 2));
console.error("✓ list-accounts.json");

const firstKey = accounts.AccountListResponse?.Accounts?.Account?.[0]?.accountIdKey;
if (!firstKey) {
  console.error("No accounts on sandbox token; skipping the per-account fixtures.");
  process.exit(0);
}

const balance = await client.getBalance({ accountIdKey: firstKey });
writeFileSync(`${fixturesDir}/balance.json`, JSON.stringify(balance, null, 2));
console.error("✓ balance.json");

const portfolio = await client.getPortfolio({ accountIdKey: firstKey });
writeFileSync(`${fixturesDir}/portfolio.json`, JSON.stringify(portfolio, null, 2));
console.error("✓ portfolio.json");

const transactions = await client.listTransactions({ accountIdKey: firstKey });
writeFileSync(`${fixturesDir}/transactions.json`, JSON.stringify(transactions, null, 2));
console.error("✓ transactions.json");
