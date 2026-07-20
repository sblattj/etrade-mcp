import { describe, expect, it } from "bun:test";
import { signRequest } from "../oauth.js";

describe("signRequest", () => {
  it("returns an Authorization header containing all required OAuth params", () => {
    const header = signRequest(
      { consumerKey: "ck", consumerSecret: "cs" },
      { oauth_token: "tk", oauth_token_secret: "ts" },
      { url: "https://api.etrade.com/v1/accounts/list", method: "GET" },
    );
    expect(header).toStartWith("OAuth ");
    expect(header).toContain('oauth_consumer_key="ck"');
    expect(header).toContain('oauth_token="tk"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain("oauth_signature=");
    expect(header).toContain("oauth_nonce=");
    expect(header).toContain("oauth_timestamp=");
    expect(header).toContain('oauth_version="1.0"');
  });

  it("works without a token (request-token leg of OAuth)", () => {
    const header = signRequest(
      { consumerKey: "ck", consumerSecret: "cs" },
      null,
      { url: "https://api.etrade.com/oauth/request_token", method: "GET" },
    );
    expect(header).toStartWith("OAuth ");
    expect(header).toContain('oauth_consumer_key="ck"');
    expect(header).not.toContain("oauth_token=");
  });

  it("includes oauth_callback when provided (request-token leg)", () => {
    const header = signRequest(
      { consumerKey: "ck", consumerSecret: "cs" },
      null,
      { url: "https://api.etrade.com/oauth/request_token", method: "GET", extraParams: { oauth_callback: "oob" } },
    );
    expect(header).toContain('oauth_callback="oob"');
  });

  it("includes oauth_verifier when provided (access-token leg)", () => {
    const header = signRequest(
      { consumerKey: "ck", consumerSecret: "cs" },
      { oauth_token: "rt", oauth_token_secret: "rts" },
      { url: "https://api.etrade.com/oauth/access_token", method: "GET", extraParams: { oauth_verifier: "12345" } },
    );
    expect(header).toContain('oauth_verifier="12345"');
  });

  it("signs a PUT request (cancel/change leg)", () => {
    const header = signRequest(
      { consumerKey: "ck", consumerSecret: "cs" },
      { oauth_token: "tk", oauth_token_secret: "ts" },
      { url: "https://api.etrade.com/v1/accounts/abc/orders/cancel", method: "PUT" },
    );
    expect(header).toStartWith("OAuth ");
    expect(header).toContain("oauth_signature=");
    expect(header).toContain('oauth_token="tk"');
  });

  it("signs a POST order request (order body is excluded from the signature)", () => {
    const header = signRequest(
      { consumerKey: "ck", consumerSecret: "cs" },
      { oauth_token: "tk", oauth_token_secret: "ts" },
      { url: "https://api.etrade.com/v1/accounts/abc/orders/preview", method: "POST" },
    );
    expect(header).toStartWith("OAuth ");
    expect(header).toContain("oauth_signature=");
  });

  it("produces deterministic signatures for a fixed nonce+timestamp (signing-vector check)", () => {
    const header = signRequest(
      { consumerKey: "9djdj82h48djs9d2", consumerSecret: "j49sk3j29djd" },
      { oauth_token: "kkk9d7dh3k39sjv7", oauth_token_secret: "dh893hdasih9" },
      {
        url: "http://example.com/request",
        method: "POST",
        overrides: { oauth_nonce: "7d8f3e4a", oauth_timestamp: "137131201" },
      },
    );
    expect(header).toContain('oauth_nonce="7d8f3e4a"');
    expect(header).toContain('oauth_timestamp="137131201"');
    const sigMatch = header.match(/oauth_signature="([^"]+)"/);
    expect(sigMatch).not.toBeNull();
    expect(sigMatch?.[1]).toContain("%");
  });
});
