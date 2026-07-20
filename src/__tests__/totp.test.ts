import { describe, expect, test } from "bun:test";

import { base32Decode, generateTotp, secondsRemaining } from "../totp.js";

// RFC 6238 Appendix B uses the ASCII seed "12345678901234567890" (20 bytes).
// Its RFC 4648 base32 encoding (what an authenticator app / vipaccess emits):
const RFC6238_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32Decode", () => {
  test("decodes the RFC 6238 seed back to the 20-byte ASCII secret", () => {
    expect(base32Decode(RFC6238_SECRET_BASE32).toString("utf8")).toBe("12345678901234567890");
  });

  test("tolerates lowercase, spaces, and = padding", () => {
    // "GEZDGNBVGY3TQOJQ" is the first half of the RFC seed → "1234567890".
    expect(base32Decode("ge zd gnbv gy3t qojq=").toString("utf8")).toBe("1234567890");
  });

  test("rejects invalid base32 characters", () => {
    expect(() => base32Decode("01890!")).toThrow(/Invalid base32/u);
  });
});

describe("generateTotp — RFC 6238 SHA1 test vectors (truncated to 6 digits)", () => {
  // From RFC 6238 Appendix B (SHA1 column), taking the low 6 digits of the
  // published 8-digit value. atMs = test time (seconds) * 1000.
  const vectors: Array<[seconds: number, code: string]> = [
    [59, "287082"], //          8-digit 94287082
    [1111111109, "081804"], //  8-digit 07081804
    [1111111111, "050471"], //  8-digit 14050471
    [1234567890, "005924"], //  8-digit 89005924
    [2000000000, "279037"], //  8-digit 69279037
    [20000000000, "353130"], // 8-digit 65353130 — exercises the >2^32 counter
  ];

  for (const [seconds, code] of vectors) {
    test(`T=${seconds}s → ${code}`, () => {
      expect(generateTotp(RFC6238_SECRET_BASE32, { atMs: seconds * 1000 })).toBe(code);
    });
  }

  test("honors an 8-digit request (full RFC value)", () => {
    expect(generateTotp(RFC6238_SECRET_BASE32, { atMs: 59_000, digits: 8 })).toBe("94287082");
  });

  test("code is stable within a 30s window and rolls at the boundary", () => {
    const a = generateTotp(RFC6238_SECRET_BASE32, { atMs: 60_000 });
    const b = generateTotp(RFC6238_SECRET_BASE32, { atMs: 89_000 });
    const c = generateTotp(RFC6238_SECRET_BASE32, { atMs: 90_000 });
    expect(a).toBe(b); // same window [60s, 90s)
    expect(a).not.toBe(c); // next window
  });
});

describe("secondsRemaining", () => {
  test("counts down within the window", () => {
    expect(secondsRemaining({ atMs: 60_000 })).toBe(30); // start of window
    expect(secondsRemaining({ atMs: 75_000 })).toBe(15);
    expect(secondsRemaining({ atMs: 89_000 })).toBe(1); // about to roll
  });
});
