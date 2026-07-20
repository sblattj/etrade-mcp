import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type StoredToken = {
  env: "sandbox" | "prod";
  oauth_token: string;
  oauth_token_secret: string;
  obtained_at: string;
  expires_at_midnight_et: string;
};

export function writeToken(filePath: string, token: StoredToken): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function readToken(filePath: string): StoredToken | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.oauth_token || !parsed.oauth_token_secret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: StoredToken, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(token.expires_at_midnight_et).getTime();
}

/**
 * Returns an ISO-8601 string representing the next midnight in America/New_York,
 * with a correct -04:00 (EDT) or -05:00 (EST) offset.
 */
export function computeEtMidnightExpiry(now: Date = new Date()): string {
  // Format the CURRENT instant as it appears in NY to figure out which calendar day we're on there.
  const nyParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = nyParts.find((p) => p.type === "year")!.value;
  const m = nyParts.find((p) => p.type === "month")!.value;
  const d = nyParts.find((p) => p.type === "day")!.value;

  // Construct "today at 00:00:00" in NY, then advance 24h.
  const todayNyMidnightUtc = zonedDateToUtc(`${y}-${m}-${d}T00:00:00`, "America/New_York");
  const tomorrowNyMidnightUtc = new Date(todayNyMidnightUtc.getTime() + 24 * 60 * 60 * 1000);

  // Compute the offset that applies at tomorrow-midnight-NY.
  const offset = getTzOffsetString(tomorrowNyMidnightUtc, "America/New_York");
  const tomorrowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(tomorrowNyMidnightUtc);
  const ty = tomorrowParts.find((p) => p.type === "year")!.value;
  const tm = tomorrowParts.find((p) => p.type === "month")!.value;
  const td = tomorrowParts.find((p) => p.type === "day")!.value;

  return `${ty}-${tm}-${td}T00:00:00${offset}`;
}

function zonedDateToUtc(isoLocal: string, timeZone: string): Date {
  // Interpret the string as local-to-timeZone. We construct a UTC date, then correct by the zone offset.
  const asIfUtc = new Date(`${isoLocal}Z`);
  const offsetMinutes = getTzOffsetMinutes(asIfUtc, timeZone);
  return new Date(asIfUtc.getTime() - offsetMinutes * 60 * 1000);
}

function getTzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number.parseInt(parts.find((p) => p.type === t)!.value, 10);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60000;
}

function getTzOffsetString(date: Date, timeZone: string): string {
  const mins = getTzOffsetMinutes(date, timeZone);
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}
