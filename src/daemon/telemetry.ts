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
}

export interface Phase0TelemetryOptions {
  readonly filePath: string;
}

// @AX:NOTE: [AUTO] 7-key JSONL shape contract — order is byte-stable for re-read parity (REQ-06). Adding a key requires telemetry-summary route schema bump.
const KEY_ORDER: (keyof Phase0TelemetryRow)[] = [
  "frame_id",
  "selection_to_chat_ms",
  "generation_ms",
  "ai_requery_count",
  "dwell_ms",
  "rss_mb",
  "ts",
];

export class Phase0Telemetry {
  private readonly filePath: string;
  // Per-frame_id last-seen counter values; new writes must be >= the previous.
  private readonly counters = new Map<
    string,
    { ai_requery_count: number; dwell_ms: number }
  >();

  constructor(opts: Phase0TelemetryOptions) {
    this.filePath = opts.filePath;
  }

  // @AX:WARN: [AUTO] INV-002 monotonic counter guard — ai_requery_count and dwell_ms are clamped via Math.max against in-memory prev; resetting `this.counters` mid-process would let a smaller value persist on disk. @AX:REASON: NFR-01 oracle reads tail rows assuming monotonicity.
  async append(row: Phase0TelemetryRow): Promise<void> {
    const prev = this.counters.get(row.frame_id);
    const ai = prev
      ? Math.max(prev.ai_requery_count, row.ai_requery_count)
      : row.ai_requery_count;
    const dw = prev ? Math.max(prev.dwell_ms, row.dwell_ms) : row.dwell_ms;
    this.counters.set(row.frame_id, { ai_requery_count: ai, dwell_ms: dw });

    // Stable key ordering for byte-equal re-reads.
    const ordered: Record<string, unknown> = {};
    const fixed: Phase0TelemetryRow = {
      ...row,
      ai_requery_count: ai,
      dwell_ms: dw,
    };
    for (const k of KEY_ORDER) {
      ordered[k] = fixed[k];
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
