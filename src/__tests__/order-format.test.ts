import { describe, expect, it } from "bun:test";
import {
  describeOrder,
  envBadge,
  renderMessages,
  renderPlaced,
  renderPreview,
} from "../order-format.js";
import { buildPreviewRequest, buildSpreadPreviewRequest } from "../orders.js";

const equity = buildPreviewRequest({
  symbol: "PANW",
  securityType: "EQ",
  orderAction: "BUY",
  quantity: 10,
  priceType: "LIMIT",
  limitPrice: 281.69,
  clientOrderId: "c1",
});

const option = buildPreviewRequest({
  symbol: "MSFT",
  securityType: "OPTN",
  orderAction: "BUY_OPEN",
  quantity: 1,
  priceType: "LIMIT",
  limitPrice: 42.5,
  callPut: "CALL",
  expiryYear: 2027,
  expiryMonth: 1,
  expiryDay: 15,
  strikePrice: 500,
  clientOrderId: "c2",
});

describe("describeOrder", () => {
  it("renders an equity limit order in plain English", () => {
    expect(describeOrder(equity)).toBe("BUY 10 PANW @ LIMIT $281.69 · GOOD_FOR_DAY · REGULAR");
  });

  it("renders an option order with expiry and strike", () => {
    expect(describeOrder(option)).toBe(
      "BUY_OPEN 1 MSFT 1/15/2027 $500 CALL @ LIMIT $42.50 · GOOD_FOR_DAY · REGULAR",
    );
  });

  it("renders a multi-leg spread as a header plus one line per leg", () => {
    const spread = buildSpreadPreviewRequest({
      symbol: "SOXX",
      priceType: "NET_DEBIT",
      limitPrice: 15.35,
      clientOrderId: "s1",
      legs: [
        { orderAction: "BUY_OPEN", quantity: 1, callPut: "CALL", expiryYear: 2026, expiryMonth: 7, expiryDay: 17, strikePrice: 630 },
        { orderAction: "SELL_OPEN", quantity: 1, callPut: "CALL", expiryYear: 2026, expiryMonth: 7, expiryDay: 17, strikePrice: 660 },
      ],
    });
    expect(describeOrder(spread)).toBe(
      [
        "SPREAD (NET_DEBIT $15.35) · GOOD_FOR_DAY · REGULAR",
        "  BUY_OPEN 1 SOXX 7/17/2026 $630 CALL",
        "  SELL_OPEN 1 SOXX 7/17/2026 $660 CALL",
      ].join("\n"),
    );
  });
});

describe("envBadge", () => {
  it("loudly marks prod as real money", () => {
    expect(envBadge("prod")).toContain("PROD");
    expect(envBadge("prod")).toContain("real money");
    expect(envBadge("sandbox")).toContain("SANDBOX");
  });
});

describe("renderPreview", () => {
  it("includes the cost, the previewId, and the exact place call", () => {
    const text = renderPreview(
      "prod",
      "acctKey",
      equity,
      {
        previewIds: [{ previewId: 999 }],
        estimatedTotalAmount: 2816.9,
        estimatedCommission: 0,
        messages: [],
      },
      999,
    );
    expect(text).toContain("PROD");
    expect(text).toContain("BUY 10 PANW");
    expect(text).toContain("$2,816.90");
    expect(text).toContain('"previewId": 999');
    expect(text).toContain('"confirm": true');
    expect(text).toContain("3 minutes");
  });
});

describe("renderPlaced", () => {
  it("shows the orderId and the pair-with-stop reminder", () => {
    const text = renderPlaced("prod", equity, "acctKey", { orderIds: [12345], messages: [] });
    expect(text).toContain("PLACED");
    expect(text).toContain("orderId 12345");
    expect(text).toContain("paired stop");
  });
});

describe("renderMessages", () => {
  it("tags type and code", () => {
    expect(renderMessages([{ type: "WARNING", code: 1042, description: "heads up" }])).toContain(
      "[WARNING 1042] heads up",
    );
  });

  it("is empty for no messages", () => {
    expect(renderMessages([])).toBe("");
  });
});
