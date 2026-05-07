/**
 * SPEC-FIGMA-008 Phase 1.5 — RED state tests for redactTunnelUrl.
 *
 * Asserts the additive `redactTunnelUrl` export from src/token-redactor.ts.
 * The function does NOT exist yet — import will fail (RED).
 *
 * Additivity invariant: existing `redact` (figd_ tokens) MUST remain unchanged.
 */

import { describe, it, expect } from "vitest";
import { redact, redactTunnelUrl } from "../../src/token-redactor.js";

describe("redactTunnelUrl (SPEC-FIGMA-008)", () => {
  it("masks https://*.trycloudflare.com URLs to '***'", () => {
    const out = redactTunnelUrl("attached at https://abc123.trycloudflare.com/");
    expect(out).not.toContain("trycloudflare.com");
    expect(out).toContain("***");
  });

  it("masks tunnel URL with path and query", () => {
    const input = "GET https://my-tunnel-9.trycloudflare.com/foo?bar=baz status=200";
    const out = redactTunnelUrl(input);
    expect(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/.test(out)).toBe(false);
    expect(out).toContain("***");
  });

  it("preserves non-tunnel URLs unchanged", () => {
    const input = "visit https://example.com/path and https://figma.com/design/abc";
    expect(redactTunnelUrl(input)).toBe(input);
  });

  it("preserves the existing figd_ redaction surface (additive only — does NOT replace redact)", () => {
    // existing behavior locked
    expect(redact("figd_AAAAAAAAAAAAAAAA")).toBe("***");
    // redactTunnelUrl is a separate gate — it does NOT touch figd_ tokens
    expect(redactTunnelUrl("figd_AAAAAAAAAAAAAAAA")).toBe("figd_AAAAAAAAAAAAAAAA");
  });

  it("handles multiple tunnel URLs in one string", () => {
    const input = "first https://aaa.trycloudflare.com/x then https://bbb.trycloudflare.com/y";
    const out = redactTunnelUrl(input);
    // exactly 0 substring matches for '.trycloudflare.com'
    expect(out.split(".trycloudflare.com").length - 1).toBe(0);
    // both URLs replaced — at least 2 occurrences of '***'
    expect(out.split("***").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("returns the input unchanged when no tunnel URL is present", () => {
    const input = "plain text with no urls";
    expect(redactTunnelUrl(input)).toBe(input);
  });

  it("does NOT consume JSON closing delimiters when URL is embedded in serialized JSON (AC-T9 oracle)", () => {
    // Regression guard: a previous regex variant `[^\s]*` consumed the closing `"` and `}`,
    // producing malformed JSON. The fix excludes `"` and `'` from the path character class.
    const input = '{"url":"https://abc.trycloudflare.com/foo","other":"keep"}';
    const out = redactTunnelUrl(input);
    expect(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/.test(out)).toBe(false);
    // closing quote and brace MUST survive — output remains parseable JSON
    expect(out).toBe('{"url":"***","other":"keep"}');
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("masks tunnel URL containing a non-standard port without leaking the path", () => {
    const input = "see https://abc.trycloudflare.com:8443/secret/path here";
    const out = redactTunnelUrl(input);
    expect(out).toBe("see *** here");
    // path MUST NOT survive
    expect(out).not.toContain("/secret/path");
    expect(out).not.toContain(":8443");
  });

  // TODO(REQ-08): SPEC regex requires https:// prefix; bare hostname redaction
  // is out-of-scope for the initial implementation.
  it.skip("redacts tunnel hostname even without https:// scheme prefix when explicitly listed", () => {
    // intentionally skipped — see REQ-08
  });
});
