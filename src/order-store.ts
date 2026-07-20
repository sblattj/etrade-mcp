/**
 * In-process store of previewed-but-not-placed orders.
 *
 * This is the safety spine of the write surface: `etrade_place_order` accepts
 * ONLY a previewId, looks the order up here, and replays the exact envelope that
 * was previewed and shown to the user. A place therefore cannot send anything
 * that wasn't previewed first. Entries are single-use (consumed on take) and
 * expire after E*TRADE's ~3-minute previewId window, after which a place must
 * be re-previewed anyway.
 *
 * Lives at module scope (a process-wide singleton), independent of the client
 * cache in mcp.ts, so a token refresh never drops pending previews.
 */
import type { PreviewOrderRequest } from "./orders.js";

export type PendingPreview = {
  previewId: number;
  previewIds: Array<{ previewId: number }>;
  accountIdKey: string;
  env: "sandbox" | "prod";
  request: PreviewOrderRequest;
  /** The human-readable preview text shown to the user, kept for the place receipt. */
  summary: string;
  createdAtMs: number;
};

/** E*TRADE previewIds are valid for ~3 minutes; mirror that here. */
export const PREVIEW_TTL_MS = 3 * 60 * 1000;

const store = new Map<number, PendingPreview>();

export function putPreview(p: Omit<PendingPreview, "createdAtMs">, nowMs: number = Date.now()): void {
  // Opportunistic GC: reap abandoned (previewed-but-never-placed) entries so the
  // store can't grow unbounded over a long-lived stdio session.
  pruneExpired(nowMs);
  store.set(p.previewId, { ...p, createdAtMs: nowMs });
}

/**
 * Consume a pending preview. Single-use: the entry is removed whether or not it
 * was still valid, so a place is never retried against a stale or already-used
 * previewId. Returns null if missing or expired.
 */
export function takePreview(previewId: number, nowMs: number = Date.now()): PendingPreview | null {
  const p = store.get(previewId);
  if (!p) return null;
  store.delete(previewId);
  if (nowMs - p.createdAtMs > PREVIEW_TTL_MS) return null;
  return p;
}

export function peekPreview(previewId: number, nowMs: number = Date.now()): PendingPreview | null {
  const p = store.get(previewId);
  if (!p) return null;
  if (nowMs - p.createdAtMs > PREVIEW_TTL_MS) return null;
  return p;
}

export function pruneExpired(nowMs: number = Date.now()): void {
  for (const [id, p] of store) {
    if (nowMs - p.createdAtMs > PREVIEW_TTL_MS) store.delete(id);
  }
}

/** Test helper — drop all pending previews. */
export function clearPreviews(): void {
  store.clear();
}
