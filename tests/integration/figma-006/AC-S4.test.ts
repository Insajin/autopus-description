// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S4.
// MCP resources/list returns exactly 4 URIs; active_selection has 5 keys.

import { describe, it, expect } from "vitest";

import { Daemon } from "../../../src/daemon/server.js";

describe("AC-S4: 4 MCP resource URIs with concrete shape", () => {
  it("resources/list returns exactly the 4 URIs", async () => {
    const daemon = new Daemon({ transport: "stdio", port: 0 });
    await daemon.boot();

    await daemon.onSelectionChange({
      figma_node_id: "1:1",
      screen_id: "FRAME-01",
      node_tree_summary: {},
      image_bytes_b64_sha256: "0".repeat(64),
      image_bytes_b64: "",
    });
    await daemon.processNextSelection();

    const list = await daemon.mcp.list();
    const uris = new Set(list.map((u: { uri: string }) => u.uri));
    expect(uris).toEqual(
      new Set([
        "autopus://active_selection",
        "autopus://pending_descriptions",
        "autopus://audit_events",
        "autopus://stale_frames",
      ]),
    );

    const active = await daemon.mcp.read("autopus://active_selection");
    expect(Object.keys(active).sort()).toEqual([
      "description",
      "frame_id",
      "generated_at",
      "screen_id",
      "source_hash",
    ]);
    expect(active.frame_id).toBe("1:1");
    expect(active.source_hash).toMatch(/^[a-f0-9]{64}$/);

    const pending = await daemon.mcp.read("autopus://pending_descriptions");
    expect(Array.isArray(pending)).toBe(true);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.length).toBeLessThanOrEqual(30);

    const stale = await daemon.mcp.read("autopus://stale_frames");
    expect(Array.isArray(stale)).toBe(true);

    await daemon.shutdown();
  });
});
