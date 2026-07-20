/**
 * Pure order-shaping + response-parsing for the E*TRADE Order API.
 *
 * Kept free of I/O so it is fully unit-testable. The two-step Preview -> Place
 * handshake is modeled here: `buildPreviewRequest` turns friendly args into the
 * `PreviewOrderRequest` envelope E*TRADE expects, and `buildPlaceRequest`
 * stamps the previewId(s) returned by preview onto that same envelope for the
 * place call (E*TRADE requires the place params to match the preview exactly).
 */

// ---- Transport-level request shapes (sent to E*TRADE) ----

export type EtradeProduct = {
  securityType: "EQ" | "OPTN";
  symbol: string;
  // Option-only:
  callPut?: "CALL" | "PUT";
  expiryYear?: string;
  expiryMonth?: string;
  expiryDay?: string;
  strikePrice?: string;
};

export type OrderDetail = {
  allOrNone: string; // "true" | "false"
  priceType: string;
  orderTerm: string;
  marketSession: string;
  limitPrice?: string;
  stopPrice?: string;
  Instrument: Array<{
    Product: EtradeProduct;
    orderAction: string;
    quantityType: "QUANTITY";
    quantity: string;
  }>;
};

export type PreviewOrderRequest = {
  orderType: string;
  clientOrderId: string;
  Order: OrderDetail[];
};

export type PlaceOrderRequest = PreviewOrderRequest & {
  PreviewIds: Array<{ previewId: number }>;
};

export type ListOrdersParams = {
  accountIdKey: string;
  count?: number;
  status?: string;
  symbol?: string;
  fromDate?: string;
  toDate?: string;
  marker?: string;
};

// ---- Friendly args (what the MCP tool accepts) ----

export const EQUITY_ACTIONS = ["BUY", "SELL", "SELL_SHORT", "BUY_TO_COVER"] as const;
export const OPTION_ACTIONS = ["BUY_OPEN", "SELL_OPEN", "BUY_CLOSE", "SELL_CLOSE"] as const;
export const PRICE_TYPES = ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"] as const;
// Multi-leg option spreads price on the NET of all legs, not a single limit.
export const SPREAD_PRICE_TYPES = ["NET_DEBIT", "NET_CREDIT", "NET_EVEN"] as const;
export const ORDER_TERMS = [
  "GOOD_FOR_DAY",
  "GOOD_UNTIL_CANCEL",
  "IMMEDIATE_OR_CANCEL",
  "FILL_OR_KILL",
] as const;

export type OrderArgs = {
  symbol: string;
  securityType: "EQ" | "OPTN";
  orderAction: string;
  quantity: number;
  priceType: (typeof PRICE_TYPES)[number];
  limitPrice?: number;
  stopPrice?: number;
  orderTerm?: string;
  marketSession?: "REGULAR" | "EXTENDED";
  allOrNone?: boolean;
  clientOrderId?: string;
  // option-only:
  callPut?: "CALL" | "PUT";
  expiryYear?: number;
  expiryMonth?: number;
  expiryDay?: number;
  strikePrice?: number;
};

export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderValidationError";
  }
}

/**
 * E*TRADE wants a developer-supplied clientOrderId: <=20 alphanumeric chars,
 * unique within the account (its duplicate-submission guard). Time + randomness
 * keeps it unique across a session without a counter to persist.
 */
