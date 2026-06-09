// SPEC-FIGMA-007 REQ-05, REQ-06, REQ-07, REQ-14, REQ-15, REQ-19 — daemon
// applyApprovedWrite tool. Drives the dryRun → apply state machine and
// integrates idempotency, drift guard, plugin command dispatch, partial
// disconnect rollback, and applied-writes publishing.

import { IdempotencyTracker } from "../../packages/write-router/src/idempotency.js";
import type {
  PluginCommand,
  PendingWriteStore,
  PendingWrite,
} from "./types-internal.js";
import type {
  AppliedWrite,
  WriteMcpResources,
} from "./write-mcp-resources.js";
import type { DaemonUndoRegistry } from "./daemon-undo-registry.js";
import {
  appendAuditDriftAbort,
  appendAuditMissingGate,
  appendAuditPartialDisconnect,
  appendAuditPendingExpired,
  appendAuditSkipped,
  appendAuditSuccess,
} from "./write-audit.js";
import type { UndoDescriptor } from "../../packages/write-router/src/types.js";
import { redactAndMinimizePrior } from "./redact-prior-annotation.js";

// SPEC-FIGMA-018 REQ-14 — re-export so the daemon test (and any caller) can
// import the capture-time redaction helper from `apply-tool.js`.
export { redactAndMinimizePrior };

export interface PluginBridgeLike {
  dispatchCommand(
    cmd: PluginCommand,
    pendingId?: string,
  ): Promise<{ ok: boolean; node_ids?: string[]; error?: string }>;
}

export interface ApplyArgs {
  pending_id: string;
  source_hash_recomputed: string;
}

export interface ApplyDeps {
  store: PendingWriteStore;
  bridge: PluginBridgeLike | null;
  idempotency: IdempotencyTracker;
  undoRegistry: DaemonUndoRegistry;
  resources: WriteMcpResources;
  pmIdentity?: string;
  auditEvents: Array<Record<string, unknown>>;
  pendingForReplay: Map<string, { commands: PluginCommand[]; pending: PendingWrite }>;
  // SPEC-FIGMA-007 REQ-10 — extend INV-003 hash chain across the write event.
  // Optional callback the daemon wires to its SPEC-FIGMA-006 audit writer
  // (this.audit.emit). When omitted the chain is not extended for that apply.
  emitDaemonAudit?: (input: { prompt_text: string; response_text: string }) => void;
}

export type ApplyResult =
  | {
      status: "applied";
      write_id: string;
      manifest_entry_hash: string;
      undo_descriptor: UndoDescriptor;
      frame_id: string;
      write_target: string;
    }
  | {
      status: "skipped";
      reason: "IDEMPOTENT_SKIP";
      manifest_entry_hash: string;
    }
  | {
      error: "MISSING_DRYRUN_GATE" | "PENDING_EXPIRED" | "APPLY_DRIFT_ABORT";
      message: string;
      source_hash_dryrun?: string;
      source_hash_recomputed?: string;
    };

