// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-02, REQ-15, AC-S2.
// Exact event sequence ["1:1","1:2","1:1","1:1","1:3","1:3"] at intervals
// [0ms,30ms,60ms,90ms,250ms,280ms] collapses to ["1:1","1:2","1:1","1:3"]
// after a 200ms debounce window.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { SelectionQueue } from "../../src/daemon/selection-queue.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Selection queue debounce (AC-S2)", () => {
  it("collapses 6 events into 4 with the exact expected order", async () => {
    const q = new SelectionQueue({ debounceMs: 200 });
    const sequence: Array<{ at: number; frame_id: string }> = [
      { at: 0, frame_id: "1:1" },
      { at: 30, frame_id: "1:2" },
      { at: 60, frame_id: "1:1" },
      { at: 90, frame_id: "1:1" },
      { at: 250, frame_id: "1:3" },
      { at: 280, frame_id: "1:3" },
    ];

    let lastAt = 0;
    for (const ev of sequence) {
      vi.advanceTimersByTime(ev.at - lastAt);
      lastAt = ev.at;
      q.enqueue({
        figma_node_id: ev.frame_id,
        screen_id: "S",
        node_tree_summary: {},
        image_bytes_b64_sha256: "0".repeat(64),
        image_bytes_b64: "",
      });
    }
    // Allow debounce window for the final event to elapse.
    vi.advanceTimersByTime(250);

    const ids = q.toArray().map((e: { frame_id: string }) => e.frame_id);
    expect(ids).toEqual(["1:1", "1:2", "1:1", "1:3"]);
  });

  it("preserves first-emission order across distinct frame_id (INV-001)", async () => {
    const q = new SelectionQueue({ debounceMs: 200 });
    for (const fid of ["X", "Y", "X", "Z"]) {
      q.enqueue({
        figma_node_id: fid,
        screen_id: "S",
        node_tree_summary: {},
        image_bytes_b64_sha256: "0".repeat(64),
        image_bytes_b64: "",
      });
      vi.advanceTimersByTime(250);
    }
    const ids = q.toArray().map((e: { frame_id: string }) => e.frame_id);
    // distinct frame_id first-emission order: X then Y then Z
    expect(ids[0]).toBe("X");
    expect(ids.indexOf("Y")).toBeGreaterThan(ids.indexOf("X"));
    expect(ids.indexOf("Z")).toBeGreaterThan(ids.indexOf("Y"));
  });
});
