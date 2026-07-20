import { afterEach, describe, expect, it } from "bun:test";
import {
  clearPreviews,
  peekPreview,
  PREVIEW_TTL_MS,
  pruneExpired,
  putPreview,
  takePreview,
} from "../order-store.js";
import type { PreviewOrderRequest } from "../orders.js";

const request: PreviewOrderRequest = {
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

function put(previewId: number, nowMs: number) {
  putPreview(
    {
      previewId,
      previewIds: [{ previewId }],
      accountIdKey: "acct",
      env: "sandbox",
      request,
      summary: "preview text",
    },
    nowMs,
  );
}

afterEach(() => clearPreviews());

describe("order-store", () => {
  it("takes a fresh preview once and removes it (single-use)", () => {
    const t0 = 1_000_000;
    put(42, t0);
    const first = takePreview(42, t0 + 1000);
    expect(first?.previewId).toBe(42);
    expect(first?.request).toEqual(request);
    // Second take is empty — single-use.
    expect(takePreview(42, t0 + 1001)).toBeNull();
  });

  it("returns null for an unknown previewId", () => {
    expect(takePreview(123, 0)).toBeNull();
  });

  it("expires a preview after the TTL and still consumes it", () => {
    const t0 = 5_000_000;
    put(7, t0);
    expect(peekPreview(7, t0 + PREVIEW_TTL_MS + 1)).toBeNull(); // peek sees it as expired
    expect(takePreview(7, t0 + PREVIEW_TTL_MS + 1)).toBeNull(); // take past TTL → null
    // ...and it was removed, so a later in-window take also fails.
    expect(takePreview(7, t0)).toBeNull();
  });

  it("peek does not consume", () => {
    const t0 = 9_000_000;
    put(8, t0);
    expect(peekPreview(8, t0 + 1)?.previewId).toBe(8);
    expect(takePreview(8, t0 + 2)?.previewId).toBe(8); // still takeable
  });

  it("pruneExpired drops only stale entries", () => {
    const t0 = 2_000_000;
    put(1, t0);
    put(2, t0 + PREVIEW_TTL_MS); // newer
    pruneExpired(t0 + PREVIEW_TTL_MS + 1);
    expect(peekPreview(1, t0 + PREVIEW_TTL_MS + 1)).toBeNull();
    expect(peekPreview(2, t0 + PREVIEW_TTL_MS + 1)?.previewId).toBe(2);
  });
});
