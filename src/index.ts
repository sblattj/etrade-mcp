/**
 * Library surface for `etrade-mcp` — the same client/auth/order-shaping code the MCP server
 * (`etrade-mcp` bin, `src/mcp.ts`) is built on, exported for direct use outside the MCP protocol.
 *
 * Importing this module has NO side effects: it never starts a server, never touches the
 * filesystem or network, and never requires any environment variable to be set. Config (env vars,
 * a stored OAuth token, etc.) is only read when you actually call one of these functions.
 *
 * Not included here: the CLI entrypoints (`auth`, `auth:start`, `auth:finish`, `renew`, `totp`,
 * `login:fill`) and `src/mcp.ts` itself, which run top-level side-effecting code (reading env,
 * writing files, opening a stdio transport) as soon as they're executed — by design, not
 * importable as a library. Also excluded: `order-store.ts` (the MCP server's in-process,
 * single-use previewId cache — server plumbing, not a general-purpose API) and
 * `order-format.ts` (plain-text rendering for the MCP tool responses).
 */

// ---- 3-legged OAuth flow (request token -> authorize -> access token) ----
export {
	clearPending,
	exchangeVerifier,
	fetchRequestToken,
	pendingPath,
	type RequestTokenResult,
	readPending,
	writePending,
} from "./auth-core.js";
// ---- Browser-free token renewal (the ~2h idle-timeout self-heal) ----
export { renewAccessToken } from "./auth-renew.js";
// ---- Account + Order API client ----
export {
	type BalanceParams,
	createClient,
	type EtradeClient,
	type PortfolioParams,
	type TransactionDetailParams,
	type TransactionListParams,
} from "./client.js";
// ---- Config ----
export { type EtradeConfig, type EtradeEnv, loadEnv } from "./env.js";
// ---- OAuth 1.0a signing ----
export {
	type ConsumerCreds,
	type SignOptions,
	signRequest,
	type TokenPair,
} from "./oauth.js";
// ---- Order shaping (Preview -> Place, single-leg + multi-leg spreads) ----
export {
	buildPlaceRequest,
	buildPreviewRequest,
	buildSpreadPreviewRequest,
	type CancelSummary,
	EQUITY_ACTIONS,
	type EtradeMessage,
	type EtradeProduct,
	generateClientOrderId,
	hasErrorMessage,
	type ListOrdersParams,
	OPTION_ACTIONS,
	ORDER_TERMS,
	type OrderArgs,
	type OrderDetail,
	OrderValidationError,
	type PlaceOrderRequest,
	type PlaceSummary,
	PRICE_TYPES,
	type PreviewOrderRequest,
	type PreviewSummary,
	SPREAD_PRICE_TYPES,
	type SpreadLegArgs,
	type SpreadOrderArgs,
	summarizeCancelResponse,
	summarizePlaceResponse,
	summarizePreviewResponse,
} from "./orders.js";
// ---- Token storage ----
export {
	computeEtMidnightExpiry,
	isTokenExpired,
	readToken,
	type StoredToken,
	writeToken,
} from "./tokens.js";

// ---- VIP TOTP (2FA code generation) ----
export { base32Decode, generateTotp, secondsRemaining, type TotpOptions } from "./totp.js";
