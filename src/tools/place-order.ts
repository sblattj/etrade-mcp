import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";
import type { EtradeConfig } from "../env.js";
import { buildPlaceRequest, hasErrorMessage, summarizePlaceResponse } from "../orders.js";
import { takePreview } from "../order-store.js";
import { errText, okText, renderMessages, renderPlaced } from "../order-format.js";

const argsSchema = {
  previewId: z
    .number()
    .describe("The previewId returned by etrade_preview_order. Must be less than 3 minutes old."),
  confirm: z
    .literal(true)
    .describe("Must be exactly true — explicit confirmation that this order should be SENT TO MARKET (real money)."),
};

export function registerPlaceOrder(
  server: McpServer,
  cfg: EtradeConfig,
  getClient: () => EtradeClient | Error,
) {
  server.tool(
    "etrade_place_order",
    "STEP 2 — SENDS THE ORDER TO MARKET (real money in PROD). Accepts ONLY a previewId from a recent etrade_preview_order plus confirm:true. It replays the exact order that was previewed, so you can never place something that was not previewed and shown to the user first.",
    argsSchema,
    async ({ previewId, confirm }) => {
      // Defense in depth: the zod schema (confirm: z.literal(true)) already rejects
      // confirm !== true upstream; this re-check makes the guarantee explicit at the seam.
      if (confirm !== true) return errText("Order not placed: confirm must be exactly true.");

      const c = getClient();
      if (c instanceof Error) return errText(c.message);

      const pending = takePreview(previewId);
      if (!pending) {
        return errText(
          `No live preview for previewId ${previewId} (it was never previewed, already placed, or is older than 3 minutes). ` +
            `Re-run etrade_preview_order and place the fresh previewId.`,
        );
      }
      // Defense in depth: never place a sandbox-minted preview against prod (or vice-versa).
      if (pending.env !== cfg.env) {
        return errText(
          `Refusing to place: preview was minted in env=${pending.env} but this server is env=${cfg.env}.`,
        );
      }

      try {
        const placeReq = buildPlaceRequest(pending.request, pending.previewIds);
        const resp = await c.placeOrder(pending.accountIdKey, placeReq);
        const summary = summarizePlaceResponse(resp);

        if (summary.orderIds.length) {
          return okText(renderPlaced(cfg.env, pending.request, pending.accountIdKey, summary));
        }
        if (hasErrorMessage(summary.messages)) {
          // Explicit E*TRADE rejection — nothing reached the market; safe to fix and re-preview.
          return errText(
            `E*TRADE rejected the order (nothing was placed). Fix and re-preview.\n` +
              `${renderMessages(summary.messages)}\n\nRaw response:\n${JSON.stringify(resp, null, 2)}`,
          );
        }
        // No orderId AND no explicit error → status UNKNOWN. The order may have landed.
        return errText(
          `E*TRADE returned no orderId and no error — the order status is UNKNOWN and it may have reached the market. ` +
            `Run etrade_list_orders (filter by symbol) to confirm BEFORE re-previewing — re-previewing mints a NEW order id and would DUPLICATE a fill.\n\n` +
            `Raw response:\n${JSON.stringify(resp, null, 2)}`,
        );
      } catch (err) {
        // Network error / timeout / non-JSON 200: the request MAY have reached E*TRADE and filled.
        return errText(
          `E*TRADE place errored: ${(err as Error).message}. The order status is UNKNOWN — it may have reached the market. ` +
            `Run etrade_list_orders to confirm BEFORE re-previewing; re-previewing mints a NEW order id and would duplicate a fill.`,
        );
      }
    },
  );
}
