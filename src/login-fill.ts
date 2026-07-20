#!/usr/bin/env bun
/**
 * Fill the E*TRADE web-login User ID + Password from ENV via CDP (a Chromium-family browser on the
 * debug port, default :9333), WITHOUT the values ever entering stdout or an agent transcript — a
 * secret-hygiene path for CDP-driven automation, used INSTEAD of a generic CDP `fill` helper (which
 * typically logs the value it's handed). Prints LENGTHS only.
 *
 *   ETRADE_LOGIN_USERNAME=… ETRADE_LOGIN_PASSWORD=… bun run src/login-fill.ts
 *   # or:  bun run etrade:login:fill
 *
 * TRUSTED INPUT (2026-06-17 fix): the fill drives each field with CDP `Input.insertText`, which goes
 * through the browser's real input pipeline and produces a **trusted** `input` event (isTrusted:true) —
 * exactly what a human keystroke produces. The previous approach set the value via the native setter +
 * SYNTHETIC dispatchEvent (isTrusted:false); E*TRADE's login silently bounced that on 2026-06-17 (it
 * worked through ~6/16, then a form/anti-automation change started rejecting untrusted input) while a
 * manual human login sailed straight through. insertText is the same trusted path the human used.
 *
 * Prereq: Arc (or any Chrome) on the CDP port (default 9333) currently on the E*TRADE login page.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Loads a .env from the current working directory, if present. Real
// environment variables always take precedence.
dotenv.config();

const CDP_PORT = process.env.CDP_PORT ?? "9333";

export type FillField = "user" | "pw";

// Page-side field resolver + focus. Resolves the field, focuses it, and SELECTS its content so the
// subsequent Input.insertText REPLACES (not appends). Returns the pre-insert length (or -1 if not found).
// Kept as a STRING — it runs in the browser, not Bun. No secret here; only Input.insertText carries it.
export function buildFocusExpression(which: FillField): string {
  const resolver =
    which === "pw"
      ? `document.querySelector('input[type="password"]') || inputs.find(function (i) { return /password/i.test(attrs(i)); })`
      : `inputs.find(function (i) { return /user/i.test(attrs(i)); }) || inputs.find(function (i) { var t = (i.type || 'text').toLowerCase(); return t === 'text' || t === 'email'; })`;
  return `(function () {
  var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
  function attrs(i) { return (i.name || '') + (i.id || '') + (i.getAttribute('aria-label') || ''); }
  var el = ${resolver};
  if (!el) return -1;
  el.focus();
  try { el.select(); } catch (e) {}
  return (el.value || '').length;
}())`;
}

// Page-side read-back: report the two field LENGTHS (never the values) and fire change/blur so any
// framework state settles before submit. Trusted `input` events were already emitted by Input.insertText;
// change/blur are non-trust-sensitive and a synthetic dispatch is fine here.
export function buildReadbackExpression(): string {
  return `(function () {
  var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
  function attrs(i) { return (i.name || '') + (i.id || '') + (i.getAttribute('aria-label') || ''); }
  var pwEl = document.querySelector('input[type="password"]') || inputs.find(function (i) { return /password/i.test(attrs(i)); });
  var userEl = inputs.find(function (i) { return /user/i.test(attrs(i)); }) || inputs.find(function (i) { var t = (i.type || 'text').toLowerCase(); return t === 'text' || t === 'email'; });
  [userEl, pwEl].forEach(function (el) {
    if (!el) return;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });
  return JSON.stringify({ user_len: userEl ? (userEl.value || '').length : -1, pw_len: pwEl ? (pwEl.value || '').length : -1 });
}())`;
}

export type FillStep =
  | { kind: "focus"; field: FillField }
  | { kind: "insertText"; field: FillField }
  | { kind: "readback" };

// The deterministic fill order: focus+select user, type user (trusted), focus+select pw, type pw, readback.
// The insertText steps are where the secret is carried (the runner pulls the value from the env field
// named by `field`); kept as a plan so the order + the secret-bearing steps are unit-testable.
export function planFillSequence(): FillStep[] {
  return [
    { kind: "focus", field: "user" },
    { kind: "insertText", field: "user" },
    { kind: "focus", field: "pw" },
    { kind: "insertText", field: "pw" },
    { kind: "readback" },
  ];
}

export type CdpTarget = { type: string; url?: string; title?: string; webSocketDebuggerUrl: string };

// Pure target-matcher: pick the open E*TRADE login tab from a CDP target list. Prefers a title match
// (the login heading) over a URL match. Kept pure + exported so the matching rules are unit-testable
// without a live browser.
//
// The title matches BOTH "Log on to E*TRADE" (the authorize-flow login the scheduled re-auth job navigates into) AND
// "Log in to E*TRADE" (the /home/welcome-back landing Arc restores when a logged-out E*TRADE tab is
// reopened — "in", not "on"): the 2026-06-17 gap that dead-ended login:fill on a restored tab. The URL
// fallback likewise covers /etx/pxy/login, the /authorize endpoint, and /home/welcome-back.
export function pickLoginTarget(targets: CdpTarget[]): CdpTarget | undefined {
  return (
    targets.find((x) => x.type === "page" && /Log\s*(?:on|in)\s+to\s+E\*TRADE/i.test(x.title ?? "")) ??
    targets.find((x) => x.type === "page" && /etrade\.com.*(?:login|authorize|welcome-back)/i.test(x.url ?? ""))
  );
}

/** Find the open E*TRADE login page among the browser's CDP targets. */
export async function findLoginTarget(port: string): Promise<CdpTarget> {
  const targets = (await (await fetch(`http://localhost:${port}/json`)).json()) as CdpTarget[];
  const t = pickLoginTarget(targets);
  if (!t) throw new Error(`E*TRADE login page not found among CDP targets on :${port} (start Arc with the debug port and land on the login page first)`);
  return t;
}

