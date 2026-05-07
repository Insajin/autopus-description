/**
 * SPEC-FIGMA-008 Phase 1.5 RED unit scaffold — TunnelSession.
 *
 * Granular bearerSha256 + salt format invariants (REQ-04, NFR-05, INV-T5).
 * Implementation file does NOT exist — RED on import.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import { TunnelSession } from "../../src/daemon/tunnel-session.js";

describe("TunnelSession (SPEC-FIGMA-008 unit)", () => {
  it("bearerSha256 = sha256Hex(bearer + ':' + salt) byte-equal", () => {
    const bearer = "bearer_" + "B".repeat(32);
    const salt = "11223344556677889900aabbccddeeff";
    const expected = createHash("sha256").update(bearer + ":" + salt).digest("hex");
    const s = new TunnelSession({ bearer, salt });
    expect(s.bearerSha256).toBe(expected);
  });

  it("salt MUST be 32-char lowercase hex (16 random bytes)", () => {
    const s = TunnelSession.createWithRandomSalt({ bearer: "bearer_" + "C".repeat(32) });
    expect(s.salt).toMatch(/^[a-f0-9]{32}$/);
  });

  it("bearer MUST match base64url-shape regex when generated from random source", () => {
    const s = TunnelSession.createWithRandomBearer();
    expect(s.bearer).toMatch(/^bearer_[A-Za-z0-9_-]{32,}$/);
  });

  it("isExpired returns false when now < attachedAt + ttlMs", () => {
    const s = new TunnelSession({
      bearer: "bearer_" + "D".repeat(32),
      salt: "1".repeat(32),
      attachedAt: 1000,
      ttlMs: 5000,
    });
    expect(s.isExpired(5999)).toBe(false);
  });

  it("isExpired returns true when now >= attachedAt + ttlMs", () => {
    const s = new TunnelSession({
      bearer: "bearer_" + "E".repeat(32),
      salt: "2".repeat(32),
      attachedAt: 1000,
      ttlMs: 5000,
    });
    expect(s.isExpired(6000)).toBe(true);
    expect(s.isExpired(6001)).toBe(true);
  });
});
