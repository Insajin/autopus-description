import { describe, it, expect } from "vitest";
import {
  computeManifestEntryHash,
  computeHash,
  IdempotencyTracker,
} from "../../packages/write-router/src/idempotency.js";
import type { ManifestEntry } from "../../packages/write-router/src/types.js";

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "로그인",
    intent: "사용자 인증",
    user_value: "PM 진입",
    success_criteria: "5초",
    states: ["default"],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "abcd1234",
    write_target: "annotation_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

describe("computeManifestEntryHash (REQ-07 / REQ-NFR-01 / INV-001)", () => {
  it("returns identical hashes for identical entries", () => {
    const a = makeEntry();
    const b = makeEntry();
    expect(computeManifestEntryHash(a)).toBe(computeManifestEntryHash(b));
  });

  it("returns identical hash when only confidence changes (excluded from hash)", () => {
    const a = makeEntry({ confidence: 0.7 });
    const b = makeEntry({ confidence: 0.95 });
    expect(computeManifestEntryHash(a)).toBe(computeManifestEntryHash(b));
  });

  it("returns identical hash when only token_usage changes (excluded from hash)", () => {
    const a = makeEntry({ token_usage: { input_tokens: 10, output_tokens: 20 } });
    const b = makeEntry({ token_usage: { input_tokens: 999, output_tokens: 999 } });
    expect(computeManifestEntryHash(a)).toBe(computeManifestEntryHash(b));
  });

  it("returns identical hash when pilot_metadata changes (excluded)", () => {
    const a = makeEntry({ pilot_metadata: { run_id: "run-1" } });
    const b = makeEntry({ pilot_metadata: { run_id: "run-2" } });
    expect(computeManifestEntryHash(a)).toBe(computeManifestEntryHash(b));
  });

  it("returns DIFFERENT hash when intent changes", () => {
    const a = makeEntry({ intent: "alpha" });
    const b = makeEntry({ intent: "beta" });
    expect(computeManifestEntryHash(a)).not.toBe(computeManifestEntryHash(b));
  });

  it("returns DIFFERENT hash when write_target changes", () => {
    const a = makeEntry({ write_target: "annotation_card" });
    const b = makeEntry({ write_target: "comment" });
    expect(computeManifestEntryHash(a)).not.toBe(computeManifestEntryHash(b));
  });

  it("is independent of key insertion order (canonical JSON)", () => {
    const a = makeEntry({ intent: "x", title: "y" });
    const b = makeEntry();
    b.title = "y";
    b.intent = "x";
    expect(computeManifestEntryHash(a)).toBe(computeManifestEntryHash(b));
  });

  it("computeHash is the same function as computeManifestEntryHash", () => {
    const e = makeEntry();
    expect(computeHash(e)).toBe(computeManifestEntryHash(e));
  });

  it("produces a hex SHA-256 digest of length 64", () => {
    expect(computeManifestEntryHash(makeEntry())).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("IdempotencyTracker", () => {
  it("isDuplicate returns false initially and true after record", () => {
    const tracker = new IdempotencyTracker();
    const hash = computeManifestEntryHash(makeEntry());
    expect(tracker.isDuplicate(hash)).toBe(false);
    tracker.record(hash);
    expect(tracker.isDuplicate(hash)).toBe(true);
  });

  it("size reflects recorded hashes", () => {
    const tracker = new IdempotencyTracker();
    tracker.record("a");
    tracker.record("b");
    tracker.record("a");
    expect(tracker.size()).toBe(2);
  });

  it("clear empties the tracker", () => {
    const tracker = new IdempotencyTracker();
    tracker.record("a");
    tracker.clear();
    expect(tracker.isDuplicate("a")).toBe(false);
    expect(tracker.size()).toBe(0);
  });
});
