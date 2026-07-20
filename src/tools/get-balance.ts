import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";

const argsSchema = {
  accountIdKey: z.string().describe("E*TRADE accountIdKey (not accountId) from etrade_list_accounts."),
  instType: z.enum(["BROKERAGE", "IRA"]).optional().describe("Default BROKERAGE."),
  realTimeNAV: z.boolean().optional().describe("Default true."),
};

export function registerGetBalance(server: McpServer, getClient: () => EtradeClient | Error) {
  server.tool(
    "etrade_get_balance",
    "Get cash balance, buying power, and NAV for an E*TRADE account.",
    argsSchema,
    async (args) => {
      const c = getClient();
      if (c instanceof Error) return { content: [{ type: "text" as const, text: c.message }], isError: true };
      try {
        const data = await c.getBalance(args);
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
