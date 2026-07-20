/**
 * Pure presentation helpers for the order tools. Kept separate from wiring so
 * the receipts can be unit-tested and so every order tool renders consistently.
 */
import type {
  CancelSummary,
  EtradeMessage,
  PlaceSummary,
  PreviewOrderRequest,
  PreviewSummary,
} from "./orders.js";

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function okText(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }] };
}

export function errText(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function usd(n?: number): string {
  if (n === undefined) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function envBadge(env: "sandbox" | "prod"): string {
  return env === "prod" ? "⚠️ PROD (real money)" : "🧪 SANDBOX (canned data — fills not real)";
}

export function renderMessages(messages: EtradeMessage[]): string {
  if (!messages.length) return "";
  const lines = messages.map((m) => {
    const tag = [m.type, m.code].filter((x) => x !== undefined && x !== "").join(" ");
    return `  • ${tag ? `[${tag}] ` : ""}${m.description ?? ""}`.trimEnd();
  });
  return lines.join("\n");
}

/** Format a price string (e.g. "42.5") as "$42.50"; falls back to the raw value if non-numeric. */
function money(s?: string): string {
  const n = Number(s);
  return Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${s}`;
}

type LegInstrument = PreviewOrderRequest["Order"][number]["Instrument"][number];

/** "BUY_OPEN 1 SOXX 7/17/2026 $630 CALL" or "BUY 10 PANW" — action + qty + instrument, no price. */
function legText(inst: LegInstrument): string {
  const p = inst.Product;
  const instrument =
    p.securityType === "OPTN"
      ? `${p.symbol} ${p.expiryMonth}/${p.expiryDay}/${p.expiryYear} $${p.strikePrice} ${p.callPut}`
      : p.symbol;
  return `${inst.orderAction} ${inst.quantity} ${instrument}`;
}

/** "NET_DEBIT $15.35" / "NET_CREDIT $2.10" / "NET_EVEN" — the net price label for a spread. */
function spreadPriceLabel(priceType: string, limitPrice?: string): string {
  return priceType === "NET_EVEN" ? "NET_EVEN" : `${priceType} ${money(limitPrice)}`;
}

/** Plain-English description of an order from its transport envelope (multi-line for spreads). */
export function describeOrder(request: PreviewOrderRequest): string {
  const d = request.Order[0];
  const inst = d?.Instrument[0];
  if (!d || !inst) return "(unparseable order)";
  const aon = d.allOrNone === "true" ? " · AON" : "";

  // Multi-leg option spread (SPREADS orderType / >1 leg): a header with the net
  // price, then one line per leg. Keeps single-leg output byte-identical below.
  if (request.orderType === "SPREADS" || d.Instrument.length > 1) {
    const header = `SPREAD (${spreadPriceLabel(d.priceType, d.limitPrice)}) · ${d.orderTerm} · ${d.marketSession}${aon}`;
    return [header, ...d.Instrument.map((leg) => `  ${legText(leg)}`)].join("\n");
  }

  const price =
    d.priceType === "MARKET"
      ? "MARKET"
      : d.priceType === "LIMIT"
        ? `LIMIT ${money(d.limitPrice)}`
        : d.priceType === "STOP"
          ? `STOP ${money(d.stopPrice)}`
          : `STOP_LIMIT stop ${money(d.stopPrice)} / limit ${money(d.limitPrice)}`;
  return `${legText(inst)} @ ${price} · ${d.orderTerm} · ${d.marketSession}${aon}`;
}

export function renderPreview(
  env: "sandbox" | "prod",
  accountIdKey: string,
  request: PreviewOrderRequest,
  summary: PreviewSummary,
  handle: number,
): string {
  const warnings = renderMessages(summary.messages);
  return [
    `${envBadge(env)} — E*TRADE order PREVIEW (nothing has been sent)`,
    ``,
    `  ${describeOrder(request)}`,
    `  account ${accountIdKey} · clientOrderId ${request.clientOrderId}`,
    ``,
    `  Estimated total:      ${usd(summary.estimatedTotalAmount ?? summary.totalOrderValue)}`,
    `  Estimated commission: ${usd(summary.estimatedCommission)}`,
    ...(warnings ? [``, `E*TRADE messages:`, warnings] : []),
    ``,
    `➡ To execute, within 3 minutes:`,
    `   etrade_place_order { "previewId": ${handle}, "confirm": true }`,
  ].join("\n");
}

export function renderPlaced(
  env: "sandbox" | "prod",
  request: PreviewOrderRequest,
  accountIdKey: string,
  summary: PlaceSummary,
): string {
  const msgs = renderMessages(summary.messages);
  return [
    `✅ ${envBadge(env)} — E*TRADE order PLACED`,
    ``,
    `  ${describeOrder(request)}`,
    `  account ${accountIdKey} · orderId ${summary.orderIds.join(", ") || "(none returned)"}`,
    ...(msgs ? [``, `E*TRADE messages:`, msgs] : []),
    ``,
    `Next: confirm the fill with etrade_list_orders, then place the paired stop (the API has no native bracket/OCO — exits are separate orders).`,
  ].join("\n");
}

export function renderCanceled(env: "sandbox" | "prod", summary: CancelSummary): string {
  const msgs = renderMessages(summary.messages);
  return [
    `${envBadge(env)} — E*TRADE cancel request`,
    `  orderId ${summary.orderId ?? "(none)"}` +
      (summary.cancelTime ? ` · cancelTime ${new Date(summary.cancelTime).toISOString()}` : ""),
    ...(msgs ? [``, `E*TRADE messages:`, msgs] : []),
  ].join("\n");
}
