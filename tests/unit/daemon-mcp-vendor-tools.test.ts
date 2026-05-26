// SPEC-FIGMA-017 AC-T1..T8 — Vendor MCP surface absorption tests.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpResources } from "../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { createMcpStdioServer } from "../../src/daemon/mcp-stdio-entry.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { FigmaPluginClient } from "../../src/daemon/figma-plugin-client.js";

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

/** Minimal stub of FigmaPluginClient that captures sendCommand calls. */
class StubPluginClient implements Partial<FigmaPluginClient> {
  ready = true;
  lastCommand: string | null = null;
  lastArgs: Record<string, unknown> | null = null;
  responseQueue: unknown[] = [];

  isReady(): boolean {
    return this.ready;
  }

  async sendCommand(
    command: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.lastCommand = command;
    this.lastArgs = args;
    if (this.responseQueue.length > 0) return this.responseQueue.shift();
    return { ok: true, echoed: command, args };
  }
}

let workDir: string;
let server: Server;
let pluginStub: StubPluginClient;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fig017-vendor-"));
  pluginStub = new StubPluginClient();
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
    figmaPluginClient: pluginStub as unknown as FigmaPluginClient,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workDir, { recursive: true, force: true });
});

describe("SPEC-FIGMA-017 vendor MCP surface absorption", () => {
  it("ListTools includes 13 vendor read + 28 vendor write tools (Strategy B verbatim)", async () => {
    const resp = (await invokeHandler(server, "tools/list", {})) as {
      tools: Array<{ name: string }>;
    };
    const names = resp.tools.map((t) => t.name);
    // Read sample
    expect(names).toContain("get_document_info");
    expect(names).toContain("get_selection");
    expect(names).toContain("read_my_design");
    expect(names).toContain("get_styles");
    expect(names).toContain("get_local_components");
    expect(names).toContain("get_reactions");
    expect(names).toContain("scan_text_nodes");
    expect(names).toContain("export_node_as_image");
    // Write sample
    expect(names).toContain("create_rectangle");
    expect(names).toContain("create_frame");
    expect(names).toContain("create_text");
    expect(names).toContain("set_fill_color");
    expect(names).toContain("set_layout_mode");
    expect(names).toContain("set_padding");
    expect(names).toContain("create_connections");
    expect(names).toContain("set_default_connector");
    expect(names).toContain("create_component_instance");
    expect(names).toContain("join_channel");
  });

  it("baseline autopus tools coexist (INV-W4a)", async () => {
    const resp = (await invokeHandler(server, "tools/list", {})) as {
      tools: Array<{ name: string }>;
    };
    const names = resp.tools.map((t) => t.name);
    expect(names.slice(0, 4)).toEqual([
      "get_active_selection",
      "get_pending_descriptions",
      "get_audit_events",
      "get_stale_frames",
    ]);
  });

  it("create_frame forwards to plugin client", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "create_frame",
      arguments: { x: 0, y: 0, width: 400, height: 300, name: "Hero" },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(resp.isError).not.toBe(true);
    expect(pluginStub.lastCommand).toBe("create_frame");
    expect(pluginStub.lastArgs).toMatchObject({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      name: "Hero",
    });
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.echoed).toBe("create_frame");
  });

  it("set_fill_color forwards to plugin client", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "set_fill_color",
      arguments: { nodeId: "1:1", r: 0.5, g: 0.2, b: 0.1, a: 1.0 },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(resp.isError).not.toBe(true);
    expect(pluginStub.lastCommand).toBe("set_fill_color");
  });

  it("returns isError when plugin client is not ready (INV-PLUGIN-CONSENT)", async () => {
    pluginStub.ready = false;
    const resp = (await invokeHandler(server, "tools/call", {
      name: "create_frame",
      arguments: { x: 0, y: 0, width: 100, height: 100 },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toContain("PLUGIN_NOT_CONNECTED");
  });

  it("propagates plugin errors as isError responses", async () => {
    pluginStub.responseQueue.push(undefined);
    pluginStub.sendCommand = async () => {
      throw new Error("figma_command_timeout:create_frame");
    };
    const resp = (await invokeHandler(server, "tools/call", {
      name: "create_frame",
      arguments: { x: 0, y: 0, width: 100, height: 100 },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toContain("timeout");
  });

  it("get_node_info forwards arguments through dispatch", async () => {
    pluginStub.responseQueue.push({ id: "1:5", name: "Card", type: "FRAME" });
    const resp = (await invokeHandler(server, "tools/call", {
      name: "get_node_info",
      arguments: { nodeId: "1:5" },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.id).toBe("1:5");
    expect(parsed.name).toBe("Card");
    expect(pluginStub.lastArgs?.nodeId).toBe("1:5");
  });

  it("delete_node and clone_node both reach plugin", async () => {
    await invokeHandler(server, "tools/call", {
      name: "delete_node",
      arguments: { nodeId: "1:9" },
    });
    expect(pluginStub.lastCommand).toBe("delete_node");
    await invokeHandler(server, "tools/call", {
      name: "clone_node",
      arguments: { nodeId: "1:9", x: 100, y: 50 },
    });
    expect(pluginStub.lastCommand).toBe("clone_node");
  });

  it("unknown vendor tool name returns isError without crashing", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "create_xyzzy",
      arguments: {},
    })) as { isError?: boolean };
    expect(resp.isError).toBe(true);
  });
});