export function generateClientOrderId(now: number = Date.now(), rand: number = Math.random()): string {
  const t = now.toString(36);
  const r = Math.floor(rand * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `g${t}${r}`.slice(0, 20);
}

export function buildPreviewRequest(args: OrderArgs): PreviewOrderRequest {
  const errs: string[] = [];

  if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
    errs.push("quantity must be a positive number");
  }
  if (!Number.isInteger(args.quantity)) {
    errs.push("quantity must be a whole number (no fractional shares/contracts on the E*TRADE API)");
  }
  if (args.clientOrderId !== undefined && !/^[A-Za-z0-9]{1,20}$/.test(args.clientOrderId)) {
    errs.push("clientOrderId must be 1-20 alphanumeric characters (E*TRADE's duplicate-submission key)");
  }

  // orderAction must match the security type
  if (args.securityType === "EQ" && !EQUITY_ACTIONS.includes(args.orderAction as never)) {
    errs.push(`orderAction "${args.orderAction}" is invalid for EQ; use one of ${EQUITY_ACTIONS.join(", ")}`);
  }
  if (args.securityType === "OPTN" && !OPTION_ACTIONS.includes(args.orderAction as never)) {
    errs.push(`orderAction "${args.orderAction}" is invalid for OPTN; use one of ${OPTION_ACTIONS.join(", ")}`);
  }

  // price fields required/forbidden by priceType
  const needsLimit = args.priceType === "LIMIT" || args.priceType === "STOP_LIMIT";
  const needsStop = args.priceType === "STOP" || args.priceType === "STOP_LIMIT";
  if (needsLimit && !(typeof args.limitPrice === "number" && Number.isFinite(args.limitPrice) && args.limitPrice > 0)) {
    errs.push(`priceType ${args.priceType} requires a finite, positive limitPrice`);
  }
  if (needsStop && !(typeof args.stopPrice === "number" && Number.isFinite(args.stopPrice) && args.stopPrice > 0)) {
    errs.push(`priceType ${args.priceType} requires a finite, positive stopPrice`);
  }
  if (!needsLimit && args.limitPrice !== undefined) {
    errs.push(`limitPrice is not allowed for priceType ${args.priceType}`);
  }
  if (!needsStop && args.stopPrice !== undefined) {
    errs.push(`stopPrice is not allowed for priceType ${args.priceType}`);
  }

  // option vs equity field requirements
  if (args.securityType === "OPTN") {
    if (!args.callPut) errs.push("OPTN requires callPut (CALL|PUT)");
    if (!args.expiryYear || !args.expiryMonth || !args.expiryDay) {
      errs.push("OPTN requires expiryYear, expiryMonth, and expiryDay");
    }
    if (!(typeof args.strikePrice === "number" && Number.isFinite(args.strikePrice) && args.strikePrice > 0)) {
      errs.push("OPTN requires a finite, positive strikePrice");
    }
  } else if (
    args.callPut ||
    args.expiryYear !== undefined ||
    args.expiryMonth !== undefined ||
    args.expiryDay !== undefined ||
    args.strikePrice !== undefined
  ) {
    errs.push("option fields (callPut/expiryYear/expiryMonth/expiryDay/strikePrice) are not allowed for EQ");
  }

  // E*TRADE coupling rules (surfaced here so we fail before sending, not after)
  const orderTerm = args.orderTerm ?? "GOOD_FOR_DAY";
  const marketSession = args.marketSession ?? "REGULAR";
  if (args.priceType === "MARKET" && orderTerm !== "GOOD_FOR_DAY") {
    errs.push("MARKET orders must use orderTerm GOOD_FOR_DAY (E*TRADE err 1035)");
  }
  if (marketSession === "EXTENDED") {
    if (args.priceType !== "LIMIT") errs.push("EXTENDED-hours orders must be LIMIT (E*TRADE err 1053)");
    if (args.allOrNone) errs.push("EXTENDED-hours orders cannot be all-or-none (E*TRADE err 1054)");
  }
  if (args.allOrNone && args.quantity < 300) {
    errs.push("all-or-none is only allowed on orders of 300+ shares (E*TRADE err 1032)");
  }

  if (errs.length) throw new OrderValidationError(errs.join("; "));

  const product: EtradeProduct =
    args.securityType === "OPTN"
      ? {
          securityType: "OPTN",
          symbol: args.symbol.toUpperCase(),
          callPut: args.callPut,
          expiryYear: String(args.expiryYear),
          expiryMonth: String(args.expiryMonth),
          expiryDay: String(args.expiryDay),
          strikePrice: String(args.strikePrice),
        }
      : { securityType: "EQ", symbol: args.symbol.toUpperCase() };

  const detail: OrderDetail = {
    allOrNone: String(Boolean(args.allOrNone)),
    priceType: args.priceType,
    orderTerm,
    marketSession,
    ...(needsLimit ? { limitPrice: String(args.limitPrice) } : {}),
    ...(needsStop ? { stopPrice: String(args.stopPrice) } : {}),
    Instrument: [
      {
        Product: product,
        orderAction: args.orderAction,
        quantityType: "QUANTITY",
        quantity: String(args.quantity),
      },
    ],
  };

  return {
    orderType: args.securityType === "OPTN" ? "OPTN" : "EQ",
    clientOrderId: args.clientOrderId ?? generateClientOrderId(),
    Order: [detail],
  };
}

