#!/usr/bin/env node
// SPEC-FIGMA-009 REQ-02 / REQ-05 + SPEC-FIGMA-011 REQ-08 — Long-running stdio
// MCP wire transport.
//
// This entry hosts the SDK `Server` over `StdioServerTransport`, wires the
// read-only resource/tool surface from SPEC-FIGMA-006 (`McpResources`,
// `handleMcpToolCall`) plus the SPEC-FIGMA-007 write-path surface
// (`DaemonWriteExtension`, `WriteMcpResources`), and emits exactly one
// `client_profile_attached` audit row per `initialize` handshake (INV-W1).
// The booted JSON line owned by `runDaemonCli::cmdStart` is NEVER printed
// here (INV-W5).
//
// Lifecycle: process stays alive until stdin EOF (transport `onclose`) or
// SIGTERM/SIGINT (NFR-05 long-running guard).

import { join } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { isDirectInvocation } from "../direct-invocation.js";
import { DaemonAuditWriter } from "./audit-writer.js";
import { CapabilityProfileRegistry } from "./capability-profile-registry.js";
import { DaemonWriteExtension } from "./daemon-write-extension.js";
import { McpResources } from "./mcp-resources.js";
import {
  registerResourceHandlers,
  registerToolHandlers,
} from "./mcp-stdio-handlers.js";
import {
  createWriteResourceContext,
  createWriteToolContext,
} from "./mcp-stdio-write-handlers.js";
import {
  createExtraReadToolContext,
  type ExtraReadToolContext,
  type ManifestValidator,
} from "./mcp-extra-read-handlers.js";
import {
  createExtraWriteToolContext,
  type ExtraWriteToolContext,
  type DescriptionGenerator,
} from "./mcp-extra-write-handlers.js";
import {
  createBriefReadContext,
  createBriefWriteContext,
  type BriefReadContext,
  type BriefWriteContext,
} from "./mcp-brief-handlers.js";
import {
  createP2ReadContext,
  createP2WriteContext,
  type P2ContextOptions,
  type P2ReadContext,
  type P2WriteContext,
} from "./mcp-p2-handlers.js";
import {
  createVendorReadContext,
  type VendorReadContext,
} from "./mcp-vendor-read-handlers.js";
import {
  createVendorWriteContext,
  type VendorWriteContext,
} from "./mcp-vendor-write-handlers.js";
import type { FigmaPluginClient } from "./figma-plugin-client.js";
import type { WriteMcpResources } from "./write-mcp-resources.js";
import type { FigmaReadAdapter } from "../../types/figma-read-adapter.js";

// @AX:NOTE: [AUTO] magic constant — MCP server identity advertised in
// `initialize` response; clients (Codex CLI, Claude Code) match on this name.
const SERVER_NAME = "autopus-mcp-stdio";
// @AX:NOTE: [AUTO] magic constant — wire-protocol-visible server version.
// SPEC-FIGMA-014 bumps to 0.2.0 to signal the additive extra-tool surface.
const SERVER_VERSION = "0.2.0";
const DEFAULT_INSTRUCTIONS =
  "Read+write MCP wire surface for the Autopus daemon (6 resources, 9 baseline tools, optional figma_/validate/generate extras).";

export interface EmitClientProfileAttachedInput {
  readonly audit: DaemonAuditWriter;
  readonly registry: CapabilityProfileRegistry;
  readonly clientName: string;
}

/* @AX:WARN: [AUTO] single-row invariant — emits exactly one
 * `client_profile_attached` audit row per `initialize` handshake (INV-W1).
 * Caller (server.oninitialized) MUST fire once; duplicate invocations would
 * violate the invariant and pollute the audit timeline.
 * @AX:REASON: SPEC-FIGMA-009 INV-W1 — single audit emit per session attach;
 * downstream consumers count rows to derive session counts. */
export function emitClientProfileAttached(
  input: EmitClientProfileAttachedInput,
): void {
  const profile = input.registry.matchProfile({
    clientName: input.clientName,
    transport: "stdio",
  });
  if (!profile) return;
  input.audit.emitEvent({
    event: "client_profile_attached",
    client_id: input.clientName,
    transport: profile.transport,
    capabilities: [...profile.capabilities],
    profile_id: profile.profile_id,
    attached_at: new Date().toISOString(),
  });
}

export interface CreateMcpStdioServerInput {
  readonly mcp: McpResources;
  readonly registry: CapabilityProfileRegistry;
  readonly auditWriter: DaemonAuditWriter;
  readonly writeExtension?: DaemonWriteExtension;
  readonly writeResources?: WriteMcpResources;
  readonly auditLogPath?: string;
  // SPEC-FIGMA-014 — optional extra tool surfaces. Pass `figmaAdapter` +
  // `manifestValidator` to enable figma_*/validate_manifest reads; pass
  // `descriptionGenerator` to enable generate_description writes.
  readonly figmaAdapter?: FigmaReadAdapter;
  readonly manifestValidator?: ManifestValidator;
  readonly descriptionGenerator?: DescriptionGenerator;
  // SPEC-FIGMA-015 — optional project-brief surface. Pass `workspaceRoot` to
  // enable get_/validate_/init_/update_project_brief tools (4 entries, 2 read
  // + 2 write).
  readonly briefWorkspaceRoot?: string;
  // SPEC-FIGMA-016 — optional P2 operational surface. Pass `p2Context` to
  // enable batch/mode/preview/status tools (6 entries, 4 read + 2 write).
  readonly p2Context?: P2ContextOptions;
  // SPEC-FIGMA-017 — optional vendor design-creation surface. Pass an active
  // FigmaPluginClient to enable 46 vendor tools (13 read + 28 write + 5
  // [NEW] reclassification candidates) that forward to the rebranded
  // Autopus Figma plugin over the relay.
  readonly figmaPluginClient?: FigmaPluginClient;
}

