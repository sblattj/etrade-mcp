import { signRequest, type TokenPair } from "./oauth.js";
import type { EtradeConfig } from "./env.js";
import type { ListOrdersParams, PlaceOrderRequest, PreviewOrderRequest } from "./orders.js";

export type BalanceParams = {
  accountIdKey: string;
  instType?: "BROKERAGE" | "IRA";
  realTimeNAV?: boolean;
};

export type PortfolioParams = {
  accountIdKey: string;
  count?: number;
  sortBy?: string;
  sortOrder?: "ASC" | "DESC";
  marketSession?: "REGULAR" | "EXTENDED";
  totalsRequired?: boolean;
  lotsRequired?: boolean;
  view?: "PERFORMANCE" | "FUNDAMENTAL" | "OPTIONSWATCH" | "QUICK" | "COMPLETE";
};

export type TransactionListParams = {
  accountIdKey: string;
  startDate?: string;
  endDate?: string;
  sortOrder?: "ASC" | "DESC";
  marker?: string;
  count?: number;
};

export type TransactionDetailParams = {
  accountIdKey: string;
  transactionId: string;
};

export type EtradeClient = {
  listAccounts(): Promise<unknown>;
  /** Real-time market quotes for up to 25 comma-joined symbols (GET /v1/market/quote). */
  getQuote(symbols: string[]): Promise<unknown>;
  getBalance(p: BalanceParams): Promise<unknown>;
  getPortfolio(p: PortfolioParams): Promise<unknown>;
  listTransactions(p: TransactionListParams): Promise<unknown>;
  getTransaction(p: TransactionDetailParams): Promise<unknown>;
  // --- Order API (writes; gated by EtradeConfig.allowOrders at registration) ---
  listOrders(p: ListOrdersParams): Promise<unknown>;
  previewOrder(accountIdKey: string, req: PreviewOrderRequest): Promise<unknown>;
  placeOrder(accountIdKey: string, req: PlaceOrderRequest): Promise<unknown>;
  cancelOrder(accountIdKey: string, orderId: number): Promise<unknown>;
};

export function createClient(cfg: EtradeConfig, token: TokenPair): EtradeClient {
  async function get<T = unknown>(path: string): Promise<T> {
    const url = `${cfg.apiBaseUrl}${path}`;
    const auth = signRequest(
      { consumerKey: cfg.consumerKey, consumerSecret: cfg.consumerSecret },
      token,
      { url, method: "GET" },
    );
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`E*TRADE ${res.status}: ${body.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  // POST/PUT with a JSON body. The JSON body is intentionally NOT part of the
  // OAuth signature base string (only form-urlencoded bodies are) — see oauth.ts.
  // E*TRADE negotiates JSON via the Accept header (same as the read GETs). Only
  // the header is used; a non-JSON response is surfaced raw (not silently handled),
  // which matters on the write path: a place could have reached the market even if
  // the body fails to parse, so the caller must see the payload, not a cryptic error.
  async function send<T = unknown>(
    path: string,
    method: "POST" | "PUT",
    body: unknown,
  ): Promise<T> {
    const url = `${cfg.apiBaseUrl}${path}`;
    const auth = signRequest(
      { consumerKey: cfg.consumerKey, consumerSecret: cfg.consumerSecret },
      token,
      { url, method },
    );
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      // E*TRADE returns an HTML page (not JSON) on rate-limit/auth errors — capture it raw.
      throw new Error(`E*TRADE ${res.status}: ${text.slice(0, 800)}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // 200 but non-JSON (XML/HTML). On a place this may mean the order DID reach
      // the market — surface the raw body so the caller can verify, never swallow it.
      throw new Error(`E*TRADE returned a non-JSON 200 response: ${text.slice(0, 800)}`);
    }
  }

  function qs(params: Record<string, string | number | boolean | undefined>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
  }

  return {
    listAccounts: () => get("/v1/accounts/list"),
    // Option contracts quote via colon notation (e.g. TKO:2027:1:15:CALL:210) — keep the
    // colons literal in the path; E*TRADE rejects them percent-encoded.
    getQuote: (symbols) =>
      get(
        `/v1/market/quote/${symbols
          .map((s) => encodeURIComponent(s.toUpperCase()).replace(/%3A/gi, ":"))
          .join(",")}`,
      ),
    getBalance: ({ accountIdKey, instType = "BROKERAGE", realTimeNAV = true }) =>
      get(`/v1/accounts/${accountIdKey}/balance${qs({ instType, realTimeNAV })}`),
    getPortfolio: ({
      accountIdKey,
      count = 50,
      sortBy = "SYMBOL",
      sortOrder = "ASC",
      marketSession = "REGULAR",
      totalsRequired,
      lotsRequired,
      view = "QUICK",
    }) =>
      get(
        `/v1/accounts/${accountIdKey}/portfolio${qs({
          count,
          sortBy,
          sortOrder,
          marketSession,
          totalsRequired,
          lotsRequired,
          view,
        })}`,
      ),
    listTransactions: ({ accountIdKey, startDate, endDate, sortOrder = "DESC", marker, count = 50 }) =>
      get(
        `/v1/accounts/${accountIdKey}/transactions${qs({ startDate, endDate, sortOrder, marker, count })}`,
      ),
    getTransaction: ({ accountIdKey, transactionId }) =>
      get(`/v1/accounts/${accountIdKey}/transactions/${transactionId}`),
    listOrders: ({ accountIdKey, count = 25, status, symbol, fromDate, toDate, marker }) =>
      get(
        `/v1/accounts/${accountIdKey}/orders${qs({ count, status, symbol, fromDate, toDate, marker })}`,
      ),
    previewOrder: (accountIdKey, req) =>
      send(`/v1/accounts/${accountIdKey}/orders/preview`, "POST", { PreviewOrderRequest: req }),
    placeOrder: (accountIdKey, req) =>
      send(`/v1/accounts/${accountIdKey}/orders/place`, "POST", { PlaceOrderRequest: req }),
    cancelOrder: (accountIdKey, orderId) =>
      send(`/v1/accounts/${accountIdKey}/orders/cancel`, "PUT", { CancelOrderRequest: { orderId } }),
  };
}
