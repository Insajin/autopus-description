// SPEC-FIGMA-004 — Plugin Bridge fallback adapter (REQ-06, INV-006, AC-S7).
//
// When the official MCP write returns a permission/seat error, the router
// classifies it via `classifyMcpError` and calls `applyViaPluginBridge` to
// deliver the manifest entry through the self-hosted Figma plugin. The
// plugin sandbox runs `figma.createText` / `setPluginData` / etc. inside the
// designer's own Figma client, sidestepping the MCP write seat requirement.
//
// The transport is injectable so unit tests can simulate plugin processing
// without spinning up the actual Figma plugin runtime. The default transport
// returns a synthetic node id; integration tests typically vi.spyOn this
// module's `applyViaPluginBridge` and supply mocked WriteResults directly.

import type {
  ManifestEntry,
  UndoDescriptor,
  WriteResult,
} from "../types.js";

export type McpErrorClass =
  | "MCP_PERMISSION_ERROR"
  | "MCP_RATE_LIMIT"
  | "MCP_NETWORK"
  | "MCP_OTHER";

export interface PluginBridgeContext {
  fallback_reason: McpErrorClass;
  original_error?: unknown;
}

export interface PluginBridgeTransport {
  send(entry: ManifestEntry, ctx: PluginBridgeContext): Promise<{
    nodeId: string;
    undo_descriptor?: UndoDescriptor;
  }>;
}

const defaultTransport: PluginBridgeTransport = {
  async send(entry) {
    // Synthetic plugin response — sufficient for integration tests that
    // do NOT spy on this module. AC-S7 explicitly stubs applyViaPluginBridge
    // via vi.spyOn so this default path runs only in unit-test contexts.
    return {
      nodeId: `bridge-${entry.frame_id}`,
      undo_descriptor: {
        type: "delete-node",
        node_id: `bridge-${entry.frame_id}`,
      },
    };
  },
};

let activeTransport: PluginBridgeTransport = defaultTransport;

export function setPluginBridgeTransport(
  transport: PluginBridgeTransport | null,
): void {
  activeTransport = transport ?? defaultTransport;
}

let writeIdCounter = 0;
function nextWriteId(): string {
  writeIdCounter += 1;
  return `wb-${Date.now().toString(36)}-${writeIdCounter}`;
}

export async function applyViaPluginBridge(
  entry: ManifestEntry,
  ctx: PluginBridgeContext,
): Promise<WriteResult> {
  const out = await activeTransport.send(entry, ctx);
  const undo_descriptor: UndoDescriptor = out.undo_descriptor ?? {
    type: "delete-node",
    node_id: out.nodeId,
  };
  return {
    status: "applied",
    write_id: nextWriteId(),
    undo_descriptor,
    fallback_used: true,
    node_id: out.nodeId,
  };
}
