#!/usr/bin/env bun
/**
 * Print the current E*TRADE VIP 2FA code to STDOUT (diagnostics to stderr),
 * so the re-auth flow can capture just the 6 digits:
 *
 *   CODE=$(bun run etrade:totp)
 *
 * Reads ETRADE_TOTP_SECRET from the environment (e.g. sourced from a private,
 * encrypted shell profile). The secret never touches stdout — only the
 * ephemeral one-time code does.
 */
import { generateTotp, secondsRemaining } from "./totp.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(
    "Usage: etrade-mcp-totp\n\n" +
      "Prints the current E*TRADE VIP 2FA code to stdout (diagnostics to stderr).\n" +
      "Reads ETRADE_TOTP_SECRET from the environment — set it before running, e.g.:\n\n" +
      "  ETRADE_TOTP_SECRET=... etrade-mcp-totp\n",
  );
  process.exit(0);
}

const secret = process.env.ETRADE_TOTP_SECRET;
if (!secret) {
  console.error(
    "[etrade-totp] ✗ ETRADE_TOTP_SECRET is not set.\n" +
      "  Provision a VIP credential and export ETRADE_TOTP_SECRET in your\n" +
      "  shell environment (e.g. a local .env or your shell profile).",
  );
  process.exit(1);
}

let code: string;
try {
  code = generateTotp(secret);
} catch (err) {
  console.error(`[etrade-totp] ✗ could not generate code: ${(err as Error).message}`);
  process.exit(1);
}

const left = secondsRemaining();
console.error(`[etrade-totp] valid ${left}s`);
// If the window is about to roll, the consumer may want to wait; surface it but
// still emit the current code (the caller decides).
if (left <= 2) console.error("[etrade-totp] ⚠ window rolling — re-run in a moment if it's rejected");

process.stdout.write(`${code}\n`);
