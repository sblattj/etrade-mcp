import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";

const argsSchema = {
  accountIdKey: z.string(),
  transactionId: z.string(),
};

export function registerGetTransaction(server: McpServer, getClient: () => EtradeClient | Error) {
  server.tool(
    "etrade_get_transaction",
    "Get detail for a specific E*TRADE transaction.",
    argsSchema,
    async (args) => {
      const c = getClient();
      if (c instanceof Error) return { content: [{ type: "text" as const, text: c.message }], isError: true };
      try {
        const data = await c.getTransaction(args);
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
