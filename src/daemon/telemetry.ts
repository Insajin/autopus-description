// SPEC-FIGMA-006 REQ-06, NFR-01, INV-002: Phase 0 telemetry JSONL writer.
// 7-key set per line, append-only, monotonic counters. Counters per frame_id
// are tracked in-memory so that, if the same frame is re-emitted in the
// same process, the counter values cannot decrease.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Phase0TelemetryRow {
  frame_id: string;
  selection_to_chat_ms: number;
  generation_ms: number;
  ai_requery_count: number;
  dwell_ms: number;
  rss_mb: number;
  ts: string;
  // SPEC-FIGMA-007 REQ-11/REQ-14 — additive write-path counters (optional so
  // existing read-path callers stay byte-equal under the 7-key contract).
  dryrun_count?: number;
  approve_count?: number;
  undo_count?: number;
  apply_drift_abort_count?: number;
  apply_partial_disconnect_count?: number;
}

export interface Phase0TelemetryOptions {
  readonly filePath: string;
}

// @AX:NOTE: [AUTO] base 7-key JSONL contract preserved (REQ-06). Write-path
// counters appended after the 7 base keys when present (additive, REQ-11).
const KEY_ORDER: (keyof Phase0TelemetryRow)[] = [
  "frame_id",
  "selection_to_chat_ms",
  "generation_ms",
  "ai_requery_count",
  "dwell_ms",
  "rss_mb",
  "ts",
];

const WRITE_KEY_ORDER: (keyof Phase0TelemetryRow)[] = [
  "dryrun_count",
  "approve_count",
  "undo_count",
  "apply_drift_abort_count",
  "apply_partial_disconnect_count",
];

interface WriteCounterState {
  ai_requery_count: number;
  dwell_ms: number;
  // SPEC-FIGMA-007 monotonic counters; absent on early SPEC-FIGMA-006 runs.
  dryrun_count: number;
  approve_count: number;
  undo_count: number;
  apply_drift_abort_count: number;
  apply_partial_disconnect_count: number;
}

function clampMax(prev: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return prev;
  if (prev === undefined) return next;
  return Math.max(prev, next);
}

export class Phase0Telemetry {
  private readonly filePath: string;
  // Per-frame_id last-seen counter values; new writes must be >= the previous.
  private readonly counters = new Map<string, WriteCounterState>();

  constructor(opts: Phase0TelemetryOptions) {
    this.filePath = opts.filePath;
  }

  // @AX:WARN: [AUTO] INV-002 monotonic counter guard — clamps each counter via
  // Math.max against in-memory prev. SPEC-FIGMA-007 extends with 5 write-path
  // counters; absence on a row preserves the previous value (no-decrement).
  async append(row: Phase0TelemetryRow): Promise<void> {
    const prev = this.counters.get(row.frame_id);
    const ai = prev
      ? Math.max(prev.ai_requery_count, row.ai_requery_count)
      : row.ai_requery_count;
    const dw = prev ? Math.max(prev.dwell_ms, row.dwell_ms) : row.dwell_ms;
    const dryrun = clampMax(prev?.dryrun_count, row.dryrun_count) ?? 0;
    const approve = clampMax(prev?.approve_count, row.approve_count) ?? 0;
    const undo = clampMax(prev?.undo_count, row.undo_count) ?? 0;
    const drift = clampMax(prev?.apply_drift_abort_count, row.apply_drift_abort_count) ?? 0;
    const partial = clampMax(prev?.apply_partial_disconnect_count, row.apply_partial_disconnect_count) ?? 0;
    this.counters.set(row.frame_id, {
      ai_requery_count: ai,
      dwell_ms: dw,
      dryrun_count: dryrun,
      approve_count: approve,
      undo_count: undo,
      apply_drift_abort_count: drift,
      apply_partial_disconnect_count: partial,
    });

    const fixed: Phase0TelemetryRow = {
      ...row,
      ai_requery_count: ai,
      dwell_ms: dw,
    };
    const ordered: Record<string, unknown> = {};
    for (const k of KEY_ORDER) ordered[k] = fixed[k];
    // Append write-path counters only when at least one was provided on this
    // row OR when prior state for the frame already includes them. Preserves
    // SPEC-FIGMA-006 7-key contract for selection-only paths.
    const includeWritePath = WRITE_KEY_ORDER.some((k) => row[k] !== undefined) || (prev !== undefined && prev.dryrun_count + prev.approve_count + prev.undo_count + prev.apply_drift_abort_count + prev.apply_partial_disconnect_count > 0);
    if (includeWritePath) {
      ordered.dryrun_count = dryrun;
      ordered.approve_count = approve;
      ordered.undo_count = undo;
      ordered.apply_drift_abort_count = drift;
      ordered.apply_partial_disconnect_count = partial;
    }
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(this.filePath, JSON.stringify(ordered) + "\n", "utf8");
  }

  /** Return the last `n` parsed rows from the JSONL file (used by crash recovery). */
  readTail(n: number): Phase0TelemetryRow[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const start = Math.max(0, lines.length - n);
    return lines.slice(start).map((l) => JSON.parse(l) as Phase0TelemetryRow);
  }
}

export function currentRssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 100) / 100;
}
