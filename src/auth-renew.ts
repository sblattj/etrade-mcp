import type { EtradeConfig } from "./env.js";
import { signRequest } from "./oauth.js";
import { writeToken, type StoredToken } from "./tokens.js";

/**
 * Reactivate an IDLE access token via E*TRADE's `renew_access_token` — the browser-free recovery for the
 * ~2h idle timeout. E*TRADE deactivates an access token after two hours of no API calls; this revives the
 * SAME token (no consent, no login page) so long as it has not also crossed the midnight ET hard-expiry.
 *
 * This matters for any scheduled/automated caller: a token minted earlier in the day can go idle and get
 * rejected by a later run, which would otherwise fall into a browser re-auth. With renew tried FIRST, an
 * idle death self-heals with zero browser. Returns {renewed:true} on success (token file rewritten with
 * a fresh obtained_at), {renewed:false, reason} otherwise — the caller then falls back to the full 3-leg
 * browser consent (the only path that survives the midnight expiry).
 */
export async function renewAccessToken(
  cfg: EtradeConfig,
  token: StoredToken | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ renewed: boolean; reason?: string }> {
  if (!token?.oauth_token || !token?.oauth_token_secret) {
    return { renewed: false, reason: "no token to renew" };
  }

  const url = `${cfg.apiBaseUrl}/oauth/renew_access_token`;
  const auth = signRequest(
    { consumerKey: cfg.consumerKey, consumerSecret: cfg.consumerSecret },
    { oauth_token: token.oauth_token, oauth_token_secret: token.oauth_token_secret },
    { url, method: "GET" },
  );

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { renewed: false, reason: `renew request failed: ${String(e).slice(0, 200)}` };
  }

  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    // A 401 here means the token is past the point renew can save (midnight-expired or invalidated) — the
    // caller must do the full browser re-consent. We deliberately do NOT touch the token file on failure.
    return { renewed: false, reason: `renew ${res.status}: ${body}` };
  }

  // Success. E*TRADE usually echoes the (same) token pair; honor a changed pair if present, else keep the
  // existing one. Either way, reset obtained_at so the idle clock restarts and keep the midnight expiry.
  const body = await res.text().catch(() => "");
  const params = new URLSearchParams(body);
  const renewedToken = params.get("oauth_token") || token.oauth_token;
  const renewedSecret = params.get("oauth_token_secret") || token.oauth_token_secret;

  writeToken(cfg.tokenFilePath, {
    env: token.env,
    oauth_token: renewedToken,
    oauth_token_secret: renewedSecret,
    obtained_at: new Date().toISOString(),
    expires_at_midnight_et: token.expires_at_midnight_et,
  });
  return { renewed: true };
}
