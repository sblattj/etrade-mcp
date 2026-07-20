import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeToken, readToken, computeEtMidnightExpiry } from "../tokens.js";

describe("tokens", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "etrade-mcp-test-"));
    filePath = join(dir, "tokens.sandbox.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the token file with 0600 perms", () => {
    writeToken(filePath, {
      env: "sandbox",
      oauth_token: "tk",
      oauth_token_secret: "ts",
      obtained_at: "2026-04-24T14:00:00-07:00",
      expires_at_midnight_et: "2026-04-25T00:00:00-04:00",
    });
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("reads back exactly what was written", () => {
    const token = {
      env: "sandbox" as const,
      oauth_token: "tk",
      oauth_token_secret: "ts",
      obtained_at: "2026-04-24T14:00:00-07:00",
      expires_at_midnight_et: "2026-04-25T00:00:00-04:00",
    };
    writeToken(filePath, token);
    expect(readToken(filePath)).toEqual(token);
  });

  it("returns null when the file doesn't exist", () => {
    expect(readToken(join(dir, "missing.json"))).toBeNull();
  });

  it("returns null when the file contains invalid JSON", () => {
    Bun.write(filePath, "{not json");
    expect(readToken(filePath)).toBeNull();
  });

  it("computeEtMidnightExpiry returns an ISO string with a -04:00 or -05:00 offset", () => {
    const expiry = computeEtMidnightExpiry(new Date("2026-04-24T20:00:00Z"));
    // DST in April → -04:00 offset
    expect(expiry).toMatch(/^2026-04-25T00:00:00-04:00$/);
  });
});
