// SPEC-FIGMA-004 single-step undo registry (REQ-08, REQ-NFR-02, INV-002).
// Records the undo descriptor for every successful write so the WriteRouter
// can reverse the last write without holding the adapter directly. PRD §11
// Q5 explicitly defers multi-step undo — this implementation supports the
// single-step "undo last write" semantics by exposing `lastWriteId()`.

import type { ManifestEntry, UndoDescriptor, WriteTarget } from "./types.js";

export interface UndoRecord {
  write_id: string;
  target: WriteTarget;
  entry: ManifestEntry;
  descriptor: UndoDescriptor;
  timestamp_iso: string;
  fallback_used: boolean;
}

export class UndoRegistry {
  private readonly byId = new Map<string, UndoRecord>();
  private readonly order: string[] = [];

  register(record: UndoRecord): void {
    if (this.byId.has(record.write_id)) {
      throw new Error(`UndoRegistry: duplicate write_id ${record.write_id}`);
    }
    this.byId.set(record.write_id, record);
    this.order.push(record.write_id);
  }

  get(write_id: string): UndoRecord | undefined {
    return this.byId.get(write_id);
  }

  has(write_id: string): boolean {
    return this.byId.has(write_id);
  }

  remove(write_id: string): UndoRecord | undefined {
    const rec = this.byId.get(write_id);
    if (!rec) return undefined;
    this.byId.delete(write_id);
    const idx = this.order.indexOf(write_id);
    if (idx >= 0) this.order.splice(idx, 1);
    return rec;
  }

  lastWriteId(): string | null {
    if (this.order.length === 0) return null;
    return this.order[this.order.length - 1];
  }

  size(): number {
    return this.byId.size;
  }

  clear(): void {
    this.byId.clear();
    this.order.length = 0;
  }
}
