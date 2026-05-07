// SPEC-FIGMA-007 REQ-02, REQ-06 — daemon write-path MCP resources.
//
// Adds two read-only resources alongside the SPEC-FIGMA-006 4-URI registry:
//   - `autopus://pending_writes`  — list of active PendingWrite records
//   - `autopus://applied_writes`  — list of completed AppliedWrite records
//
// The existing `McpResources` class is kept frozen by NFR-04. This module is
// a sibling registry the daemon composes; the merged `list()` view is exposed
// via Daemon.listMcpResources() if needed.

import type { PendingWriteSerializable, PendingWriteStore } from "./pending-writes.js";
import type { UndoDescriptor, WriteTarget } from "../../packages/write-router/src/types.js";

export const PENDING_WRITES_URI = "autopus://pending_writes";
export const APPLIED_WRITES_URI = "autopus://applied_writes";

export interface AppliedWrite {
  write_id: string;
  frame_id: string;
  write_target: WriteTarget;
  manifest_entry_hash: string;
  undo_descriptor: UndoDescriptor;
  applied_at: string;
}

export class WriteMcpResources {
  private readonly applied: AppliedWrite[] = [];

  constructor(private readonly pendingStore: PendingWriteStore) {}

  recordApplied(entry: AppliedWrite): void {
    this.applied.push({ ...entry });
  }

  removeApplied(write_id: string): void {
    const idx = this.applied.findIndex((a) => a.write_id === write_id);
    if (idx >= 0) this.applied.splice(idx, 1);
  }

  readPendingWrites(): PendingWriteSerializable[] {
    return this.pendingStore.list();
  }

  readAppliedWrites(): AppliedWrite[] {
    return this.applied.map((a) => ({ ...a }));
  }

  /** MCP resources/read dispatcher for the two URIs this module owns. */
  read(uri: string): unknown {
    switch (uri) {
      case PENDING_WRITES_URI:
        return this.readPendingWrites();
      case APPLIED_WRITES_URI:
        return this.readAppliedWrites();
      default:
        throw new Error(`unknown write-path MCP URI: ${uri}`);
    }
  }

  list(): Array<{ uri: string; name: string }> {
    return [
      { uri: PENDING_WRITES_URI, name: "pending_writes" },
      { uri: APPLIED_WRITES_URI, name: "applied_writes" },
    ];
  }
}