// ---- Multi-leg option spreads (verticals, calendars, straddles, …) ----

/**
 * One option leg of a spread. Every leg is an option on the SAME underlying
 * (the SpreadOrderArgs.symbol); only the per-leg contract + action vary.
 */
export type SpreadLegArgs = {
  orderAction: (typeof OPTION_ACTIONS)[number];
  quantity: number;
  callPut: "CALL" | "PUT";
  expiryYear: number;
  expiryMonth: number;
  expiryDay: number;
  strikePrice: number;
};

export type SpreadOrderArgs = {
  symbol: string; // shared underlying for every leg
  legs: SpreadLegArgs[]; // 2–4 legs
  priceType: (typeof SPREAD_PRICE_TYPES)[number];
  /** Net debit/credit per spread (positive). Required for NET_DEBIT/NET_CREDIT; 0/omitted for NET_EVEN. */
  limitPrice?: number;
  orderTerm?: string;
  marketSession?: "REGULAR" | "EXTENDED";
  allOrNone?: boolean;
  clientOrderId?: string;
};

/**
 * Shape a multi-leg option spread into E*TRADE's `SPREADS` envelope: ONE Order
 * element carrying N Instrument legs, priced on the NET of the legs
 * (NET_DEBIT / NET_CREDIT / NET_EVEN) rather than a single limit. This is the
 * one shape the single-leg `buildPreviewRequest` could not express — the gap
 * that blocked the 2026-06-15 SOXX defined-risk vertical. The place handshake
 * is unchanged: the resulting envelope flows through `buildPlaceRequest` and
 * the existing `etrade_place_order` exactly like a single-leg order.
 */
