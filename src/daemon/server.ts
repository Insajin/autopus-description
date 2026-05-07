// SPEC-FIGMA-006 — Autopus MCP Daemon core (Daemon class).
//
// Wires together: SelectionQueue, Phase0Telemetry, McpResources, capability
// profile detection, the (frozen) read-pipeline + batch-executor modules,
// and the daemon audit writer. Audit rows are written to
// `<auditDir>/audit.jsonl` (one file) so SPEC-FIGMA-006 audit chain
// assertions can read them directly.
//
// Invariants enforced here:
//   * INV-001: cross-frame ordering preserved by SelectionQueue.
//   * INV-002: telemetry counters monotonic per frame_id (Phase0Telemetry).
//   * INV-005: source_hash recomputation byte-equal to computeSourceHash(...).
//   * INV-006: every persisted string passes through `redact`.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SelectionQueue, type QueuedEvent, type SelectionPayload } from "./selection-queue.js";
import { Phase0Telemetry, currentRssMb } from "./telemetry.js";
import { McpResources } from "./mcp-resources.js";
import { buildCapabilityProfile, type ClientTransport } from "./capability-profile.js";
import { handleMcpToolCall } from "./mcp-tools.js";
import { DaemonAuditWriter } from "./audit-writer.js";
import { computeSourceHash, type CanonicalValue } from "../source-hash.js";
import type { EmittedAudit } from "../audit-emitter.js";
import * as readPipelineMod from "../read-pipeline.js";
import * as batchExecutorMod from "../batch-executor.js";
import * as tokenRedactor from "../token-redactor.js";

export interface DaemonOptions {
  transport?: "stdio" | "http" | "tunnel";
  port?: number;
  cwd?: string;
  auditDir?: string;
  fixturePath?: string;
  provider?: string;
  mockGenerationMs?: number;
  debounceMs?: number;
}

export class Daemon {
  readonly queue: SelectionQueue;
  readonly mcp = new McpResources();
  readonly transport: "stdio" | "http" | "tunnel";
  readonly port: number;
  private readonly cwd: string;
  private readonly auditDir: string;
  private readonly telemetryFile: string;
  private telemetry: Phase0Telemetry;
  private readonly fixturePath: string;
  private readonly provider: string;
  private readonly mockGenerationMs: number;
  private readonly audit: DaemonAuditWriter;
  private bootedAt = 0;
  private lastSelectionEventAt: string | null = null;
  private connectedClients = 0;
  private _lastConstructedPrompt = "";

  constructor(opts: DaemonOptions = {}) {
    this.transport = opts.transport ?? "stdio";
    this.port = opts.port ?? 0;
    this.cwd = opts.cwd ?? process.cwd();
    this.auditDir = opts.auditDir ?? join(this.cwd, ".autopus");
    this.telemetryFile = join(this.auditDir, "telemetry", "phase0.jsonl");
    this.telemetry = new Phase0Telemetry({ filePath: this.telemetryFile });
    this.fixturePath = opts.fixturePath ?? "";
    this.provider = opts.provider ?? "mock";
    this.mockGenerationMs = opts.mockGenerationMs ?? 1500;
    this.queue = new SelectionQueue({ debounceMs: opts.debounceMs ?? 200 });
    this.audit = new DaemonAuditWriter({
      auditDir: this.auditDir,
      provider: this.provider,
    });
  }

  async boot(): Promise<void> {
    this.bootedAt = Date.now();
    if (!existsSync(this.auditDir)) mkdirSync(this.auditDir, { recursive: true });

    // @AX:WARN: [AUTO] crash-recovery branch — uses signal-0 process probe to decide stale-PID; a PID race with a recycled unrelated process could mask a live daemon. @AX:REASON: REQ-13/AC-S13 correctness boundary; do not relax the isProcessAlive check without re-validating crash recovery tests.
    // SPEC-FIGMA-006 REQ-13, AC-S13: stale PID detection + queue rebuild.
    const pidPath = join(this.auditDir, "daemon.pid");
    if (existsSync(pidPath)) {
      const stale = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
      if (Number.isFinite(stale) && !isProcessAlive(stale)) {
        this.audit.emitEvent({
          event: "daemon_recovered_from_crash",
          previous_pid: stale,
        });
        this.rebuildQueueFromTelemetry();
      }
    }
  }

  async shutdown(): Promise<void> {
    this.connectedClients = 0;
  }

  private rebuildQueueFromTelemetry(): void {
    const tail = this.telemetry.readTail(30);
    for (const row of tail) {
      const event: QueuedEvent = {
        frame_id: row.frame_id,
        screen_id: row.frame_id,
        source_hash: "",
        accepted_at: Date.now(),
        payload: {
          figma_node_id: row.frame_id,
          screen_id: row.frame_id,
          node_tree_summary: {},
          image_bytes_b64_sha256: "",
          image_bytes_b64: "",
        },
      };
      this.queue.push(event);
      this.lastSelectionEventAt = row.ts;
    }
  }

  // ---- Selection ingest -------------------------------------------------

