import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createClient } from "../client.js";
import type { PlaceOrderRequest, PreviewOrderRequest } from "../orders.js";

const cfg = {
  env: "sandbox" as const,
  consumerKey: "ck",
  consumerSecret: "cs",
  apiBaseUrl: "https://apisb.etrade.com",
  authorizeUrl: "https://us.etrade.com/e/t/etws/authorize",
  tokenFilePath: "/tmp/ignored",
  allowOrders: true,
};
const token = { oauth_token: "tk", oauth_token_secret: "ts" };

const previewReq: PreviewOrderRequest = {
  orderType: "EQ",
  clientOrderId: "c1",
  Order: [
    {
      allOrNone: "false",
      priceType: "LIMIT",
      orderTerm: "GOOD_FOR_DAY",
      marketSession: "REGULAR",
      limitPrice: "281.69",
      Instrument: [
        {
          Product: { securityType: "EQ", symbol: "PANW" },
          orderAction: "BUY",
          quantityType: "QUANTITY",
          quantity: "10",
        },
      ],
    },
  ],
};

type Captured = { url: string; method: string; auth: string; contentType: string; body: string };

function mockFetch(capture: Partial<Captured>, response: unknown, status = 200) {
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    capture.url = typeof input === "string" ? input : input.toString();
    capture.method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    capture.auth = headers.get("Authorization") ?? "";
    capture.contentType = headers.get("Content-Type") ?? "";
    capture.body = typeof init?.body === "string" ? init.body : "";
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
}

describe("client order writes", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("previewOrder POSTs the PreviewOrderRequest envelope as JSON", async () => {
    const cap: Partial<Captured> = {};
    mockFetch(cap, { PreviewOrderResponse: { PreviewIds: [{ previewId: 1 }] } });
    const client = createClient(cfg, token);
    await client.previewOrder("acctKey", previewReq);

    expect(cap.url).toBe("https://apisb.etrade.com/v1/accounts/acctKey/orders/preview");
    expect(cap.method).toBe("POST");
    expect(cap.auth).toStartWith("OAuth ");
    expect(cap.contentType).toBe("application/json");
    expect(JSON.parse(cap.body ?? "{}")).toEqual({ PreviewOrderRequest: previewReq });
  });

  it("placeOrder POSTs the PlaceOrderRequest envelope carrying the previewId", async () => {
    const cap: Partial<Captured> = {};
    mockFetch(cap, { PlaceOrderResponse: { OrderIds: [{ orderId: 9 }] } });
    const placeReq: PlaceOrderRequest = { ...previewReq, PreviewIds: [{ previewId: 1234 }] };
    const client = createClient(cfg, token);
    await client.placeOrder("acctKey", placeReq);

    expect(cap.url).toBe("https://apisb.etrade.com/v1/accounts/acctKey/orders/place");
    expect(cap.method).toBe("POST");
    const parsed = JSON.parse(cap.body ?? "{}");
    expect(parsed.PlaceOrderRequest.PreviewIds).toEqual([{ previewId: 1234 }]);
    expect(parsed.PlaceOrderRequest.Order).toEqual(previewReq.Order);
  });

  it("cancelOrder PUTs the CancelOrderRequest with just the orderId", async () => {
    const cap: Partial<Captured> = {};
    mockFetch(cap, { CancelOrderResponse: { orderId: 9 } });
    const client = createClient(cfg, token);
    await client.cancelOrder("acctKey", 9);

    expect(cap.url).toBe("https://apisb.etrade.com/v1/accounts/acctKey/orders/cancel");
    expect(cap.method).toBe("PUT");
    expect(JSON.parse(cap.body ?? "{}")).toEqual({ CancelOrderRequest: { orderId: 9 } });
  });

  it("listOrders GETs with default count and passes status", async () => {
    const cap: Partial<Captured> = {};
    mockFetch(cap, { OrdersResponse: {} });
    const client = createClient(cfg, token);
    await client.listOrders({ accountIdKey: "acctKey", status: "OPEN" });

    expect(cap.method).toBe("GET");
    expect(cap.url).toBe("https://apisb.etrade.com/v1/accounts/acctKey/orders?count=25&status=OPEN");
  });

  it("surfaces a non-200 body (e.g. rate-limit HTML) as a thrown error", async () => {
    const cap: Partial<Captured> = {};
    mockFetch(cap, "Number of requests exceeded the rate limit set", 400);
    const client = createClient(cfg, token);
    await expect(client.previewOrder("acctKey", previewReq)).rejects.toThrow(/400/);
  });
});
