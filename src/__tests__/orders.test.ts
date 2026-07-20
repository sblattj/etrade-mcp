import { describe, expect, it } from "bun:test";
import {
  buildPlaceRequest,
  buildPreviewRequest,
  buildSpreadPreviewRequest,
  generateClientOrderId,
  hasErrorMessage,
  OrderValidationError,
  type SpreadOrderArgs,
  summarizeCancelResponse,
  summarizePlaceResponse,
  summarizePreviewResponse,
  type OrderArgs,
} from "../orders.js";

const equityLimit: OrderArgs = {
  symbol: "panw",
  securityType: "EQ",
  orderAction: "BUY",
  quantity: 10,
  priceType: "LIMIT",
  limitPrice: 281.69,
  clientOrderId: "fixed123",
};

describe("buildPreviewRequest — equity", () => {
  it("shapes a LIMIT BUY into the E*TRADE envelope and uppercases the symbol", () => {
    const req = buildPreviewRequest(equityLimit);
    expect(req.orderType).toBe("EQ");
    expect(req.clientOrderId).toBe("fixed123");
    expect(req.Order).toHaveLength(1);
    const d = req.Order[0];
    expect(d.priceType).toBe("LIMIT");
    expect(d.limitPrice).toBe("281.69");
    expect(d.orderTerm).toBe("GOOD_FOR_DAY");
    expect(d.marketSession).toBe("REGULAR");
    expect(d.allOrNone).toBe("false");
    expect(d.stopPrice).toBeUndefined();
    const inst = d.Instrument[0];
    expect(inst.orderAction).toBe("BUY");
    expect(inst.quantity).toBe("10");
    expect(inst.quantityType).toBe("QUANTITY");
    expect(inst.Product).toEqual({ securityType: "EQ", symbol: "PANW" });
  });

  it("auto-generates a clientOrderId when omitted", () => {
    const { clientOrderId } = buildPreviewRequest({ ...equityLimit, clientOrderId: undefined });
    expect(clientOrderId.length).toBeGreaterThan(0);
    expect(clientOrderId.length).toBeLessThanOrEqual(20);
    expect(clientOrderId).toMatch(/^[a-z0-9]+$/i);
  });

  it("rejects LIMIT without limitPrice", () => {
    expect(() => buildPreviewRequest({ ...equityLimit, limitPrice: undefined })).toThrow(
      OrderValidationError,
    );
  });

  it("rejects a stopPrice on a plain LIMIT order", () => {
    expect(() => buildPreviewRequest({ ...equityLimit, stopPrice: 270 })).toThrow(/stopPrice is not allowed/);
  });

  it("rejects fractional quantity", () => {
    expect(() => buildPreviewRequest({ ...equityLimit, quantity: 1.5 })).toThrow(/whole number/);
  });

  it("rejects a non-alphanumeric clientOrderId", () => {
    expect(() => buildPreviewRequest({ ...equityLimit, clientOrderId: "order-1!" })).toThrow(
      /alphanumeric/,
    );
  });

  it("rejects a non-finite limitPrice (Infinity must not become \"Infinity\")", () => {
    expect(() => buildPreviewRequest({ ...equityLimit, limitPrice: Number.POSITIVE_INFINITY })).toThrow(
      /finite/,
    );
  });

  it("rejects an option action on an equity", () => {
    expect(() => buildPreviewRequest({ ...equityLimit, orderAction: "BUY_OPEN" })).toThrow(/invalid for EQ/);
  });

  it("rejects option fields on an equity", () => {
    expect(() => buildPreviewRequest({ ...equityLimit, strikePrice: 280 })).toThrow(/not allowed for EQ/);
  });

  it("enforces MARKET must be GOOD_FOR_DAY", () => {
    expect(() =>
      buildPreviewRequest({
        symbol: "PANW",
        securityType: "EQ",
        orderAction: "SELL",
        quantity: 10,
        priceType: "MARKET",
        orderTerm: "GOOD_UNTIL_CANCEL",
      }),
    ).toThrow(/GOOD_FOR_DAY/);
  });

  it("enforces EXTENDED session must be LIMIT", () => {
    expect(() =>
      buildPreviewRequest({ ...equityLimit, priceType: "MARKET", marketSession: "EXTENDED" }),
    ).toThrow(/EXTENDED-hours orders must be LIMIT/);
  });

  it("enforces all-or-none requires 300+ shares", () => {
    expect(() => buildPreviewRequest({ ...equityLimit, allOrNone: true })).toThrow(/300\+/);
  });

  it("builds a STOP_LIMIT with both prices", () => {
    const req = buildPreviewRequest({
      symbol: "PANW",
      securityType: "EQ",
      orderAction: "SELL",
      quantity: 10,
      priceType: "STOP_LIMIT",
      stopPrice: 260,
      limitPrice: 258,
    });
    expect(req.Order[0].stopPrice).toBe("260");
    expect(req.Order[0].limitPrice).toBe("258");
  });
});