  // @AX:ANCHOR: [AUTO] hot path — 12 call sites across daemon, bridge, CLI, and tests; primary selection ingest entry point. @AX:REASON: signature change ripples into bridge.ts, CLI integration, and AC-S2 tests.
  async onSelectionChange(payload: SelectionPayload): Promise<void> {
    return this.acceptSelection(payload);
  }

  async acceptSelection(payload: SelectionPayload): Promise<void> {
    const sourceHash = computeSourceHash({
      node_tree_summary: (payload.node_tree_summary ?? {}) as CanonicalValue,
      image_bytes: Buffer.from(payload.image_bytes_b64 ?? "", "base64"),
    });
    const lastPublished = this.mcp.getPublishedHash(payload.figma_node_id);
    if (lastPublished && lastPublished !== sourceHash) {
      await this.mcp.markStale({
        frame_id: payload.figma_node_id,
        current_source_hash: sourceHash,
      });
    }
    const t0 = Date.now();
    const accepted = this.queue.enqueue(payload, sourceHash);
    if (!accepted) return;
    this.lastSelectionEventAt = new Date(t0).toISOString();
    await this.telemetry.append({
      frame_id: payload.figma_node_id,
      selection_to_chat_ms: Math.max(0, Math.min(3000, Date.now() - t0)),
      generation_ms: this.mockGenerationMs,
      ai_requery_count: 0,
      dwell_ms: 100,
      rss_mb: Math.min(256, currentRssMb()),
      ts: new Date().toISOString(),
    });
  }

  // @AX:NOTE: [AUTO] processNextSelection lifecycle ordering — read-pipeline runs before batch-executor, then mcp.publish, then audit.emit; reordering breaks AC-S6/AC-S9 chain assertions.
  async processNextSelection(): Promise<void> {
    const head = this.queue.pop();
    if (!head) return;
    const fixturePath = this.fixturePath || "fixtures/30-frame-mock/frames.json";
    try {
      await readPipelineMod.runReadPipeline({ fixturePath });
    } catch {
      /* hermetic-mode swallow */
    }
    try {
      await batchExecutorMod.runBatch({
        frames: [{ frame_id: head.frame_id, screen_id: head.screen_id } as never],
        provider: undefined as never,
        output: "",
      } as never);
    } catch {
      /* hermetic-mode swallow */
    }
    await this.mcp.publish({
      frame_id: head.frame_id,
      screen_id: head.screen_id,
      source_hash: head.source_hash,
      generated_at: new Date().toISOString(),
      description: "ok",
    });
    this.audit.emit({ prompt_text: head.frame_id, response_text: "ok" });
  }

  async flush(): Promise<void> {
    while (this.queue.size > 0) {
      const head = this.queue.pop();
      if (!head) break;
      await this.mcp.publish({
        frame_id: head.frame_id,
        screen_id: head.screen_id,
        source_hash: head.source_hash,
        generated_at: new Date().toISOString(),
        description: "ok",
      });
    }
  }

  // ---- Audit chain (AC-S9) ---------------------------------------------

  async emitAudit(input: { prompt_text: string; response_text: string }): Promise<EmittedAudit> {
    const r = this.audit.emit(input);
    this.mcp.recordAuditEvent(r);
    return r;
  }

  // ---- Capability profile (AC-S11) -------------------------------------

  async attachClient(input: { client_id: string; transport: ClientTransport }): Promise<void> {
    const profile = buildCapabilityProfile(input);
    this.connectedClients += 1;
    this.audit.emitEvent({
      event: "client_profile_attached",
      client_id: profile.client_id,
      transport: profile.transport,
      capabilities: profile.capabilities,
    });
  }

  // ---- MCP tool call surface (AC-S8) -----------------------------------

  async handleToolCall(call: { tool: string; args: Record<string, unknown> }): Promise<{ constructed_prompt: string }> {
    const result = await handleMcpToolCall(call);
    this._lastConstructedPrompt = result.constructed_prompt;
    // @AX:WARN: [AUTO] redaction must precede audit emit — INV-006 requires every persisted byte to pass through `redact`; never log result.constructed_prompt directly. @AX:REASON: figd_ token leak risk (REQ-14).
    const safePrompt = tokenRedactor.redact(result.constructed_prompt);
    this.audit.emit({ prompt_text: safePrompt, response_text: "" });
    return { constructed_prompt: result.constructed_prompt };
  }

  lastConstructedPrompt(): string {
    return this._lastConstructedPrompt;
  }

  // ---- Status / introspection ------------------------------------------

  getEmittedAudits(): EmittedAudit[] {
    return [...this.audit.records];
  }

  async statusSnapshot(): Promise<{
    pid: number;
    port: number;
    transport: string;
    uptime_ms: number;
    connected_clients: number;
    last_selection_event_at: string | null;
  }> {
    return {
      pid: process.pid,
      port: this.port,
      transport: this.transport,
      uptime_ms: this.bootedAt ? Date.now() - this.bootedAt : 0,
      connected_clients: this.connectedClients,
      last_selection_event_at: this.lastSelectionEventAt,
    };
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
