import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EtradeConfig } from "../env.js";
import {
  fetchRequestToken,
  exchangeVerifier,
  writePending,
  readPending,
  clearPending,
  pendingPath,
} from "../auth-core.js";

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "etrade-mcp-auth-core-test-"));
  tmpDirs.push(d);
  return d;
}

function makeCfg(tokenDir?: string): EtradeConfig {
  const dir = tokenDir ?? makeTmpDir();
  return {
    env: "sandbox",
    consumerKey: "ck",
    consumerSecret: "cs",
    apiBaseUrl: "https://apisb.etrade.com",
    authorizeUrl: "https://us.etrade.com/e/t/etws/authorize",
    tokenFilePath: join(dir, "tokens.sandbox.json"),
    allowOrders: false,
  };
}

afterAll(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// ── fetchRequestToken ──────────────────────────────────────────────────────────

test("fetchRequestToken parses request token from a 200 response", async () => {
  const stubFetch = (async () =>
    new Response("oauth_token=RT&oauth_token_secret=RS", {
      status: 200,
    })) as unknown as typeof fetch;

  const result = await fetchRequestToken(makeCfg(), stubFetch);
  expect(result.requestToken).toBe("RT");
  expect(result.requestTokenSecret).toBe("RS");
});

test("fetchRequestToken builds the correct authorize URL", async () => {
  const stubFetch = (async () =>
    new Response("oauth_token=RT&oauth_token_secret=RS", {
      status: 200,
    })) as unknown as typeof fetch;

  const cfg = makeCfg();
  const result = await fetchRequestToken(cfg, stubFetch);
  // key= is the consumer key (URL-encoded), token= is RT
  const expected = `https://us.etrade.com/e/t/etws/authorize?key=${encodeURIComponent("ck")}&token=RT`;
  expect(result.authorizeUrl).toBe(expected);
});

test("fetchRequestToken throws on a non-200 response", async () => {
  const stubFetch = (async () =>
    new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;

  await expect(fetchRequestToken(makeCfg(), stubFetch)).rejects.toThrow("request_token failed: 401");
});

test("fetchRequestToken throws on malformed response (missing token fields)", async () => {
  const stubFetch = (async () =>
    new Response("no_tokens_here=1", { status: 200 })) as unknown as typeof fetch;

  await expect(fetchRequestToken(makeCfg(), stubFetch)).rejects.toThrow(
    "malformed request_token response",
  );
});

// ── exchangeVerifier ───────────────────────────────────────────────────────────

test("exchangeVerifier writes the token file and returns expiresAt", async () => {
  const stubFetch = (async () =>
    new Response("oauth_token=AT&oauth_token_secret=ATS", {
      status: 200,
    })) as unknown as typeof fetch;

  const cfg = makeCfg();
  const result = await exchangeVerifier(
    cfg,
    { requestToken: "RT", requestTokenSecret: "RS" },
    "12345",
    stubFetch,
  );

  expect(typeof result.expiresAt).toBe("string");
  expect(result.expiresAt.length).toBeGreaterThan(0);

  // Token file should exist and have the access token
  const stored = JSON.parse(readFileSync(cfg.tokenFilePath, "utf8"));
  expect(stored.oauth_token).toBe("AT");
  expect(stored.oauth_token_secret).toBe("ATS");
  expect(stored.env).toBe("sandbox");
});

test("exchangeVerifier throws on a non-200 response", async () => {
  const stubFetch = (async () =>
    new Response("Bad Request", { status: 400 })) as unknown as typeof fetch;

  await expect(
    exchangeVerifier(
      makeCfg(),
      { requestToken: "RT", requestTokenSecret: "RS" },
      "12345",
      stubFetch,
    ),
  ).rejects.toThrow("access_token failed: 400");
});

test("exchangeVerifier throws on malformed access_token response", async () => {
  const stubFetch = (async () =>
    new Response("no_tokens=1", { status: 200 })) as unknown as typeof fetch;

  await expect(
    exchangeVerifier(
      makeCfg(),
      { requestToken: "RT", requestTokenSecret: "RS" },
      "12345",
      stubFetch,
    ),
  ).rejects.toThrow("malformed access_token response");
});

// ── pending roundtrip ──────────────────────────────────────────────────────────

test("writePending / readPending roundtrip returns the same object", () => {
  const cfg = makeCfg();
  const data = {
    requestToken: "RT",
    requestTokenSecret: "RS",
    authorizeUrl: "https://example.com/auth",
  };
  writePending(cfg, data);
  const read = readPending(cfg);
  expect(read).toEqual(data);
});

test("pendingPath is in the same directory as tokenFilePath", () => {
  const cfg = makeCfg();
  const p = pendingPath(cfg);
  expect(p).toContain("pending.sandbox.json");
  // should be in the same parent dir as the token file
  expect(p.startsWith(join(tmpdir(), "etrade-mcp-auth-core-test-"))).toBe(true);
});

test("clearPending makes readPending return null", () => {
  const cfg = makeCfg();
  writePending(cfg, {
    requestToken: "RT",
    requestTokenSecret: "RS",
    authorizeUrl: "https://example.com/auth",
  });
  clearPending(cfg);
  expect(readPending(cfg)).toBeNull();
});

test("readPending returns null when no pending file exists", () => {
  const cfg = makeCfg();
  expect(readPending(cfg)).toBeNull();
});

test("clearPending is idempotent (no throw when file already gone)", () => {
  const cfg = makeCfg();
  // No file written — should not throw
  expect(() => clearPending(cfg)).not.toThrow();
  // Call twice with file present → gone
  writePending(cfg, {
    requestToken: "RT",
    requestTokenSecret: "RS",
    authorizeUrl: "https://example.com",
  });
  clearPending(cfg);
  expect(() => clearPending(cfg)).not.toThrow();
});
