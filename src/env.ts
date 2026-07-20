export type EtradeEnv = "sandbox" | "prod";

export type EtradeConfig = {
  env: EtradeEnv;
  consumerKey: string;
  consumerSecret: string;
  apiBaseUrl: string;
  authorizeUrl: string;
  tokenFilePath: string;
  /**
   * Order-placement kill switch. Order tools (preview/place/cancel) are only
   * registered when this is true. Off by default so the server is read-only
   * unless you deliberately opt in with `ETRADE_ALLOW_ORDERS=1`.
   */
  allowOrders: boolean;
};

const AUTHORIZE_URL = "https://us.etrade.com/e/t/etws/authorize";

export function loadEnv(source: Record<string, string | undefined> = process.env): EtradeConfig {
  // Defaults to prod: this server targets your real account. Opt into the
  // sandbox explicitly with ETRADE_ENV=sandbox.
  const env: EtradeEnv = source.ETRADE_ENV === "sandbox" ? "sandbox" : "prod";

  const keyVar = env === "prod" ? "ETRADE_PROD_API_KEY" : "ETRADE_SANDBOX_API_KEY";
  const secretVar = env === "prod" ? "ETRADE_PROD_API_SECRET" : "ETRADE_SANDBOX_API_KEY_SECRET";
  const consumerKey = source[keyVar];
  const consumerSecret = source[secretVar];

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      `Missing E*TRADE credentials for env=${env}. Set ${keyVar} and ${secretVar} in your .env.`,
    );
  }

  const home = source.HOME ?? process.env.HOME ?? "";
  return {
    env,
    consumerKey,
    consumerSecret,
    apiBaseUrl: env === "prod" ? "https://api.etrade.com" : "https://apisb.etrade.com",
    authorizeUrl: AUTHORIZE_URL,
    tokenFilePath: `${home}/.config/etrade-mcp/tokens.${env}.json`,
    allowOrders: source.ETRADE_ALLOW_ORDERS === "1",
  };
}
