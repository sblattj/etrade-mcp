import { afterEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";
import type { EtradeConfig } from "../env.js";
import { registerPreviewOrder } from "../tools/preview-order.js";
import { registerPreviewSpread } from "../tools/preview-spread.js";
import { registerPlaceOrder } from "../tools/place-order.js";
import { registerCancelOrder } from "../tools/cancel-order.js";
import { buildPreviewRequest } from "../orders.js";
import { clearPreviews, peekPreview, putPreview, takePreview } from "../order-store.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function fakeServer() {
  const handlers: Record<string, Handler> = {};
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: Handler) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, handlers };
}

function cfg(env: "sandbox" | "prod" = "sandbox"): EtradeConfig {
  return {
    env,
    consumerKey: "ck",
    consumerSecret: "cs",
    apiBaseUrl: env === "prod" ? "https://api.etrade.com" : "https://apisb.etrade.com",
    authorizeUrl: "https://us.etrade.com/e/t/etws/authorize",
    tokenFilePath: "/tmp/ignored",
    allowOrders: true,
  };
}

function makeClient(overrides: Partial<EtradeClient> = {}): EtradeClient {
  return {
    listAccounts: async () => ({}),
    getQuote: async () => ({}),
    getBalance: async () => ({}),
    getPortfolio: async () => ({}),
    listTransactions: async () => ({}),
    getTransaction: async () => ({}),
    listOrders: async () => ({}),
    previewOrder: async () => ({}),
    placeOrder: async () => ({}),
    cancelOrder: async () => ({}),
    ...overrides,
  };
}

const validEquityArgs = {
  accountIdKey: "acctKey",
  symbol: "PANW",
  securityType: "EQ",
  orderAction: "BUY",
  quantity: 10,
  priceType: "LIMIT",
  limitPrice: 281.69,
  clientOrderId: "c1",
};

const validSpreadArgs = {
  accountIdKey: "acctKey",
  symbol: "SOXX",
  priceType: "NET_DEBIT",
  limitPrice: 15.35,
  clientOrderId: "s1",
  legs: [
    { orderAction: "BUY_OPEN", quantity: 1, callPut: "CALL", expiryYear: 2026, expiryMonth: 7, expiryDay: 17, strikePrice: 630 },
    { orderAction: "SELL_OPEN", quantity: 1, callPut: "CALL", expiryYear: 2026, expiryMonth: 7, expiryDay: 17, strikePrice: 660 },
  ],
};

const pendingRequest = buildPreviewRequest({
  symbol: "PANW",
  securityType: "EQ",
  orderAction: "BUY",
  quantity: 10,
  priceType: "LIMIT",
  limitPrice: 281.69,
  clientOrderId: "c1",
});

afterEach(() => clearPreviews());

describe("etrade_preview_order handler", () => {
  it("happy path: previews, stores the previewId, returns the cost", async () => {
    const { server, handlers } = fakeServer();
    const client = makeClient({
      previewOrder: async () => ({
        PreviewOrderResponse: {
          PreviewIds: [{ previewId: 42 }],
          Order: [{ estimatedTotalAmount: 2816.9, estimatedCommission: 0 }],
        },
      }),
    });
    registerPreviewOrder(server, cfg(), () => client);

    const res = await handlers.etrade_preview_order(validEquityArgs);
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("previewId");
    expect(res.content[0].text).toContain("42");
    expect(peekPreview(42)?.accountIdKey).toBe("acctKey"); // stored for a later place
  });

  it("rejects an ERROR-message response and stores nothing", async () => {
    const { server, handlers } = fakeServer();
    const client = makeClient({
      previewOrder: async () => ({
        PreviewOrderResponse: { Order: [{ messages: { Message: [{ type: "ERROR", description: "bad" }] } }] },
      }),
    });
    registerPreviewOrder(server, cfg(), () => client);

    const res = await handlers.etrade_preview_order(validEquityArgs);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("bad");
  });

  it("returns a validation error for a bad order without calling E*TRADE", async () => {
    const { server, handlers } = fakeServer();
    let called = false;
    const client = makeClient({
      previewOrder: async () => {
        called = true;
        return {};
      },
    });
    registerPreviewOrder(server, cfg(), () => client);

    const res = await handlers.etrade_preview_order({ ...validEquityArgs, limitPrice: undefined });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Invalid order");
    expect(called).toBe(false);
  });

  it("surfaces a token error from getClient", async () => {
    const { server, handlers } = fakeServer();
    registerPreviewOrder(server, cfg(), () => new Error("token expired"));
    const res = await handlers.etrade_preview_order(validEquityArgs);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("token expired");
  });
});

