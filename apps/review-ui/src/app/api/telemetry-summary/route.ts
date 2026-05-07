// SPEC-FIGMA-006 REQ-11 / AC-S12 — /api/telemetry-summary.
// Aggregates Phase 0 telemetry events from .autopus/telemetry/phase0.jsonl
// and returns a fixed 7-key summary body. Path traversal is guarded by
// resolving the telemetry root and rejecting any escape (mirrors the
// manifest-loader containment pattern).
//
// @AX:WARN: [AUTO] Path traversal guard — telemetry root is resolved via
// `path.resolve` and the requested file MUST live inside it. Any user-influenced
// path component MUST NOT escape the telemetry root. Removing this guard turns
// the route into an arbitrary-file read.
// @AX:REASON: Q-SEC-02 + apps/review-ui pattern parity (manifest-loader.ts
// uses MANIFEST_ROOT containment for the same reason on the read side).
//
// @AX:NOTE: [AUTO] AC-S12 oracle response shape — exactly 7 keys, no extras:
// {event_count, mean_selection_to_chat_ms, p95_selection_to_chat_ms,
//  mean_generation_ms, p95_generation_ms, mean_dwell_ms, mean_ai_requery_count}.
// Adding a key here would silently expand the API surface without spec change.

import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const TELEMETRY_FILE = "phase0.jsonl";

interface Phase0Event {
  selection_to_chat_ms?: number;
  generation_ms?: number;
  ai_requery_count?: number;
  dwell_ms?: number;
}

interface Summary {
  event_count: number;
  mean_selection_to_chat_ms: number;
  p95_selection_to_chat_ms: number;
  mean_generation_ms: number;
  p95_generation_ms: number;
  mean_dwell_ms: number;
  mean_ai_requery_count: number;
}

function telemetryRoot(): string {
  const override = process.env.AUTOPUS_PHASE0_TELEMETRY_DIR;
  if (override && override.length > 0) {
    return path.resolve(override);
  }
  return path.resolve(process.cwd(), ".autopus", "telemetry");
}

function resolveTelemetryFile(): string {
  const root = telemetryRoot();
  const resolved = path.resolve(root, TELEMETRY_FILE);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error("telemetry path escapes telemetry root");
  }
  return resolved;
}

function emptySummary(): Summary {
  return {
    event_count: 0,
    mean_selection_to_chat_ms: 0,
    p95_selection_to_chat_ms: 0,
    mean_generation_ms: 0,
    p95_generation_ms: 0,
    mean_dwell_ms: 0,
    mean_ai_requery_count: 0,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank p95: ceil(0.95 * n) - 1 (zero-indexed).
  const idx = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function parseEvents(content: string): Phase0Event[] {
  const events: Phase0Event[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") {
        events.push(parsed as Phase0Event);
      }
    } catch {
      // skip malformed line
    }
  }
  return events;
}

function summarize(events: Phase0Event[]): Summary {
  if (events.length === 0) return emptySummary();
  const sel = events.map((e) => Number(e.selection_to_chat_ms ?? 0));
  const gen = events.map((e) => Number(e.generation_ms ?? 0));
  const dwell = events.map((e) => Number(e.dwell_ms ?? 0));
  const req = events.map((e) => Number(e.ai_requery_count ?? 0));
  return {
    event_count: events.length,
    mean_selection_to_chat_ms: mean(sel),
    p95_selection_to_chat_ms: p95(sel),
    mean_generation_ms: mean(gen),
    p95_generation_ms: p95(gen),
    mean_dwell_ms: mean(dwell),
    mean_ai_requery_count: mean(req),
  };
}

export async function GET(): Promise<Response> {
  let summary: Summary;
  try {
    const file = resolveTelemetryFile();
    const content = await readFile(file, "utf8");
    summary = summarize(parseEvents(content));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      summary = emptySummary();
    } else {
      summary = emptySummary();
    }
  }
  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
