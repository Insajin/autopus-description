import { readFile, writeFile } from "node:fs/promises";

export interface FeaturePolicy {
  feature: string;
  purpose?: string;
  entry_points?: string[];
  user_rules?: string[];
  states?: string[];
  edge_cases?: string[];
  data_io?: string[];
  dev_notes?: string[];
}

export interface ProjectBrief {
  project_name?: string;
  product_summary?: string;
  primary_users?: string[];
  business_goals?: string[];
  domain_terms?: Record<string, string>;
  core_user_flows?: string[];
  global_policies?: string[];
  permissions?: string[];
  data_contracts?: string[];
  feature_policies?: FeaturePolicy[];
  non_goals?: string[];
  open_questions?: string[];
}

export const PROJECT_BRIEF_QUESTIONS = `# Autopus project brief questions

디스크립션 생성 전에 아래 항목을 채워 주세요. 모르는 항목은 빈 배열로 두거나 open_questions에 남기면 됩니다.

1. 이 제품은 누구를 위해 어떤 문제를 해결하나요?
2. 이번 Figma 범위에서 반드시 설명해야 하는 사용자 플로우는 무엇인가요?
3. 사용자 역할, 권한, 접근 제한 정책은 무엇인가요?
4. 기능별 정책은 무엇인가요? 예: 검색 범위, 필터 조합, 정렬, 페이지네이션, 상세 진입, 오류 처리.
5. 각 기능에서 개발자가 알아야 하는 상태는 무엇인가요? 예: loading, empty, error, disabled, permission denied.
6. API, 이벤트, 파라미터, 저장 상태, 캐시 정책은 무엇인가요?
7. 성공 기준과 QA 확인 기준은 무엇인가요?
8. 도메인 용어와 화면에 보이는 약어는 어떤 의미인가요?
9. 이번 작업에서 추론하면 안 되는 범위나 아직 결정되지 않은 정책은 무엇인가요?
`;

export function projectBriefTemplateJson(): string {
  const template: ProjectBrief = {
    project_name: "",
    product_summary: "",
    primary_users: [],
    business_goals: [],
    domain_terms: {},
    core_user_flows: [],
    global_policies: [],
    permissions: [],
    data_contracts: [],
    feature_policies: [
      {
        feature: "",
        purpose: "",
        entry_points: [],
        user_rules: [],
        states: [],
        edge_cases: [],
        data_io: [],
        dev_notes: [],
      },
    ],
    non_goals: [],
    open_questions: [],
  };
  return `${PROJECT_BRIEF_QUESTIONS}\n\n${JSON.stringify(template, null, 2)}\n`;
}

export async function writeProjectBriefTemplate(path: string): Promise<void> {
  await writeFile(path, projectBriefTemplateJson(), "utf8");
}

export async function loadProjectBrief(path: string): Promise<ProjectBrief> {
  const raw = await readFile(path, "utf8");
  const jsonStart = raw.indexOf("{");
  const body = jsonStart >= 0 ? raw.slice(jsonStart) : raw;
  const parsed = JSON.parse(body) as ProjectBrief;
  return normalizeProjectBrief(parsed);
}

export function normalizeProjectBrief(input: ProjectBrief): ProjectBrief {
  return {
    project_name: text(input.project_name),
    product_summary: text(input.product_summary),
    primary_users: strings(input.primary_users),
    business_goals: strings(input.business_goals),
    domain_terms: input.domain_terms ?? {},
    core_user_flows: strings(input.core_user_flows),
    global_policies: strings(input.global_policies),
    permissions: strings(input.permissions),
    data_contracts: strings(input.data_contracts),
    feature_policies: (input.feature_policies ?? [])
      .filter((f) => text(f.feature).length > 0)
      .map((f) => ({
        feature: text(f.feature),
        purpose: text(f.purpose),
        entry_points: strings(f.entry_points),
        user_rules: strings(f.user_rules),
        states: strings(f.states),
        edge_cases: strings(f.edge_cases),
        data_io: strings(f.data_io),
        dev_notes: strings(f.dev_notes),
      })),
    non_goals: strings(input.non_goals),
    open_questions: strings(input.open_questions),
  };
}

export function hasProjectBriefContent(brief?: ProjectBrief): boolean {
  if (!brief) return false;
  return renderProjectBriefForPrompt(brief) !== "No trusted project brief supplied.";
}

export function renderProjectBriefForPrompt(brief?: ProjectBrief): string {
  if (!brief) return "No trusted project brief supplied.";
  const compact = normalizeProjectBrief(brief);
  const rows: string[] = [];
  push(rows, "project_name", compact.project_name);
  push(rows, "product_summary", compact.product_summary);
  pushList(rows, "primary_users", compact.primary_users);
  pushList(rows, "business_goals", compact.business_goals);
  if (compact.domain_terms && Object.keys(compact.domain_terms).length > 0) {
    rows.push(`domain_terms=${JSON.stringify(compact.domain_terms)}`);
  }
  pushList(rows, "core_user_flows", compact.core_user_flows);
  pushList(rows, "global_policies", compact.global_policies);
  pushList(rows, "permissions", compact.permissions);
  pushList(rows, "data_contracts", compact.data_contracts);
  if (compact.feature_policies && compact.feature_policies.length > 0) {
    rows.push(`feature_policies=${JSON.stringify(compact.feature_policies)}`);
  }
  pushList(rows, "non_goals", compact.non_goals);
  pushList(rows, "open_questions", compact.open_questions);
  return rows.length > 0 ? rows.join("\n") : "No trusted project brief supplied.";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter((v) => v.length > 0).slice(0, 50)
    : [];
}

function push(rows: string[], key: string, value?: string): void {
  if (value && value.length > 0) rows.push(`${key}=${value}`);
}

function pushList(rows: string[], key: string, value?: string[]): void {
  if (value && value.length > 0) rows.push(`${key}=${JSON.stringify(value)}`);
}
