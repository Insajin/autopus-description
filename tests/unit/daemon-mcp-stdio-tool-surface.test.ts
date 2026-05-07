// SPEC-FIGMA-009 T6 / AC-W3 / REQ-04 — Vitest unit test.
// Verifies the stdio MCP wire ListTools surface is exactly the 4 read-only
// tools and the write-tool surface from SPEC-FIGMA-007 DaemonWriteExtension
// (plan_emit / dry_run / approve / apply / undo) is NEVER advertised.
// INV-W4 — write-tool count == 0.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { READ_ONLY_TOOLS } from "../../src/daemon/mcp-stdio-handlers.js";
import * as mcpTools from "../../src/daemon/mcp-tools.js";
import { McpResources } from "../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { createMcpStdioServer } from "../../src/daemon/mcp-stdio-entry.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

const WRITE_TOOL_SURFACE = new Set([
  "plan_emit",
  "dry_run",
  "approve",
  "apply",
  "undo",
]);

const EXPECTED_TOOL_NAMES = [
  "get_active_selection",
  "get_pending_descriptions",
  "get_audit_events",
  "get_stale_frames",
];

type HandlerMap = Map<string, (req: unknown) => Promise<unknown>>;

async function invokeHandler(
  server: Server,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handlers = (server as unknown as { _requestHandlers: HandlerMap })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`no handler for method ${method}`);
  return handler({ method, params });
}

let workDir: string;
let server: Server;
let mcp: McpResources;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fig009-tool-surface-"));
  mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({ auditDir: workDir, provider: "test" });
  server = createMcpStdioServer({ mcp, registry, auditWriter });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workDir, { recursive: true, force: true });
});

describe("mcp-stdio tool surface — read-only only (AC-W3 / INV-W4)", () => {
  it("READ_ONLY_TOOLS has exactly 4 entries with the canonical names in order", () => {
    expect(READ_ONLY_TOOLS).toHaveLength(4);
    expect(READ_ONLY_TOOLS.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("every entry inputSchema is empty-object with additionalProperties:false", () => {
    for (const tool of READ_ONLY_TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(Object.keys(tool.inputSchema.properties)).toHaveLength(0);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("zero entries belong to the SPEC-FIGMA-007 write-tool surface (INV-W4)", () => {
    const writeMatches = READ_ONLY_TOOLS.filter((t) => WRITE_TOOL_SURFACE.has(t.name));
    expect(writeMatches).toHaveLength(0);
  });

  it("descriptions are non-empty and tool name set is disjoint from write-tool set", () => {
    const names = new Set(READ_ONLY_TOOLS.map((t) => t.name));
    for (const writeName of WRITE_TOOL_SURFACE) {
      expect(names.has(writeName)).toBe(false);
    }
    for (const tool of READ_ONLY_TOOLS) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("ListTools handler returns 4 entries with canonical shape", async () => {
    const resp = (await invokeHandler(server, "tools/list", {})) as {
      tools: Array<{
        name: string;
        inputSchema: { type: string; properties: Record<string, unknown>; additionalProperties: boolean };
      }>;
    };
    expect(resp.tools).toHaveLength(4);
    expect(resp.tools.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
    for (const tool of resp.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(Object.keys(tool.inputSchema.properties)).toHaveLength(0);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("CallTool with unknown name returns isError:true and does NOT invoke handleMcpToolCall", async () => {
    const spy = vi.spyOn(mcpTools, "handleMcpToolCall");

    const resp = (await invokeHandler(server, "tools/call", {
      name: "plan_emit",
      arguments: {},
    })) as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(resp.isError).toBe(true);
    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe("text");
    expect(resp.content[0].text).toContain("unknown tool");
    expect(spy).not.toHaveBeenCalled();
  });

  it("CallTool with valid name invokes handleMcpToolCall and returns text content", async () => {
    await mcp.publish({
      frame_id: "FRAME-A",
      screen_id: "SCREEN-A",
      source_hash: "h1",
      generated_at: "2026-05-07T00:00:00Z",
      description: "ok",
    });
    const spy = vi.spyOn(mcpTools, "handleMcpToolCall");

    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_active_selection",
      arguments: {},
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe("text");
    expect(resp.isError === undefined || resp.isError === false).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ tool: "get_active_selection", args: {} });
  });
});
