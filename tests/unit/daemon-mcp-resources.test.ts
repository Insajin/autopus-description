// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-05, AC-S4, AC-S7.
// Asserts the 4 MCP resource URIs and concrete shape of each.

import { describe, it, expect } from "vitest";

import { McpResources } from "../../src/daemon/mcp-resources.js";

const SOURCE_HASH_RE = /^[a-f0-9]{64}$/;

describe("MCP resources (REQ-05, AC-S4)", () => {
  it("resources/list contains exactly the 4 URIs", async () => {
    const r = new McpResources();
    const list = await r.list();
    expect(new Set(list.map((u: { uri: string }) => u.uri))).toEqual(
      new Set([
        "autopus://active_selection",
        "autopus://pending_descriptions",
        "autopus://audit_events",
        "autopus://stale_frames",
      ]),
    );
  });

  it("active_selection JSON has the exact 5-key set", async () => {
    const r = new McpResources();
    await r.publish({
      frame_id: "1:1",
      screen_id: "FRAME-01",
      source_hash: "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420",
      generated_at: "2026-05-07T00:00:00.000Z",
      description: "ok",
    });
    const body = await r.read("autopus://active_selection");
    expect(Object.keys(body).sort()).toEqual([
      "description",
      "frame_id",
      "generated_at",
      "screen_id",
      "source_hash",
    ]);
    expect(body.frame_id).toBe("1:1");
    expect(body.source_hash).toMatch(SOURCE_HASH_RE);
  });

  it("pending_descriptions returns an array length >=1 and <=30 after a publish", async () => {
    const r = new McpResources();
    await r.publish({ frame_id: "1:1", screen_id: "F", source_hash: "0".repeat(64), generated_at: "", description: "" });
    const body = await r.read("autopus://pending_descriptions");
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.length).toBeLessThanOrEqual(30);
  });

  it("stale_frames is an empty array when no stale frames exist", async () => {
    const r = new McpResources();
    const body = await r.read("autopus://stale_frames");
    expect(body).toEqual([]);
  });
});

describe("Stale frame entry shape (REQ-05, AC-S7)", () => {
  it("entry has exactly the 3-key set with concrete oracle hashes", async () => {
    const r = new McpResources();
    await r.publish({
      frame_id: "1:1",
      screen_id: "FRAME-01",
      source_hash: "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420",
      generated_at: "2026-05-07T00:00:00.000Z",
      description: "ok",
    });
    await r.markStale({
      frame_id: "1:1",
      current_source_hash: "4d37393bcfd9719d10c9fd512971443cb20f6eb74123ffa60b546b86758a7b11",
    });
    const arr = await r.read("autopus://stale_frames");
    expect(arr).toHaveLength(1);
    expect(Object.keys(arr[0]).sort()).toEqual([
      "current_source_hash",
      "frame_id",
      "last_published_source_hash",
    ]);
    expect(arr[0].last_published_source_hash).toBe(
      "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420",
    );
    expect(arr[0].current_source_hash).toBe(
      "4d37393bcfd9719d10c9fd512971443cb20f6eb74123ffa60b546b86758a7b11",
    );
  });
});