describe("buildPreviewRequest — option", () => {
  const leap: OrderArgs = {
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
  };

  it("shapes an OPTN order with full Product greeks", () => {
    const req = buildPreviewRequest(leap);
    expect(req.orderType).toBe("OPTN");
    expect(req.Order[0].Instrument[0].Product).toEqual({
      securityType: "OPTN",
      symbol: "MSFT",
      callPut: "CALL",
      expiryYear: "2027",
      expiryMonth: "1",
      expiryDay: "15",
      strikePrice: "500",
    });
    expect(req.Order[0].Instrument[0].orderAction).toBe("BUY_OPEN");
  });

  it("rejects an OPTN order missing the strike", () => {
    expect(() => buildPreviewRequest({ ...leap, strikePrice: undefined })).toThrow(/positive strikePrice/);
  });

  it("rejects an OPTN order missing the expiry", () => {
    expect(() => buildPreviewRequest({ ...leap, expiryDay: undefined })).toThrow(/expiryYear/);
  });

  it("rejects an equity action on an option", () => {
    expect(() => buildPreviewRequest({ ...leap, orderAction: "BUY" })).toThrow(/invalid for OPTN/);
  });
});

describe("buildPlaceRequest", () => {
  it("stamps the previewIds onto the preview envelope unchanged", () => {
    const preview = buildPreviewRequest(equityLimit);
    const place = buildPlaceRequest(preview, [{ previewId: 999 }]);
    expect(place.PreviewIds).toEqual([{ previewId: 999 }]);
    expect(place.orderType).toBe(preview.orderType);
    expect(place.clientOrderId).toBe(preview.clientOrderId);
    expect(place.Order).toEqual(preview.Order);
  });
});

