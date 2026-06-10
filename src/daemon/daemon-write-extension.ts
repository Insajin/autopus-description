// SPEC-FIGMA-007 W2 — daemon write-path extension. Wraps the dryRun/apply/undo
// state and exposes a flat method surface that the Daemon class proxies to.
// Lives separate from server.ts to keep that file under the 300-line limit
// (NFR-06) and to isolate write-path changes from SPEC-FIGMA-006 surface.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { computeSourceHash, type CanonicalValue } from "../source-hash.js";
import { IdempotencyTracker } from "../../packages/write-router/src/idempotency.js";
import { WriteRouter } from "../../packages/write-router/src/index.js";
import type { ManifestEntry, WriteTarget } from "../../packages/write-router/src/types.js";

import { PendingWriteStore } from "./pending-writes.js";
import {
  WriteMcpResources,
  type AppliedWrite,
} from "./write-mcp-resources.js";
import { DaemonUndoRegistry } from "./daemon-undo-registry.js";
import { dryRunWrite, type DryRunWriteArgs } from "./dryrun-tool.js";
import {
  applyApprovedWrite,
  type ApplyResult,
  type PluginBridgeLike,
} from "./apply-tool.js";
import { undoWrite, replayPartialRollback, type UndoResult } from "./undo-tool.js";
import type { PendingWrite, PluginCommand } from "./types-internal.js";

const DEFAULT_NODE_TREE: CanonicalValue = { a: 1, b: 2 } as CanonicalValue;
const DEFAULT_IMAGE = Buffer.from("abc", "ascii");

// Dev affordance: load a real ManifestEntry from a local JSON file so the daemon
// dryRun path can carry genuine content (not the stub). Returns undefined when
// no file is present or it does not match the requested frame, so production
// behaviour is unchanged unless an operator opts in by placing the file.
function loadDryRunOverride(frame_id: string): Partial<ManifestEntry> | undefined {
  // Candidate paths, in priority order: explicit env override, then a path
  // resolved relative to this module (cwd-independent — dist/src/daemon → repo
  // root), then a cwd-relative fallback.
  const candidates: string[] = [];
  if (process.env.AUTOPUS_DRYRUN_ENTRY) candidates.push(process.env.AUTOPUS_DRYRUN_ENTRY);
  try {
    candidates.push(fileURLToPath(new URL("../../../.autopus/dryrun-entry.json", import.meta.url)));
  } catch {
    // import.meta.url unavailable — skip the module-relative candidate.
  }
  candidates.push("./.autopus/dryrun-entry.json");
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ManifestEntry>;
      if (parsed.frame_id && parsed.frame_id !== frame_id) continue;
      return { ...parsed, frame_id };
    } catch {
      continue;
    }
  }
  return undefined;
}

export interface DaemonWriteExtensionOptions {
  pmIdentity?: string;
  // SPEC-FIGMA-007 REQ-10: optional callback that emits a SPEC-FIGMA-006
  // EmittedAudit row per accepted write apply event. Injected by Daemon so
  // the daemon-emitter INV-003 chain extends across read→write boundary.
  emitDaemonAudit?: (input: { prompt_text: string; response_text: string }) => void;
}

export class DaemonWriteExtension {
  readonly pendingStore = new PendingWriteStore();
  readonly idempotency = new IdempotencyTracker();
  readonly undoRegistry = new DaemonUndoRegistry();
  readonly resources: WriteMcpResources;
  readonly router = new WriteRouter();
  readonly events: Array<Record<string, unknown>> = [];
  readonly partialReplay = new Map<string, { commands: PluginCommand[]; pending: PendingWrite }>();
  bridge: PluginBridgeLike | null = null;
  private readonly pmIdentity: string;
  private readonly frameSourceHashes = new Map<string, string>();
  private readonly emitDaemonAudit:
    | ((input: { prompt_text: string; response_text: string }) => void)
    | undefined;

  constructor(opts: DaemonWriteExtensionOptions = {}) {
    this.pmIdentity = opts.pmIdentity ?? "unknown";
    this.resources = new WriteMcpResources(this.pendingStore);
    this.emitDaemonAudit = opts.emitDaemonAudit;
  }

  attachPluginBridge(bridge: PluginBridgeLike): void {
    this.bridge = bridge;
  }

  recordFrameSourceHash(frame_id: string, hash: string): void {
    this.frameSourceHashes.set(frame_id, hash);
  }

  recomputeSourceHash(frame_id: string): string {
    const cached = this.frameSourceHashes.get(frame_id);
    if (cached) return cached;
    return computeSourceHash({
      node_tree_summary: DEFAULT_NODE_TREE,
      image_bytes: DEFAULT_IMAGE,
    });
  }

  advanceClockMs(ms: number): void {
    this.pendingStore.advanceMs(ms);
  }

  async dryRun(args: DryRunWriteArgs): Promise<Record<string, unknown>> {
    // Dev affordance: when no caller-supplied entry override is present, allow a
    // local JSON file to provide a real ManifestEntry so dryRun/apply can drive
    // genuine content through the live plugin instead of the hardcoded stub.
    // Off by default (no file → stub). Path via AUTOPUS_DRYRUN_ENTRY or the
    // cwd-relative .autopus/dryrun-entry.json fallback.
    const entry_override = args.entry_override ?? loadDryRunOverride(args.frame_id);
    const result = await dryRunWrite(
      {
        store: this.pendingStore,
        router: this.router,
        resolveSourceHash: (id) => this.recomputeSourceHash(id),
      },
      { ...args, entry_override },
    );
    return { ...result };
  }

  async apply(args: { pending_id: string; source_hash_recomputed: string }): Promise<ApplyResult> {
    return applyApprovedWrite(
      {
        store: this.pendingStore,
        bridge: this.bridge,
        idempotency: this.idempotency,
        undoRegistry: this.undoRegistry,
        resources: this.resources,
        pmIdentity: this.pmIdentity,
        auditEvents: this.events,
        pendingForReplay: this.partialReplay,
        emitDaemonAudit: this.emitDaemonAudit,
      },
      args,
    );
  }

  async undo(args: { write_id: string }): Promise<UndoResult> {
    return undoWrite(
      {
        bridge: this.bridge,
        idempotency: this.idempotency,
        undoRegistry: this.undoRegistry,
        resources: this.resources,
        pmIdentity: this.pmIdentity,
        auditEvents: this.events,
      },
      args,
    );
  }

  async onPluginReconnect(): Promise<void> {
    if (!this.bridge) return;
    for (const [, entry] of this.partialReplay) {
      await replayPartialRollback(this.bridge, entry.commands);
    }
    this.partialReplay.clear();
  }

  readPendingWrites(): unknown[] {
    return this.resources.readPendingWrites();
  }

  readAppliedWrites(): AppliedWrite[] {
    return this.resources.readAppliedWrites();
  }

  getWriteAudits(): Array<Record<string, unknown>> {
    return [...this.events];
  }

  idempotencyHas(hash: string): boolean {
    return this.idempotency.has(hash);
  }

  hasUndoEntry(write_id: string): boolean {
    return this.undoRegistry.has(write_id);
  }
}
