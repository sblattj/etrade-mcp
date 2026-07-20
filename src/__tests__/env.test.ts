import { describe, expect, it } from "bun:test";
import { loadEnv } from "../env.js";

describe("loadEnv", () => {
  it("returns sandbox config when ETRADE_ENV=sandbox", () => {
    const cfg = loadEnv({
      ETRADE_ENV: "sandbox",
      ETRADE_SANDBOX_API_KEY: "sk",
      ETRADE_SANDBOX_API_KEY_SECRET: "ss",
      ETRADE_PROD_API_KEY: "pk",
      ETRADE_PROD_API_SECRET: "ps",
    });
    expect(cfg.env).toBe("sandbox");
    expect(cfg.consumerKey).toBe("sk");
    expect(cfg.consumerSecret).toBe("ss");
    expect(cfg.apiBaseUrl).toBe("https://apisb.etrade.com");
  });

  it("returns prod config when ETRADE_ENV=prod", () => {
    const cfg = loadEnv({
      ETRADE_ENV: "prod",
      ETRADE_SANDBOX_API_KEY: "sk",
      ETRADE_SANDBOX_API_KEY_SECRET: "ss",
      ETRADE_PROD_API_KEY: "pk",
      ETRADE_PROD_API_SECRET: "ps",
    });
    expect(cfg.env).toBe("prod");
    expect(cfg.consumerKey).toBe("pk");
    expect(cfg.consumerSecret).toBe("ps");
    expect(cfg.apiBaseUrl).toBe("https://api.etrade.com");
  });

  it("defaults to prod when ETRADE_ENV is unset", () => {
    const cfg = loadEnv({
      ETRADE_PROD_API_KEY: "pk",
      ETRADE_PROD_API_SECRET: "ps",
    });
    expect(cfg.env).toBe("prod");
    expect(cfg.apiBaseUrl).toBe("https://api.etrade.com");
  });

  it("throws when the required credentials for the chosen env are missing", () => {
    expect(() => loadEnv({ ETRADE_ENV: "prod" })).toThrow(/ETRADE_PROD_API_KEY/);
  });

  it("leaves order placement disabled by default", () => {
    const cfg = loadEnv({
      ETRADE_ENV: "sandbox",
      ETRADE_SANDBOX_API_KEY: "sk",
      ETRADE_SANDBOX_API_KEY_SECRET: "ss",
    });
    expect(cfg.allowOrders).toBe(false);
  });

  it("enables order placement only when ETRADE_ALLOW_ORDERS=1", () => {
    const base = {
      ETRADE_ENV: "sandbox",
      ETRADE_SANDBOX_API_KEY: "sk",
      ETRADE_SANDBOX_API_KEY_SECRET: "ss",
    };
    expect(loadEnv({ ...base, ETRADE_ALLOW_ORDERS: "1" }).allowOrders).toBe(true);
    expect(loadEnv({ ...base, ETRADE_ALLOW_ORDERS: "true" }).allowOrders).toBe(false);
    expect(loadEnv({ ...base, ETRADE_ALLOW_ORDERS: "0" }).allowOrders).toBe(false);
  });
});
