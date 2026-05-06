// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S9 stale badge logic + AC-S21 digest mode.
// REQ-10, REQ-21, INV-008.

import { describe, it, expect } from "vitest";

import { detectStale } from "@autopus/review-ui/lib/stale-detector";

describe("AC-S9: stale badge on source_hash diff (REQ-10)", () => {
  it("returns stale=[AUTH-01] when AUTH-01 source_hash changed and DASH-01 unchanged", () => {
    const baseline = {
      frames: [
        { screen_id: "AUTH-01", source_hash: "abc12345" },
        { screen_id: "DASH-01", source_hash: "stable01" },
      ],
    };
    const next = {
      frames: [
        { screen_id: "AUTH-01", source_hash: "def67890" },
        { screen_id: "DASH-01", source_hash: "stable01" },
      ],
    };

    const result = detectStale(baseline, next);

    expect(result.stale).toContain("AUTH-01");
    expect(result.stale).not.toContain("DASH-01");
  });

  it("does not invoke any auto-regeneration (regeneratorInvocations === 0)", () => {
    const baseline = {
      frames: [{ screen_id: "AUTH-01", source_hash: "abc12345" }],
    };
    const next = {
      frames: [{ screen_id: "AUTH-01", source_hash: "def67890" }],
    };

    const result = detectStale(baseline, next);
    expect(result.regeneratorInvocations).toBe(0);
  });

  it("returns stale=[] when no baseline exists (first load)", () => {
    const next = { frames: [{ screen_id: "AUTH-01", source_hash: "def67890" }] };
    const result = detectStale(null, next);
    expect(result.stale).toEqual([]);
  });
});

describe("AC-S21: stale digest mode at N>3 (REQ-21)", () => {
  it("groups 4 stale frames into digest mode (digestMode=true) instead of per-row badges", () => {
    const baseline = {
      frames: [
        { screen_id: "S0", source_hash: "h0" },
        { screen_id: "S1", source_hash: "h1" },
        { screen_id: "S2", source_hash: "h2" },
        { screen_id: "S3", source_hash: "h3" },
        { screen_id: "S4", source_hash: "h4" },
      ],
    };
    const next = {
      frames: [
        { screen_id: "S0", source_hash: "h0" },
        { screen_id: "S1", source_hash: "X1" },
        { screen_id: "S2", source_hash: "X2" },
        { screen_id: "S3", source_hash: "X3" },
        { screen_id: "S4", source_hash: "X4" },
      ],
    };

    const result = detectStale(baseline, next);
    expect(result.stale).toHaveLength(4);
    expect(result.digestMode).toBe(true);
  });

  it("renders per-frame badges (digestMode=false) when exactly 3 frames are stale", () => {
    const baseline = {
      frames: [
        { screen_id: "S0", source_hash: "h0" },
        { screen_id: "S1", source_hash: "h1" },
        { screen_id: "S2", source_hash: "h2" },
        { screen_id: "S3", source_hash: "h3" },
      ],
    };
    const next = {
      frames: [
        { screen_id: "S0", source_hash: "h0" },
        { screen_id: "S1", source_hash: "X1" },
        { screen_id: "S2", source_hash: "X2" },
        { screen_id: "S3", source_hash: "X3" },
      ],
    };

    const result = detectStale(baseline, next);
    expect(result.stale).toHaveLength(3);
    expect(result.digestMode).toBe(false);
  });
});