export function buildSpreadPreviewRequest(args: SpreadOrderArgs): PreviewOrderRequest {
  const errs: string[] = [];

  const legs = Array.isArray(args.legs) ? args.legs : [];
  if (legs.length < 2) errs.push("a spread needs at least 2 legs (use etrade_preview_order for a single option)");
  if (legs.length > 4) errs.push("the E*TRADE SPREADS order type supports at most 4 legs");

  if (args.clientOrderId !== undefined && !/^[A-Za-z0-9]{1,20}$/.test(args.clientOrderId)) {
    errs.push("clientOrderId must be 1-20 alphanumeric characters (E*TRADE's duplicate-submission key)");
  }

  if (!SPREAD_PRICE_TYPES.includes(args.priceType as never)) {
    errs.push(`priceType "${args.priceType}" is invalid for a spread; use one of ${SPREAD_PRICE_TYPES.join(", ")}`);
  }

  // Net-price rules: a debit/credit spread needs a positive net; NET_EVEN is exactly zero.
  const netNeedsPrice = args.priceType === "NET_DEBIT" || args.priceType === "NET_CREDIT";
  if (netNeedsPrice && !(typeof args.limitPrice === "number" && Number.isFinite(args.limitPrice) && args.limitPrice > 0)) {
    errs.push(`priceType ${args.priceType} requires a finite, positive net limitPrice`);
  }
  if (args.priceType === "NET_EVEN" && args.limitPrice !== undefined && args.limitPrice !== 0) {
    errs.push("priceType NET_EVEN requires limitPrice 0 (or omitted)");
  }

  // Options spreads do not trade in the extended session.
  const orderTerm = args.orderTerm ?? "GOOD_FOR_DAY";
  const marketSession = args.marketSession ?? "REGULAR";
  if (marketSession !== "REGULAR") errs.push("option spreads trade the REGULAR session only");

  const symbol = (args.symbol ?? "").toUpperCase();
  if (!symbol) errs.push("symbol (the shared underlying for every leg) is required");

  // Per-leg validation + a copy-paste guard: every leg must be a DISTINCT contract
  // (differ in strike, expiry, or call/put) — a vertical/calendar/straddle all do.
  const seenContracts = new Set<string>();
  legs.forEach((leg, i) => {
    const tag = `leg ${i + 1}`;
    if (!OPTION_ACTIONS.includes(leg.orderAction as never)) {
      errs.push(`${tag}: orderAction "${leg.orderAction}" is invalid; use one of ${OPTION_ACTIONS.join(", ")}`);
    }
    if (!Number.isFinite(leg.quantity) || leg.quantity <= 0) {
      errs.push(`${tag}: quantity must be a positive number`);
    } else if (!Number.isInteger(leg.quantity)) {
      errs.push(`${tag}: quantity must be a whole number of contracts`);
    }
    if (leg.callPut !== "CALL" && leg.callPut !== "PUT") errs.push(`${tag}: callPut must be CALL or PUT`);
    if (!leg.expiryYear || !leg.expiryMonth || !leg.expiryDay) {
      errs.push(`${tag}: requires expiryYear, expiryMonth, and expiryDay`);
    }
    if (!(typeof leg.strikePrice === "number" && Number.isFinite(leg.strikePrice) && leg.strikePrice > 0)) {
      errs.push(`${tag}: requires a finite, positive strikePrice`);
    }
    const contractKey = `${leg.callPut}|${leg.expiryYear}-${leg.expiryMonth}-${leg.expiryDay}|${leg.strikePrice}`;
    if (seenContracts.has(contractKey)) {
      errs.push(`${tag}: same contract as an earlier leg — spread legs must be distinct contracts (differ in strike, expiry, or call/put)`);
    }
    seenContracts.add(contractKey);
  });

  if (errs.length) throw new OrderValidationError(errs.join("; "));

  const Instrument = legs.map((leg) => ({
    Product: {
      securityType: "OPTN" as const,
      symbol,
      callPut: leg.callPut,
      expiryYear: String(leg.expiryYear),
      expiryMonth: String(leg.expiryMonth),
      expiryDay: String(leg.expiryDay),
      strikePrice: String(leg.strikePrice),
    },
    orderAction: leg.orderAction,
    quantityType: "QUANTITY" as const,
    quantity: String(leg.quantity),
  }));

  const detail: OrderDetail = {
    allOrNone: String(Boolean(args.allOrNone)),
    priceType: args.priceType,
    orderTerm,
    marketSession,
    limitPrice: String(args.priceType === "NET_EVEN" ? 0 : args.limitPrice),
    Instrument,
  };

  return {
    orderType: "SPREADS",
    clientOrderId: args.clientOrderId ?? generateClientOrderId(),
    Order: [detail],
  };
}

export function buildPlaceRequest(
  preview: PreviewOrderRequest,
  previewIds: Array<{ previewId: number }>,
): PlaceOrderRequest {
  return { ...preview, PreviewIds: previewIds };
}

// ---- Response parsing (defensive; E*TRADE JSON is loosely typed) ----

export type EtradeMessage = { code?: number; type?: string; description?: string };

export type PreviewSummary = {
  previewIds: Array<{ previewId: number }>;
  estimatedTotalAmount?: number;
  estimatedCommission?: number;
  totalOrderValue?: number;
  messages: EtradeMessage[];
};

type RawMessages = { Message?: EtradeMessage[] } | undefined;

function collectMessages(holder: { messages?: RawMessages } | undefined): EtradeMessage[] {
  const m = holder?.messages?.Message;
  return Array.isArray(m) ? m : [];
}