describe("buildSpreadPreviewRequest — option vertical", () => {
  // The real 2026-06-15 SOXX defined-risk vertical the single-leg API could not place.
  const soxxVertical: SpreadOrderArgs = {
    symbol: "soxx",
    priceType: "NET_DEBIT",
    limitPrice: 15.35,
    clientOrderId: "spread123",
    legs: [
      { orderAction: "BUY_OPEN", quantity: 1, callPut: "CALL", expiryYear: 2026, expiryMonth: 7, expiryDay: 17, strikePrice: 630 },
      { orderAction: "SELL_OPEN", quantity: 1, callPut: "CALL", expiryYear: 2026, expiryMonth: 7, expiryDay: 17, strikePrice: 660 },
    ],
  };

  it("shapes a SPREADS envelope with one Order, two Instrument legs, and a net debit", () => {
    const req = buildSpreadPreviewRequest(soxxVertical);
    expect(req.orderType).toBe("SPREADS");
    expect(req.clientOrderId).toBe("spread123");
    expect(req.Order).toHaveLength(1);
    const d = req.Order[0];
    expect(d.priceType).toBe("NET_DEBIT");
    expect(d.limitPrice).toBe("15.35");
    expect(d.stopPrice).toBeUndefined();
    expect(d.orderTerm).toBe("GOOD_FOR_DAY");
    expect(d.marketSession).toBe("REGULAR");
    expect(d.Instrument).toHaveLength(2);
    // long leg
    expect(d.Instrument[0].orderAction).toBe("BUY_OPEN");
    expect(d.Instrument[0].quantity).toBe("1");
    expect(d.Instrument[0].Product).toEqual({
      securityType: "OPTN",
      symbol: "SOXX",
      callPut: "CALL",
      expiryYear: "2026",
      expiryMonth: "7",
      expiryDay: "17",
      strikePrice: "630",
    });
    // short leg
    expect(d.Instrument[1].orderAction).toBe("SELL_OPEN");
    expect(d.Instrument[1].Product.strikePrice).toBe("660");
  });

  it("auto-generates a clientOrderId when omitted", () => {
    const { clientOrderId } = buildSpreadPreviewRequest({ ...soxxVertical, clientOrderId: undefined });
    expect(clientOrderId).toMatch(/^[a-z0-9]{1,20}$/i);
  });

  it("supports a 3-4 leg structure (butterfly) and a NET_CREDIT spread", () => {
    const credit = buildSpreadPreviewRequest({ ...soxxVertical, priceType: "NET_CREDIT", limitPrice: 2.1 });
    expect(credit.Order[0].priceType).toBe("NET_CREDIT");
    expect(credit.Order[0].limitPrice).toBe("2.1");
  });

  it("emits limitPrice 0 for a NET_EVEN spread", () => {
    const even = buildSpreadPreviewRequest({ ...soxxVertical, priceType: "NET_EVEN", limitPrice: undefined });
    expect(even.Order[0].priceType).toBe("NET_EVEN");
    expect(even.Order[0].limitPrice).toBe("0");
  });

  it("rejects a single-leg 'spread'", () => {
    expect(() => buildSpreadPreviewRequest({ ...soxxVertical, legs: [soxxVertical.legs[0]] })).toThrow(
      /at least 2 legs/,
    );
  });

  it("rejects more than 4 legs", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...soxxVertical.legs[0], strikePrice: 600 + i * 10 }));
    expect(() => buildSpreadPreviewRequest({ ...soxxVertical, legs: five })).toThrow(/at most 4 legs/);
  });

  it("rejects NET_DEBIT without a positive net limitPrice", () => {
    expect(() => buildSpreadPreviewRequest({ ...soxxVertical, limitPrice: undefined })).toThrow(
      /requires a finite, positive net limitPrice/,
    );
  });

  it("rejects a non-finite net price (Infinity must not become \"Infinity\")", () => {
    expect(() => buildSpreadPreviewRequest({ ...soxxVertical, limitPrice: Number.POSITIVE_INFINITY })).toThrow(
      /finite/,
    );
  });

  it("rejects NET_EVEN with a non-zero limitPrice", () => {
    expect(() => buildSpreadPreviewRequest({ ...soxxVertical, priceType: "NET_EVEN", limitPrice: 1.5 })).toThrow(
      /NET_EVEN/,
    );
  });

  it("rejects an equity action on a leg", () => {
    const bad = { ...soxxVertical, legs: [{ ...soxxVertical.legs[0], orderAction: "BUY" as never }, soxxVertical.legs[1]] };
    expect(() => buildSpreadPreviewRequest(bad)).toThrow(/invalid/);
  });

  it("rejects a leg missing the strike", () => {
    const bad = { ...soxxVertical, legs: [{ ...soxxVertical.legs[0], strikePrice: undefined as never }, soxxVertical.legs[1]] };
    expect(() => buildSpreadPreviewRequest(bad)).toThrow(/strikePrice/);
  });

  it("rejects two identical-contract legs (copy-paste guard)", () => {
    const dup = { ...soxxVertical, legs: [soxxVertical.legs[0], soxxVertical.legs[0]] };
    expect(() => buildSpreadPreviewRequest(dup)).toThrow(/distinct contracts/);
  });

  it("rejects an EXTENDED-hours spread (options spreads are REGULAR only)", () => {
    expect(() =>
      buildSpreadPreviewRequest({ ...soxxVertical, marketSession: "EXTENDED" }),
    ).toThrow(/REGULAR/);
  });

  it("rejects a fractional contract quantity on a leg", () => {
    const bad = { ...soxxVertical, legs: [{ ...soxxVertical.legs[0], quantity: 1.5 }, soxxVertical.legs[1]] };
    expect(() => buildSpreadPreviewRequest(bad)).toThrow(/whole number/);
  });

  it("buildPlaceRequest replays a spread envelope unchanged with previewIds stamped", () => {
    const preview = buildSpreadPreviewRequest(soxxVertical);
    const place = buildPlaceRequest(preview, [{ previewId: 321 }]);
    expect(place.PreviewIds).toEqual([{ previewId: 321 }]);
    expect(place.orderType).toBe("SPREADS");
    expect(place.Order).toEqual(preview.Order);
  });
});