// Portable "is this the entrypoint" check (node-safe; import.meta.main is Bun-only) — true only
// when this file was invoked directly (`node dist/login-fill.js` / `bun run src/login-fill.ts`),
// never when another module imports the pure helpers above.
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  // --help MUST run before any env read or CDP action. Without this guard, running
  // with ETRADE_LOGIN_USERNAME/ETRADE_LOGIN_PASSWORD set (the normal case for a
  // provisioned re-auth job) meant `--help` silently attempted a real CDP browser
  // fill instead of printing usage.
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error(
      "Usage: etrade-mcp-login-fill\n\n" +
        "Fills the E*TRADE web-login User ID + Password from the environment via CDP\n" +
        "(a Chromium-family browser on the debug port), using trusted Input.insertText\n" +
        "so the value never enters stdout or an agent transcript — only field LENGTHS\n" +
        "are printed. Requires an open E*TRADE login tab on the CDP port first.\n\n" +
        "Reads from the environment:\n" +
        "  ETRADE_LOGIN_USERNAME / ETRADE_LOGIN_PASSWORD   (required)\n" +
        "  CDP_PORT                                        (optional, default 9333)\n",
    );
    process.exit(0);
  }

  const user = process.env.ETRADE_LOGIN_USERNAME;
  const pw = process.env.ETRADE_LOGIN_PASSWORD;
  if (!user || !pw) {
    console.error("[etrade-login-fill] ✗ ETRADE_LOGIN_USERNAME / ETRADE_LOGIN_PASSWORD not in env (set them in your shell environment, e.g. a local .env).");
    process.exit(1);
  }
  const secretFor: Record<FillField, string> = { user, pw };

  const target = await findLoginTarget(CDP_PORT);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((res, rej) => {
      const id = ++nextId;
      pending.set(id, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.addEventListener("message", (e: MessageEvent) => {
    const msg = JSON.parse(String(e.data)) as { id?: number; error?: unknown; result?: unknown };
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  });
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error("CDP WebSocket error — is the browser reachable?")));
  });

  await send("Runtime.enable");
  let readback = "";
  for (const step of planFillSequence()) {
    if (step.kind === "focus") {
      await send("Runtime.evaluate", { expression: buildFocusExpression(step.field), returnByValue: true });
    } else if (step.kind === "insertText") {
      // TRUSTED input — goes through the real input pipeline (isTrusted:true). The secret value travels
      // only in this CDP param over the WS; it is never printed.
      await send("Input.insertText", { text: secretFor[step.field] });
    } else {
      const r = (await send("Runtime.evaluate", { expression: buildReadbackExpression(), returnByValue: true })) as {
        result?: { value?: unknown };
      };
      readback = String(r?.result?.value ?? "");
    }
  }
  console.error(`[etrade-login-fill] fill result (lengths only, trusted insertText): ${readback}`);
  ws.close();
  process.exit(0);
}
