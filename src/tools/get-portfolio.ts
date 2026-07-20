import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";

const argsSchema = {
  accountIdKey: z.string(),
  count: z.number().int().min(1).max(250).optional().describe("Default 50."),
  sortBy: z.string().optional().describe("Default SYMBOL."),
  sortOrder: z.enum(["ASC", "DESC"]).optional().describe("Default ASC."),
  marketSession: z.enum(["REGULAR", "EXTENDED"]).optional().describe("Default REGULAR."),
  totalsRequired: z.boolean().optional(),
  lotsRequired: z.boolean().optional(),
  view: z.enum(["PERFORMANCE", "FUNDAMENTAL", "OPTIONSWATCH", "QUICK", "COMPLETE"]).optional()
    .describe("Default QUICK. WARNING: OPTIONSWATCH silently drops most plain-equity rows (observed 9 of 18 positions returned 2026-06-11) — use QUICK for the full book and OPTIONSWATCH only for option marks."),
};

export function registerGetPortfolio(server: McpServer, getClient: () => EtradeClient | Error) {
  server.tool(
    "etrade_get_portfolio",
    "Get current positions for an E*TRADE account.",
    argsSchema,
    async (args) => {
      const c = getClient();
      if (c instanceof Error) return { content: [{ type: "text" as const, text: c.message }], isError: true };
      try {
        const data = await c.getPortfolio(args);
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
