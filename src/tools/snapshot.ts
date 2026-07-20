import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtradeClient } from "../client.js";

export type Snapshot = {
  env: "sandbox" | "prod";
  generatedAt: string;
  accounts: Array<{
    accountIdKey: string;
    accountName: string;
    accountType: string;
    balance: { totalAvailableForWithdrawal: number; cashBalance: number; netAccountValue: number };
    positions: Array<{
      symbol: string;
      quantity: number;
      pricePaid: number;
      marketValue: number;
      totalGain: number;
      totalGainPct: number;
      daysGain: number;
    }>;
    errors?: Array<{ op: "balance" | "portfolio"; error: string }>;
  }>;
  totals: { netAccountValue: number; cashBalance: number; positionsValue: number; totalGain: number };
  recentTransactions?: unknown[];
};

export type SnapshotArgs = { includeTransactions?: boolean; recentDays?: number };

export async function buildSnapshot(
  client: EtradeClient,
  env: "sandbox" | "prod",
  args: SnapshotArgs,
): Promise<Snapshot> {
  const accountsResp = (await client.listAccounts()) as {
    AccountListResponse?: { Accounts?: { Account?: Array<Record<string, unknown>> } };
  };
  const rawAccounts = accountsResp.AccountListResponse?.Accounts?.Account ?? [];

  const accounts = await Promise.all(
    rawAccounts.map(async (a) => {
      const accountIdKey = String(a.accountIdKey ?? "");
      const errors: Array<{ op: "balance" | "portfolio"; error: string }> = [];
      const balance = { totalAvailableForWithdrawal: 0, cashBalance: 0, netAccountValue: 0 };
      let positions: Snapshot["accounts"][number]["positions"] = [];

      try {
        const b = (await client.getBalance({ accountIdKey })) as {
          BalanceResponse?: {
            Computed?: {
              totalAvailableForWithdrawal?: number;
              cashBalance?: number;
              RealTimeValues?: { totalAccountValue?: number };
            };
          };
        };
        balance.totalAvailableForWithdrawal = b.BalanceResponse?.Computed?.totalAvailableForWithdrawal ?? 0;
        balance.cashBalance = b.BalanceResponse?.Computed?.cashBalance ?? 0;
        balance.netAccountValue = b.BalanceResponse?.Computed?.RealTimeValues?.totalAccountValue ?? 0;
      } catch (err) {
        errors.push({ op: "balance", error: (err as Error).message });
      }

      try {
        const p = (await client.getPortfolio({ accountIdKey })) as {
          PortfolioResponse?: { AccountPortfolio?: Array<{ Position?: Array<Record<string, unknown>> }> };
        };
        const rawPositions = p.PortfolioResponse?.AccountPortfolio?.[0]?.Position ?? [];
        positions = rawPositions.map((pos) => ({
          symbol: String((pos.Product as Record<string, unknown> | undefined)?.symbol ?? ""),
          quantity: Number(pos.quantity ?? 0),
          pricePaid: Number(pos.pricePaid ?? 0),
          marketValue: Number(pos.marketValue ?? 0),
          totalGain: Number(pos.totalGain ?? 0),
          totalGainPct: Number(pos.totalGainPct ?? 0),
          daysGain: Number(pos.daysGain ?? 0),
        }));
      } catch (err) {
        errors.push({ op: "portfolio", error: (err as Error).message });
      }

      return {
        accountIdKey,
        accountName: String(a.accountName ?? ""),
        accountType: String(a.accountType ?? ""),
        balance,
        positions,
        ...(errors.length ? { errors } : {}),
      };
    }),
  );

  const totals = accounts.reduce(
    (acc, a) => ({
      netAccountValue: acc.netAccountValue + a.balance.netAccountValue,
      cashBalance: acc.cashBalance + a.balance.cashBalance,
      positionsValue: acc.positionsValue + a.positions.reduce((s, p) => s + p.marketValue, 0),
      totalGain: acc.totalGain + a.positions.reduce((s, p) => s + p.totalGain, 0),
    }),
    { netAccountValue: 0, cashBalance: 0, positionsValue: 0, totalGain: 0 },
  );

  let recentTransactions: unknown[] | undefined;
  if (args.includeTransactions) {
    const days = args.recentDays ?? 7;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    // MMDDYYYY, NO separators — the API rejects MM/DD/YYYY with error 2004, and the catch below
    // swallowed that for every account, so includeTransactions silently returned [] (until 2026-06-11).
    const fmt = (d: Date) =>
      `${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${d.getUTCFullYear()}`;
    recentTransactions = [];
    for (const a of accounts) {
      try {
        const t = (await client.listTransactions({
          accountIdKey: a.accountIdKey,
          startDate: fmt(start),
          endDate: fmt(end),
        })) as { TransactionListResponse?: { Transaction?: unknown[] } };
        for (const tx of t.TransactionListResponse?.Transaction ?? []) {
          recentTransactions.push(tx);
        }
      } catch {
        // swallow — per-account errors are already surfaced via balance/portfolio paths
      }
    }
  }

  return {
    env,
    generatedAt: new Date().toISOString(),
    accounts,
    totals,
    ...(recentTransactions ? { recentTransactions } : {}),
  };
}

const argsSchema = {
  includeTransactions: z.boolean().optional().describe("Default false."),
  recentDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe("Default 7. Ignored unless includeTransactions=true."),
};

export function registerSnapshot(
  server: McpServer,
  env: "sandbox" | "prod",
  getClient: () => EtradeClient | Error,
) {
  server.tool(
    "etrade_snapshot",
    "Fan-out snapshot of all E*TRADE accounts: balances + positions (+ optional recent transactions).",
    argsSchema,
    async (args) => {
      const c = getClient();
      if (c instanceof Error) return { content: [{ type: "text" as const, text: c.message }], isError: true };
      try {
        const snap = await buildSnapshot(c, env, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(snap, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `snapshot failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
