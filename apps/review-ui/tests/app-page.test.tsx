// @vitest-environment jsdom
// SPEC-FIGMA-004 Phase 3 — server-component pages coverage (page.tsx, layout.tsx).
// These are async React server components; we render them via direct invocation
// and assert on the resulting React element tree.

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Stub loadManifest BEFORE importing the page so the page's import resolves
// to the mock. The relative path matches the import in src/app/page.tsx.
vi.mock("../src/lib/manifest-loader.js", () => ({
  loadManifest: vi.fn(),
}));

import { loadManifest } from "../src/lib/manifest-loader.js";
import RootLayout, { metadata } from "../src/app/layout.js";
import DashboardPage from "../src/app/page.js";

afterEach(() => {
  delete process.env.REVIEW_MANIFEST_PATH;
  delete process.env.SLACK_BOT_TOKEN;
  vi.restoreAllMocks();
  vi.mocked(loadManifest).mockReset();
});

describe("layout.tsx (RootLayout)", () => {
  it("exports metadata with title and description", () => {
    expect(metadata.title).toBe("SPEC-FIGMA-004 Review Dashboard");
    expect(metadata.description).toContain("PM review");
  });

  it("renders <html lang='ko'> wrapping body with children", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <span>child-content</span>
      </RootLayout>,
    );
    expect(html).toContain('lang="ko"');
    expect(html).toContain("<body>");
    expect(html).toContain("child-content");
  });
});

describe("page.tsx (DashboardPage server component)", () => {
  it("renders dashboard-empty fallback when REVIEW_MANIFEST_PATH is not set", async () => {
    delete process.env.REVIEW_MANIFEST_PATH;
    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("dashboard-empty");
    expect(html).toContain("REVIEW_MANIFEST_PATH");
  });

  it("renders dashboard-empty fallback when loadManifest returns valid:false with no data", async () => {
    process.env.REVIEW_MANIFEST_PATH = "/nonexistent/path.json";
    vi.mocked(loadManifest).mockResolvedValue({ valid: false, exitCode: 1 });
    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("dashboard-empty");
  });

  it("renders dashboard-empty fallback when loadManifest returns valid:true but data has no frames", async () => {
    process.env.REVIEW_MANIFEST_PATH = "/something.json";
    vi.mocked(loadManifest).mockResolvedValue({
      valid: true,
      exitCode: 0,
      data: { pilot_metadata: { total_token_cost: 100 } },
    });
    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("dashboard-empty");
  });

  it("renders Dashboard component (success branch) when manifest has frames", async () => {
    process.env.REVIEW_MANIFEST_PATH = "/valid.json";
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    vi.mocked(loadManifest).mockResolvedValue({
      valid: true,
      exitCode: 0,
      data: {
        pilot_metadata: {
          total_token_cost: 145000,
          pilot_date: "2026-05-10",
          pm_reviewer_id: "pm-test",
        },
        frames: [
          {
            screen_id: "PG-01",
            frame_id: "1:1",
            title: "Title",
            intent: "intent",
            user_value: "uv",
            success_criteria: "sc",
            states: [],
            edge_cases: [],
            component_refs: [],
            data_io: [],
            design_tokens: [],
            variants: [],
            navigation: [],
            confidence: 0.9,
            intent_mismatch: false,
            source_hash: "h",
            write_target: "annotation_card",
            persona_tags: ["pm"],
            token_usage: { input_tokens: 0, output_tokens: 0 },
          },
        ],
      },
    });
    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("dashboard-empty");
    expect(html).toContain("PG-01");
    expect(html).toContain("145.0K");
  });
});
