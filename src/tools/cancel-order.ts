import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";
import type { EtradeConfig } from "../env.js";
import { summarizeCancelResponse } from "../orders.js";
import { errText, okText, renderCanceled } from "../order-format.js";

const argsSchema = {
  accountIdKey: z.string().describe("E*TRADE accountIdKey from etrade_list_accounts."),
  orderId: z
    .number()
    .int()
    .describe("The orderId to cancel (from etrade_list_orders or an etrade_place_order confirmation)."),
  confirm: z.literal(true).describe("Must be exactly true to cancel the order."),
};

export function registerCancelOrder(
  server: McpServer,
  cfg: EtradeConfig,
  getClient: () => EtradeClient | Error,
) {
  server.tool(
    "etrade_cancel_order",
    "Cancel an open E*TRADE order by orderId. Requires confirm:true. An order already routed to or filled at market cannot be cancelled.",
    argsSchema,
    async ({ accountIdKey, orderId, confirm }) => {
      // Defense in depth: zod (confirm: z.literal(true)) already rejects confirm !== true upstream.
      if (confirm !== true) return errText("Order not cancelled: confirm must be exactly true.");

      const c = getClient();
      if (c instanceof Error) return errText(c.message);

      try {
        const resp = await c.cancelOrder(accountIdKey, orderId);
        return okText(renderCanceled(cfg.env, summarizeCancelResponse(resp)));
      } catch (err) {
        return errText(`E*TRADE cancel failed: ${(err as Error).message}`);
      }
    },
  );
}
