import { createHmac } from "node:crypto";

/**
 * RFC 6238 TOTP — the 6-digit codes E*TRADE's Symantec VIP 2FA expects.
 *
 * Deliberately dependency-free (node:crypto only): this mints login codes, so
 * the supply-chain surface is kept to zero and correctness is pinned to the
 * RFC 6238 Appendix-B test vectors in totp.test.ts. The shared secret is the
 * base32 string emitted by `vipaccess provision` (stored as ETRADE_TOTP_SECRET).
 */

export type TotpOptions = {
  /** Unix epoch milliseconds to generate the code for. Defaults to now. */
  atMs?: number;
  /** Number of digits in the code. E*TRADE/VIP use 6. */
  digits?: number;
  /** Time step in seconds. Standard authenticator period is 30. */
  periodSeconds?: number;
  /** HMAC hash. VIP/authenticators use SHA1. */
  algorithm?: "sha1" | "sha256" | "sha512";
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decode an RFC 4648 base32 string (the format authenticator apps and
 * python-vipaccess emit) into bytes. Tolerant of lowercase, spaces, and `=`
 * padding so a secret pasted from a QR/otpauth URI works as-is.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/u, "").replace(/\s/gu, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Generate a TOTP code from a base32 secret. Pure and deterministic given
 * `atMs`, so it can be vector-tested without mocking the clock.
 */
export function generateTotp(base32Secret: string, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? 6;
  const period = opts.periodSeconds ?? 30;
  const algorithm = opts.algorithm ?? "sha1";
  const atMs = opts.atMs ?? Date.now();

  const counter = Math.floor(atMs / 1000 / period);

  // 8-byte big-endian counter. Use a BigInt to avoid the 32-bit overflow that
  // bit-shifting would hit for counters past 2^32 (~year 4147 at 30s steps,
  // but the RFC test vectors exercise it, so do it right).
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(base32Secret);
  const hmac = createHmac(algorithm, key).update(counterBuf).digest();

  // RFC 4226 dynamic truncation.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binCode % 10 ** digits).toString().padStart(digits, "0");
}

/** Seconds remaining in the current TOTP window — handy for "wait or use now". */
export function secondsRemaining(opts: Pick<TotpOptions, "atMs" | "periodSeconds"> = {}): number {
  const period = opts.periodSeconds ?? 30;
  const atMs = opts.atMs ?? Date.now();
  return period - (Math.floor(atMs / 1000) % period);
}
