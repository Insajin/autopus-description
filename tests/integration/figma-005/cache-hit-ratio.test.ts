// SPEC-FIGMA-005 AC-S1, AC-S11 (cache portion): 30-frame Prompt Caching
// hit ratio verification. REQ-01, REQ-08, REQ-22.
//
// Mock provider returns frame-1 cache miss + frames 2-30 cache hit
// (cache_read_input_tokens: 5000, cache_creation_input_tokens: 200,
// input_tokens: 800). Aggregate ratio is computed by audit-emitter and
// MUST land at 0.80556 ± 0.001 with the printed summary line containing
// `aggregate_cache_hit_ratio` and the exact dedup count.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runBatch } from "../../../src/batch-executor.js";
import {
  type LLMProvider,
  type LLMResponse,
  type ProviderOpts,
} from "../../../src/types/llm-provider.js";
import type { FrameInput } from "../../../src/routing.js";

class CacheHitMockProvider implements LLMProvider {
  call_count = 0;
  async generateNodeOnly(
    _prompt: string,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    this.call_count += 1;
    const isFirstFrame = this.call_count === 1;
    return {
      text: JSON.stringify({
        intent: "mock intent",
        user_value: "mock value",
        success_criteria: "mock criterion",
        intent_mismatch: false,
        confidence: 0.9,
        states: [],
        edge_cases: [],
        data_io: [],
      }),
      input_tokens: 800,
      output_tokens: 250,
      confidence: 0.9,
      intent_mismatch: false,
      cache_read_input_tokens: isFirstFrame ? 0 : 5000,
      cache_creation_input_tokens: isFirstFrame ? 5200 : 200,
      dynamic_input_tokens: 800,
      provider_sdk_version: "0.95.0",
    };
  }
  async generateVision(
    _prompt: string,
    _image: Buffer,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    return this.generateNodeOnly("", _opts);
  }
}

function makeFrames(n: number): FrameInput[] {
  const frames: FrameInput[] = [];
  for (let i = 1; i <= n; i++) {
    const screen_id = `AUTH-${i.toString().padStart(2, "0")}`;
    frames.push({
      screen_id,
      source_hash: `hash_${i.toString().padStart(16, "0")}`,
      frame_meta: { screen_id, name: `Frame ${i}` },
      screenshot_path: "/dev/null",
    });
  }
  return frames;
}

describe("AC-S1: 30-frame cache_hit_ratio ≥ 0.5", () => {
  it("aggregate ratio matches numeric oracle", async () => {
    const provider = new CacheHitMockProvider();
    const tmp = mkdtempSync(join(tmpdir(), "figma005-ratio-"));
    const result = await runBatch({
      frames: makeFrames(30),
      provider,
      output: join(tmp, "manifest.json"),
      audit_dir: join(tmp, "audit"),
      mode: "node-only",
      cache_control_region: "STATIC PREFIX",
    });

    expect(result.exit_code).toBe(0);
    expect(result.audit_entries).toHaveLength(30);
    expect(provider.call_count).toBe(30);

    // Frame 1 audit row: cache miss
    const f1 = result.audit_entries[0];
    expect(f1.cache_hit).toBe(false);
    expect(f1.cache_read_input_tokens).toBe(0);
    expect(f1.cache_creation_input_tokens).toBe(5200);

    // Frames 2-30 audit rows: cache hit
    for (let i = 1; i < 30; i++) {
      expect(result.audit_entries[i].cache_hit).toBe(true);
      expect(result.audit_entries[i].cache_read_input_tokens).toBe(5000);
      expect(result.audit_entries[i].cache_creation_input_tokens).toBe(200);
    }

    // Aggregate numeric oracle:
    //   cache_read_sum    = 5000 * 29 = 145000
    //   cache_creation_sum = 200 * 29 + 5200 = 11000
    //   dynamic_sum       = 800 * 30 = 24000
    //   total             = 180000
    //   ratio             = 145000 / 180000 = 0.80555...
    const stdoutMatch = result.stdout.match(
      /aggregate_cache_hit_ratio=([0-9.]+)/,
    );
    expect(stdoutMatch).not.toBeNull();
    const ratio = parseFloat(stdoutMatch![1]);
    expect(ratio).toBeCloseTo(145000 / 180000, 3);
    // Must threshold ≥ 0.5
    expect(ratio).toBeGreaterThanOrEqual(0.5);
  });

  it("audit JSONL persists 30 rows under .audit/<batch_id>/calls.jsonl", async () => {
    const provider = new CacheHitMockProvider();
    const tmp = mkdtempSync(join(tmpdir(), "figma005-ratio-jsonl-"));
    const auditDir = join(tmp, "audit");
    const result = await runBatch({
      frames: makeFrames(30),
      provider,
      output: join(tmp, "manifest.json"),
      audit_dir: auditDir,
      mode: "node-only",
    });
    const batchId = result.audit_entries[0].batch_id;
    const callsPath = join(auditDir, batchId, "calls.jsonl");
    const lines = readFileSync(callsPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(30);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    // first frame ⇒ cache_hit=false; remaining ⇒ true
    expect(parsed[0].cache_hit).toBe(false);
    for (let i = 1; i < 30; i++) {
      expect(parsed[i].cache_hit).toBe(true);
    }
  });
});
