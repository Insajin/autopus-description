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
import type { WriteMcpResources } from "./write-mcp-resources.js";

// @AX:NOTE: [AUTO] magic constant — MCP server identity advertised in
// `initialize` response; clients (Codex CLI, Claude Code) match on this name.
const SERVER_NAME = "autopus-mcp-stdio";
// @AX:NOTE: [AUTO] magic constant — wire-protocol-visible server version.
const SERVER_VERSION = "0.1.0";
const DEFAULT_INSTRUCTIONS =
  "Read+write MCP wire surface for the Autopus daemon (6 resources, 9 tools).";

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

  registerResourceHandlers(server, {
    mcp: input.mcp,
    writeResourceContext,
  });
  registerToolHandlers(server, { writeToolContext });

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
