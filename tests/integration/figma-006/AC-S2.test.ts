// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S2.
// Selection event ordering preserved + same-frame coalesce within 200ms debounce.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Daemon } from "../../../src/daemon/server.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AC-S2: ordering preserved + same-frame coalesce", () => {
  it(
    "Given 6 events at [0,30,60,90,250,280]ms with frame_ids " +
      "['1:1','1:2','1:1','1:1','1:3','1:3'] and 200ms debounce, " +
      "Then queue equals exactly ['1:1','1:2','1:1','1:3']",
    async () => {
      const daemon = new Daemon({ transport: "stdio", port: 0, debounceMs: 200 });
      await daemon.boot();

      const events: Array<{ at: number; fid: string }> = [
        { at: 0, fid: "1:1" },
        { at: 30, fid: "1:2" },
        { at: 60, fid: "1:1" },
        { at: 90, fid: "1:1" },
        { at: 250, fid: "1:3" },
        { at: 280, fid: "1:3" },
      ];

      let last = 0;
      for (const ev of events) {
        vi.advanceTimersByTime(ev.at - last);
        last = ev.at;
        await daemon.onSelectionChange({
          figma_node_id: ev.fid,
          screen_id: "S",
          node_tree_summary: {},
          image_bytes_b64_sha256: "0".repeat(64),
          image_bytes_b64: "",
        });
      }
      vi.advanceTimersByTime(250);

      const ids = daemon.queue.toArray().map((e: { frame_id: string }) => e.frame_id);
      expect(ids).toEqual(["1:1", "1:2", "1:1", "1:3"]);

      await daemon.shutdown();
    },
  );
});
