// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-06, NFR-01, AC-S6.
// JSONL line format: 7-key set, monotonic counters, byte-equal re-read.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Phase0Telemetry } from "../../src/daemon/telemetry.js";

const EXPECTED_KEYS = [
  "ai_requery_count",
  "dwell_ms",
  "frame_id",
  "generation_ms",
  "rss_mb",
  "selection_to_chat_ms",
  "ts",
];

let workDir: string;
let telemetryPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-tele-"));
  telemetryPath = join(workDir, ".autopus", "telemetry", "phase0.jsonl");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("Phase 0 telemetry JSONL (REQ-06, AC-S6)", () => {
  it("each emitted line parses with the exact 7-key set", async () => {
    const t = new Phase0Telemetry({ filePath: telemetryPath });
    await t.append({
      frame_id: "1:1",
      selection_to_chat_ms: 120,
      generation_ms: 1500,
      ai_requery_count: 0,
      dwell_ms: 2000,
      rss_mb: 64,
      ts: "2026-05-07T00:00:00.000Z",
    });
    const line = readFileSync(telemetryPath, "utf8").trim();
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(EXPECTED_KEYS);
  });

  it("generation_ms equals 1500 for a mock provider run; rss_mb <= 256 (NFR-01)", async () => {
    const t = new Phase0Telemetry({ filePath: telemetryPath });
    await t.append({
      frame_id: "1:1",
      selection_to_chat_ms: 50,
      generation_ms: 1500,
      ai_requery_count: 0,
      dwell_ms: 100,
      rss_mb: 200,
      ts: "2026-05-07T00:00:00.000Z",
    });
    const parsed = JSON.parse(readFileSync(telemetryPath, "utf8").trim());
    expect(parsed.generation_ms).toBe(1500);
    expect(parsed.rss_mb).toBeLessThanOrEqual(256);
  });

  it("re-reading 100ms later produces byte-equal content (INV-002 monotonic, never decrement)", async () => {
    const t = new Phase0Telemetry({ filePath: telemetryPath });
    await t.append({
      frame_id: "1:1",
      selection_to_chat_ms: 50,
      generation_ms: 1500,
      ai_requery_count: 0,
      dwell_ms: 100,
      rss_mb: 64,
      ts: "2026-05-07T00:00:00.000Z",
    });
    const first = readFileSync(telemetryPath);
    await new Promise((r) => setTimeout(r, 100));
    const second = readFileSync(telemetryPath);
    expect(first.equals(second)).toBe(true);
  });
});
