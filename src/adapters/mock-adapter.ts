import type { FigmaReadAdapter } from "../../types/figma-read-adapter";

/**
 * SPEC-FIGMA-002 AC-S9 substitutability test double.
 *
 * Implements the same FigmaReadAdapter shape as use_figma. The deterministic
 * 30-frame fixture is the source of truth; the pipeline reads frames.json
 * directly so identical input → identical manifest. This stub satisfies the
 * type-level substitutability invariant (REQ-09).
 */

export const mockAdapter: FigmaReadAdapter = {
  async listTopLevelFrames() {
    return [];
  },
  async getFrameMeta() {
    return {
      figma_node_id: "stub",
      frame_name: "stub",
      page_name: "stub",
      parent_section_name: null,
      outgoing_prototype_edges: [],
      child_component_instances: [],
      design_tokens: null,
      variants: null,
    };
  },
  async exportFrameImage() {
    return new Uint8Array(0);
  },
  async getPrototypeGraph() {
    return { entry: null, transitions: [] };
  },
};
