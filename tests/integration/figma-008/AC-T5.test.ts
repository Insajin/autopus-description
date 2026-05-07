/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T5.
 *
 * REQ-04, NFR-05, INV-T5 token-hash determinism.
 *
 * Reference vector:
 *   bearer = "bearer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
 *   salt   = "00112233445566778899aabbccddeeff"
 *   sha256(bearer + ":" + salt) = lowercase 64-char hex
 *
 * [NEW] surfaces:
 *   - src/daemon/tunnel-session.ts → TunnelSession
 *   - TunnelSession.bearerSha256: string (computed property)
 *   - random salt is sourced from `crypto.randomBytes(16)` (spy assertion)
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import { TunnelSession } from "../../../src/daemon/tunnel-session.js";

const REF_BEARER = "bearer_" + "A".repeat(32);
const REF_SALT = "00112233445566778899aabbccddeeff";
const EXPECTED_SHA = createHash("sha256")
  .update(REF_BEARER + ":" + REF_SALT)
  .digest("hex");

describe("AC-T5 bearer + per-session salt + sha256 reference vector", () => {
  it("Test_TunnelSession_KnownVector_BearerSha256ByteEqualToReference", () => {
    const session = new TunnelSession({ bearer: REF_BEARER, salt: REF_SALT });
    expect(session.bearerSha256).toBe(EXPECTED_SHA);
    expect(session.bearerSha256).toMatch(/^[a-f0-9]{64}$/);
    // Zero false-positive: hash must NOT look like a bearer string.
    expect(session.bearerSha256).not.toMatch(/^bearer_[A-Za-z0-9_-]{16,}$/);
  });

  it("Test_TunnelSession_NewSession_GeneratesNonRepeatingSaltOf16RandomBytes", () => {
    // 16 random bytes encoded as hex → exactly 32 lowercase hex chars.
    // Probability that two independently generated 16-byte salts collide is
    // negligible — assert non-equality across two fresh sessions to verify the
    // randomness source is wired (entropy oracle, no spy needed).
    const a = TunnelSession.createWithRandomSalt({ bearer: REF_BEARER });
    const b = TunnelSession.createWithRandomSalt({ bearer: REF_BEARER });
    expect(a.salt).toMatch(/^[a-f0-9]{32}$/);
    expect(b.salt).toMatch(/^[a-f0-9]{32}$/);
    expect(a.salt).not.toBe(b.salt);
    // bearerSha256 differs because salt differs.
    expect(a.bearerSha256).not.toBe(b.bearerSha256);
  });

  it("Test_TunnelSession_SameInputs_DeterministicHash", () => {
    const a = new TunnelSession({ bearer: REF_BEARER, salt: REF_SALT });
    const b = new TunnelSession({ bearer: REF_BEARER, salt: REF_SALT });
    expect(a.bearerSha256).toBe(b.bearerSha256);
  });

  it("Test_TunnelSession_DifferentSalt_DifferentHash", () => {
    const a = new TunnelSession({ bearer: REF_BEARER, salt: REF_SALT });
    const b = new TunnelSession({
      bearer: REF_BEARER,
      salt: "ffffffffffffffffffffffffffffffff",
    });
    expect(a.bearerSha256).not.toBe(b.bearerSha256);
  });
});
