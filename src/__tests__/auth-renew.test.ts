import { test, expect, describe } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renewAccessToken } from "../auth-renew.js";
import type { EtradeConfig } from "../env.js";
import type { StoredToken } from "../tokens.js";

// renew_access_token is the BROWSER-FREE recovery for the ~2h idle timeout (distinct from the midnight
// expiry, which needs full re-consent). E*TRADE deactivates an access token after 2h of no API calls;
// renew_access_token reactivates the SAME token. Without this, every idle death between scheduled/
// automated calls triggers a full (and possibly flaky) browser re-auth. With it, the idle deaths
// self-heal with no browser at all.

function tmpCfg(): EtradeConfig {
  const dir = mkdtempSync(join(tmpdir(), "etrade-renew-"));
  return {
    env: "prod",
    consumerKey: "ck",
    consumerSecret: "cs",
    apiBaseUrl: "https://api.etrade.com",
    authorizeUrl: "https://us.etrade.com/e/t/etws/authorize",
    tokenFilePath: join(dir, "tokens.prod.json"),
    allowOrders: false,
  } as EtradeConfig;
}

const tokenOf = (over: Partial<StoredToken> = {}): StoredToken => ({
  env: "prod",
  oauth_token: "OLD_TOKEN",
  oauth_token_secret: "OLD_SECRET",
  obtained_at: "2026-06-17T11:35:00.000Z",
  expires_at_midnight_et: "2026-06-18T00:00:00-04:00",
  ...over,
});

describe("renewAccessToken", () => {
  test("on 200 it marks the token renewed and refreshes obtained_at (keeping the SAME token/secret + midnight expiry)", async () => {
    const cfg = tmpCfg();
    writeFileSync(cfg.tokenFilePath, JSON.stringify(tokenOf()));
    let calledUrl = "";
    const fakeFetch = (async (url: string) => {
      calledUrl = String(url);
      // E*TRADE reactivates and echoes the same token pair
      return new Response("oauth_token=OLD_TOKEN&oauth_token_secret=OLD_SECRET", { status: 200 });
    }) as unknown as typeof fetch;

    const r = await renewAccessToken(cfg, tokenOf(), fakeFetch);
    expect(r.renewed).toBe(true);
    expect(calledUrl).toBe("https://api.etrade.com/oauth/renew_access_token");

    const written = JSON.parse(readFileSync(cfg.tokenFilePath, "utf8")) as StoredToken;
    expect(written.oauth_token).toBe("OLD_TOKEN"); // same token, reactivated
    expect(written.oauth_token_secret).toBe("OLD_SECRET");
    expect(written.expires_at_midnight_et).toBe("2026-06-18T00:00:00-04:00"); // midnight unchanged
    expect(new Date(written.obtained_at).getTime()).toBeGreaterThan(new Date("2026-06-17T11:35:00.000Z").getTime()); // idle clock reset
  });

  test("on a 401/token_rejected it returns renewed:false (caller must fall back to the browser flow) and does NOT clobber the token file", async () => {
    const cfg = tmpCfg();
    const original = JSON.stringify(tokenOf());
    writeFileSync(cfg.tokenFilePath, original);
    const fakeFetch = (async () =>
      new Response("oauth_problem=token_rejected", { status: 401 })) as unknown as typeof fetch;

    const r = await renewAccessToken(cfg, tokenOf(), fakeFetch);
    expect(r.renewed).toBe(false);
    expect(r.reason).toContain("401");
    expect(readFileSync(cfg.tokenFilePath, "utf8")).toBe(original); // untouched on failure
  });

  test("a 200 that echoes a DIFFERENT token pair persists the new pair (defensive — honor whatever E*TRADE returns)", async () => {
    const cfg = tmpCfg();
    writeFileSync(cfg.tokenFilePath, JSON.stringify(tokenOf()));
    const fakeFetch = (async () =>
      new Response("oauth_token=NEW_TOKEN&oauth_token_secret=NEW_SECRET", { status: 200 })) as unknown as typeof fetch;

    const r = await renewAccessToken(cfg, tokenOf(), fakeFetch);
    expect(r.renewed).toBe(true);
    const written = JSON.parse(readFileSync(cfg.tokenFilePath, "utf8")) as StoredToken;
    expect(written.oauth_token).toBe("NEW_TOKEN");
    expect(written.oauth_token_secret).toBe("NEW_SECRET");
  });

  test("a 200 with an EMPTY body still counts as renewed and keeps the existing token (E*TRADE sometimes returns no body)", async () => {
    const cfg = tmpCfg();
    writeFileSync(cfg.tokenFilePath, JSON.stringify(tokenOf()));
    const fakeFetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;

    const r = await renewAccessToken(cfg, tokenOf(), fakeFetch);
    expect(r.renewed).toBe(true);
    const written = JSON.parse(readFileSync(cfg.tokenFilePath, "utf8")) as StoredToken;
    expect(written.oauth_token).toBe("OLD_TOKEN");
  });

  test("returns renewed:false when there is no token to renew (null/empty)", async () => {
    const cfg = tmpCfg();
    const r = await renewAccessToken(cfg, null, (async () => new Response("", { status: 200 })) as unknown as typeof fetch);
    expect(r.renewed).toBe(false);
    expect(r.reason?.toLowerCase()).toContain("no token");
  });
});
