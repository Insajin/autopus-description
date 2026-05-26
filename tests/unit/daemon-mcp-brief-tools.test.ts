// SPEC-FIGMA-015 AC-T3..T8 — Project brief MCP surface tests.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpResources } from "../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { createMcpStdioServer } from "../../src/daemon/mcp-stdio-entry.js";
import { assertBriefPath } from "../../src/daemon/brief-path-guard.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

type HandlerMap = Map<string, (req: unknown) => Promise<unknown>>;

async function invokeHandler(
  server: Server,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handlers = (server as unknown as { _requestHandlers: HandlerMap })
    ._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`no handler for method ${method}`);
  return handler({ method, params });
}

let workDir: string;
let server: Server;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fig015-brief-"));
  mkdirSync(join(workDir, ".autopus", "runs"), { recursive: true });
  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({
    auditDir: workDir,
    provider: "test",
  });
  server = createMcpStdioServer({
    mcp,
    registry,
    auditWriter,
    briefWorkspaceRoot: workDir,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workDir, { recursive: true, force: true });
});

describe("SPEC-FIGMA-015 brief path guard (INV-BRIEF-PATH)", () => {
  it("accepts paths under .autopus/runs/", () => {
    expect(
      assertBriefPath(".autopus/runs/myproj/project-brief.json", workDir),
    ).toBeNull();
  });

  it("rejects paths outside .autopus/runs/", () => {
    expect(assertBriefPath("etc/passwd", workDir)).toMatch(/\.autopus[\\/]runs/);
  });

  it("rejects ../ traversal", () => {
    expect(
      assertBriefPath(".autopus/runs/../../etc/passwd", workDir),
    ).toMatch(/\.autopus[\\/]runs/);
  });

  it("rejects null byte", () => {
    expect(assertBriefPath(".autopus/runs/x\0y", workDir)).toContain(
      "null byte",
    );
  });
});

describe("SPEC-FIGMA-015 MCP brief tools", () => {
  it("init_project_brief creates a template at expected path (AC-T3)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "init_project_brief",
      arguments: { project_slug: "test-proj" },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(resp.isError).not.toBe(true);
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.brief_path).toBe(
      ".autopus/runs/test-proj/project-brief.json",
    );
    expect(parsed.created).toBe(true);
    expect(
      existsSync(join(workDir, ".autopus/runs/test-proj/project-brief.json")),
    ).toBe(true);
  });

  it("init_project_brief rejects output_path outside .autopus/runs/ (AC-T4)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "init_project_brief",
      arguments: {
        project_slug: "evil",
        output_path: "etc/passwd",
      },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toMatch(/\.autopus[\\/]runs/);
  });

  it("init_project_brief rejects invalid slug", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "init_project_brief",
      arguments: { project_slug: "../escape" },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toContain("project_slug");
  });

  it("validate_project_brief on missing file returns valid:false with NOT_FOUND", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "validate_project_brief",
      arguments: { brief_path: ".autopus/runs/missing/project-brief.json" },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBe("NOT_FOUND");
    expect(parsed.missing_required.length).toBeGreaterThan(0);
  });

  it("validate_project_brief on incomplete brief returns missing fields (AC-T8)", async () => {
    const briefPath = join(
      workDir,
      ".autopus/runs/incomplete/project-brief.json",
    );
    mkdirSync(join(workDir, ".autopus/runs/incomplete"), { recursive: true });
    writeFileSync(
      briefPath,
      JSON.stringify({ project_name: "x", primary_users: ["pm"] }),
    );
    const resp = (await invokeHandler(server, "tools/call", {
      name: "validate_project_brief",
      arguments: {
        brief_path: ".autopus/runs/incomplete/project-brief.json",
      },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.valid).toBe(false);
    expect(parsed.missing_required).toContain("product_summary");
    expect(parsed.missing_required).toContain("business_goals");
  });

  it("get_project_brief by slug returns NOT_FOUND when missing", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_project_brief",
      arguments: { project_slug: "ghost" },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.error).toBe("NOT_FOUND");
  });

  it("get_project_brief without args returns isError", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_project_brief",
      arguments: {},
    })) as { isError?: boolean };
    expect(resp.isError).toBe(true);
  });

  it("update_project_brief patches fields and returns applied list", async () => {
    // Setup
    await invokeHandler(server, "tools/call", {
      name: "init_project_brief",
      arguments: { project_slug: "patchy" },
    });
    const resp = (await invokeHandler(server, "tools/call", {
      name: "update_project_brief",
      arguments: {
        brief_path: ".autopus/runs/patchy/project-brief.json",
        patch: { project_name: "Updated Name", primary_users: ["pm", "qa"] },
      },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(resp.isError).not.toBe(true);
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.applied_fields).toContain("project_name");
    expect(parsed.applied_fields).toContain("primary_users");
  });

  it("ListTools includes 4 brief tools when briefWorkspaceRoot is set", async () => {
    const resp = (await invokeHandler(server, "tools/list", {})) as {
      tools: Array<{ name: string }>;
    };
    const names = resp.tools.map((t) => t.name);
    expect(names).toContain("get_project_brief");
    expect(names).toContain("validate_project_brief");
    expect(names).toContain("init_project_brief");
    expect(names).toContain("update_project_brief");
  });
});
