// SPEC-FIGMA-014 AC-T1/T2/T3/T4/T5 — Verifies the extra MCP tool surface:
// - figma_list_frames / figma_get_frame_meta / figma_export_image /
//   figma_get_prototype_graph / validate_manifest (5 extra reads)
// - generate_description (1 extra write)
// Ordering: baseline(4) → extra read(5) → write(5) → extra write(1) = 15 tools.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpResources } from "../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { DaemonWriteExtension } from "../../src/daemon/daemon-write-extension.js";
import { createMcpStdioServer } from "../../src/daemon/mcp-stdio-entry.js";
import type {
  FigmaReadAdapter,
  FrameRef,
  FrameMeta,
  PrototypeGraph,
} from "../../types/figma-read-adapter.js";
import type { ManifestValidator } from "../../src/daemon/mcp-extra-read-handlers.js";
import type { DescriptionGenerator } from "../../src/daemon/mcp-extra-write-handlers.js";
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

const STUB_FRAMES: FrameRef[] = [
  {
    figma_node_id: "1:1",
    screen_id: "SCREEN-1",
    title: "Login",
    page_name: "Auth",
  },
];

const STUB_META: FrameMeta = {
  figma_node_id: "1:1",
  frame_name: "Login",
  page_name: "Auth",
  parent_section_name: null,
  outgoing_prototype_edges: [],
  child_component_instances: [],
  design_tokens: null,
  variants: null,
};

const STUB_GRAPH: PrototypeGraph = { entry: null, transitions: [] };

class StubAdapter implements FigmaReadAdapter {
  async listTopLevelFrames(): Promise<readonly FrameRef[]> {
    return STUB_FRAMES;
  }
  async getFrameMeta(): Promise<FrameMeta> {
    return STUB_META;
  }
  async exportFrameImage(): Promise<Uint8Array> {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  }
  async getPrototypeGraph(): Promise<PrototypeGraph> {
    return STUB_GRAPH;
  }
}

class StubValidator implements ManifestValidator {
  async validate(manifestPath: string): Promise<{
    valid: boolean;
    errors: Array<{ code: string; json_pointer: string; message: string }>;
    frame_count: number;
  }> {
    if (manifestPath.endsWith("invalid.json")) {
      return {
        valid: false,
        errors: [
          { code: "SCHEMA", json_pointer: "/frames/0", message: "missing intent" },
        ],
        frame_count: 1,
      };
    }
    return { valid: true, errors: [], frame_count: 3 };
  }
}

class StubGenerator implements DescriptionGenerator {
  async generate(input: { file_id: string; node_id: string }): Promise<any> {
    return {
      screen_id: input.node_id,
      display_id: "stub",
      title: "Stub",
      intent: "fake intent",
      user_value: "fake value",
      success_criteria: "ok",
      states: [],
      edge_cases: [],
      component_refs: [],
      data_io: [],
      design_tokens: [],
      variants: [],
      navigation: [],
      confidence: 0.9,
      intent_mismatch: false,
      source_hash: "",
      write_target: "annotation_card",
      persona_tags: ["pm"],
      token_usage: { input_tokens: 10, output_tokens: 20 },
    };
  }
}

let workDir: string;
let server: Server;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fig014-extra-"));
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
    writeExtension: new DaemonWriteExtension(),
    figmaAdapter: new StubAdapter(),
    manifestValidator: new StubValidator(),
    descriptionGenerator: new StubGenerator(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workDir, { recursive: true, force: true });
});

describe("SPEC-FIGMA-014 extra MCP tool surface", () => {
  it("ListTools returns 15 entries in REQ-04 order", async () => {
    const resp = (await invokeHandler(server, "tools/list", {})) as {
      tools: Array<{ name: string }>;
    };
    expect(resp.tools).toHaveLength(15);
    expect(resp.tools.map((t) => t.name)).toEqual([
      // baseline read
      "get_active_selection",
      "get_pending_descriptions",
      "get_audit_events",
      "get_stale_frames",
      // extra read (SPEC-FIGMA-014)
      "figma_list_frames",
      "figma_get_frame_meta",
      "figma_export_image",
      "figma_get_prototype_graph",
      "validate_manifest",
      // SPEC-FIGMA-011 write
      "plan_emit",
      "dryRun",
      "approve",
      "apply",
      "undo",
      // extra write (SPEC-FIGMA-014)
      "generate_description",
    ]);
  });

  it("baseline read tools (positions 1-4) keep empty inputSchema (INV-W4a)", async () => {
    const resp = (await invokeHandler(server, "tools/list", {})) as {
      tools: Array<{
        name: string;
        inputSchema: {
          type: string;
          properties: Record<string, unknown>;
          additionalProperties: boolean;
        };
      }>;
    };
    for (let i = 0; i < 4; i++) {
      expect(Object.keys(resp.tools[i].inputSchema.properties)).toHaveLength(0);
    }
  });

  it("figma_list_frames returns frames from adapter (AC-T3)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "figma_list_frames",
      arguments: { file_id: "abc" },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(resp.isError).not.toBe(true);
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0].figma_node_id).toBe("1:1");
  });

  it("figma_list_frames without file_id returns isError", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "figma_list_frames",
      arguments: {},
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toContain("file_id required");
  });

  it("figma_export_image returns base64 bytes", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "figma_export_image",
      arguments: { file_id: "abc", node_id: "1:1", scale: 1 },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(resp.isError).not.toBe(true);
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.content_type).toBe("image/png");
    expect(parsed.scale).toBe(1);
    expect(typeof parsed.image_bytes_base64).toBe("string");
  });

  it("validate_manifest with valid path returns valid:true (AC-T5)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "validate_manifest",
      arguments: { manifest_path: "/tmp/ok.json" },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.frame_count).toBe(3);
  });

  it("validate_manifest with invalid path returns valid:false (AC-T6)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "validate_manifest",
      arguments: { manifest_path: "/tmp/invalid.json" },
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toHaveLength(1);
  });

  it("validate_manifest without args returns isError", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "validate_manifest",
      arguments: {},
    })) as { isError?: boolean };
    expect(resp.isError).toBe(true);
  });

  it("generate_description returns ManifestEntry with schema_version (AC-T4)", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "generate_description",
      arguments: { file_id: "abc", node_id: "1:1" },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(resp.isError).not.toBe(true);
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.schema_version).toBe("0.2.0");
    expect(parsed.entry.screen_id).toBe("1:1");
    expect(parsed.entry.intent).toBe("fake intent");
    expect(parsed.entry.user_value).toBe("fake value");
    expect(parsed.entry.success_criteria).toBe("ok");
  });

  it("generate_description without file_id/node_id returns isError", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "generate_description",
      arguments: { file_id: "abc" },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toContain("required");
  });

  it("unknown tool name still returns isError after extras wired", async () => {
    const resp = (await invokeHandler(server, "tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toContain("unknown tool");
  });
});
