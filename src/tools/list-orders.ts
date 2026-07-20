import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";

const argsSchema = {
  accountIdKey: z.string().describe("E*TRADE accountIdKey from etrade_list_accounts."),
  status: z
    .enum([
      "OPEN",
      "EXECUTED",
      "CANCELLED",
      "INDIVIDUAL_FILLS",
      "CANCEL_REQUESTED",
      "EXPIRED",
      "REJECTED",
    ])
    .optional()
    .describe("Filter by order status, e.g. OPEN to see working orders or EXECUTED to confirm fills."),
  count: z.number().int().min(1).max(100).optional().describe("Default 25, max 100."),
  symbol: z.string().optional().describe("Filter to a single underlying symbol."),
  marker: z.string().optional().describe("Pagination marker from a prior response."),
};

export function registerListOrders(server: McpServer, getClient: () => EtradeClient | Error) {
  server.tool(
    "etrade_list_orders",
    "List orders for an E*TRADE account (read-only). Use status=OPEN to see working orders or status=EXECUTED to confirm a fill before placing a paired stop.",
    argsSchema,
    async (args) => {
      const c = getClient();
      if (c instanceof Error)
        return { content: [{ type: "text" as const, text: c.message }], isError: true };
      try {
        const data = await c.listOrders(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `E*TRADE call failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
