// SPEC-FIGMA-004 write-router entrypoint.
// W1 contract — adapters are stub NotImplemented placeholders; future waves
// replace them. Provides routing dispatch, validates write_target enum,
// surfaces a stable apply/undo API consumed by the API route + tests.

import {
  ERROR_CODES,
  WriteRouterError,
  type Adapter,
  type ManifestEntry,
  type UndoDescriptor,
  type WriteResult,
  type WriteTarget,
} from "./types.js";
import { AdapterRegistry, KNOWN_TARGETS } from "./registry.js";

export interface WriteRouterOptions {
  registry?: AdapterRegistry;
  adapters?: Partial<Record<WriteTarget, Adapter>>;
  auditLogPath?: string;
  figma?: unknown;
  figmaToken?: string;
  slackToken?: string;
  valid?: boolean;
}

interface UndoRecord {
  write_id: string;
  target: WriteTarget;
  descriptor: UndoDescriptor;
}

let writeIdCounter = 0;
function nextWriteId(): string {
  writeIdCounter += 1;
  return `wr-${Date.now().toString(36)}-${writeIdCounter}`;
}

export class WriteRouter {
  private readonly registry: AdapterRegistry;
  private readonly auditLogPath: string | undefined;
  private readonly figma: unknown;
  private readonly valid: boolean;
  private readonly undoLog: UndoRecord[] = [];

  constructor(options: WriteRouterOptions = {}) {
    this.registry =
      options.registry ?? new AdapterRegistry(options.adapters);
    this.auditLogPath = options.auditLogPath;
    this.figma = options.figma;
    this.valid = options.valid ?? true;
  }

  async apply(entry: ManifestEntry): Promise<WriteResult> {
    if (!this.valid) {
      throw new WriteRouterError(
        ERROR_CODES.MANIFEST_INVALID,
        "manifest failed schema validation; apply blocked",
      );
    }
    if (!this.isKnownTarget(entry.write_target)) {
      throw new WriteRouterError(
        ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
        `unknown write_target: ${String(entry.write_target)}`,
      );
    }

    const adapter = this.registry.resolve(entry.write_target);
    const applied = await adapter.apply(entry, { figma: this.figma });

    const write_id = nextWriteId();
    this.undoLog.push({
      write_id,
      target: entry.write_target,
      descriptor: applied.undo_descriptor,
    });

    return {
      status: "applied",
      write_id,
      undo_descriptor: applied.undo_descriptor,
      fallback_used: applied.fallback_used ?? false,
      node_id: applied.node_id,
    };
  }

  async undo(write_id: string): Promise<void> {
    const idx = this.undoLog.findIndex((r) => r.write_id === write_id);
    if (idx === -1) {
      throw new WriteRouterError(
        ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
        `unknown write_id: ${write_id}`,
      );
    }
    const record = this.undoLog[idx];
    const adapter = this.registry.resolve(record.target);
    await adapter.undo(record.descriptor, { figma: this.figma });
    this.undoLog.splice(idx, 1);
  }

  hasUndoEntry(write_id: string): boolean {
    return this.undoLog.some((r) => r.write_id === write_id);
  }

  listAdapters(): WriteTarget[] {
    return this.registry.list();
  }

  private isKnownTarget(target: unknown): target is WriteTarget {
    return (
      typeof target === "string" &&
      (KNOWN_TARGETS as readonly string[]).includes(target)
    );
  }
}

export { AdapterRegistry } from "./registry.js";
export * from "./types.js";
