// SPEC-FIGMA-007 REQ-08 — daemon undoWrite tool. Looks up the
// DaemonUndoRecord, serializes the UndoDescriptor into an inverse
// PluginCommand, dispatches via the WebSocket bridge to the plugin, and on
// success: clears the manifest_entry_hash from IdempotencyTracker (so
// re-apply is permitted), removes the write_id from DaemonUndoRegistry,
// publishes an UNDO_REQUESTED audit row, and removes the entry from
// `autopus://applied_writes`.

import type { IdempotencyTracker } from "../../packages/write-router/src/idempotency.js";
import type { UndoDescriptor } from "../../packages/write-router/src/types.js";
import type { DaemonUndoRegistry } from "./daemon-undo-registry.js";
import type { PluginCommand } from "./types-internal.js";
import type { WriteMcpResources } from "./write-mcp-resources.js";
import type { PluginBridgeLike } from "./apply-tool.js";
import { appendAuditUndo } from "./write-audit.js";

export interface UndoArgs {
  write_id: string;
}

export interface UndoDeps {
  bridge: PluginBridgeLike | null;
  idempotency: IdempotencyTracker;
  undoRegistry: DaemonUndoRegistry;
  resources: WriteMcpResources;
  pmIdentity?: string;
  auditEvents: Array<Record<string, unknown>>;
}

export type UndoResult =
  | { status: "undone"; write_id: string; manifest_entry_hash: string }
  | { error: "UNKNOWN_WRITE_ID"; message: string };

export function inverseCommand(descriptor: UndoDescriptor): PluginCommand {
  switch (descriptor.type) {
    case "delete-node":
      return {
        op: "noop", // Inverse "delete_node" routes through plugin's autopus_command_dispatch.
        args: {} as never,
      };
    case "delete-comment":
    case "clear-plugin-data":
    case "restore-frame-name":
    case "noop":
    default:
      return { op: "noop", args: {} };
  }
}

// Concrete inverse command for the bridge — uses the extended op set the
// MockPluginBridge accepts (delete_node, delete_comment, clear_plugin_data,
// restore_frame_name). Falls back to noop for the writer-router's UndoDescriptor
// noop variant.
function bridgeInverseCommand(d: UndoDescriptor): {
  op:
    | "delete_node"
    | "delete_comment"
    | "clear_plugin_data"
    | "restore_frame_name"
    | "restore_annotation"
    | "noop";
  args: Record<string, unknown>;
} {
  switch (d.type) {
    case "delete-node":
      return { op: "delete_node", args: { node_id: d.node_id } };
    case "delete-comment":
      return { op: "delete_comment", args: { comment_id: d.comment_id } };
    case "clear-plugin-data":
      return { op: "clear_plugin_data", args: { node_id: d.node_id, key: d.key } };
    case "restore-frame-name":
      return {
        op: "restore_frame_name",
        args: { node_id: d.node_id, original_name: d.original_name },
      };
    case "restore-annotation":
      // @AX:NOTE: [AUTO] SPEC-FIGMA-021 REQ-06 live wire — restore_annotation op added here;
      //           field name `node_id` (snake_case) must match the dispatchInverse arm in autopus_command_dispatch.ts.
      // SPEC-FIGMA-021 REQ-06 — emit the real inverse carrying the prior
      // snapshot so the bundled plugin dispatch can write node.annotations back
      // (empty prior clears to []). Field name `node_id` matches dispatchInverse.
      return { op: "restore_annotation", args: { node_id: d.node_id, prior: d.prior } };
    case "native-with-card":
      // @AX:NOTE: [AUTO] leading-inverse stub — bridgeInverseCommand returns only the card delete-node here;
      //           the full ordered sequence (card first, then each native) is assembled by compoundInverseCommands.
      // SPEC-FIGMA-020 REQ-08 — the compound inverse is dispatched as an ORDERED
      // sequence (card delete-node first, then each native restore-annotation) by
      // `compoundInverseCommands`; this single-command surface returns the CARD
      // delete-node as the leading inverse (skip when node_id is empty sentinel).
      if (d.card.node_id !== "") {
        return { op: "delete_node", args: { node_id: d.card.node_id } };
      }
      // Card node_id is the empty sentinel (voided on cardFailed multi-native path):
      // fall back to the first native restore as the leading inverse.
      return d.natives.length > 0
        ? bridgeInverseCommand(d.natives[0])
        : { op: "noop", args: {} };
    case "noop":
      return { op: "noop", args: {} };
  }
}

// @AX:ANCHOR: [AUTO] ordered compound inverse — card delete-node MUST precede native restore-annotation
// @AX:REASON: the Figma plugin applies ops sequentially; reversing the order (native first, card second)
//             would attempt to restore annotations on a node that still has the card attached, producing
//             an inconsistent canvas state that cannot be recovered without a second manual undo.
// SPEC-FIGMA-020 REQ-08 — the compound `native-with-card` undo reverses BOTH
// surfaces in one invocation, ordered to match the adapter's
// `undoNativeAnnotationWithCard`: the CARD (delete-node) is reversed FIRST, then
// the NATIVE (restore-annotation write-back). Each member reuses the existing
// per-variant inverse logic rather than reimplementing it. Flat descriptors
// produce exactly one inverse command (unchanged behavior).
function compoundInverseCommands(d: UndoDescriptor): Array<{
  op:
    | "delete_node"
    | "delete_comment"
    | "clear_plugin_data"
    | "restore_frame_name"
    | "restore_annotation"
    | "noop";
  args: Record<string, unknown>;
}> {
  if (d.type === "native-with-card") {
    // SPEC-FIGMA-020 REQ-08 — card delete-node FIRST (skip when node_id is the
    // empty sentinel), then each native restore-annotation in order.
    const cmds: ReturnType<typeof bridgeInverseCommand>[] = [];
    if (d.card.node_id !== "") {
      cmds.push(bridgeInverseCommand(d.card));
    }
    for (const n of d.natives) {
      cmds.push(bridgeInverseCommand(n));
    }
    return cmds;
  }
  return [bridgeInverseCommand(d)];
}