describe("etrade_preview_spread handler", () => {
  it("happy path: previews a vertical, stores the previewId, returns the net cost", async () => {
    const { server, handlers } = fakeServer();
    let sentRequest: unknown;
    const client = makeClient({
      previewOrder: async (_acct, req) => {
        sentRequest = req;
        return {
          PreviewOrderResponse: {
            PreviewIds: [{ previewId: 77 }],
            Order: [{ estimatedTotalAmount: 1535, estimatedCommission: 1 }],
          },
        };
      },
    });
    registerPreviewSpread(server, cfg(), () => client);

    const res = await handlers.etrade_preview_spread(validSpreadArgs);
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("SPREAD (NET_DEBIT $15.35)");
    expect(res.content[0].text).toContain("BUY_OPEN 1 SOXX 7/17/2026 $630 CALL");
    expect(res.content[0].text).toContain("77");
    // the stored envelope is a real SPREADS order the EXISTING place tool can replay
    expect((sentRequest as { orderType?: string }).orderType).toBe("SPREADS");
    expect(peekPreview(77)?.request.orderType).toBe("SPREADS");
    expect(peekPreview(77)?.request.Order[0].Instrument).toHaveLength(2);
  });

  it("returns a validation error for a single-leg 'spread' without calling E*TRADE", async () => {
    const { server, handlers } = fakeServer();
    let called = false;
    const client = makeClient({
      previewOrder: async () => {
        called = true;
        return {};
      },
    });
    registerPreviewSpread(server, cfg(), () => client);

    const res = await handlers.etrade_preview_spread({ ...validSpreadArgs, legs: [validSpreadArgs.legs[0]] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Invalid spread");
    expect(called).toBe(false);
  });

  it("rejects an ERROR-message response and stores nothing", async () => {
    const { server, handlers } = fakeServer();
    const client = makeClient({
      previewOrder: async () => ({
        PreviewOrderResponse: { Order: [{ messages: { Message: [{ type: "ERROR", description: "bad spread" }] } }] },
      }),
    });
    registerPreviewSpread(server, cfg(), () => client);

    const res = await handlers.etrade_preview_spread(validSpreadArgs);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("bad spread");
  });
});

describe("etrade_place_order handler", () => {
  it("refuses an unknown previewId and never calls placeOrder", async () => {
    const { server, handlers } = fakeServer();
    let placeCalls = 0;
    const client = makeClient({
      placeOrder: async () => {
        placeCalls++;
        return {};
      },
    });
    registerPlaceOrder(server, cfg(), () => client);

    const res = await handlers.etrade_place_order({ previewId: 999, confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No live preview");
    expect(placeCalls).toBe(0);
  });

  it("refuses to place a sandbox-minted preview against a prod server", async () => {
    const { server, handlers } = fakeServer();
    let placeCalls = 0;
    const client = makeClient({
      placeOrder: async () => {
        placeCalls++;
        return {};
      },
    });
    putPreview({
      previewId: 7,
      previewIds: [{ previewId: 7 }],
      accountIdKey: "acctKey",
      env: "sandbox",
      request: pendingRequest,
      summary: "preview",
    });
    registerPlaceOrder(server, cfg("prod"), () => client);

    const res = await handlers.etrade_place_order({ previewId: 7, confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Refusing to place");
    expect(placeCalls).toBe(0);
  });

  it("happy path: places and consumes the preview", async () => {
    const { server, handlers } = fakeServer();
    const client = makeClient({
      placeOrder: async () => ({ PlaceOrderResponse: { OrderIds: [{ orderId: 555 }] } }),
    });
    putPreview({
      previewId: 8,
      previewIds: [{ previewId: 8 }],
      accountIdKey: "acctKey",
      env: "sandbox",
      request: pendingRequest,
      summary: "preview",
    });
    registerPlaceOrder(server, cfg(), () => client);

    const res = await handlers.etrade_place_order({ previewId: 8, confirm: true });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("PLACED");
    expect(res.content[0].text).toContain("555");
    expect(peekPreview(8)).toBeNull(); // single-use: consumed
  });

  it("treats an orderId returned under Order[] as success (not a duplicate-risk failure)", async () => {
    const { server, handlers } = fakeServer();
    const client = makeClient({
      placeOrder: async () => ({ PlaceOrderResponse: { Order: [{ orderId: 777 }] } }),
    });
    putPreview({
      previewId: 9,
      previewIds: [{ previewId: 9 }],
      accountIdKey: "acctKey",
      env: "sandbox",
      request: pendingRequest,
      summary: "preview",
    });
    registerPlaceOrder(server, cfg(), () => client);

    const res = await handlers.etrade_place_order({ previewId: 9, confirm: true });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("777");
  });

  it("on a thrown placeOrder, returns UNKNOWN status and the preview stays consumed", async () => {
    const { server, handlers } = fakeServer();
    const client = makeClient({
      placeOrder: async () => {
        throw new Error("network timeout");
      },
    });
    putPreview({
      previewId: 10,
      previewIds: [{ previewId: 10 }],
      accountIdKey: "acctKey",
      env: "sandbox",
      request: pendingRequest,
      summary: "preview",
    });
    registerPlaceOrder(server, cfg(), () => client);

    const res = await handlers.etrade_place_order({ previewId: 10, confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("UNKNOWN");
    expect(res.content[0].text).toContain("etrade_list_orders");
    expect(takePreview(10)).toBeNull(); // consumed even though the place threw
  });

  it("rejects confirm:false at the handler", async () => {
    const { server, handlers } = fakeServer();
    let placeCalls = 0;
    const client = makeClient({
      placeOrder: async () => {
        placeCalls++;
        return {};
      },
    });
    registerPlaceOrder(server, cfg(), () => client);
    const res = await handlers.etrade_place_order({ previewId: 1, confirm: false });
    expect(res.isError).toBe(true);
    expect(placeCalls).toBe(0);
  });
});

describe("etrade_cancel_order handler", () => {
  it("cancels and renders the result", async () => {
    const { server, handlers } = fakeServer();
    const client = makeClient({
      cancelOrder: async () => ({ CancelOrderResponse: { orderId: 555, cancelTime: 1_700_000_000_000 } }),
    });
    registerCancelOrder(server, cfg(), () => client);
    const res = await handlers.etrade_cancel_order({ accountIdKey: "acctKey", orderId: 555, confirm: true });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("555");
  });

  it("rejects confirm:false and never calls cancelOrder", async () => {
    const { server, handlers } = fakeServer();
    let cancelCalls = 0;
    const client = makeClient({
      cancelOrder: async () => {
        cancelCalls++;
        return {};
      },
    });
    registerCancelOrder(server, cfg(), () => client);
    const res = await handlers.etrade_cancel_order({ accountIdKey: "acctKey", orderId: 1, confirm: false });
    expect(res.isError).toBe(true);
    expect(cancelCalls).toBe(0);
  });
});
