import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";

export function registerListAccounts(server: McpServer, getClient: () => EtradeClient | Error) {
  server.tool(
    "etrade_list_accounts",
    "List all E*TRADE accounts for the authenticated user.",
    {},
    async () => {
      const clientOrError = getClient();
      if (clientOrError instanceof Error) {
        return { content: [{ type: "text" as const, text: clientOrError.message }], isError: true };
      }
      try {
        const data = await clientOrError.listAccounts();
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
