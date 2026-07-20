import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "../client.js";

const fixturesDir = join(import.meta.dir, "fixtures");
const loadFixture = (name: string) => JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));

const cfg = {
  env: "sandbox" as const,
  consumerKey: "ck",
  consumerSecret: "cs",
  apiBaseUrl: "https://apisb.etrade.com",
  authorizeUrl: "https://us.etrade.com/e/t/etws/authorize",
  tokenFilePath: "/tmp/ignored",
  allowOrders: false,
};
const token = { oauth_token: "tk", oauth_token_secret: "ts" };

describe("client.listAccounts", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls GET /v1/accounts/list and returns parsed JSON", async () => {
    const fixture = loadFixture("list-accounts.json");
    let capturedUrl = "";
    let capturedAuth = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get("Authorization") ?? "";
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createClient(cfg, token);
    const result = await client.listAccounts();

    expect(capturedUrl).toBe("https://apisb.etrade.com/v1/accounts/list");
    expect(capturedAuth).toStartWith("OAuth ");
    expect(result).toEqual(fixture);
  });

  it("throws a descriptive error on non-200 response", async () => {
    globalThis.fetch = mock(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const client = createClient(cfg, token);
    await expect(client.listAccounts()).rejects.toThrow(/401/);
  });
});

describe("client.getBalance", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("builds the correct URL with default query params", async () => {
    const fixture = loadFixture("balance.json");
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createClient(cfg, token);
    const result = await client.getBalance({ accountIdKey: "dBZOKt9xDrtRSAOl4MSiiA" });

    expect(capturedUrl).toBe(
      "https://apisb.etrade.com/v1/accounts/dBZOKt9xDrtRSAOl4MSiiA/balance?instType=BROKERAGE&realTimeNAV=true",
    );
    expect(result).toEqual(fixture);
  });

  it("passes instType=IRA when provided", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const client = createClient(cfg, token);
    await client.getBalance({ accountIdKey: "abc", instType: "IRA", realTimeNAV: false });
    expect(capturedUrl).toBe(
      "https://apisb.etrade.com/v1/accounts/abc/balance?instType=IRA&realTimeNAV=false",
    );
  });
});

describe("client.getPortfolio", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("uses QUICK view and count=50 as defaults", async () => {
    const fixture = loadFixture("portfolio.json");
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createClient(cfg, token);
    const result = await client.getPortfolio({ accountIdKey: "abc" });

    expect(capturedUrl).toBe(
      "https://apisb.etrade.com/v1/accounts/abc/portfolio?count=50&sortBy=SYMBOL&sortOrder=ASC&marketSession=REGULAR&view=QUICK",
    );
    expect(result).toEqual(fixture);
  });

  it("passes totalsRequired and lotsRequired when specified", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const client = createClient(cfg, token);
    await client.getPortfolio({ accountIdKey: "abc", totalsRequired: true, lotsRequired: true, view: "COMPLETE" });
    expect(capturedUrl).toContain("totalsRequired=true");
    expect(capturedUrl).toContain("lotsRequired=true");
    expect(capturedUrl).toContain("view=COMPLETE");
  });
});

describe("client.listTransactions", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("uses default sortOrder=DESC and count=50", async () => {
    const fixture = loadFixture("transactions.json");
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createClient(cfg, token);
    const result = await client.listTransactions({ accountIdKey: "abc" });

    expect(capturedUrl).toBe(
      "https://apisb.etrade.com/v1/accounts/abc/transactions?sortOrder=DESC&count=50",
    );
    expect(result).toEqual(fixture);
  });

  it("passes startDate, endDate, and marker when provided", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const client = createClient(cfg, token);
    await client.listTransactions({
      accountIdKey: "abc",
      startDate: "01/01/2026",
      endDate: "04/24/2026",
      marker: "m1",
      count: 25,
    });
    expect(capturedUrl).toContain("startDate=01%2F01%2F2026");
    expect(capturedUrl).toContain("endDate=04%2F24%2F2026");
    expect(capturedUrl).toContain("marker=m1");
    expect(capturedUrl).toContain("count=25");
  });
});

describe("client.getTransaction", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("fetches the transaction detail endpoint", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response('{"TransactionDetailsResponse":{"transactionId":"10000001"}}', { status: 200 });
    }) as unknown as typeof fetch;

    const client = createClient(cfg, token);
    const result = await client.getTransaction({ accountIdKey: "abc", transactionId: "10000001" });
    expect(capturedUrl).toBe("https://apisb.etrade.com/v1/accounts/abc/transactions/10000001");
    expect(result).toEqual({ TransactionDetailsResponse: { transactionId: "10000001" } });
  });
});