export async function undoWrite(
  deps: UndoDeps,
  args: UndoArgs,
): Promise<UndoResult> {
  const record = deps.undoRegistry.get(args.write_id);
  if (!record) {
    return {
      error: "UNKNOWN_WRITE_ID",
      message: `no undo record for write_id ${args.write_id}`,
    };
  }
  if (deps.bridge) {
    // SPEC-FIGMA-020 REQ-08 — flat descriptors yield one inverse command;
    // the compound `native-with-card` yields the ordered pair (card delete-node
    // first, then native restore-annotation) so one undo reverses both surfaces.
    const inverses = compoundInverseCommands(record.descriptor);
    for (const inv of inverses) {
      await deps.bridge.dispatchCommand(inv as unknown as PluginCommand, args.write_id);
    }
  }
  // Clear idempotency for THIS hash only. SPEC-FIGMA-004 IdempotencyTracker
  // exposes a `clear()` (whole-set clear); we mimic per-hash clearing by
  // removing all hashes and re-adding the rest. Daemon-process-local registry
  // size stays small (per-process) so this is cheap.
  const tracker = deps.idempotency as unknown as {
    has(h: string): boolean;
    clear(): void;
    record(h: string): void;
    seen?: Set<string>;
  };
  if (tracker.has(record.manifest_entry_hash)) {
    // @AX:WARN: [AUTO] per-hash clear workaround — IdempotencyTracker exposes only a whole-set clear();
    // @AX:REASON: the clear-and-re-add approach relies on the `seen` internal Set being accessible; if
    //             IdempotencyTracker is refactored to remove or rename `seen`, all hashes are silently
    //             dropped on undo (every previously-applied write becomes re-applicable). Add a per-hash
    //             remove API to IdempotencyTracker to eliminate this dependency.
    // Snapshot all currently-tracked hashes (best-effort), clear, and re-add
    // everything except the undone one.
    const remembered = new Set<string>();
    if (tracker.seen instanceof Set) {
      for (const h of tracker.seen) {
        if (h !== record.manifest_entry_hash) remembered.add(h);
      }
    }
    tracker.clear();
    for (const h of remembered) tracker.record(h);
  }
  deps.undoRegistry.remove(args.write_id);
  deps.resources.removeApplied(args.write_id);
  const row = await appendAuditUndo({
    frame_id: record.frame_id,
    manifest_entry_hash: record.manifest_entry_hash,
    pm_identity_or_unknown: deps.pmIdentity ?? "unknown",
    write_target: record.write_target,
  });
  deps.auditEvents.push(row);
  return {
    status: "undone",
    write_id: args.write_id,
    manifest_entry_hash: record.manifest_entry_hash,
  };
}

/** Replay inverse commands for a partially-completed apply on plugin reconnect.
 * Dispatches in reverse order. Best-effort: per-step bridge errors are
 * swallowed, and a `reconnect()` callback (if exposed) is invoked between
 * steps so a flaky bridge that re-drops post-success can continue replaying
 * the remaining inverses. REQ-14 mandates best-effort rollback. */
export async function replayPartialRollback(
  bridge: PluginBridgeLike,
  completedCommands: PluginCommand[],
): Promise<void> {
  const maybeReconnect = (bridge as { reconnect?: () => void }).reconnect;
  for (let i = completedCommands.length - 1; i >= 0; i -= 1) {
    const cmd = completedCommands[i];
    const inv = forwardToInverse(cmd);
    if (typeof maybeReconnect === "function") maybeReconnect.call(bridge);
    try {
      await bridge.dispatchCommand(inv as unknown as PluginCommand, undefined);
    } catch {
      /* best-effort rollback; per-step failure does not abort the loop */
    }
  }
}

function forwardToInverse(c: PluginCommand): {
  op: string;
  args: Record<string, unknown>;
} {
  switch (c.op) {
    // SPEC-FIGMA-022 — the legacy text-card op (renamed from set_annotation)
    // creates a node, so its inverse is delete_node. The native annotation op
    // (set_native_annotation) is reversed via restore-annotation, not here.
    case "set_annotation_card":
    case "upsert_descriptions_page_node":
      return { op: "delete_node", args: {} };
    case "post_comment":
      return { op: "delete_comment", args: {} };
    case "set_plugin_data":
      return {
        op: "clear_plugin_data",
        args: { node_id: c.args.nodeId, key: c.args.key },
      };
    case "set_frame_name":
      return {
        op: "restore_frame_name",
        args: { node_id: c.args.nodeId, original_name: c.args.originalName },
      };
    case "noop":
    default:
      return { op: "noop", args: {} };
  }
}
