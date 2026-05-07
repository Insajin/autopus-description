/**
 * SPEC-FIGMA-008 Phase 1.5 — RED state tests for capability profile registry.
 *
 * AC-T1: registry shape (3 profile_ids in canonical order)
 * AC-T12: byte-equal preservation of FIGMA-006 baseline capabilities
 *
 * Implementation file does NOT exist yet — all tests MUST FAIL on first run.
 */

import { describe, it, expect } from "vitest";
import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";

describe("CapabilityProfileRegistry (SPEC-FIGMA-008)", () => {
  it("lists exactly 3 profile_ids in canonical order", () => {
    const registry = new CapabilityProfileRegistry();
    expect(registry.list().map((p: { profile_id: string }) => p.profile_id)).toEqual([
      "claude-code-local",
      "codex-windows-stdio",
      "claude-cowork-remote",
    ]);
  });

  it("preserves SPEC-FIGMA-006 baseline byte-equal for claude-code-local", () => {
    const registry = new CapabilityProfileRegistry();
    expect(JSON.stringify(registry.getProfile("claude-code-local")!.capabilities)).toBe(
      '["resources.read","tools.call"]',
    );
  });

  it("preserves SPEC-FIGMA-006 baseline byte-equal for codex-windows-stdio", () => {
    const registry = new CapabilityProfileRegistry();
    expect(JSON.stringify(registry.getProfile("codex-windows-stdio")!.capabilities)).toBe(
      '["resources.read","tools.call"]',
    );
  });

  it("preserves first-three baseline for claude-cowork-remote (additivity prefix)", () => {
    const registry = new CapabilityProfileRegistry();
    const profile = registry.getProfile("claude-cowork-remote")!;
    expect(JSON.stringify(profile.capabilities.slice(0, 3))).toBe(
      '["resources.read","tools.call","fallback.polling"]',
    );
    expect(profile.capabilities.length).toBeGreaterThanOrEqual(3);
  });

  it("every profile has default_capabilities_locked === true", () => {
    const registry = new CapabilityProfileRegistry();
    const ids = ["claude-code-local", "codex-windows-stdio", "claude-cowork-remote"];
    for (const id of ids) {
      expect(registry.getProfile(id)!.default_capabilities_locked).toBe(true);
    }
  });

  it("every profile has the correct transport literal", () => {
    const registry = new CapabilityProfileRegistry();
    expect(registry.getProfile("claude-code-local")!.transport).toBe("stdio");
    expect(registry.getProfile("codex-windows-stdio")!.transport).toBe("http");
    expect(registry.getProfile("claude-cowork-remote")!.transport).toBe("tunnel");
  });

  it("matchProfile resolves clientInfo.name + transport to a profile_id", () => {
    const registry = new CapabilityProfileRegistry();
    expect(
      registry.matchProfile({ clientName: "claude-code", transport: "stdio" })?.profile_id,
    ).toBe("claude-code-local");
    expect(
      registry.matchProfile({ clientName: "codex-windows", transport: "http" })?.profile_id,
    ).toBe("codex-windows-stdio");
    expect(
      registry.matchProfile({ clientName: "claude-cowork", transport: "tunnel" })?.profile_id,
    ).toBe("claude-cowork-remote");
  });

  it("matchProfile falls back to local profile when name unknown but transport matches", () => {
    const registry = new CapabilityProfileRegistry();
    expect(
      registry.matchProfile({ clientName: "unknown-client", transport: "stdio" })?.profile_id,
    ).toBe("claude-code-local");
  });

  it("matchProfile returns null when transport does not match any profile", () => {
    const registry = new CapabilityProfileRegistry();
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registry.matchProfile({ clientName: "whatever", transport: "unknown" as any }),
    ).toBeNull();
  });

  it("getProfile returns null for unknown profile_id (negative branch)", () => {
    const registry = new CapabilityProfileRegistry();
    expect(registry.getProfile("nonexistent-profile")).toBeNull();
    expect(registry.getProfile("")).toBeNull();
  });

  it("matchProfile falls back to codex-windows-stdio for http transport with unknown name", () => {
    const registry = new CapabilityProfileRegistry();
    expect(
      registry.matchProfile({ clientName: "unknown-client", transport: "http" })?.profile_id,
    ).toBe("codex-windows-stdio");
  });

  it("matchProfile falls back to claude-cowork-remote for tunnel transport with unknown name", () => {
    const registry = new CapabilityProfileRegistry();
    expect(
      registry.matchProfile({ clientName: "unknown-client", transport: "tunnel" })?.profile_id,
    ).toBe("claude-cowork-remote");
  });
});
