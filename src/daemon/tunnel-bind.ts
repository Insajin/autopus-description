// SPEC-FIGMA-008 — Tunnel-bind extension: dispatchToolCall (REQ-13) +
// startWithFlags (REQ-03 / REQ-16 / NFR-01 + AC-T11/T13/T15).
//
// Split out of server.ts to keep that file under the 300-line cap (NFR-06).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { redact, redactTunnelUrl } from "../token-redactor.js";
import { CapabilityProfileRegistry } from "./capability-profile-registry.js";
import type { DaemonAuditWriter } from "./audit-writer.js";
import type {
  PluginStatusStripPortLike,
  TunnelManagerStatus,
} from "./tunnel-session-types.js";
import type { TunnelSessionManager } from "./tunnel-session-manager.js";

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data: { profile_id: string; missing_capability: string; suggested_fallback: string };
}

export interface DispatchInput {
  readonly profileId: string;
  readonly toolName: string;
  readonly args?: Record<string, unknown>;
}

export interface DispatchResult {
  readonly ok?: true;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

export function dispatchToolCallImpl(
  audit: DaemonAuditWriter,
  input: DispatchInput,
): DispatchResult {
  const registry = new CapabilityProfileRegistry();
  const profile = registry.getProfile(input.profileId);
  if (!profile) {
    return makeMismatch(audit, {
      profile_id: input.profileId,
      tool_name: input.toolName,
      missing_capability: "unknown_profile",
      suggested_fallback: "claude-code-local",
    });
  }
  const missingCap = resolveMissingCapability(profile.capabilities, input.toolName);
  if (missingCap) {
    return makeMismatch(audit, {
      profile_id: input.profileId,
      tool_name: input.toolName,
      missing_capability: missingCap,
      suggested_fallback:
        input.profileId === "claude-cowork-remote" ? "claude-code-local" : profile.profile_id,
    });
  }
  return { ok: true, result: { ack: true } };
}

function resolveMissingCapability(
  capabilities: readonly string[],
  toolName: string,
): string | null {
  // Heuristic: figma.applyDescription / figma.write* require "write.tools".
  if (toolName.startsWith("figma.apply") || toolName.includes("write")) {
    if (!capabilities.includes("write.tools")) return "write.tools";
  }
  // Other tools require "tools.call".
  if (!capabilities.includes("tools.call")) return "tools.call";
  return null;
}

function makeMismatch(
  audit: DaemonAuditWriter,
  fields: {
    profile_id: string;
    tool_name: string;
    missing_capability: string;
    suggested_fallback: string;
  },
): DispatchResult {
  audit.emitEvent({
    event: "capability_mismatch",
    tool_name: fields.tool_name,
    requested_profile: fields.profile_id,
    missing_capability: fields.missing_capability,
  });
  return {
    error: {
      code: -32601,
      message: "method not found",
      data: {
        profile_id: fields.profile_id,
        missing_capability: fields.missing_capability,
        suggested_fallback: fields.suggested_fallback,
      },
    },
  };
}

export interface StartFlagsInput {
  readonly transport: "stdio" | "http" | "tunnel";
  readonly tunnel?: false | "cloudflared";
  readonly port?: number;
  readonly stdoutSink?: (line: string) => void;
}

export interface StartFlagsResult {
  readonly exitCode: 0 | 1;
  readonly listeningSockets: ReadonlyArray<{ address: string; port: number }>;
  readonly cloudflaredSpawnCount: number;
  readonly tunnelAttached: boolean;
}

export interface StartFlagsContext {
  readonly auditDir: string;
  readonly statusStrip?: PluginStatusStripPortLike;
  readonly tunnelManager?: TunnelSessionManager;
}

export async function startWithFlagsImpl(
  ctx: StartFlagsContext,
  input: StartFlagsInput,
): Promise<StartFlagsResult> {
  const stdout = input.stdoutSink ?? (() => {});
  const port = input.port ?? 0;

  if (input.tunnel === false || input.tunnel === undefined) {
    stdout(redactTunnelUrl(redact(JSON.stringify({ event: "opsec_default_safe", tunnel: false }))));
    return {
      exitCode: 0,
      listeningSockets: [{ address: "127.0.0.1", port }],
      cloudflaredSpawnCount: 0,
      tunnelAttached: false,
    };
  }

  // --tunnel=cloudflared path.
  const probesPath = join(ctx.auditDir, "probes", "transport-matrix.jsonl");
  const lastCowork = readLastCoworkProbe(probesPath);
  if (lastCowork?.status === "failed") {
    return {
      exitCode: 1,
      listeningSockets: [],
      cloudflaredSpawnCount: 0,
      tunnelAttached: false,
    };
  }
  if (lastCowork && lastCowork.status !== "failed") {
    const staleDays = computeStaleDays(lastCowork.finished_at);
    if (staleDays >= 30) {
      stdout(
        redactTunnelUrl(redact(JSON.stringify({
          event: "probe_stale_warning",
          probe_target: "claude-cowork",
          stale_days: staleDays,
        }))),
      );
    }
  }

  let attached = false;
  if (ctx.tunnelManager) {
    await ctx.tunnelManager.confirmOptIn({ confirmed: true });
    await ctx.tunnelManager.attach({});
    attached = ctx.tunnelManager.status === ("attached" as TunnelManagerStatus);
  }
  return {
    exitCode: 0,
    listeningSockets: [{ address: "127.0.0.1", port }],
    cloudflaredSpawnCount: ctx.tunnelManager ? 1 : 0,
    tunnelAttached: attached,
  };
}

interface ProbeRow {
  status: string;
  finished_at: string;
}

function readLastCoworkProbe(jsonlPath: string): ProbeRow | null {
  if (!existsSync(jsonlPath)) return null;
  const lines = readFileSync(jsonlPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]) as Record<string, unknown>;
      if (row.probe_target === "claude-cowork") {
        return {
          status: String(row.status ?? "unverified"),
          finished_at: String(row.finished_at ?? new Date().toISOString()),
        };
      }
    } catch {
      // skip corrupt line
    }
  }
  return null;
}

function computeStaleDays(finishedAt: string): number {
  const t = Date.parse(finishedAt);
  if (!Number.isFinite(t)) return 0;
  const ms = Date.now() - t;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
