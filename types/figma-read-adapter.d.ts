/**
 * SPEC-FIGMA-002 — FigmaReadAdapter (vendor-neutral interface).
 *
 * REQ-09: exactly four read methods. REQ-10: read-only — no write surface.
 * Implementations MUST NOT leak vendor-specific types through these signatures.
 */

export interface FrameRef {
  readonly figma_node_id: string;
  readonly screen_id: string;
  readonly title: string;
  readonly page_name: string;
}

export interface ComponentInstanceDescriptor {
  readonly id: string;
  readonly componentKey: string;
}

export interface FrameMeta {
  readonly figma_node_id: string;
  readonly frame_name: string;
  readonly page_name: string;
  readonly parent_section_name: string | null;
  readonly outgoing_prototype_edges: ReadonlyArray<PrototypeEdge>;
  readonly child_component_instances: ReadonlyArray<ComponentInstanceDescriptor>;
  readonly design_tokens: ReadonlyArray<string> | null;
  readonly variants: ReadonlyArray<string> | null;
}

export interface PrototypeEdge {
  readonly from: string;
  readonly to: string;
  readonly trigger: string;
}

export interface PrototypeGraph {
  readonly entry: string | null;
  readonly transitions: ReadonlyArray<PrototypeEdge>;
}

export type ImageScale = 1 | 2;

// @AX:ANCHOR:[AUTO]:fan-in=4 — REQ-09 vendor-neutral substitutability contract
// @AX:REASON: importers — src/adapters/use-figma-adapter.ts (class + default const), src/adapters/figma-developer-mcp-adapter.ts (class), src/adapters/mock-adapter.ts (default const), src/read-pipeline.ts (RunReadPipelineOptions + exerciseAdapterSurface). src/read-adapter.ts no longer imports the interface — it routes through HttpSpy directly for AC-S10. AC-S9 verifies any pair of implementations produces identically-shaped manifest output for identical inputs. Adding a 5th method here breaks all implementers.
export interface FigmaReadAdapter {
  /** REQ-01: ordered top-level frames with stable ids and screen_id candidates. GET only. */
  listTopLevelFrames(fileId: string): Promise<ReadonlyArray<FrameRef>>;

  /** REQ-02: per-frame metadata with deterministic key order. GET only. */
  getFrameMeta(fileId: string, nodeId: string): Promise<FrameMeta>;

  /** REQ-03: PNG bytes at scale (default 2x). GET only. */
  exportFrameImage(fileId: string, nodeId: string, scale: ImageScale): Promise<Uint8Array>;

  /** REQ-04: file-level prototype graph. GET only. */
  getPrototypeGraph(fileId: string): Promise<PrototypeGraph>;
}
