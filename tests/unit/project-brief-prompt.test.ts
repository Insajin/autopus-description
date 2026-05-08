import { describe, expect, it } from "vitest";

import {
  hasProjectBriefContent,
  projectBriefTemplateJson,
  renderProjectBriefForPrompt,
} from "../../src/project-brief.js";
import { buildNodeOnlyPrompt } from "../../src/prompts/node-only.js";

describe("project brief prompt context", () => {
  it("template contains the user-question flow and JSON policy slots", () => {
    const template = projectBriefTemplateJson();
    expect(template).toContain("Autopus project brief questions");
    expect(template).toContain("기능별 확정 정책");
    expect(template).toContain("\"resolved_decisions\"");
    expect(template).toContain("\"state_transitions\"");
    expect(template).toContain("\"api_contracts\"");
    expect(template).toContain("\"qa_acceptance\"");
    expect(template).toContain("\"feature_policies\"");
  });

  it("renders trusted feature policy context for prompts", () => {
    const rendered = renderProjectBriefForPrompt({
      project_name: "Sample Project",
      product_summary: "리포트 검색",
      feature_policies: [
        {
          feature: "Report Search",
          resolved_decisions: ["검색은 Enter 또는 검색 아이콘으로만 실행한다"],
          state_transitions: ["typing -> submitted"],
          user_rules: ["검색 범위는 제목, 내용, 키워드를 포함한다"],
          api_contracts: ["GET /reports"],
          data_io: ["query", "filters"],
          qa_acceptance: ["검색 실행 시 page=1"],
        },
      ],
    });
    expect(rendered).toContain("project_name=Sample Project");
    expect(rendered).toContain("Report Search");
    expect(rendered).toContain("resolved_decisions");
    expect(rendered).toContain("api_contracts");
    expect(hasProjectBriefContent({ project_name: "Sample Project" })).toBe(true);
  });

  it("node-only prompt asks for developer handoff instead of visual-only summary", () => {
    const prompt = buildNodeOnlyPrompt(
      {
        screen_id: "REPORT-01",
        name: "Report Search",
        text_nodes: [{ content: "리포트 제목, 내용, 또는 키워드 검색" }],
      },
      {
        projectBrief: {
          product_summary: "리서치 리포트 검색",
          feature_policies: [
            {
              feature: "Report Search",
              states: ["loading", "empty", "populated"],
              data_io: ["query", "scope", "filters"],
            },
          ],
        },
      },
    );
    expect(prompt.user).toContain("PROJECT BRIEF");
    expect(prompt.user).toContain("HANDOFF REQUIREMENTS");
    expect(prompt.system).toContain("Do not produce visual-only frame summaries");
    expect(prompt.user).toContain("trigger -> UI/data expectation");
    expect(prompt.user).toContain("reset scope");
    expect(prompt.user).toContain("Report Search");
  });
});
