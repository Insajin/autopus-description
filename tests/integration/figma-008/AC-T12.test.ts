/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T12.
 *
 * REQ-01, NFR-02; INV-T1 additivity, INV-T4 baseline byte-equality.
 *
 * Locks the SPEC-FIGMA-006 AC-S11 baseline arrays as JSON.stringify byte-equal
 * across release boundaries.
 */

import { describe, it, expect } from "vitest";

import { CapabilityProfileRegistry } from "../../../src/daemon/capability-profile-registry.js";

describe("AC-T12 SPEC-FIGMA-006 baseline byte-equality across release boundary", () => {
  it("Test_Registry_ClaudeCodeLocal_JsonStringifyByteEqualToBaseline", () => {
    const r = new CapabilityProfileRegistry();
    expect(JSON.stringify(r.getProfile("claude-code-local")!.capabilities)).toBe(
      '["resources.read","tools.call"]',
    );
  });

  it("Test_Registry_CodexWindowsStdio_JsonStringifyByteEqualToBaseline", () => {
    const r = new CapabilityProfileRegistry();
    expect(JSON.stringify(r.getProfile("codex-windows-stdio")!.capabilities)).toBe(
      '["resources.read","tools.call"]',
    );
  });

  it("Test_Registry_ClaudeCoworkRemote_FirstThreeJsonStringifyByteEqualToBaseline", () => {
    const r = new CapabilityProfileRegistry();
    const profile = r.getProfile("claude-cowork-remote")!;
    expect(JSON.stringify(profile.capabilities.slice(0, 3))).toBe(
      '["resources.read","tools.call","fallback.polling"]',
    );
  });

  it("Test_Registry_AdditivityPreservesPrefix_NoFlagRemoved", () => {
    const r = new CapabilityProfileRegistry();
    expect(r.getProfile("claude-code-local")!.capabilities.length).toBeGreaterThanOrEqual(2);
    expect(r.getProfile("codex-windows-stdio")!.capabilities.length).toBeGreaterThanOrEqual(2);
    expect(r.getProfile("claude-cowork-remote")!.capabilities.length).toBeGreaterThanOrEqual(3);
  });

  it("Test_Registry_DefaultCapabilitiesLockedTrueForAllProfiles", () => {
    const r = new CapabilityProfileRegistry();
    for (const p of r.list()) {
      expect(p.default_capabilities_locked).toBe(true);
    }
  });
});
