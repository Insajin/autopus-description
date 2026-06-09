// SPEC-FIGMA-018 T9 — area-node-resolver scaffold (RED).
// Covers S1 (matched, fallback_used=false), S3 (unresolved → frame node,
// fallback_used=true, confidence="fallback"), and REQ-12 multi-candidate
// recording.
//
// nodeIndex shape chosen for scaffolds: Record<string, string> (name → node id)
// because the in-test fixtures are most naturally written as object literals.
// The executor (T3) may conform to Map; the resolver accepts
// `Map<string,string> | Record<string,string>` per the plan signature.
//
// RED expectation: ../src/area-node-resolver.js does not exist yet (T3).

import { describe, it, expect } from "vitest";
import { resolveAreaNode } from "../src/area-node-resolver.js";
import type { AreaAnnotation } from "../src/types.js";

function makeArea(overrides: Partial<AreaAnnotation> = {}): AreaAnnotation {
  return {
    area_id: "1",
    title: "검색",
    target_area: "검색 바",
    description: "입력한 조건으로 목록을 갱신한다",
    ...overrides,
  };
}

describe("resolveAreaNode (REQ-04, REQ-12)", () => {
  it("S1: resolves a matching target_area to its node id with confidence=matched and fallback_used=false", () => {
    const nodeIndex: Record<string, string> = {
      "검색 바": "10:1",
      "결과 리스트": "10:2",
    };
    const res = resolveAreaNode(makeArea(), "10:0", nodeIndex);
    expect(res.node_id).toBe("10:1");
    expect(res.fallback_used).toBe(false);
    expect(res.confidence).toBe("matched");
  });

  it("S1: resolves the second area to '10:2'", () => {
    const nodeIndex: Record<string, string> = {
      "검색 바": "10:1",
      "결과 리스트": "10:2",
    };
    const res = resolveAreaNode(
      makeArea({ area_id: "2", title: "결과", target_area: "결과 리스트" }),
      "10:0",
      nodeIndex,
    );
    expect(res.node_id).toBe("10:2");
    expect(res.fallback_used).toBe(false);
    expect(res.confidence).toBe("matched");
  });

  it("S3: unresolved target_area falls back to the frame node with confidence=fallback", () => {
    const nodeIndex: Record<string, string> = { "헤더": "30:1" };
    const res = resolveAreaNode(
      makeArea({ target_area: "존재하지 않는 영역", placement_hint: "없음" }),
      "30:0",
      nodeIndex,
    );
    expect(res.node_id).toBe("30:0");
    expect(res.fallback_used).toBe(true);
    expect(res.confidence).toBe("fallback");
  });

  it("REQ-12: records every matching node in candidates when more than one node name matches", () => {
    const nodeIndex: Record<string, string> = {
      "검색 바 상단": "10:1",
      "검색 바 하단": "10:2",
    };
    const res = resolveAreaNode(makeArea({ target_area: "검색 바" }), "10:0", nodeIndex);
    expect(res.candidates).toEqual(
      expect.arrayContaining(["10:1", "10:2"]),
    );
    expect(res.candidates.length).toBeGreaterThanOrEqual(2);
    expect(res.confidence).toBe("multi");
    // Deterministic first-candidate pick.
    expect(res.node_id).toBe("10:1");
    expect(res.fallback_used).toBe(false);
  });

  // SPEC-018 coverage — area-node-resolver.ts branch [25]: Map input arm of
  // indexEntries (object literal arm already covered by S1/S3 above).
  it("accepts a Map<string,string> node index and resolves the matched node", () => {
    const nodeIndex = new Map<string, string>([
      ["검색 바", "10:1"],
      ["결과 리스트", "10:2"],
    ]);
    const res = resolveAreaNode(makeArea(), "10:0", nodeIndex);
    expect(res.node_id).toBe("10:1");
    expect(res.confidence).toBe("matched");
    expect(res.fallback_used).toBe(false);
  });

  // SPEC-018 coverage — matchNodes branch [34]: empty (whitespace-only)
  // target_area normalizes to "" so the first pass matches nothing; with no
  // placement_hint the resolver must fall back to the frame node.
  it("REQ-04: an empty target_area with no placement_hint falls back to the frame node", () => {
    const nodeIndex: Record<string, string> = { "검색 바": "10:1" };
    const res = resolveAreaNode(
      makeArea({ target_area: "   " }),
      "10:0",
      nodeIndex,
    );
    expect(res.node_id).toBe("10:0");
    expect(res.fallback_used).toBe(true);
    expect(res.confidence).toBe("fallback");
  });

  // SPEC-018 coverage — area-node-resolver.ts pass-2: target_area misses, but
  // placement_hint matches a node name, so the second matchNodes pass resolves.
  it("REQ-04: pass-2 resolves via placement_hint when target_area does not match", () => {
    const nodeIndex: Record<string, string> = {
      "헤더": "30:1",
      "검색 입력 필드": "30:2",
    };
    const res = resolveAreaNode(
      makeArea({ target_area: "존재하지 않는 영역", placement_hint: "검색 입력 필드" }),
      "30:0",
      nodeIndex,
    );
    expect(res.node_id).toBe("30:2");
    expect(res.fallback_used).toBe(false);
    expect(res.confidence).toBe("matched");
  });
});