let writeIdCounter = 0;
function nextWriteId(): string {
  writeIdCounter += 1;
  return `wr-${Date.now().toString(36)}-${writeIdCounter}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pmId(deps: ApplyDeps): string {
  return deps.pmIdentity ?? "unknown";
}

function hydrateUndoDescriptor(
  template: UndoDescriptor | undefined,
  nodeIds: string[],
): UndoDescriptor {
  if (!template) return { type: "noop" };
  switch (template.type) {
    case "delete-node":
      return { type: "delete-node", node_id: nodeIds[0] ?? template.node_id };
    case "delete-comment":
      return { type: "delete-comment", comment_id: nodeIds[0] ?? template.comment_id };
    case "clear-plugin-data":
      return { ...template };
    case "restore-frame-name":
      return { ...template };
    case "restore-annotation":
      // SPEC-FIGMA-018 — node_id hydrated from the plugin result; the captured
      // prior snapshot array is carried through unchanged.
      return {
        type: "restore-annotation",
        node_id: nodeIds[0] ?? template.node_id,
        prior: template.prior,
      };
    case "noop":
      return { type: "noop" };
  }
}

export async function applyApprovedWrite(
  deps: ApplyDeps,
  args: ApplyArgs,
): Promise<ApplyResult> {
  // 1. Atomicity gate: pending_id MUST exist.
  const lookup = deps.store.get(args.pending_id);
  if (!lookup.record && !lookup.expired) {
    const row = await appendAuditMissingGate({
      frame_id: "",
      manifest_entry_hash: "",
      pm_identity_or_unknown: pmId(deps),
      write_target: "",
    });
    deps.auditEvents.push(row);
    return {
      error: "MISSING_DRYRUN_GATE",
      message: `no pending_id matches ${args.pending_id}; call autopus.dryRunWrite first`,
    };
  }
  if (lookup.expired) {
    const row = await appendAuditPendingExpired({
      frame_id: "",
      manifest_entry_hash: "",
      pm_identity_or_unknown: pmId(deps),
      write_target: "",
    });
    deps.auditEvents.push(row);
    return {
      error: "PENDING_EXPIRED",
      message: `pending_id ${args.pending_id} expired; rerun dryRun`,
    };
  }
  const pending = lookup.record!;

  // 2. Drift guard: byte-equal hash compare.
  if (args.source_hash_recomputed !== pending.source_hash_dryrun) {
    const row = await appendAuditDriftAbort({
      frame_id: pending.frame_id,
      manifest_entry_hash: pending.manifest_entry_hash,
      pm_identity_or_unknown: pmId(deps),
      write_target: pending.write_target,
      source_hash_dryrun: pending.source_hash_dryrun,
      source_hash_recomputed: args.source_hash_recomputed,
    });
    deps.auditEvents.push(row);
    return {
      error: "APPLY_DRIFT_ABORT",
      message: "source_hash drift detected; rerun dryRun",
      source_hash_dryrun: pending.source_hash_dryrun,
      source_hash_recomputed: args.source_hash_recomputed,
    };
  }

  // 3. Idempotency: hash already applied → skipped (no plugin dispatch).
  if (deps.idempotency.has(pending.manifest_entry_hash)) {
    const row = await appendAuditSkipped({
      frame_id: pending.frame_id,
      manifest_entry_hash: pending.manifest_entry_hash,
      pm_identity_or_unknown: pmId(deps),
      write_target: pending.write_target,
    });
    deps.auditEvents.push(row);
    deps.store.remove(args.pending_id);
    return {
      status: "skipped",
      reason: "IDEMPOTENT_SKIP",
      manifest_entry_hash: pending.manifest_entry_hash,
    };
  }

  // 4. Dispatch plugin commands. On any failure mid-stream, treat as partial
  // disconnect (REQ-14) and stash completed commands for reconnect rollback.
  if (!deps.bridge) {
    throw new Error("plugin bridge not attached — call attachPluginBridge before applyApprovedWrite");
  }
  const completed: PluginCommand[] = [];
  const collectedNodeIds: string[] = [];
  try {
    for (const cmd of pending.plugin_commands) {
      const res = await deps.bridge.dispatchCommand(cmd, pending.pending_id);
      if (!res.ok) throw new Error(res.error ?? "plugin_command_failed");
      completed.push(cmd);
      for (const id of res.node_ids ?? []) collectedNodeIds.push(id);
    }
  } catch (err) {
    deps.pendingForReplay.set(pending.pending_id, { commands: completed, pending });
    const row = await appendAuditPartialDisconnect({
      frame_id: pending.frame_id,
      manifest_entry_hash: pending.manifest_entry_hash,
      pm_identity_or_unknown: pmId(deps),
      write_target: pending.write_target,
    });
    deps.auditEvents.push(row);
    throw err instanceof Error ? err : new Error(String(err));
  }

  // 5. Success path. Record idempotency + undo + audit + applied_writes.
  const write_id = nextWriteId();
  deps.idempotency.record(pending.manifest_entry_hash);
  const hydrated = hydrateUndoDescriptor(pending.undo_template, collectedNodeIds);
  // SPEC-FIGMA-018 REQ-14 (INV-011): the captured prior `node.annotations` is
  // untrusted input. Redact + minimize it BEFORE it is persisted in AppliedWrite
  // or served via autopus://applied_writes (the read-path redactor only catches
  // figd_). Undo consequently restores the redacted minimized prior state.
  // @AX:WARN [AUTO]: security wiring — this branch MUST run before recordApplied/register/applied_writes (REQ-14, INV-011).
  // @AX:REASON: restore-annotation is the only descriptor carrying untrusted captured prior annotations. Moving redactAndMinimizePrior after deps.resources.recordApplied or deps.undoRegistry.register would persist/serve the raw secret. `descriptor` (not `hydrated`) is intentionally reused for both undo registration and the AppliedWrite payload.
  const descriptor: UndoDescriptor =
    hydrated.type === "restore-annotation"
      ? redactAndMinimizePrior(hydrated)
      : hydrated;
  deps.undoRegistry.register({
    write_id,
    frame_id: pending.frame_id,
    manifest_entry_hash: pending.manifest_entry_hash,
    write_target: pending.write_target,
    descriptor,
    applied_at: nowIso(),
  });
  const row = await appendAuditSuccess({
    frame_id: pending.frame_id,
    manifest_entry_hash: pending.manifest_entry_hash,
    pm_identity_or_unknown: pmId(deps),
    write_target: pending.write_target,
  });
  deps.auditEvents.push(row);
  // SPEC-FIGMA-007 REQ-10: extend INV-003 daemon-emitter chain across write.
  // The prompt_text is the canonical apply intent for this frame; response_text
  // is the write_id assigned. Both run through redact at the daemon-emitter layer.
  if (deps.emitDaemonAudit) {
    deps.emitDaemonAudit({
      prompt_text: `${pending.frame_id}:${pending.write_target}:${pending.manifest_entry_hash}`,
      response_text: write_id,
    });
  }
  const applied: AppliedWrite = {
    write_id,
    frame_id: pending.frame_id,
    write_target: pending.write_target,
    manifest_entry_hash: pending.manifest_entry_hash,
    undo_descriptor: descriptor,
    applied_at: row.timestamp_iso as string,
  };
  deps.resources.recordApplied(applied);
  deps.store.remove(args.pending_id);
  return {
    status: "applied",
    write_id,
    manifest_entry_hash: pending.manifest_entry_hash,
    undo_descriptor: descriptor,
    frame_id: pending.frame_id,
    write_target: pending.write_target,
  };
}
