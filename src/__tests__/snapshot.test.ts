import { describe, expect, it } from "bun:test";
import { buildSnapshot } from "../tools/snapshot.js";
import type { EtradeClient } from "../client.js";

function stubClient(overrides: Partial<EtradeClient> = {}): EtradeClient {
  return {
    listAccounts: async () => ({}),
    getQuote: async () => ({}),
    getBalance: async () => ({}),
    getPortfolio: async () => ({}),
    listTransactions: async () => ({}),
    getTransaction: async () => ({}),
    listOrders: async () => ({}),
    previewOrder: async () => ({}),
    placeOrder: async () => ({}),
    cancelOrder: async () => ({}),
    ...overrides,
  };
}

describe("buildSnapshot", () => {
  it("merges balance + positions across two accounts and sums totals", async () => {
    const client = stubClient({
      listAccounts: async () => ({
        AccountListResponse: {
          Accounts: {
            Account: [
              { accountIdKey: "k1", accountName: "A1", accountType: "MARGIN" },
              { accountIdKey: "k2", accountName: "A2", accountType: "CASH" },
            ],
          },
        },
      }),
      getBalance: async ({ accountIdKey }) => ({
        BalanceResponse: {
          Computed: {
            totalAvailableForWithdrawal: accountIdKey === "k1" ? 1000 : 500,
            cashBalance: accountIdKey === "k1" ? 1000 : 500,
            RealTimeValues: { totalAccountValue: accountIdKey === "k1" ? 5000 : 2000 },
          },
        },
      }),
      getPortfolio: async ({ accountIdKey }) => ({
        PortfolioResponse: {
          AccountPortfolio: [
            {
              Position: [
                {
                  symbolDescription: accountIdKey === "k1" ? "AAPL INC" : "MSFT INC",
                  Product: { symbol: accountIdKey === "k1" ? "AAPL" : "MSFT" },
                  quantity: 10,
                  pricePaid: 100,
                  marketValue: accountIdKey === "k1" ? 4000 : 1500,
                  totalGain: 100,
                  totalGainPct: 2.5,
                  daysGain: 5,
                },
              ],
            },
          ],
        },
      }),
    });

    const snap = await buildSnapshot(client, "sandbox", {});

    expect(snap.env).toBe("sandbox");
    expect(snap.accounts).toHaveLength(2);
    expect(snap.totals.netAccountValue).toBe(7000);
    expect(snap.totals.cashBalance).toBe(1500);
    expect(snap.totals.positionsValue).toBe(5500);
    expect(snap.accounts[0].positions[0].symbol).toBe("AAPL");
    expect(snap.accounts[1].positions[0].symbol).toBe("MSFT");
  });

  it("captures per-account errors instead of throwing", async () => {
    const client = stubClient({
      listAccounts: async () => ({
        AccountListResponse: {
          Accounts: { Account: [{ accountIdKey: "k1", accountName: "A1", accountType: "MARGIN" }] },
        },
      }),
      getBalance: async () => { throw new Error("balance boom"); },
      getPortfolio: async () => { throw new Error("portfolio boom"); },
    });

    const snap = await buildSnapshot(client, "sandbox", {});
    expect(snap.accounts[0].errors).toEqual([
      { op: "balance", error: "balance boom" },
      { op: "portfolio", error: "portfolio boom" },
    ]);
    expect(snap.accounts[0].positions).toEqual([]);
    expect(snap.totals.netAccountValue).toBe(0);
  });

  it("includes recent transactions when requested", async () => {
    const client = stubClient({
      listAccounts: async () => ({
        AccountListResponse: {
          Accounts: { Account: [{ accountIdKey: "k1", accountName: "A1", accountType: "MARGIN" }] },
        },
      }),
      listTransactions: async () => ({
        TransactionListResponse: { Transaction: [{ transactionId: 1, description: "BOUGHT AAPL" }] },
      }),
    });

    const snap = await buildSnapshot(client, "sandbox", { includeTransactions: true, recentDays: 7 });
    expect(snap.recentTransactions).toHaveLength(1);
  });
});
