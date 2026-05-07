// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S7.
// Stale frame detection — entry contains last_published vs current source_hash.

import { describe, it, expect } from "vitest";

import { Daemon } from "../../../src/daemon/server.js";

describe("AC-S7: stale_frames entry has 3-key set with concrete hashes", () => {
  it("returns one entry whose hashes equal the SPEC oracle values", async () => {
    const daemon = new Daemon({ transport: "stdio", port: 0 });
    await daemon.boot();

    // First selection: image bytes "abc"
    await daemon.onSelectionChange({
      figma_node_id: "1:1",
      screen_id: "FRAME-01",
      node_tree_summary: { a: 1, b: 2 },
      image_bytes_b64_sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      image_bytes_b64: "YWJj",
    });
    await daemon.processNextSelection();

    // Second selection: same frame, but last image byte flipped (SPEC-FIGMA-002 AC-S2 vector)
    await daemon.onSelectionChange({
      figma_node_id: "1:1",
      screen_id: "FRAME-01",
      node_tree_summary: { a: 1, b: 2 },
      image_bytes_b64_sha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      image_bytes_b64: "YWJk",
    });
    // Read stale_frames BEFORE generation completes
    const stale = await daemon.mcp.read("autopus://stale_frames");
    expect(stale).toHaveLength(1);
    const entry = stale[0];
    expect(Object.keys(entry).sort()).toEqual([
      "current_source_hash",
      "frame_id",
      "last_published_source_hash",
    ]);
    expect(entry.frame_id).toBe("1:1");
    expect(entry.last_published_source_hash).toBe(
      "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420",
    );
    expect(entry.current_source_hash).toBe(
      "4d37393bcfd9719d10c9fd512971443cb20f6eb74123ffa60b546b86758a7b11",
    );

    await daemon.shutdown();
  });
});
