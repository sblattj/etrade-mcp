import { describe, expect, it } from "bun:test";
import dotenv from "dotenv";
import { loadEnv } from "../env.js";
import { readToken, isTokenExpired } from "../tokens.js";
import { createClient } from "../client.js";
import { buildSnapshot } from "../tools/snapshot.js";
import { buildPreviewRequest, buildSpreadPreviewRequest, summarizePreviewResponse } from "../orders.js";

const runIntegration = process.env.ETRADE_RUN_INTEGRATION === "1";
// Order-preview smoke is double-gated and PREVIEW-ONLY: it never places.
// Needs ETRADE_RUN_INTEGRATION=1 ETRADE_RUN_ORDER_PREVIEW=1 plus a target
// account key + symbol. Run with the market closed against a real key.
const runOrderPreview =
  runIntegration &&
  process.env.ETRADE_RUN_ORDER_PREVIEW === "1" &&
  !!process.env.ETRADE_TEST_ACCOUNT_KEY &&
  !!process.env.ETRADE_TEST_SYMBOL;
// Multi-leg spread preview smoke — same double-gate, also PREVIEW-ONLY.
// Needs ETRADE_RUN_INTEGRATION=1 ETRADE_RUN_ORDER_SPREAD_PREVIEW=1 plus a
// target account key. The spread contract defaults to the SOXX Jul-17
// $630/$660 call vertical but is overridable via ETRADE_TEST_SPREAD_* env vars.
const runOrderSpreadPreview =
  runIntegration &&
  process.env.ETRADE_RUN_ORDER_SPREAD_PREVIEW === "1" &&
  !!process.env.ETRADE_TEST_ACCOUNT_KEY;

describe.skipIf(!runIntegration)("integration (live sandbox)", () => {
  // Load creds lazily, inside each test — NOT at describe-body scope. `skipIf`
  // still runs the describe callback at collection time, so a top-level
  // loadEnv() throws in any env without creds (e.g. CI), failing the whole
  // suite. Calling setup() only from it() bodies means a skipped run never
  // touches credentials. (Mirrors the order-preview block below.)
  const setup = () => {
    dotenv.config();
    const cfg = loadEnv(process.env);
    const token = readToken(cfg.tokenFilePath);
    return { cfg, token };
  };

  it("has a valid sandbox token on disk", () => {
    const { token } = setup();
    expect(token).not.toBeNull();
    if (token) expect(isTokenExpired(token)).toBe(false);
  });

  it("lists accounts", async () => {
    const { cfg, token } = setup();
    if (!token) throw new Error("no token");
    const client = createClient(cfg, token);
    const result = (await client.listAccounts()) as Record<string, unknown>;
    expect(result).toHaveProperty("AccountListResponse");
  });

  it("builds a non-empty snapshot", async () => {
    const { cfg, token } = setup();
    if (!token) throw new Error("no token");
    const client = createClient(cfg, token);
    const snap = await buildSnapshot(client, cfg.env, {});
    expect(snap.accounts.length).toBeGreaterThan(0);
  });
});

// PREVIEW-ONLY: validates the order-body shaping against the live E*TRADE
// preview endpoint. It NEVER calls placeOrder, so no order reaches the market.
describe.skipIf(!runOrderPreview)("integration — order preview (no placement)", () => {
  it("previews a deliberately-far-from-market BUY LIMIT and gets a previewId", async () => {
    // Loaded lazily inside the test so a skipped run never touches credentials.
    dotenv.config();
    const cfg = loadEnv(process.env);
    const token = readToken(cfg.tokenFilePath);
    if (!token) throw new Error("no token");
    const client = createClient(cfg, token);
    const request = buildPreviewRequest({
      symbol: process.env.ETRADE_TEST_SYMBOL as string,
      securityType: "EQ",
      orderAction: "BUY",
      quantity: 1,
      priceType: "LIMIT",
      limitPrice: 1, // $1 limit: far from market, would never fill even if (never) placed
    });
    const resp = await client.previewOrder(process.env.ETRADE_TEST_ACCOUNT_KEY as string, request);
    const summary = summarizePreviewResponse(resp);
    expect(summary.previewIds.length).toBeGreaterThan(0);
  });
});

// PREVIEW-ONLY multi-leg spread: validates the SPREADS envelope (NET_DEBIT, two
// option legs) against the live E*TRADE preview endpoint. It NEVER calls
// placeOrder, so no order reaches the market. The default contract is the
// 2026-06-15 SOXX Jul-17 $630/$660 call vertical — the defined-risk offense the
// single-leg API could not place — and is overridable via ETRADE_TEST_SPREAD_*.
describe.skipIf(!runOrderSpreadPreview)("integration — spread preview (no placement)", () => {
  it("previews a 2-leg NET_DEBIT vertical and gets a previewId", async () => {
    // Loaded lazily inside the test so a skipped run never touches credentials.
    dotenv.config();
    const cfg = loadEnv(process.env);
    const token = readToken(cfg.tokenFilePath);
    if (!token) throw new Error("no token");
    const client = createClient(cfg, token);

    const symbol = process.env.ETRADE_TEST_SPREAD_SYMBOL ?? "SOXX";
    const [y, m, d] = (process.env.ETRADE_TEST_SPREAD_EXPIRY ?? "2026-07-17").split("-").map(Number);
    const longStrike = Number(process.env.ETRADE_TEST_SPREAD_LONG_STRIKE ?? 630);
    const shortStrike = Number(process.env.ETRADE_TEST_SPREAD_SHORT_STRIKE ?? 660);

    const request = buildSpreadPreviewRequest({
      symbol,
      priceType: "NET_DEBIT",
      limitPrice: 1, // deliberately far-from-market net debit; the preview never places
      legs: [
        { orderAction: "BUY_OPEN", quantity: 1, callPut: "CALL", expiryYear: y, expiryMonth: m, expiryDay: d, strikePrice: longStrike },
        { orderAction: "SELL_OPEN", quantity: 1, callPut: "CALL", expiryYear: y, expiryMonth: m, expiryDay: d, strikePrice: shortStrike },
      ],
    });
    // The envelope is the SPREADS shape (one Order, two legs) before it ever leaves the process.
    expect(request.orderType).toBe("SPREADS");
    expect(request.Order[0].Instrument).toHaveLength(2);

    const resp = await client.previewOrder(process.env.ETRADE_TEST_ACCOUNT_KEY as string, request);
    const summary = summarizePreviewResponse(resp);
    expect(summary.previewIds.length).toBeGreaterThan(0);
  });
});
