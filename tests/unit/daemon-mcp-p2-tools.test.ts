// SPEC-FIGMA-016 AC-T1..T9 — P2 MCP surface tests.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpResources } from "../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { createMcpStdioServer } from "../../src/daemon/mcp-stdio-entry.js";
import {
  FileBatchStore,
  ModeOverride,
  redactTunnelUrl,
} from "../../src/daemon/mcp-p2-state.js";
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
let batchStore: FileBatchStore;
let modeOverride: ModeOverride;
const startedAt = new Date(Date.now() - 60_000);

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fig016-p2-"));
  batchStore = new FileBatchStore(join(workDir, ".autopus", "batch"));
  modeOverride = new ModeOverride();
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
    p2Context: {
      batchStore,
      modeOverride,
      statusSource: {
        version: "test-0.2.0",
        startedAt,
        transport: "stdio",
        tunnelUrl: "https://abcdef1234.trycloudflare.com/path?secret=xyz",
        pendingCount: () => 2,
        appliedCount: () => 5,
        auditRowCount: () => 17,
        lastInitializeAt: () => "2026-05-21T10:00:00Z",
      },
      previewFromPending: async (pendingId) => {
        if (pendingId === "missing") return null;
        return {
          pending_id: pendingId,
          intent: "Show login flow",
          user_value: "User can authenticate",
          success_criteria: "submit returns 200",
          states: ["empty", "loading", "error"],
          edge_cases: ["bad password", "timeout"],
        };
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workDir, { recursive: true, force: true });
});

describe("SPEC-FIGMA-016 redactTunnelUrl", () => {
  it("strips subdomain and path", () => {
    const out = redactTunnelUrl(
      "https://abcdef1234.trycloudflare.com/path?token=secret",
    );
    expect(out).toBe("https://<redacted>.trycloudflare.com");
    expect(out).not.toContain("abcdef1234");
    expect(out).not.toContain("secret");
  });
  it("returns null when input null", () => {
    expect(redactTunnelUrl(null)).toBeNull();
  });
  it("returns sentinel on garbage URL", () => {
    expect(redactTunnelUrl("not a url")).toBe("<redacted>");
  });
});

describe("SPEC-FIGMA-016 P2 MCP tools — batch lane", () => {
  it("submit_batch_lane with valid args returns batch_id (AC-T2)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "submit_batch_lane",
      arguments: { file_id: "f1", node_ids: ["1:1", "1:2", "1:3"] },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(resp.isError).not.toBe(true);
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.batch_id).toMatch(/^bat_[a-f0-9]{12}$/);
    expect(parsed.state).toBe("in_progress");
    expect(parsed.node_ids).toEqual(["1:1", "1:2", "1:3"]);
  });

  it("submit_batch_lane rejects single-frame jobs", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "submit_batch_lane",
      arguments: { file_id: "f1", node_ids: ["1:1"] },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toContain("node_ids.length >= 2");
  });

  it("get_batch_status for unknown batch returns UNKNOWN_BATCH (AC-T3)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_batch_status",
      arguments: { batch_id: "bat_doesnotexist" },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.state).toBe("failed");
    expect(parsed.error).toBe("UNKNOWN_BATCH");
  });

  it("submit→get roundtrip returns same batch_id (AC-T8)", async () => {
    const submit = (await invokeHandler(server, "tools/call", {
      name: "submit_batch_lane",
      arguments: { file_id: "f1", node_ids: ["1:1", "1:2"] },
    })) as { content: Array<{ text: string }> };
    const { batch_id } = JSON.parse(submit.content[0].text);
    const get = (await invokeHandler(server, "tools/call", {
      name: "get_batch_status",
      arguments: { batch_id },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(get.content[0].text);
    expect(parsed.batch_id).toBe(batch_id);
    expect(parsed.state).toBe("in_progress");
  });
});

describe("SPEC-FIGMA-016 P2 MCP tools — mode override", () => {
  it("force_generation_mode then get returns forced state (AC-T4)", async () => {
    await invokeHandler(server, "tools/call", {
      name: "force_generation_mode",
      arguments: { mode: "node-only" },
    });
    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_generation_mode",
      arguments: {},
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.active_mode).toBe("node-only");
    expect(parsed.source).toBe("forced");
  });

  it("clear:true resets to auto (AC-T5)", async () => {
    await invokeHandler(server, "tools/call", {
      name: "force_generation_mode",
      arguments: { mode: "vision-only" },
    });
    await invokeHandler(server, "tools/call", {
      name: "force_generation_mode",
      arguments: { clear: true },
    });
    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_generation_mode",
      arguments: {},
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.active_mode).toBe("auto");
    expect(parsed.source).toBe("default");
  });

  it("invalid mode value returns isError", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "force_generation_mode",
      arguments: { mode: "telepathy" },
    })) as { isError?: boolean };
    expect(resp.isError).toBe(true);
  });
});

describe("SPEC-FIGMA-016 P2 MCP tools — preview", () => {
  it("preview_description returns markdown with intent/value/criteria (AC-T6)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "preview_description",
      arguments: { pending_id: "p1" },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.markdown).toContain("**Intent**: Show login flow");
    expect(parsed.markdown).toContain("**User value**: User can authenticate");
    expect(parsed.markdown).toContain("**Success criteria**: submit returns 200");
    expect(parsed.markdown).toContain("- empty");
    expect(parsed.markdown).toContain("- bad password");
  });

  it("preview_description for missing pending returns PENDING_NOT_FOUND", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "preview_description",
      arguments: { pending_id: "missing" },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.error).toBe("PENDING_NOT_FOUND");
  });

  it("preview_description without pending_id returns isError", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "preview_description",
      arguments: {},
    })) as { isError?: boolean };
    expect(resp.isError).toBe(true);
  });
});

describe("SPEC-FIGMA-016 P2 MCP tools — daemon status", () => {
  it("get_daemon_status redacts tunnel URL (AC-T7)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_daemon_status",
      arguments: {},
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.tunnel.attached).toBe(true);
    expect(parsed.tunnel.redacted_url).not.toContain("abcdef1234");
    expect(parsed.tunnel.redacted_url).not.toContain("secret");
    expect(parsed.tunnel.redacted_url).not.toContain("xyz");
    expect(parsed.tunnel.redacted_url).toBe(
      "https://<redacted>.trycloudflare.com",
    );
  });

  it("get_daemon_status returns uptime/pending/applied counts", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_daemon_status",
      arguments: {},
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.version).toBe("test-0.2.0");
    expect(parsed.uptime_seconds).toBeGreaterThanOrEqual(60);
    expect(parsed.transport).toBe("stdio");
    expect(parsed.pending_count).toBe(2);
    expect(parsed.applied_count).toBe(5);
    expect(parsed.audit_row_count).toBe(17);
  });

  it("ListTools includes 6 P2 tools when p2Context wired", async () => {
    const resp = (await invokeHandler(server, "tools/list", {})) as {
      tools: Array<{ name: string }>;
    };
    const names = resp.tools.map((t) => t.name);
    expect(names).toContain("get_batch_status");
    expect(names).toContain("get_generation_mode");
    expect(names).toContain("preview_description");
    expect(names).toContain("get_daemon_status");
    expect(names).toContain("submit_batch_lane");
    expect(names).toContain("force_generation_mode");
  });
});
