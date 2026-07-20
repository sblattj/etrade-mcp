import { createHmac } from "node:crypto";
import OAuth from "oauth-1.0a";

export type ConsumerCreds = { consumerKey: string; consumerSecret: string };
export type TokenPair = { oauth_token: string; oauth_token_secret: string };

export type SignOptions = {
  url: string;
  method: "GET" | "POST" | "PUT";
  /**
   * Extra OAuth params such as `oauth_callback` or `oauth_verifier`.
   *
   * NOTE: this is intentionally NOT used to pass an order's JSON body. Under
   * OAuth 1.0a, a request body is only folded into the signature base string
   * when it is `application/x-www-form-urlencoded`. E*TRADE order endpoints
   * take an `application/json` body, which is excluded from the signature — so
   * preview/place/cancel sign the URL + oauth params only, with `data`
   * undefined. (See client.ts `send()`.)
   */
  extraParams?: Record<string, string>;
  /** Test-only overrides to pin nonce/timestamp for deterministic vectors. */
  overrides?: { oauth_nonce?: string; oauth_timestamp?: string };
};

export function signRequest(
  creds: ConsumerCreds,
  token: TokenPair | null,
  opts: SignOptions,
): string {
  const oauth = new OAuth({
    consumer: { key: creds.consumerKey, secret: creds.consumerSecret },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return createHmac("sha1", key).update(baseString).digest("base64");
    },
  });

  const requestData = {
    url: opts.url,
    method: opts.method,
    data: opts.extraParams,
  };

  const authorized = oauth.authorize(
    requestData,
    token ? { key: token.oauth_token, secret: token.oauth_token_secret } : undefined,
  );

  // If EITHER nonce or timestamp is pinned, apply both overrides and re-sign — so the
  // header's nonce/timestamp/signature always stay internally consistent. (Recomputing
  // only on a timestamp override would leave a pinned-nonce header signed for the
  // library's random nonce — a guaranteed 401.)
  if (opts.overrides?.oauth_nonce || opts.overrides?.oauth_timestamp) {
    if (opts.overrides.oauth_nonce) authorized.oauth_nonce = opts.overrides.oauth_nonce;
    if (opts.overrides.oauth_timestamp) {
      authorized.oauth_timestamp = Number.parseInt(opts.overrides.oauth_timestamp, 10);
    }
    authorized.oauth_signature = oauth.getSignature(
      requestData,
      token?.oauth_token_secret ?? "",
      authorized,
    );
  }

  const header = oauth.toHeader(authorized);
  return header.Authorization;
}
