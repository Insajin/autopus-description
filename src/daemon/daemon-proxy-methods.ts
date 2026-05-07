// SPEC-FIGMA-007 — extracted Daemon write-path proxy methods.
//
// These thin one-line proxies forward calls to the DaemonWriteExtension. They
// were inlined on the Daemon class until server.ts crossed the 300-line hard
// limit (NFR-06). Splitting into a free factory keeps server.ts under 295
// while preserving the public Daemon surface byte-equal — `Object.assign(this,
// buildWriteProxies(this.write))` in the constructor restores the same call
// sites for tests and external callers.

import type { WriteTarget } from "../../packages/write-router/src/types.js";
import type { DaemonWriteExtension } from "./daemon-write-extension.js";
import type { PluginBridgeLike } from "./apply-tool.js";

export interface DaemonWriteProxies {
  attachPluginBridge: (b: PluginBridgeLike) => void;
  dryRunWrite: (args: { frame_id: string; write_target: WriteTarget }) => Promise<Record<string, unknown>>;
  applyApprovedWrite: (args: { pending_id: string; source_hash_recomputed: string }) => Promise<Record<string, unknown>>;
  undoWrite: (args: { write_id: string }) => Promise<Record<string, unknown>>;
  onPluginReconnect: () => Promise<void>;
  readPendingWrites: () => unknown[];
  readAppliedWrites: () => unknown[];
  idempotencyHas: (hash: string) => boolean;
  hasUndoEntry: (write_id: string) => boolean;
  recomputeSourceHash: (frame_id: string) => string;
  advanceClockMs: (ms: number) => void;
  getWriteAudits: () => Array<Record<string, unknown>>;
  getWriteRouterAudits: () => Array<Record<string, unknown>>;
}

export function buildWriteProxies(write: DaemonWriteExtension): DaemonWriteProxies {
  return {
    attachPluginBridge: (b) => write.attachPluginBridge(b),
    dryRunWrite: (args) => write.dryRun(args),
    applyApprovedWrite: async (args) =>
      (await write.apply(args)) as unknown as Record<string, unknown>,
    undoWrite: async (args) =>
      (await write.undo(args)) as unknown as Record<string, unknown>,
    onPluginReconnect: () => write.onPluginReconnect(),
    readPendingWrites: () => write.readPendingWrites(),
    readAppliedWrites: () => write.readAppliedWrites(),
    idempotencyHas: (hash) => write.idempotencyHas(hash),
    hasUndoEntry: (write_id) => write.hasUndoEntry(write_id),
    recomputeSourceHash: (frame_id) => write.recomputeSourceHash(frame_id),
    advanceClockMs: (ms) => write.advanceClockMs(ms),
    getWriteAudits: () => write.getWriteAudits(),
    getWriteRouterAudits: () => write.getWriteAudits(),
  };
}
