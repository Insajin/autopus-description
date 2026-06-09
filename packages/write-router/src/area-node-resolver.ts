// SPEC-FIGMA-018 T3 — area-to-node resolver (REQ-04, REQ-12).
//
// Pure function (no live bridge): the adapter supplies the name→id index built
// from scan results, keeping this module testable without a socket (D5).
// Heuristic (OQ-1): normalized two-pass name match — target_area then
// placement_hint — against node names, with frame-node fallback.

import type { AreaAnnotation } from "./types.js";

export interface AreaResolution {
  node_id: string;
  fallback_used: boolean;
  candidates: string[];
  confidence: "matched" | "fallback" | "multi";
}

type NodeIndex = Map<string, string> | Record<string, string>;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function indexEntries(nodeIndex: NodeIndex): Array<[string, string]> {
  return nodeIndex instanceof Map
    ? [...nodeIndex.entries()]
    : Object.entries(nodeIndex);
}

// Collect node ids whose normalized name matches the normalized needle by
// exact or substring relation (either direction). Insertion order is preserved
// so the first candidate is deterministic.
function matchNodes(needle: string, entries: Array<[string, string]>): string[] {
  const target = normalize(needle);
  if (!target) return [];
  const matched: string[] = [];
  for (const [name, id] of entries) {
    const candidate = normalize(name);
    if (candidate === target || candidate.includes(target) || target.includes(candidate)) {
      matched.push(id);
    }
  }
  return matched;
}

// @AX:NOTE [AUTO]: heuristic resolver — two-pass normalized name match (target_area then placement_hint).
// confidence semantics are load-bearing: "matched" = single hit, "multi" = >1 hit (first candidate wins,
// deterministic by index insertion order), "fallback" = no hit so the write anchors to frameNodeId
// (fallback_used=true). Callers gate on these values; do not collapse "multi" into "matched".
export function resolveAreaNode(
  area: AreaAnnotation,
  frameNodeId: string,
  nodeIndex: NodeIndex,
): AreaResolution {
  const entries = indexEntries(nodeIndex);

  // Pass 1: target_area. Pass 2: placement_hint fallback.
  let candidates = matchNodes(area.target_area, entries);
  if (candidates.length === 0 && area.placement_hint) {
    candidates = matchNodes(area.placement_hint, entries);
  }

  if (candidates.length === 0) {
    return {
      node_id: frameNodeId,
      fallback_used: true,
      candidates: [],
      confidence: "fallback",
    };
  }

  if (candidates.length > 1) {
    return {
      node_id: candidates[0],
      fallback_used: false,
      candidates,
      confidence: "multi",
    };
  }

  return {
    node_id: candidates[0],
    fallback_used: false,
    candidates,
    confidence: "matched",
  };
}
