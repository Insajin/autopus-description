// SPEC-FIGMA-004 W4 unit — stale detector (REQ-10, REQ-21, INV-008).

import { describe, it, expect } from "vitest";
import {
  detectStale,
  STALE_DIGEST_THRESHOLD,
} from "../src/lib/stale-detector.js";

const baseline = (entries: Array<[string, string]>) => ({
  frames: entries.map(([screen_id, source_hash]) => ({ screen_id, source_hash })),
});

describe("detectStale", () => {
  it("returns empty stale list when baseline is null (first load)", () => {
    const result = detectStale(null, baseline([["A", "h1"]]));
    expect(result).toEqual({
      stale: [],
      digestMode: false,
      regeneratorInvocations: 0,
    });
  });

  it("returns empty stale list when baseline is undefined", () => {
    const result = detectStale(undefined, baseline([["A", "h1"]]));
    expect(result.stale).toEqual([]);
  });

  it("flags frames whose source_hash diverged", () => {
    const result = detectStale(
      baseline([
        ["A", "h1"],
        ["B", "h2"],
      ]),
      baseline([
        ["A", "X1"],
        ["B", "h2"],
      ]),
    );
    expect(result.stale).toEqual(["A"]);
    expect(result.digestMode).toBe(false);
    expect(result.regeneratorInvocations).toBe(0);
  });

  it("never invokes regeneration (regeneratorInvocations stays 0 per INV-008)", () => {
    const result = detectStale(
      baseline([["A", "h1"]]),
      baseline([["A", "X1"]]),
    );
    expect(result.regeneratorInvocations).toBe(0);
  });

  it("digestMode flips true at count > STALE_DIGEST_THRESHOLD", () => {
    const ids = Array.from({ length: STALE_DIGEST_THRESHOLD + 1 }, (_, i) => `S${i}`);
    const result = detectStale(
      baseline(ids.map((s) => [s, "old"])),
      baseline(ids.map((s) => [s, "new"])),
    );
    expect(result.stale.length).toBe(STALE_DIGEST_THRESHOLD + 1);
    expect(result.digestMode).toBe(true);
  });

  it("digestMode stays false at exactly STALE_DIGEST_THRESHOLD", () => {
    const ids = Array.from({ length: STALE_DIGEST_THRESHOLD }, (_, i) => `S${i}`);
    const result = detectStale(
      baseline(ids.map((s) => [s, "old"])),
      baseline(ids.map((s) => [s, "new"])),
    );
    expect(result.stale.length).toBe(STALE_DIGEST_THRESHOLD);
    expect(result.digestMode).toBe(false);
  });

  it("ignores current frames absent from baseline (treated as new, not stale)", () => {
    const result = detectStale(
      baseline([["A", "h1"]]),
      baseline([
        ["A", "h1"],
        ["NEW", "n1"],
      ]),
    );
    expect(result.stale).toEqual([]);
  });
});
