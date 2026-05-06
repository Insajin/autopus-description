// SPEC-FIGMA-004 WriteRouter — full integration of W2 adapters with W3 layers:
// idempotency dedup (REQ-07), undo registry (REQ-08), JSONL audit logger
// (REQ-11), token redaction (REQ-13), and Plugin Bridge fallback (REQ-06).
// Public API: apply(entry), undo(write_id), getEntryStatus(entry),
// hasUndoEntry(write_id), listAdapters().

import {
  ERROR_CODES,
  WriteRouterError,
  type Adapter,
  type AdapterApplyResult,
  type ManifestEntry,
  type WriteResult,
  type WriteTarget,
} from "./types.js";
import { AdapterRegistry, KNOWN_TARGETS } from "./registry.js";
import {
  computeManifestEntryHash,
  IdempotencyTracker,
} from "./idempotency.js";
import { UndoRegistry } from "./undo-registry.js";
import {
  appendAuditSuccess,
  appendAuditRejection,
  appendAuditSkipped,
  appendAuditFallback,
  FALLBACK_LITERAL,
} from "./audit-log.js";
import { redactTokens } from "./redactor.js";
import {
  classifyMcpError,
  type McpErrorClass,
} from "./fallback/error-classifier.js";
import { applyViaPluginBridge } from "./fallback/plugin-bridge.js";

export interface WriteRouterOptions {
  registry?: AdapterRegistry;
  adapters?: Partial<Record<WriteTarget, Adapter>>;
  auditLogPath?: string;
  figma?: unknown;
  figmaToken?: string;
  slackToken?: string;
  valid?: boolean;
  pmIdentity?: string;
}

