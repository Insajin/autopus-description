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

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
import { FigmaPluginClient } from "./figma-plugin-client.js";
import { FigmaRelay } from "./figma-relay.js";
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

/* C-1 UX: the relay binds to a per-session secret channel, and the Figma plugin
 * cannot connect until the user pastes that secret into its Connect field.
 * Surface the secret in the MCP server instructions so the connected agent can
 * proactively relay it to the user — no manual file lookup needed. The MCP stdio
 * pipe is already a trusted operator channel, so this does not weaken C-1 (an
 * unprivileged process has no access to these instructions). */
function figmaChannelInstruction(channel: string): string {
  return (
    `Figma plugin channel secret for THIS session: ${channel}\n` +
    `When the user wants to use the Autopus Figma plugin, proactively tell them ` +
    `this secret and have them paste it into the plugin's channel field, then ` +
    `click Connect. The plugin cannot connect until they do (security audit C-1).`
  );
}

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
  // C-1 — the per-session relay channel secret. When provided, it is surfaced
  // in the server instructions so the connected agent can relay it to the user.
  readonly figmaChannel?: string;
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
  const instructions = input.figmaChannel
    ? `${DEFAULT_INSTRUCTIONS}\n\n${figmaChannelInstruction(input.figmaChannel)}`
    : DEFAULT_INSTRUCTIONS;
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions,
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
    figmaChannel: input.figmaChannel,
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

  /* SPEC-FIGMA-017 — boot the Figma relay and plugin client so the 46 vendor
   * design tools (create_frame, set_fill_color, ...) can reach the Autopus
   * Figma plugin without the caller having to wire FigmaPluginClient
   * manually. Channel defaults to "autopus" so single-user single-session
   * setups (the 99% case) need zero configuration; multi-session callers
   * override with FIGMA_CHANNEL. The relay binds 127.0.0.1 only. */
  /* C-1 (security audit): the join channel doubles as the only access-control
   * gate on the relay. A fixed, OSS-published default ("autopus") is effectively
   * unauthenticated — any local process can join and inject mutation commands.
   * Default to a random per-session secret instead; FIGMA_CHANNEL still overrides
   * for advanced/CI setups. The secret is surfaced to the operator (stderr + a
   * gitignored file) so they can paste it into the plugin's Connect field. */
  const explicitChannel = process.env.FIGMA_CHANNEL;
  const channelFile = join(auditDir, "figma-channel.txt");
  let figmaChannel: string;
  if (explicitChannel) {
    figmaChannel = explicitChannel;
  } else {
    // P2-9: reuse a stable per-project secret across daemon restarts so the
    // operator pastes it into the plugin once, instead of a fresh secret every
    // boot. Still a random, gitignored secret (C-1). FIGMA_CHANNEL overrides.
    let existing = "";
    try {
      existing = readFileSync(channelFile, "utf8").trim();
    } catch {
      /* no prior secret — generate one below */
    }
    if (/^[0-9a-f]{32}$/.test(existing)) {
      figmaChannel = existing;
    } else {
      figmaChannel = randomBytes(16).toString("hex");
      try {
        writeFileSync(channelFile, figmaChannel + "\n", "utf8");
      } catch {
        /* non-fatal — stderr still carries the secret */
      }
    }
    process.stderr.write(
      `autopus-mcp-stdio: figma channel secret = ${figmaChannel}\n` +
        `  paste this into the Autopus plugin's channel field to connect ` +
        `(also at ${channelFile})\n`,
    );
  }
  const relay = new FigmaRelay({ port: 3055, allowedChannel: figmaChannel });
  let figmaPluginClient: FigmaPluginClient | undefined;
  try {
    await relay.start();
    figmaPluginClient = new FigmaPluginClient({
      url: "ws://127.0.0.1:3055",
      channel: figmaChannel,
      timeoutMs: 30_000,
    });
    // Non-blocking connect — the plugin may not be open yet. Vendor tool
    // calls will return PLUGIN_NOT_CONNECTED until both sides are joined.
    figmaPluginClient.connect().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `autopus-mcp-stdio: figma plugin client connect deferred: ${message}\n`,
      );
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `autopus-mcp-stdio: figma relay start failed: ${message}\n`,
    );
    figmaPluginClient = undefined;
  }

  const server = createMcpStdioServer({
    mcp,
    registry,
    auditWriter,
    writeExtension,
    writeResources,
    auditLogPath,
    figmaPluginClient,
    figmaChannel,
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
    try {
      if (figmaPluginClient) await figmaPluginClient.close();
    } catch {
      /* swallow */
    }
    try {
      await relay.stop();
    } catch {
      /* swallow */
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