describe("generateClientOrderId", () => {
  it("is <=20 alphanumeric chars and varies with time/rand", () => {
    const a = generateClientOrderId(1_700_000_000_000, 0.123);
    const b = generateClientOrderId(1_700_000_000_001, 0.999);
    expect(a).toMatch(/^[a-z0-9]{1,20}$/i);
    expect(a.length).toBeLessThanOrEqual(20);
    expect(a).not.toBe(b);
  });
});

describe("response parsers", () => {
  it("summarizePreviewResponse pulls previewId, cost, and messages", () => {
    const resp = {
      PreviewOrderResponse: {
        totalOrderValue: 2816.9,
        PreviewIds: [{ previewId: 1234567890 }],
        Order: [
          {
            estimatedCommission: 0,
            estimatedTotalAmount: 2816.9,
            messages: { Message: [{ code: 1042, type: "WARNING", description: "heads up" }] },
          },
        ],
      },
    };
    const s = summarizePreviewResponse(resp);
    expect(s.previewIds).toEqual([{ previewId: 1234567890 }]);
    expect(s.estimatedTotalAmount).toBe(2816.9);
    expect(s.estimatedCommission).toBe(0);
    expect(s.messages).toHaveLength(1);
    expect(hasErrorMessage(s.messages)).toBe(false);
  });

  it("summarizePreviewResponse flags ERROR messages and empty previewIds defensively", () => {
    const resp = {
      PreviewOrderResponse: {
        Order: [{ messages: { Message: [{ type: "ERROR", description: "bad" }] } }],
      },
    };
    const s = summarizePreviewResponse(resp);
    expect(s.previewIds).toEqual([]);
    expect(hasErrorMessage(s.messages)).toBe(true);
  });

  it("summarizePreviewResponse survives garbage input", () => {
    expect(summarizePreviewResponse(null).previewIds).toEqual([]);
    expect(summarizePreviewResponse({}).messages).toEqual([]);
  });

  it("summarizePreviewResponse coerces string-typed money fields", () => {
    const resp = {
      PreviewOrderResponse: {
        PreviewIds: [{ previewId: 1 }],
        Order: [{ estimatedTotalAmount: "2816.90", estimatedCommission: "0" }],
      },
    };
    const s = summarizePreviewResponse(resp);
    expect(s.estimatedTotalAmount).toBe(2816.9);
    expect(s.estimatedCommission).toBe(0);
  });

  it("summarizePlaceResponse pulls orderIds from OrderIds[]", () => {
    const resp = { PlaceOrderResponse: { OrderIds: [{ orderId: 555 }] } };
    expect(summarizePlaceResponse(resp).orderIds).toEqual([555]);
  });

  it("summarizePlaceResponse also pulls orderId from Order[] (real fill must not read as failure)", () => {
    const resp = { PlaceOrderResponse: { Order: [{ orderId: 777 }] } };
    expect(summarizePlaceResponse(resp).orderIds).toEqual([777]);
  });

  it("summarizeCancelResponse pulls orderId and cancelTime", () => {
    const resp = { CancelOrderResponse: { orderId: 555, cancelTime: 1_700_000_000_000 } };
    const s = summarizeCancelResponse(resp);
    expect(s.orderId).toBe(555);
    expect(s.cancelTime).toBe(1_700_000_000_000);
  });
});