/* @AX:ANCHOR: [AUTO] fan-in=4 — wires the SDK Server, registers resource/tool
 * handlers (read + optional write contexts), and binds the `oninitialized`
 * audit hook in one place. Callers: runMcpStdio (entry self-host),
 * figma-009 in-memory pair helper, figma-011 in-memory pair helper,
 * tool-surface unit test.
 * @AX:REASON: SPEC-FIGMA-009 REQ-02/REQ-05 + SPEC-FIGMA-011 REQ-01/REQ-05 —
 * single construction site for the stdio MCP surface; signature changes
 * cascade to every host and test harness. */
export function createMcpStdioServer(
  input: CreateMcpStdioServerInput,
): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: DEFAULT_INSTRUCTIONS,
      capabilities: { resources: {}, tools: {} },
    },
  );

  const writeToolContext =
    input.writeExtension !== undefined
      ? createWriteToolContext(input.writeExtension, {
          auditLogPath: input.auditLogPath,
        })
      : undefined;
  const writeResourceContext =
    input.writeResources !== undefined
      ? createWriteResourceContext(input.writeResources)
      : undefined;

  // SPEC-FIGMA-014 — both adapter and validator must be present to enable the
  // extra read surface (figma_* tools require an adapter; validate_manifest
  // requires the validator). Either-or activation is rejected here to keep the
  // wire contract well-defined.
  const extraReadToolContext: ExtraReadToolContext | undefined =
    input.figmaAdapter && input.manifestValidator
      ? createExtraReadToolContext({
          adapter: input.figmaAdapter,
          validator: input.manifestValidator,
        })
      : undefined;
  const extraWriteToolContext: ExtraWriteToolContext | undefined =
    input.descriptionGenerator
      ? createExtraWriteToolContext({
          generator: input.descriptionGenerator,
        })
      : undefined;

  const briefReadContext: BriefReadContext | undefined = input.briefWorkspaceRoot
    ? createBriefReadContext({ workspaceRoot: input.briefWorkspaceRoot })
    : undefined;
  const briefWriteContext: BriefWriteContext | undefined =
    input.briefWorkspaceRoot
      ? createBriefWriteContext({ workspaceRoot: input.briefWorkspaceRoot })
      : undefined;

  const p2ReadContext: P2ReadContext | undefined = input.p2Context
    ? createP2ReadContext(input.p2Context)
    : undefined;
  const p2WriteContext: P2WriteContext | undefined = input.p2Context
    ? createP2WriteContext(input.p2Context)
    : undefined;

  const vendorReadContext: VendorReadContext | undefined =
    input.figmaPluginClient
      ? createVendorReadContext({ client: input.figmaPluginClient })
      : undefined;
  const vendorWriteContext: VendorWriteContext | undefined =
    input.figmaPluginClient
      ? createVendorWriteContext({ client: input.figmaPluginClient })
      : undefined;

  registerResourceHandlers(server, {
    mcp: input.mcp,
    writeResourceContext,
  });
  registerToolHandlers(server, {
    writeToolContext,
    extraReadToolContext,
    extraWriteToolContext,
    briefReadContext,
    briefWriteContext,
    p2ReadContext,
    p2WriteContext,
    vendorReadContext,
    vendorWriteContext,
  });

  server.oninitialized = () => {
    const info = server.getClientVersion();
    emitClientProfileAttached({
      audit: input.auditWriter,
      registry: input.registry,
      clientName: info?.name ?? "unknown",
    });
  };

  return server;
}

export interface RunMcpStdioOptions {
  readonly auditDir?: string;
  readonly cwd?: string;
}

export async function runMcpStdio(
  opts: RunMcpStdioOptions = {},
): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const auditDir =
    opts.auditDir ?? process.env.AUTOPUS_AUDIT_DIR ?? join(cwd, ".autopus");
  const auditLogPath = join(auditDir, "write-audit.jsonl");

  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({
    auditDir,
    provider: "autopus-mcp-stdio",
  });
  const writeExtension = new DaemonWriteExtension();
  const writeResources = writeExtension.resources;

  const server = createMcpStdioServer({
    mcp,
    registry,
    auditWriter,
    writeExtension,
    writeResources,
    auditLogPath,
  });
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } catch {
      // Swallow close errors during shutdown — process exit follows.
    }
  };

  /* @AX:WARN: [AUTO] long-running guard — fire-and-forget shutdown promises;
   * failures inside `shutdown()` are swallowed so the process always exits 0.
   * Replacing `void` with `await` would deadlock under SIGTERM if `server.close`
   * hangs.
   * @AX:REASON: SPEC-FIGMA-009 NFR-05 — process MUST terminate promptly on
   * stdin EOF or signal; no awaiting on potentially-blocked transport teardown. */
  transport.onclose = () => {
    void shutdown().then(() => process.exit(0));
  };
  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });

  await server.connect(transport);
}

if (isDirectInvocation(import.meta.url)) {
  runMcpStdio().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`autopus-mcp-stdio: ${message}\n`);
    process.exit(1);
  });
}
