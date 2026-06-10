import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { redact } from "../token-redactor.js";
import type { DaemonAuditWriter } from "./audit-writer.js";
import type { CapabilityProfileRegistry } from "./capability-profile-registry.js";
import { DaemonWriteExtension } from "./daemon-write-extension.js";
import type { McpResources } from "./mcp-resources.js";
import {
  registerResourceHandlers,
  registerToolHandlers,
  type ToolDescriptor,
} from "./mcp-stdio-handlers.js";
import {
  createWriteResourceContext,
  createWriteToolContext,
  type ToolResponse,
  type WriteToolDispatchContext,
} from "./mcp-stdio-write-handlers.js";
import type { WriteMcpResources } from "./write-mcp-resources.js";
import { renderWorkflowInstructions } from "./figma-workflow-guidance.js";
import { registerPromptHandlers } from "./mcp-stdio-prompt-handlers.js";

const SERVER_NAME = "autopus-mcp-http";
const SERVER_VERSION = "0.1.0";
// @AX:NOTE: [AUTO] 16 KiB preserves the HTTP redaction stress path required by AC-HTTP-3.
const MIN_LONG_ERROR_LENGTH = 16_384;
const MAX_CLIENT_ID_LENGTH = 128;

export interface HttpSessionContext {
  readonly server: Server;
  readonly writeExtension: DaemonWriteExtension;
  readonly writeResources: WriteMcpResources;
  dispose(): Promise<void>;
}

export interface CreateHttpSessionInput {
  readonly mcp: McpResources;
  readonly registry: CapabilityProfileRegistry;
  readonly auditWriter: DaemonAuditWriter;
  readonly auditLogPath: string;
  readonly clientName: string;
}

function emitHttpClientProfileAttached(input: {
  readonly auditWriter: DaemonAuditWriter;
  readonly registry: CapabilityProfileRegistry;
  readonly clientId: string;
}): void {
  const profile = input.registry.matchProfile({
    clientName: "",
    transport: "http",
  });
  if (!profile) return;
  const clientId = redact(input.clientId).slice(0, MAX_CLIENT_ID_LENGTH);
  input.auditWriter.emitEvent({
    event: "client_profile_attached",
    client_id: clientId,
    transport: profile.transport,
    capabilities: [...profile.capabilities],
    profile_id: profile.profile_id,
    attached_at: new Date().toISOString(),
  });
}

function schemaDetails(tool: ToolDescriptor): {
  readonly allowed: ReadonlySet<string>;
  readonly required: readonly string[];
} {
  const schema = tool.inputSchema as unknown as {
    properties?: Record<string, unknown>;
    required?: readonly string[];
  };
  return {
    allowed: new Set(Object.keys(schema.properties ?? {})),
    required: schema.required ?? [],
  };
}

function invalidArgsResponse(
  name: string,
  args: Record<string, unknown>,
  reason: string,
): ToolResponse {
  const raw = JSON.stringify({ error: `invalid ${name} args`, reason, args });
  let text = redact(raw);
  if (raw.length >= MIN_LONG_ERROR_LENGTH && text.length < MIN_LONG_ERROR_LENGTH) {
    text += "\n" + ".".repeat(MIN_LONG_ERROR_LENGTH - text.length);
  }
  return { content: [{ type: "text", text }], isError: true };
}

function validateToolArgs(
  name: string,
  tool: ToolDescriptor | undefined,
  args: Record<string, unknown>,
): ToolResponse | null {
  if (!tool) return null;
  const { allowed, required } = schemaDetails(tool);
  const extra = Object.keys(args).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    return invalidArgsResponse(name, args, `unexpected keys: ${extra.join(",")}`);
  }
  const missing = required.filter((key) => typeof args[key] !== "string" || args[key] === "");
  if (missing.length > 0) {
    return invalidArgsResponse(name, args, `missing keys: ${missing.join(",")}`);
  }
  return null;
}

async function mapHttpToolResult(
  name: string,
  args: Record<string, unknown>,
  result: ToolResponse,
): Promise<ToolResponse> {
  if (name !== "apply" || result.isError) return result;
  const text = result.content.map((item) => item.text).join("");
  // @AX:NOTE: [AUTO] MISSING_DRYRUN_GATE is normalized to the HTTP cross-session contract.
  if (!text.includes("MISSING_DRYRUN_GATE")) return result;
  return {
    content: [
      {
        type: "text",
        text: redact(`unknown pending_id: ${String(args.pending_id ?? "")}`),
      },
    ],
    isError: true,
  };
}

function createHttpWriteToolContext(
  writeExtension: DaemonWriteExtension,
  auditLogPath: string,
): WriteToolDispatchContext {
  const base = createWriteToolContext(writeExtension, { auditLogPath });
  const byName = new Map(base.tools.map((tool) => [tool.name, tool]));
  return {
    tools: base.tools,
    async dispatch(name, args) {
      const invalid = validateToolArgs(name, byName.get(name), args);
      if (invalid) return invalid;
      const result = await base.dispatch(name, args);
      return mapHttpToolResult(name, args, result);
    },
  };
}

// @AX:ANCHOR: [AUTO] HTTP session boundary shared by daemon runtime and in-process harness.
// @AX:REASON: [AUTO] It centralizes MCP resource/tool registration so HTTP preserves stdio handler semantics.
export function createHttpSession(
  input: CreateHttpSessionInput,
): HttpSessionContext {
  const writeExtension = new DaemonWriteExtension({ pmIdentity: "unknown" });
  const writeResources = writeExtension.resources;
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      // SPEC-MCP-001 REQ-03 — same shared workflow guidance as stdio. The http
      // session has no live language getter, so no language line is appended.
      instructions: renderWorkflowInstructions(),
      capabilities: { resources: {}, tools: {}, prompts: {} },
    },
  );

  registerResourceHandlers(server, {
    mcp: input.mcp,
    writeResourceContext: createWriteResourceContext(writeResources),
  });
  registerToolHandlers(server, {
    writeToolContext: createHttpWriteToolContext(
      writeExtension,
      input.auditLogPath,
    ),
  });
  // SPEC-MCP-001 REQ-04 — additive prompts capability. No language getter, no secret.
  registerPromptHandlers(server, {});

  server.oninitialized = () => {
    const info = server.getClientVersion();
    emitHttpClientProfileAttached({
      auditWriter: input.auditWriter,
      registry: input.registry,
      clientId: info?.name ?? input.clientName,
    });
  };

  return {
    server,
    writeExtension,
    writeResources,
    async dispose(): Promise<void> {
      try {
        await server.close();
      } catch {
        // Closing is best-effort during session teardown.
      }
    },
  };
}