// E*TRADE puts warnings/errors inside each Order element (Order[].messages.Message[]);
// gather from the root holder AND every Order element so multi-leg responses aren't lost.
function collectAllMessages(
  root: { messages?: RawMessages } | undefined,
  orders: Array<{ messages?: RawMessages }> | undefined,
): EtradeMessage[] {
  const out = collectMessages(root);
  if (Array.isArray(orders)) for (const o of orders) out.push(...collectMessages(o));
  return out;
}

// E*TRADE JSON is loosely typed: monetary fields can come back as numbers OR strings.
// Coerce numeric strings so a string-typed cost doesn't render as "—" on a prod preview.
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// NOTE: previewId/orderId are modeled as JS numbers. E*TRADE ids are 64-bit longs;
// an id above Number.MAX_SAFE_INTEGER (2^53-1) would lose precision in JSON.parse.
// This is fail-SAFE — a mismatched previewId is rejected by E*TRADE at place time
// (a blocked order, never a wrong fill) — but is a known limitation worth recording.
export function summarizePreviewResponse(resp: unknown): PreviewSummary {
  const r =
    (resp as { PreviewOrderResponse?: Record<string, unknown> } | undefined)?.PreviewOrderResponse ?? {};
  const rawIds = (r as { PreviewIds?: Array<{ previewId?: number }> }).PreviewIds;
  const previewIds = Array.isArray(rawIds)
    ? rawIds
        .map((p) => ({ previewId: Number(p?.previewId) }))
        .filter((p) => Number.isFinite(p.previewId))
    : [];
  const orders = (r as { Order?: Array<Record<string, unknown>> }).Order;
  const order0 = orders?.[0];
  return {
    previewIds,
    estimatedTotalAmount: num(order0?.estimatedTotalAmount),
    estimatedCommission: num(order0?.estimatedCommission),
    totalOrderValue: num((r as { totalOrderValue?: unknown }).totalOrderValue),
    messages: collectAllMessages(
      r as { messages?: RawMessages },
      orders as Array<{ messages?: RawMessages }> | undefined,
    ),
  };
}

export type PlaceSummary = { orderIds: number[]; messages: EtradeMessage[] };

export function summarizePlaceResponse(resp: unknown): PlaceSummary {
  const r =
    (resp as { PlaceOrderResponse?: Record<string, unknown> } | undefined)?.PlaceOrderResponse ?? {};
  const orders = (r as { Order?: Array<{ orderId?: number; messages?: RawMessages }> }).Order;
  const fromOrderIds = (r as { OrderIds?: Array<{ orderId?: number }> }).OrderIds;
  // E*TRADE's place response has carried the orderId under BOTH OrderIds[] and Order[]
  // across versions — read both so a real fill is never mis-classified as a failure
  // (which would tempt a duplicate re-place).
  const ids = new Set<number>();
  if (Array.isArray(fromOrderIds)) {
    for (const o of fromOrderIds) {
      const n = Number(o?.orderId);
      if (Number.isFinite(n)) ids.add(n);
    }
  }
  if (Array.isArray(orders)) {
    for (const o of orders) {
      const n = Number(o?.orderId);
      if (Number.isFinite(n)) ids.add(n);
    }
  }
  return {
    orderIds: [...ids],
    messages: collectAllMessages(r as { messages?: RawMessages }, orders),
  };
}

export type CancelSummary = { orderId?: number; cancelTime?: number; messages: EtradeMessage[] };

export function summarizeCancelResponse(resp: unknown): CancelSummary {
  const r =
    (resp as { CancelOrderResponse?: Record<string, unknown> } | undefined)?.CancelOrderResponse ?? {};
  return {
    orderId: num((r as { orderId?: unknown }).orderId),
    cancelTime: num((r as { cancelTime?: unknown }).cancelTime),
    messages: collectMessages(r as { messages?: RawMessages }),
  };
}

export function hasErrorMessage(messages: EtradeMessage[]): boolean {
  return messages.some((m) => (m.type ?? "").toUpperCase() === "ERROR");
}
