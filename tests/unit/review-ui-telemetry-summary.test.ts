// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-11, AC-S12.
// /api/telemetry-summary route: 7-key response set, mean_generation_ms===1500.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GET } from "../../apps/review-ui/src/app/api/telemetry-summary/route.js";

const EXPECTED_KEYS = [
  "event_count",
  "mean_ai_requery_count",
  "mean_dwell_ms",
  "mean_generation_ms",
  "mean_selection_to_chat_ms",
  "p95_generation_ms",
  "p95_selection_to_chat_ms",
];

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-tsum-"));
  const teleDir = join(workDir, ".autopus", "telemetry");
  mkdirSync(teleDir, { recursive: true });
  const lines = Array.from({ length: 30 }, (_, i) =>
    JSON.stringify({
      frame_id: `1:${i + 1}`,
      selection_to_chat_ms: 100 + i,
      generation_ms: 1500,
      ai_requery_count: 0,
      dwell_ms: 200,
      rss_mb: 64,
      ts: new Date(2026, 4, 7, 0, 0, i).toISOString(),
    }),
  );
  writeFileSync(join(teleDir, "phase0.jsonl"), lines.join("\n") + "\n", "utf8");
  process.env.AUTOPUS_PHASE0_TELEMETRY_DIR = teleDir;
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.AUTOPUS_PHASE0_TELEMETRY_DIR;
});

describe("/api/telemetry-summary (REQ-11, AC-S12)", () => {
  it("returns status 200 with the exact 7-key response body", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(EXPECTED_KEYS);
    expect(body.event_count).toBe(30);
    expect(body.mean_generation_ms).toBe(1500);
    expect(body.p95_generation_ms).toBe(1500);
  });
});
