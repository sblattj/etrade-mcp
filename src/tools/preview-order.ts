import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";
import type { EtradeConfig } from "../env.js";
import {
  buildPreviewRequest,
  hasErrorMessage,
  OrderValidationError,
  summarizePreviewResponse,
  type OrderArgs,
} from "../orders.js";
import { putPreview } from "../order-store.js";
import { errText, okText, renderMessages, renderPreview } from "../order-format.js";

const argsSchema = {
  accountIdKey: z
    .string()
    .describe("E*TRADE accountIdKey (the obfuscated key from etrade_list_accounts, NOT the account number)."),
  symbol: z.string().describe("Underlying ticker, e.g. PANW or MSFT (uppercased automatically)."),
  securityType: z.enum(["EQ", "OPTN"]).describe("EQ = stock/ETF. OPTN = a single option contract."),
  orderAction: z
    .enum(["BUY", "SELL", "SELL_SHORT", "BUY_TO_COVER", "BUY_OPEN", "SELL_OPEN", "BUY_CLOSE", "SELL_CLOSE"])
    .describe("EQ: BUY/SELL/SELL_SHORT/BUY_TO_COVER. OPTN: BUY_OPEN/SELL_OPEN/BUY_CLOSE/SELL_CLOSE."),
  quantity: z.number().int().positive().describe("Whole shares (EQ) or contracts (OPTN). No fractional shares."),
  priceType: z
    .enum(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"])
    .describe("LIMIT for fast-money entries/exits; STOP/STOP_LIMIT for protective stops."),
  limitPrice: z.number().finite().positive().optional().describe("Required for LIMIT and STOP_LIMIT."),
  stopPrice: z.number().finite().positive().optional().describe("Required for STOP and STOP_LIMIT."),
  orderTerm: z
    .enum(["GOOD_FOR_DAY", "GOOD_UNTIL_CANCEL", "IMMEDIATE_OR_CANCEL", "FILL_OR_KILL"])
    .optional()
    .describe("Default GOOD_FOR_DAY. MARKET orders must be GOOD_FOR_DAY."),
  marketSession: z
    .enum(["REGULAR", "EXTENDED"])
    .optional()
    .describe("Default REGULAR. EXTENDED requires LIMIT and disallows all-or-none."),
  allOrNone: z.boolean().optional().describe("All-or-none. Only valid on 300+ share orders."),
  clientOrderId: z
    .string()
    .regex(/^[A-Za-z0-9]{1,20}$/, "1-20 alphanumeric characters")
    .optional()
    .describe("Optional idempotency key (1-20 alphanumeric, unique per account). Auto-generated if omitted."),
  callPut: z.enum(["CALL", "PUT"]).optional().describe("OPTN only."),
  expiryYear: z.number().int().optional().describe("OPTN only, e.g. 2027."),
  expiryMonth: z.number().int().min(1).max(12).optional().describe("OPTN only (1-12)."),
  expiryDay: z.number().int().min(1).max(31).optional().describe("OPTN only."),
  strikePrice: z.number().finite().positive().optional().describe("OPTN only."),
};

export function registerPreviewOrder(
  server: McpServer,
  cfg: EtradeConfig,
  getClient: () => EtradeClient | Error,
) {
  server.tool(
    "etrade_preview_order",
    "STEP 1 of placing an E*TRADE order. Validates the order and returns E*TRADE's own cost/commission estimate plus a previewId. Nothing is sent to market. Show the preview to the user, then call etrade_place_order with that previewId and confirm:true within 3 minutes to execute.",
    argsSchema,
    async (args) => {
      const c = getClient();
      if (c instanceof Error) return errText(c.message);

      let request: ReturnType<typeof buildPreviewRequest>;
      try {
        request = buildPreviewRequest(args as OrderArgs);
      } catch (err) {
        if (err instanceof OrderValidationError) return errText(`Invalid order: ${err.message}`);
        throw err;
      }

      try {
        const resp = await c.previewOrder(args.accountIdKey, request);
        const summary = summarizePreviewResponse(resp);

        if (!summary.previewIds.length || hasErrorMessage(summary.messages)) {
          return errText(
            `E*TRADE rejected the preview (no usable previewId).\n${renderMessages(summary.messages)}` +
              `\n\nRaw response:\n${JSON.stringify(resp, null, 2)}`,
          );
        }

        const handle = summary.previewIds[0].previewId;
        const text = renderPreview(cfg.env, args.accountIdKey, request, summary, handle);
        putPreview({
          previewId: handle,
          previewIds: summary.previewIds,
          accountIdKey: args.accountIdKey,
          env: cfg.env,
          request,
          summary: text,
        });
        return okText(text);
      } catch (err) {
        return errText(`E*TRADE preview failed: ${(err as Error).message}`);
      }
    },
  );
}
