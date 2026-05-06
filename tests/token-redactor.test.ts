/**
 * AC-S3 — token redaction
 *
 * Given an access token figd_TESTTOKEN1234567890 (matches /figd_[A-Za-z0-9_-]{16,}/)
 *   And read adapter is invoked with --debug against the 30-frame mock fixture
 *   And all stdout, stderr, audit log lines, and emitted manifest content are concatenated
 * When the captured string is searched with /figd_[A-Za-z0-9_-]{16,}/g
 * Then match count is exactly 0
 *  And the literal token does not appear
 *  And "***" appears at least once (redaction marker)
 *  And no audit log field is named token | access_token | figma_token
 *
 * Linked: REQ-11, INV-005
 */
import { describe, it, expect } from "vitest";
import { redactTokens, runReadAdapterWithCapture } from "../src/token-redactor.js";

const TOKEN_REGEX = /figd_[A-Za-z0-9_-]{16,}/g;
const FIXTURE_TOKEN = "figd_TESTTOKEN1234567890";

describe("AC-S3: token redaction in stdout/stderr/audit/manifest", () => {
  it("redacts a Figma token from a raw string (unit-level)", () => {
    const input = `auth=${FIXTURE_TOKEN} continuing...`;
    const out = redactTokens(input);
    expect(out.match(TOKEN_REGEX)).toBeNull();
    expect(out).not.toContain(FIXTURE_TOKEN);
    expect(out).toContain("***");
  });

  it("captured stream from --debug run contains zero token matches", async () => {
    const captured = await runReadAdapterWithCapture({
      fixturePath: "fixtures/30-frame-mock/",
      token: FIXTURE_TOKEN,
      debug: true,
    });
    const matches = captured.match(TOKEN_REGEX) ?? [];
    expect(matches.length).toBe(0);
  });

  it("captured stream does not contain the literal fixture token", async () => {
    const captured = await runReadAdapterWithCapture({
      fixturePath: "fixtures/30-frame-mock/",
      token: FIXTURE_TOKEN,
      debug: true,
    });
    expect(captured).not.toContain(FIXTURE_TOKEN);
  });

  it('captured stream contains "***" redaction marker at least once', async () => {
    const captured = await runReadAdapterWithCapture({
      fixturePath: "fixtures/30-frame-mock/",
      token: FIXTURE_TOKEN,
      debug: true,
    });
    expect(captured).toContain("***");
  });

  it("audit log lines contain no token | access_token | figma_token field", async () => {
    const captured = await runReadAdapterWithCapture({
      fixturePath: "fixtures/30-frame-mock/",
      token: FIXTURE_TOKEN,
      debug: true,
      collectAuditLines: true,
    });
    const auditLines = captured
      .split("\n")
      .filter((l) => l.trim().startsWith("{") && l.includes("frame_id"));
    expect(auditLines.length).toBeGreaterThan(0);
    for (const line of auditLines) {
      const obj = JSON.parse(line);
      const keys = Object.keys(obj);
      expect(keys).not.toContain("token");
      expect(keys).not.toContain("access_token");
      expect(keys).not.toContain("figma_token");
    }
  });
});
