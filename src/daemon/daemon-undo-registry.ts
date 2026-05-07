// SPEC-FIGMA-007 REQ-08 — daemon-side undo registry. Mirrors the
// SPEC-FIGMA-004 `UndoRegistry` shape but is process-local to the daemon
// (per REQ-16 process-scoped state). Reuses the 5-variant `UndoDescriptor`
// union from packages/write-router/src/types.ts (frozen, no parallel union).

import type {
  UndoDescriptor,
  WriteTarget,
} from "../../packages/write-router/src/types.js";

export interface DaemonUndoRecord {
  write_id: string;
  frame_id: string;
  manifest_entry_hash: string;
  write_target: WriteTarget;
  descriptor: UndoDescriptor;
  applied_at: string;
}

export class DaemonUndoRegistry {
  private readonly map = new Map<string, DaemonUndoRecord>();

  register(record: DaemonUndoRecord): void {
    this.map.set(record.write_id, { ...record });
  }

  get(write_id: string): DaemonUndoRecord | undefined {
    return this.map.get(write_id);
  }

  has(write_id: string): boolean {
    return this.map.has(write_id);
  }

  remove(write_id: string): void {
    this.map.delete(write_id);
  }

  list(): DaemonUndoRecord[] {
    return [...this.map.values()];
  }

  size(): number {
    return this.map.size;
  }
}
