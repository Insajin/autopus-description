/**
 * Coverage gap — src/adapters/mock-adapter.ts
 *
 * The mock adapter is a placeholder test double; cover all four methods
 * to lock its substitutability shape.
 */
import { describe, it, expect } from "vitest";
import { mockAdapter } from "../src/adapters/mock-adapter.js";

describe("mockAdapter — coverage", () => {
  it("listTopLevelFrames returns an empty array", async () => {
    const out = await mockAdapter.listTopLevelFrames("F");
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(0);
  });

  it("getFrameMeta returns the canonical stub shape", async () => {
    const meta = await mockAdapter.getFrameMeta("F", "1:1");
    expect(meta).toEqual({
      figma_node_id: "stub",
      frame_name: "stub",
      page_name: "stub",
      parent_section_name: null,
      outgoing_prototype_edges: [],
      child_component_instances: [],
      design_tokens: null,
      variants: null,
    });
  });

  it("exportFrameImage returns an empty Uint8Array", async () => {
    const bytes = await mockAdapter.exportFrameImage("F", "1:1", 2);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(0);
  });

  it("getPrototypeGraph returns null entry and empty transitions", async () => {
    const g = await mockAdapter.getPrototypeGraph("F");
    expect(g.entry).toBeNull();
    expect(g.transitions).toEqual([]);
  });
});
