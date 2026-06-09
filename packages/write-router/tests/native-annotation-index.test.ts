// SPEC-FIGMA-018 — native-annotation-index branch coverage.
// buildNodeIndex tolerant-parse edge branches: non-array `nodes` payload (line
// 19) and null / non-object entries inside the array (line 21). These guard the
// pure resolveAreaNode input against malformed scan results from the bridge.

import { describe, it, expect } from "vitest";
import { buildNodeIndex } from "../src/native-annotation-index.js";

describe("buildNodeIndex (tolerant scan parse)", () => {
  it("returns the well-formed name→id index for a valid scan payload", () => {
    const index = buildNodeIndex({
      nodes: [
        { id: "10:1", name: "검색 바" },
        { id: "10:2", name: "결과 리스트" },
      ],
    });
    expect(index).toEqual({ "검색 바": "10:1", "결과 리스트": "10:2" });
  });

  // Branch [19]: nodes is not an array → empty index, no throw.
  it("returns an empty index when `nodes` is missing", () => {
    expect(buildNodeIndex({})).toEqual({});
  });

  it("returns an empty index when `nodes` is not an array", () => {
    expect(buildNodeIndex({ nodes: "not-an-array" })).toEqual({});
  });

  it("returns an empty index for null / undefined scan results", () => {
    expect(buildNodeIndex(null)).toEqual({});
    expect(buildNodeIndex(undefined)).toEqual({});
  });

  // Branch [21]: null / non-object node entries are skipped, valid ones kept.
  it("skips null and non-object node entries while keeping valid ones", () => {
    const index = buildNodeIndex({
      nodes: [
        null,
        "string-node",
        42,
        { id: "10:1", name: "검색 바" },
        { id: 5, name: "숫자 id" }, // id not a string → skipped
        { id: "10:3", name: 99 }, // name not a string → skipped
      ],
    });
    expect(index).toEqual({ "검색 바": "10:1" });
  });
});
