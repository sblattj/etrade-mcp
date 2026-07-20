import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";

const argsSchema = {
  accountIdKey: z.string(),
  startDate: z.string().optional().describe("MMDDYYYY, no separators (e.g. 06112026). The API rejects MM/DD/YYYY with error 2004."),
  endDate: z.string().optional().describe("MMDDYYYY, no separators (e.g. 06112026). The API rejects MM/DD/YYYY with error 2004."),
  sortOrder: z.enum(["ASC", "DESC"]).optional().describe("Default DESC."),
  marker: z.string().optional().describe("Pagination cursor."),
  count: z.number().int().min(1).max(50).optional().describe("Default 50."),
};

export function registerListTransactions(server: McpServer, getClient: () => EtradeClient | Error) {
  server.tool(
    "etrade_list_transactions",
    "List transactions for an E*TRADE account in a date range.",
    argsSchema,
    async (args) => {
      const c = getClient();
      if (c instanceof Error) return { content: [{ type: "text" as const, text: c.message }], isError: true };
      try {
        const data = await c.listTransactions(args);
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
