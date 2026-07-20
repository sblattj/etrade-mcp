import { test, expect, describe } from "bun:test";
import { buildFocusExpression, buildReadbackExpression, planFillSequence, pickLoginTarget } from "../login-fill";
import type { CdpTarget } from "../login-fill";

// Login fill uses TRUSTED CDP input (Input.insertText -> isTrusted:true), not synthetic dispatchEvent
// (isTrusted:false). E*TRADE's login silently bounced the synthetic-event fill on 2026-06-17 (worked
// through ~6/16, then a form/anti-automation change) while a human (trusted) login sailed through. These
// builders are the pure, testable core; the CDP orchestration (focus -> insertText -> readback) is driven
// off planFillSequence so the order + the secret-carrying steps are asserted without a live browser.
//
// NOTE: the old buildFillExpression (which interpolated the password into a Runtime.evaluate string) is
// GONE — the secret is now carried only in the Input.insertText param, so there is no JS-injection surface
// to guard anymore (a strict secret-hygiene improvement over the previous approach).

describe("buildFocusExpression", () => {
  test("password variant resolves the password field, focuses + selects it", () => {
    const e = buildFocusExpression("pw");
    expect(e).toContain('input[type="password"]');
    expect(e).toContain(".focus()");
    expect(e).toContain(".select"); // select-all so insertText REPLACES rather than appends
  });
  test("user variant resolves the user field by name/id/aria, then any text/email input", () => {
    const e = buildFocusExpression("user");
    expect(e).toContain("user");
    expect(e).toContain(".focus()");
  });
  test("is a self-invoking expression (safe for Runtime.evaluate)", () => {
    expect(buildFocusExpression("pw").trimStart().startsWith("(")).toBe(true);
  });
  test("the focus expressions never embed a secret (they only resolve + focus the field)", () => {
    // No password/username is interpolated into the page-JS — the value rides Input.insertText instead.
    expect(buildFocusExpression("pw")).not.toContain("ETRADE_LOGIN");
    expect(buildFocusExpression("user")).not.toContain("ETRADE_LOGIN");
  });
});

describe("buildReadbackExpression", () => {
  test("reports lengths only (never the values) and fires change/blur for framework state", () => {
    const e = buildReadbackExpression();
    expect(e).toContain("user_len");
    expect(e).toContain("pw_len");
    expect(e).toContain(".length");
    expect(e).toContain("change");
    expect(e).toContain("blur");
  });
});

describe("planFillSequence", () => {
  test("orders the steps: focus user -> insertText user -> focus pw -> insertText pw -> readback", () => {
    const steps = planFillSequence();
    expect(steps.map((s) => s.kind)).toEqual(["focus", "insertText", "focus", "insertText", "readback"]);
    expect(steps[0]).toMatchObject({ kind: "focus", field: "user" });
    expect(steps[2]).toMatchObject({ kind: "focus", field: "pw" });
  });
  test("the insertText steps are the secret-carrying ones, in user-then-pw order", () => {
    const inserts = planFillSequence().filter((s) => s.kind === "insertText");
    expect(inserts.map((s) => (s as { field: string }).field)).toEqual(["user", "pw"]);
  });
});

describe("pickLoginTarget", () => {
  const tgt = (over: Partial<CdpTarget>): CdpTarget => ({
    type: "page",
    webSocketDebuggerUrl: "ws://localhost:9333/devtools/page/ABC",
    ...over,
  });

  test("picks the /home/welcome-back login tab Arc restores (heading 'Log IN to E*TRADE')", () => {
    // The 2026-06-17 gap: a reopened logged-out E*TRADE tab lands on /home/welcome-back with the
    // heading "Log in to E*TRADE" ("in", not "on"). Neither the old title regex (/Log on/) nor the
    // old URL regex (login|authorize) matched it, so auto-login dead-ended on a restored tab.
    const t = pickLoginTarget([tgt({ title: "Log in to E*TRADE", url: "https://us.etrade.com/home/welcome-back" })]);
    expect(t?.url).toBe("https://us.etrade.com/home/welcome-back");
  });

  test("picks the authorize-flow login page (title 'Log on to E*TRADE', /etx/pxy/login URL)", () => {
    const t = pickLoginTarget([
      tgt({ title: "Log on to E*TRADE", url: "https://us.etrade.com/etx/pxy/login?TARGET=https%3A%2F%2Fus.etrade.com%2Fe%2Ft%2Fetws%2Fauthorize" }),
    ]);
    expect(t?.title).toBe("Log on to E*TRADE");
  });

  test("picks a tab by the authorize URL even when the title is generic", () => {
    const t = pickLoginTarget([
      tgt({ title: "us.etrade.com/e/t/etws/authorize?key=abc", url: "https://us.etrade.com/e/t/etws/authorize?key=abc&token=xyz" }),
    ]);
    expect(t?.url).toContain("/authorize");
  });

  test("does NOT pick a logged-in account/portfolio tab", () => {
    const t = pickLoginTarget([tgt({ title: "My Accounts | E*TRADE", url: "https://us.etrade.com/etx/hw/v2/accounts/portfolios" })]);
    expect(t).toBeUndefined();
  });

  test("does NOT pick a non-E*TRADE tab", () => {
    const t = pickLoginTarget([tgt({ title: "Weekly meal plan", url: "file:///home/user/notes.html" })]);
    expect(t).toBeUndefined();
  });

  test("prefers a title match over a URL-only match (the login heading wins, regardless of list order)", () => {
    const urlOnly = tgt({ title: "us.etrade.com/e/t/etws/authorize?key=abc", url: "https://us.etrade.com/e/t/etws/authorize?key=abc" });
    const byTitle = tgt({ title: "Log in to E*TRADE", url: "https://us.etrade.com/home/welcome-back" });
    expect(pickLoginTarget([urlOnly, byTitle])).toBe(byTitle); // urlOnly appears first, but the title match wins
  });

  test("ignores non-page targets (service/shared workers, background pages)", () => {
    const t = pickLoginTarget([tgt({ type: "service_worker", title: "Log on to E*TRADE", url: "https://us.etrade.com/etx/pxy/login" })]);
    expect(t).toBeUndefined();
  });
});
