// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S6.
// Phase 0 telemetry — 30 lines, exact 7-key set, generation_ms===1500, byte-equal re-read.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";

const KEYS = [
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
  workDir = mkdtempSync(join(tmpdir(), "autopus-tele-int-"));
  telemetryPath = join(workDir, ".autopus", "telemetry", "phase0.jsonl");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-S6: Phase 0 telemetry counters with concrete oracle values", () => {
  it("30 events produce 30 JSONL lines with the 7-key set and stable bytes", async () => {
    const daemon = new Daemon({
      transport: "stdio",
      port: 0,
      cwd: workDir,
      provider: "mock",
      mockGenerationMs: 1500,
    });
    await daemon.boot();

    for (let i = 1; i <= 30; i++) {
      await daemon.onSelectionChange({
        figma_node_id: `1:${i}`,
        screen_id: `FRAME-${String(i).padStart(2, "0")}`,
        node_tree_summary: {},
        image_bytes_b64_sha256: "0".repeat(64),
        image_bytes_b64: "",
      });
    }
    await daemon.flush();

    expect(existsSync(telemetryPath)).toBe(true);
    const content = readFileSync(telemetryPath, "utf8").trim();
    const lines = content.split("\n");
    expect(lines).toHaveLength(30);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(Object.keys(parsed).sort()).toEqual(KEYS);
      expect(parsed.selection_to_chat_ms).toBeGreaterThanOrEqual(0);
      expect(parsed.selection_to_chat_ms).toBeLessThanOrEqual(3000);
      expect(parsed.generation_ms).toBe(1500);
      expect(Number.isInteger(parsed.ai_requery_count)).toBe(true);
      expect(parsed.ai_requery_count).toBeGreaterThanOrEqual(0);
      expect(parsed.rss_mb).toBeLessThanOrEqual(256);
    }

    const firstBytes = readFileSync(telemetryPath);
    await new Promise((r) => setTimeout(r, 100));
    const secondBytes = readFileSync(telemetryPath);
    expect(firstBytes.equals(secondBytes)).toBe(true);

    await daemon.shutdown();
  });
});
