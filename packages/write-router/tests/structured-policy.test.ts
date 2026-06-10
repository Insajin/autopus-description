// SPEC-FIGMA-020 T14 — union normalizer oracle (S3, REQ-06).
//
// `normalizeState`/`normalizeEdgeCase` coerce the v0.4.0 string-or-object union
// into a fixed 3-column row. Legacy STRING input maps to column 1 with the
// remaining columns empty; OBJECT input maps each field to its column with
// missing optionals rendered as "". These tests assert the exact cell contents
// (not just "no error"), per the S3 oracle.

import { describe, it, expect } from "vitest";
import {
  normalizeState,
  normalizeEdgeCase,
  type StateObject,
  type EdgeCaseObject,
} from "../src/structured-policy.js";

describe("normalizeState (S3, REQ-06)", () => {
  it("legacy string 'populated' → [populated, '', ''] (column 1 carries the string)", () => {
    const row = normalizeState("populated");
    expect(row).toEqual({ state: "populated", trigger: "", result: "" });
  });

  it("trims a legacy string into column 1", () => {
    const row = normalizeState("  loading  ");
    expect(row).toEqual({ state: "loading", trigger: "", result: "" });
  });

  it("structured object maps each field to its column", () => {
    const item: StateObject = {
      state: "error",
      trigger: "검증 실패",
      result: "인라인 오류",
    };
    expect(normalizeState(item)).toEqual({
      state: "error",
      trigger: "검증 실패",
      result: "인라인 오류",
    });
  });

  it("object missing optional trigger/result renders empty columns 2 and 3", () => {
    const item: StateObject = { state: "loading" };
    expect(normalizeState(item)).toEqual({
      state: "loading",
      trigger: "",
      result: "",
    });
  });
});

describe("normalizeEdgeCase (S3, REQ-06)", () => {
  it("legacy string '빈 결과' → ['빈 결과', '', ''] (column 1 carries the string)", () => {
    const row = normalizeEdgeCase("빈 결과");
    expect(row).toEqual({ case: "빈 결과", risk: "", handling: "" });
  });

  it("structured object maps case/risk/handling to their columns", () => {
    const item: EdgeCaseObject = {
      case: "빈 결과",
      risk: "사용자 혼란",
      handling: "빈 상태 안내",
    };
    expect(normalizeEdgeCase(item)).toEqual({
      case: "빈 결과",
      risk: "사용자 혼란",
      handling: "빈 상태 안내",
    });
  });

  it("object missing optional risk/handling renders empty columns 2 and 3", () => {
    const item: EdgeCaseObject = { case: "권한 없음" };
    expect(normalizeEdgeCase(item)).toEqual({
      case: "권한 없음",
      risk: "",
      handling: "",
    });
  });
});
