// SPEC-FIGMA-020 T14 — card-table payload builder oracle (S1, S3, REQ-03,
// REQ-04, REQ-06).
//
// `buildCardTablePayload` maps a ManifestEntry to one table per NON-EMPTY policy
// section, each with a fixed header and one body row per source item. These
// tests assert the EXACT table count, each table's header cells, exact row
// counts, and specific cell contents (oracle acceptance — not structural-only).

import { describe, it, expect } from "vitest";
import { buildCardTablePayload } from "../src/card-table-payload.js";
import type {
  AreaAnnotation,
  DataRequirement,
  ManifestEntry,
} from "../src/types.js";

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "10:0",
    title: "검색 화면",
    intent: "사용자 인증 게이트",
    user_value: "PM 진입",
    success_criteria: "5초",
    states: [],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "abc12345",
    write_target: "native_annotation_with_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

// S1 source data: 2 states + 1 edge_case + 2 data_requirements + 2 area_annotations.
const twoStates = [
  { state: "loading", trigger: "제출 직후", result: "스피너 표시" },
  { state: "error", trigger: "검증 실패", result: "인라인 오류" },
] as unknown as ManifestEntry["states"];

const oneEdgeCase = [
  { case: "빈 결과", risk: "사용자 혼란", handling: "빈 상태 안내" },
] as unknown as ManifestEntry["edge_cases"];

const twoDataRequirements: DataRequirement[] = [
  {
    data_id: "d1",
    name: "검색어",
    purpose: "목록 필터링",
    required_values: ["문자열"],
  },
  {
    data_id: "d2",
    name: "정렬옵션",
    purpose: "결과 정렬",
    required_values: ["최신순", "관련도순"],
  },
];

const twoAreas: AreaAnnotation[] = [
  {
    area_id: "1",
    title: "검색",
    target_area: "검색 바",
    description: "조건으로 목록을 갱신한다",
    policy: "필수 입력",
  },
  {
    area_id: "2",
    title: "결과",
    target_area: "결과 리스트",
    description: "검색 결과를 표시한다",
    policy: "최대 50건",
  },
];

describe("buildCardTablePayload — S1 heterogeneous oracle", () => {
  const payload = buildCardTablePayload(
    makeEntry({
      states: twoStates,
      edge_cases: oneEdgeCase,
      data_requirements: twoDataRequirements,
      area_annotations: twoAreas,
    }),
  );

  it("emits exactly four tables in fixed section order", () => {
    expect(payload.tables).toHaveLength(4);
    expect(payload.tables.map((t) => t.section)).toEqual([
      "states",
      "edge_cases",
      "data_requirements",
      "area_annotations",
    ]);
  });

  it("states table: header state/trigger/result + exactly 2 rows with exact cells", () => {
    const states = payload.tables.find((t) => t.section === "states")!;
    expect(states.header).toEqual(["state", "trigger", "result"]);
    expect(states.rows).toHaveLength(2);
    expect(states.rows[0]).toEqual(["loading", "제출 직후", "스피너 표시"]);
    expect(states.rows[1]).toEqual(["error", "검증 실패", "인라인 오류"]);
  });

  it("edge_cases table: header case/risk/handling + exactly 1 row with exact cells", () => {
    const ec = payload.tables.find((t) => t.section === "edge_cases")!;
    expect(ec.header).toEqual(["case", "risk", "handling"]);
    expect(ec.rows).toHaveLength(1);
    expect(ec.rows[0]).toEqual(["빈 결과", "사용자 혼란", "빈 상태 안내"]);
  });

  it("data_requirements table: header name/purpose/required values + exactly 2 rows", () => {
    const dr = payload.tables.find((t) => t.section === "data_requirements")!;
    expect(dr.header).toEqual(["name", "purpose", "required values"]);
    expect(dr.rows).toHaveLength(2);
    expect(dr.rows[0]).toEqual(["검색어", "목록 필터링", "문자열"]);
    // required_values join: comma-separated.
    expect(dr.rows[1]).toEqual(["정렬옵션", "결과 정렬", "최신순, 관련도순"]);
  });

  it("area_annotations table: header area/description/policy + exactly 2 rows", () => {
    const aa = payload.tables.find((t) => t.section === "area_annotations")!;
    expect(aa.header).toEqual(["area", "description", "policy"]);
    expect(aa.rows).toHaveLength(2);
    expect(aa.rows[0]).toEqual(["검색 바", "조건으로 목록을 갱신한다", "필수 입력"]);
    expect(aa.rows[1]).toEqual(["결과 리스트", "검색 결과를 표시한다", "최대 50건"]);
  });

  it("every body row has exactly the same column count as its header (3 columns)", () => {
    for (const table of payload.tables) {
      expect(table.header).toHaveLength(3);
      for (const row of table.rows) expect(row).toHaveLength(3);
    }
  });
});

describe("buildCardTablePayload — empty sections omitted (REQ-03)", () => {
  it("only the states table is emitted when other sections are empty", () => {
    const payload = buildCardTablePayload(makeEntry({ states: twoStates }));
    expect(payload.tables).toHaveLength(1);
    expect(payload.tables[0].section).toBe("states");
  });

  it("an entry with no policy sections yields zero tables", () => {
    const payload = buildCardTablePayload(makeEntry());
    expect(payload.tables).toEqual([]);
  });
});

describe("buildCardTablePayload — mixed legacy-string + object states (S3 path)", () => {
  it("a legacy string and a structured object render in the SAME states table", () => {
    const mixed = [
      "populated",
      { state: "error", trigger: "검증 실패", result: "인라인 오류" },
    ] as unknown as ManifestEntry["states"];
    const payload = buildCardTablePayload(
      makeEntry({
        states: mixed,
        edge_cases: oneEdgeCase,
      }),
    );
    const states = payload.tables.find((t) => t.section === "states")!;
    expect(states.rows).toHaveLength(2);
    // Legacy string → column 1, columns 2/3 empty (S3 oracle).
    expect(states.rows[0]).toEqual(["populated", "", ""]);
    // Structured object → mapped columns, in the same table.
    expect(states.rows[1]).toEqual(["error", "검증 실패", "인라인 오류"]);
    // Renders without error alongside a structured edge_cases object.
    const ec = payload.tables.find((t) => t.section === "edge_cases")!;
    expect(ec.rows[0]).toEqual(["빈 결과", "사용자 혼란", "빈 상태 안내"]);
  });
});
