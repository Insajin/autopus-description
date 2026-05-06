import type {
  FigmaReadAdapter,
  FrameMeta,
  FrameRef,
  ImageScale,
  PrototypeEdge,
  PrototypeGraph,
} from "../../types/figma-read-adapter";
import { deriveScreenId } from "./screen-id.js";

/**
 * SPEC-FIGMA-002 — alternate adapter targeting `figma-developer-mcp >=0.6.3`.
 *
 * REQ-08: dependency pin enforced by check-dep-security.sh + REQ-09 dual-adapter swap.
 * REQ-10: only invokes the MCP client's read-flavored tools; write tools are not surfaced.
 *
 * Dependency gate semantics:
 *   - DORMANT — when `figma-developer-mcp` is absent from package.json
 *     (dependencies / devDependencies / optionalDependencies), the gate exits 0
 *     as a no-op and this adapter is unused (use-figma adapter is the default path).
 *   - ACTIVE — once the package appears in package.json, the >=0.6.3 floor is
 *     enforced (CVE-2025-53967 command injection mitigation) and `npm audit`
 *     critical advisories touching this package fail the build.
 *
 * The MCP client is injected as a vendor-neutral capability bag so the adapter can be
 * compiled and tested without an actual `figma-developer-mcp` install.
 */

// @AX:NOTE:[AUTO] — REQ-10 read-only invariant; this adapter MUST only invoke read-flavored tool names (get_file, get_node_meta, export_image, get_prototype_graph). Tool name strings are the boundary — adding a write-capable tool name here breaks AC-S10.
export interface FigmaMcpClient {
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface FigmaDeveloperMcpAdapterOptions {
  readonly client: FigmaMcpClient;
  readonly token: string;
}

export class FigmaDeveloperMcpAdapter implements FigmaReadAdapter {
  private readonly client: FigmaMcpClient;
  private readonly token: string;

  constructor(opts: FigmaDeveloperMcpAdapterOptions) {
    this.client = opts.client;
    this.token = opts.token;
  }

  async listTopLevelFrames(fileId: string): Promise<ReadonlyArray<FrameRef>> {
    const raw = (await this.client.callTool("get_file", {
      fileKey: fileId,
      token: this.token,
    })) as McpFileResponse;
    const out: FrameRef[] = [];
    for (const page of raw.pages ?? []) {
      for (const frame of page.topLevelFrames ?? []) {
        out.push({
          figma_node_id: frame.id,
          screen_id: deriveScreenId(frame.name, out.length),
          title: frame.name,
          page_name: page.name,
        });
      }
    }
    return out;
  }

  async getFrameMeta(fileId: string, nodeId: string): Promise<FrameMeta> {
    const raw = (await this.client.callTool("get_node_meta", {
      fileKey: fileId,
      nodeId,
      token: this.token,
    })) as McpNodeMetaResponse;
    return {
      figma_node_id: raw.id,
      frame_name: raw.name,
      page_name: raw.pageName ?? "",
      parent_section_name: raw.parentSectionName ?? null,
      outgoing_prototype_edges: (raw.outgoingEdges ?? []).map((e) => ({
        from: e.from,
        to: e.to,
        trigger: e.trigger,
      })),
      child_component_instances: (raw.componentInstances ?? []).map((c) => ({
        id: c.id,
        componentKey: c.componentKey,
      })),
      design_tokens: raw.designTokens ?? null,
      variants: raw.variants ?? null,
    };
  }

  async exportFrameImage(fileId: string, nodeId: string, scale: ImageScale): Promise<Uint8Array> {
    const raw = (await this.client.callTool("export_image", {
      fileKey: fileId,
      nodeId,
      scale,
      format: "png",
      token: this.token,
    })) as McpExportResponse;
    if (raw.bytesBase64) return Buffer.from(raw.bytesBase64, "base64");
    if (raw.bytes) return raw.bytes;
    throw new Error(`figma-developer-mcp export missing bytes for ${nodeId}`);
  }

  async getPrototypeGraph(fileId: string): Promise<PrototypeGraph> {
    const raw = (await this.client.callTool("get_prototype_graph", {
      fileKey: fileId,
      token: this.token,
    })) as McpPrototypeResponse;
    const transitions: PrototypeEdge[] = (raw.transitions ?? []).map((t) => ({
      from: t.from,
      to: t.to,
      trigger: t.trigger,
    }));
    return { entry: raw.entry ?? null, transitions };
  }
}

interface McpFileResponse {
  pages?: { name: string; topLevelFrames?: { id: string; name: string }[] }[];
}

interface McpNodeMetaResponse {
  id: string;
  name: string;
  pageName?: string;
  parentSectionName?: string | null;
  outgoingEdges?: { from: string; to: string; trigger: string }[];
  componentInstances?: { id: string; componentKey: string }[];
  designTokens?: string[] | null;
  variants?: string[] | null;
}

interface McpExportResponse {
  bytesBase64?: string;
  bytes?: Uint8Array;
}

interface McpPrototypeResponse {
  entry?: string | null;
  transitions?: { from: string; to: string; trigger: string }[];
}

