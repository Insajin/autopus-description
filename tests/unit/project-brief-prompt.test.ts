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
    expect(template).toContain("기능별 정책");
    expect(template).toContain("\"feature_policies\"");
  });

  it("renders trusted feature policy context for prompts", () => {
    const rendered = renderProjectBriefForPrompt({
      project_name: "Sample Project",
      product_summary: "리포트 검색",
      feature_policies: [
        {
          feature: "Report Search",
          user_rules: ["검색 범위는 제목, 내용, 키워드를 포함한다"],
          data_io: ["query", "filters"],
        },
      ],
    });
    expect(rendered).toContain("project_name=Sample Project");
    expect(rendered).toContain("Report Search");
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
    expect(prompt.user).toContain("Report Search");
  });
});
