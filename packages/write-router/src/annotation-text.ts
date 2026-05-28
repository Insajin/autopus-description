import type { AreaAnnotation, DataRequirement, ManifestEntry } from "./types.js";

export interface AreaCalloutPayload {
  areaId: string;
  badgeLabel: string;
  title: string;
  targetArea: string;
  description: string;
  placementHint?: string;
  dataRefs: string[];
  documentAnchor: string;
}

export interface AnnotationVisualPayload {
  layout?: "area_handoff";
  documentPosition?: "right_of_frame";
  areaCallouts?: AreaCalloutPayload[];
  visualPolicy?: {
    badgeColor: string;
    connectorColor: string;
    documentWidth: number;
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pushLine(lines: string[], label: string, value?: string): void {
  if (hasText(value)) lines.push(`- ${label}: ${value.trim()}`);
}

function pushList(lines: string[], label: string, values?: string[]): void {
  const filtered = (values ?? []).filter(hasText);
  if (filtered.length > 0) lines.push(`- ${label}: ${filtered.join(", ")}`);
}

function renderArea(area: AreaAnnotation): string[] {
  const lines = [`${area.area_id}. ${area.title}`, `- 영역: ${area.target_area}`];
  pushLine(lines, "설명", area.description);
  pushLine(lines, "상호작용", area.interaction);
  pushLine(lines, "모션", area.motion);
  pushLine(lines, "정책", area.policy);
  pushList(lines, "상태", area.states);
  pushList(lines, "데이터", area.data_refs);
  pushList(lines, "QA", area.qa_notes);
  pushLine(lines, "배치 힌트", area.placement_hint);
  return lines;
}

function renderDataRequirement(item: DataRequirement): string[] {
  const lines = [`${item.data_id}. ${item.name}`, `- 목적: ${item.purpose}`];
  pushList(lines, "필요 값", item.required_values);
  pushLine(lines, "출처/협의", item.source);
  pushLine(lines, "갱신", item.refresh_policy);
  pushLine(lines, "권한", item.permission);
  pushLine(lines, "빈 값", item.empty_state);
  pushList(lines, "비고", item.notes);
  return lines;
}

function appendSection(lines: string[], title: string, body: string[]): void {
  if (body.length === 0) return;
  lines.push("", `[${title}]`, ...body);
}

export function renderAnnotationText(entry: ManifestEntry): string {
  const lines = [`${entry.title} (${entry.screen_id})`];
  appendSection(lines, "화면 개요", [
    `- 목적: ${entry.intent}`,
    `- 사용자 가치: ${entry.user_value}`,
    `- 성공 기준: ${entry.success_criteria}`,
  ]);
  appendSection(
    lines,
    "영역별 설명",
    (entry.area_annotations ?? []).flatMap((area, index) => [
      ...(index > 0 ? [""] : []),
      ...renderArea(area),
    ]),
  );
  const dataBody =
    entry.data_requirements && entry.data_requirements.length > 0
      ? entry.data_requirements.flatMap((item, index) => [
          ...(index > 0 ? [""] : []),
          ...renderDataRequirement(item),
        ])
      : entry.data_io.map((item) => `- ${item}`);
  appendSection(lines, "필요 데이터 리스트", dataBody);
  appendSection(lines, "상태 / 예외", [
    ...entry.states.map((item) => `- 상태: ${item}`),
    ...entry.edge_cases.map((item) => `- 예외: ${item}`),
  ]);
  lines.push(
    "",
    "[구현 경계]",
    "- 본 문서는 제품 동작, QA 기준, 데이터 협의 범위를 정리합니다.",
    "- endpoint, DB, enum, 모듈명, 저장 방식은 확정 자료가 있을 때만 따릅니다.",
  );
  return lines.join("\n");
}

export function buildAnnotationVisualPayload(entry: ManifestEntry): AnnotationVisualPayload {
  const areas = entry.area_annotations ?? [];
  if (areas.length === 0) return {};
  return {
    layout: "area_handoff",
    documentPosition: "right_of_frame",
    areaCallouts: areas.map((area) => ({
      areaId: area.area_id,
      badgeLabel: area.area_id,
      title: area.title,
      targetArea: area.target_area,
      description: area.description,
      placementHint: area.placement_hint,
      dataRefs: area.data_refs ?? [],
      documentAnchor: `area-${area.area_id}`,
    })),
    visualPolicy: {
      badgeColor: "#FF6200",
      connectorColor: "#FF6200",
      documentWidth: 720,
    },
  };
}

export function buildAnnotationCreateArgs(entry: ManifestEntry): AnnotationVisualPayload & {
  frameId: string;
  text: string;
} {
  return {
    frameId: entry.frame_id,
    text: renderAnnotationText(entry),
    ...buildAnnotationVisualPayload(entry),
  };
}
