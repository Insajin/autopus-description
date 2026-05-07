// SPEC-FIGMA-007 REQ-02, REQ-15 — daemon-side PendingWrite store.
// In-memory map keyed by `pending_id`, with `expires_at = createdAt + 60s` GC.
// Clock injection (`advanceMs`) supports AC-S9 deterministic expiry tests.

import { randomBytes } from "node:crypto";
import type { PluginCommand } from "../../packages/write-router/src/plan-emit/types.js";
import type { UndoDescriptor, WriteTarget } from "../../packages/write-router/src/types.js";

export const DEFAULT_TTL_MS = 60_000;

export interface PendingWrite {
  pending_id: string;
  manifest_entry_hash: string;
  source_hash_dryrun: string;
  plugin_commands: PluginCommand[];
  frame_id: string;
  write_target: WriteTarget;
  expires_at: string;
  // Internal-only — surfaced for retrieval but not part of the AC-S1 7-key oracle.
  undo_template?: UndoDescriptor;
  created_at_ms?: number;
}

export type PendingWriteSerializable = Omit<PendingWrite, "undo_template" | "created_at_ms">;

export interface PendingWriteStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

export class PendingWriteStore {
  private readonly map = new Map<string, PendingWrite>();
  private readonly ttlMs: number;
  private clockOffsetMs = 0;
  private readonly baseNow: () => number;
  private counter = 0;

  constructor(opts: PendingWriteStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.baseNow = opts.now ?? Date.now;
  }

  private now(): number {
    return this.baseNow() + this.clockOffsetMs;
  }

  advanceMs(ms: number): void {
    this.clockOffsetMs += ms;
  }

  newPendingId(): string {
    this.counter += 1;
    const seed = randomBytes(4).toString("hex");
    return `pw-${seed}${this.counter % 100000}-${this.counter}`;
  }

  put(input: {
    pending_id?: string;
    manifest_entry_hash: string;
    source_hash_dryrun: string;
    plugin_commands: PluginCommand[];
    frame_id: string;
    write_target: WriteTarget;
    undo_template?: UndoDescriptor;
  }): PendingWrite {
    const created_at_ms = this.now();
    const pending_id = input.pending_id ?? this.newPendingId();
    const record: PendingWrite = {
      pending_id,
      manifest_entry_hash: input.manifest_entry_hash,
      source_hash_dryrun: input.source_hash_dryrun,
      plugin_commands: [...input.plugin_commands],
      frame_id: input.frame_id,
      write_target: input.write_target,
      expires_at: new Date(created_at_ms + this.ttlMs).toISOString(),
      undo_template: input.undo_template,
      created_at_ms,
    };
    this.map.set(pending_id, record);
    return record;
  }

  /** Look up by pending_id. Reports expired status BEFORE GC eviction. */
  get(pending_id: string): { record: PendingWrite | null; expired: boolean } {
    const r = this.map.get(pending_id);
    if (!r) return { record: null, expired: false };
    if (this.isExpired(r)) {
      this.map.delete(pending_id);
      return { record: null, expired: true };
    }
    return { record: r, expired: false };
  }

  has(pending_id: string): boolean {
    this.gc();
    return this.map.has(pending_id);
  }

  remove(pending_id: string): void {
    this.map.delete(pending_id);
  }

  /** Lazily evict expired entries; called from public read paths. */
  gc(): number {
    let removed = 0;
    for (const [id, rec] of this.map) {
      if (this.isExpired(rec)) {
        this.map.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Read-only list view (post-GC). */
  list(): PendingWriteSerializable[] {
    this.gc();
    const out: PendingWriteSerializable[] = [];
    for (const r of this.map.values()) out.push(this.toSerializable(r));
    return out;
  }

  size(): number {
    this.gc();
    return this.map.size;
  }

  toSerializable(r: PendingWrite): PendingWriteSerializable {
    return {
      pending_id: r.pending_id,
      manifest_entry_hash: r.manifest_entry_hash,
      source_hash_dryrun: r.source_hash_dryrun,
      plugin_commands: r.plugin_commands,
      frame_id: r.frame_id,
      write_target: r.write_target,
      expires_at: r.expires_at,
    };
  }

  private isExpired(r: PendingWrite): boolean {
    const created = r.created_at_ms ?? Date.parse(r.expires_at) - this.ttlMs;
    return this.now() - created >= this.ttlMs;
  }
}
