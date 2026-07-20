import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";
import type { EtradeConfig } from "../env.js";
import {
  buildSpreadPreviewRequest,
  hasErrorMessage,
  OrderValidationError,
  type SpreadOrderArgs,
  summarizePreviewResponse,
} from "../orders.js";
import { putPreview } from "../order-store.js";
import { errText, okText, renderMessages, renderPreview } from "../order-format.js";

const legSchema = z.object({
  orderAction: z
    .enum(["BUY_OPEN", "SELL_OPEN", "BUY_CLOSE", "SELL_CLOSE"])
    .describe("Per-leg action. A debit vertical = BUY_OPEN the long strike + SELL_OPEN the short strike."),
  quantity: z.number().int().positive().describe("Contracts for this leg (whole number)."),
  callPut: z.enum(["CALL", "PUT"]),
  expiryYear: z.number().int().describe("e.g. 2026."),
  expiryMonth: z.number().int().min(1).max(12),
  expiryDay: z.number().int().min(1).max(31),
  strikePrice: z.number().finite().positive(),
});

const argsSchema = {
  accountIdKey: z
    .string()
    .describe("E*TRADE accountIdKey (the obfuscated key from etrade_list_accounts, NOT the account number)."),
  symbol: z
    .string()
    .describe("The shared underlying ticker for EVERY leg, e.g. SOXX (uppercased automatically)."),
  legs: z
    .array(legSchema)
    .min(2)
    .max(4)
    .describe(
      "2-4 option legs of ONE multi-leg spread on the same underlying — e.g. a defined-risk vertical " +
        "(BUY_OPEN the long strike + SELL_OPEN the short strike). Each leg must be a distinct contract.",
    ),
  priceType: z
    .enum(["NET_DEBIT", "NET_CREDIT", "NET_EVEN"])
    .describe(
      "Net price basis. NET_DEBIT = a debit spread you pay for; NET_CREDIT = a credit spread you receive; NET_EVEN = zero net.",
    ),
  limitPrice: z
    .number()
    .finite()
    .positive()
    .optional()
    .describe("The NET debit/credit per spread (positive). Required for NET_DEBIT/NET_CREDIT; omit for NET_EVEN."),
  orderTerm: z
    .enum(["GOOD_FOR_DAY", "GOOD_UNTIL_CANCEL", "IMMEDIATE_OR_CANCEL", "FILL_OR_KILL"])
    .optional()
    .describe("Default GOOD_FOR_DAY."),
  allOrNone: z
    .boolean()
    .optional()
    .describe("All-or-none. A spread typically fills as a single unit; this is unrelated to the 300-share equity rule."),
  clientOrderId: z
    .string()
    .regex(/^[A-Za-z0-9]{1,20}$/, "1-20 alphanumeric characters")
    .optional()
    .describe("Optional idempotency key (1-20 alphanumeric, unique per account). Auto-generated if omitted."),
};

export function registerPreviewSpread(
  server: McpServer,
  cfg: EtradeConfig,
  getClient: () => EtradeClient | Error,
) {
  server.tool(
    "etrade_preview_spread",
    "STEP 1 for a MULTI-LEG OPTION SPREAD (e.g. a defined-risk vertical). Validates a 2-4 leg spread on a single " +
      "underlying and returns E*TRADE's NET cost/commission estimate plus a previewId. Nothing is sent to market. " +
      "Then call etrade_place_order with that previewId and confirm:true within 3 minutes — the SAME place tool " +
      "executes single-leg and spread previews. Use etrade_preview_order for a single option or equity.",
    argsSchema,
    async (args) => {
      const c = getClient();
      if (c instanceof Error) return errText(c.message);

      let request: ReturnType<typeof buildSpreadPreviewRequest>;
      try {
        request = buildSpreadPreviewRequest(args as SpreadOrderArgs);
      } catch (err) {
        if (err instanceof OrderValidationError) return errText(`Invalid spread: ${err.message}`);
        throw err;
      }

      try {
        const resp = await c.previewOrder(args.accountIdKey, request);
        const summary = summarizePreviewResponse(resp);

        if (!summary.previewIds.length || hasErrorMessage(summary.messages)) {
          return errText(
            `E*TRADE rejected the spread preview (no usable previewId).\n${renderMessages(summary.messages)}` +
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
        return errText(`E*TRADE spread preview failed: ${(err as Error).message}`);
      }
    },
  );
}