let writeIdCounter = 0;
function nextWriteId(): string {
  writeIdCounter += 1;
  return `wr-${Date.now().toString(36)}-${writeIdCounter}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class WriteRouter {
  private readonly registry: AdapterRegistry;
  private readonly auditLogPath: string | undefined;
  private readonly figma: unknown;
  private readonly valid: boolean;
  private readonly pmIdentity: string;
  private readonly idempotency = new IdempotencyTracker();
  private readonly undoRegistry = new UndoRegistry();
  private readonly entryStatus = new Map<string, "pending" | "applied">();

  constructor(options: WriteRouterOptions = {}) {
    this.registry = options.registry ?? new AdapterRegistry(options.adapters);
    this.auditLogPath = options.auditLogPath;
    this.figma = options.figma;
    this.valid = options.valid ?? true;
    this.pmIdentity = options.pmIdentity ?? "unknown";
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

    const hash = computeManifestEntryHash(entry);

    if (this.idempotency.isDuplicate(hash)) {
      await this.writeSkipped(entry, hash);
      throw new WriteRouterError(
        ERROR_CODES.IDEMPOTENT_SKIP,
        "duplicate apply for unchanged manifest entry",
      );
    }

    const adapter = this.registry.resolve(entry.write_target);
    let applied: AdapterApplyResult;
    let fallbackClass: McpErrorClass | null = null;

    try {
      applied = await adapter.apply(entry, { figma: this.figma });
    } catch (err) {
      const cls = classifyMcpError(err);
      if (cls === "MCP_PERMISSION_ERROR") {
        return await this.fallbackToPluginBridge(entry, hash, err, cls);
      }
      if (
        err instanceof WriteRouterError &&
        err.code === ERROR_CODES.FRAME_NAME_OPT_IN_REQUIRED
      ) {
        await this.writeRejection(
          entry,
          hash,
          ERROR_CODES.FRAME_NAME_OPT_IN_REQUIRED,
        );
        throw err;
      }
      const redacted = redactErrorMessage(err);
      const reason = redacted instanceof Error ? redacted.message : String(redacted);
      await this.writeRejection(entry, hash, reason);
      throw redacted;
    }

    const write_id = nextWriteId();
    this.idempotency.record(hash);
    this.undoRegistry.register({
      write_id,
      target: entry.write_target,
      entry,
      descriptor: applied.undo_descriptor,
      timestamp_iso: nowIso(),
      fallback_used: applied.fallback_used ?? fallbackClass !== null,
    });
    this.entryStatus.set(hash, "applied");

    await appendAuditSuccess(
      {
        frame_id: entry.frame_id,
        write_target: entry.write_target,
        timestamp_iso: nowIso(),
        pm_identity_or_unknown: this.pmIdentity,
        manifest_entry_hash: hash,
      },
      { logPath: this.auditLogPath },
    );

    return {
      status: "applied",
      write_id,
      undo_descriptor: applied.undo_descriptor,
      fallback_used: applied.fallback_used ?? false,
      node_id: applied.node_id,
    };
  }

  async undo(write_id: string): Promise<void> {
    const record = this.undoRegistry.get(write_id);
    if (!record) {
      throw new WriteRouterError(
        ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
        `unknown write_id: ${write_id}`,
      );
    }
    const adapter = this.registry.resolve(record.target);
    await adapter.undo(record.descriptor, { figma: this.figma });
    this.undoRegistry.remove(write_id);
    const hash = computeManifestEntryHash(record.entry);
    this.entryStatus.set(hash, "pending");
    this.idempotency.clear(); // single-step undo allows re-apply with same hash
  }

  getEntryStatus(entry: ManifestEntry): "pending" | "applied" {
    const hash = computeManifestEntryHash(entry);
    return this.entryStatus.get(hash) ?? "pending";
  }

  hasUndoEntry(write_id: string): boolean {
    return this.undoRegistry.has(write_id);
  }

  listAdapters(): WriteTarget[] {
    return this.registry.list();
  }

  private async fallbackToPluginBridge(
    entry: ManifestEntry,
    hash: string,
    err: unknown,
    cls: McpErrorClass,
  ): Promise<WriteResult> {
    const result = await applyViaPluginBridge(entry, {
      fallback_reason: cls,
      original_error: err,
    });
    const write_id = nextWriteId();
    this.idempotency.record(hash);
    if (result.undo_descriptor) {
      this.undoRegistry.register({
        write_id,
        target: entry.write_target,
        entry,
        descriptor: result.undo_descriptor,
        timestamp_iso: nowIso(),
        fallback_used: true,
      });
    }
    this.entryStatus.set(hash, "applied");
    await appendAuditFallback(
      {
        frame_id: entry.frame_id,
        write_target: entry.write_target,
        timestamp_iso: nowIso(),
        pm_identity_or_unknown: this.pmIdentity,
        manifest_entry_hash: hash,
        fallback_reason: cls,
        fallback_via: FALLBACK_LITERAL,
      },
      { logPath: this.auditLogPath },
    );
    return {
      status: "applied",
      write_id,
      undo_descriptor: result.undo_descriptor,
      fallback_used: true,
      node_id: result.node_id,
    };
  }

  private async writeSkipped(
    entry: ManifestEntry,
    hash: string,
  ): Promise<void> {
    await appendAuditSkipped(
      {
        frame_id: entry.frame_id,
        write_target: entry.write_target,
        timestamp_iso: nowIso(),
        pm_identity_or_unknown: this.pmIdentity,
        manifest_entry_hash: hash,
        status: "skipped",
        reason: ERROR_CODES.IDEMPOTENT_SKIP,
      },
      { logPath: this.auditLogPath },
    );
  }

  private async writeRejection(
    entry: ManifestEntry,
    hash: string,
    reason: string,
  ): Promise<void> {
    await appendAuditRejection(
      {
        frame_id: entry.frame_id,
        write_target: entry.write_target,
        timestamp_iso: nowIso(),
        pm_identity_or_unknown: this.pmIdentity,
        manifest_entry_hash: hash,
        status: "rejected",
        reason,
      },
      { logPath: this.auditLogPath },
    );
  }

  private isKnownTarget(target: unknown): target is WriteTarget {
    return (
      typeof target === "string" &&
      (KNOWN_TARGETS as readonly string[]).includes(target)
    );
  }
}

function redactErrorMessage(err: unknown): unknown {
  if (err instanceof WriteRouterError) {
    // Mutate in place so instanceof + code are preserved.
    err.message = redactTokens(err.message);
    return err;
  }
  if (err instanceof Error) {
    err.message = redactTokens(err.message);
    return err;
  }
  return new Error(redactTokens(String(err)));
}

export { AdapterRegistry } from "./registry.js";
export * from "./types.js";
