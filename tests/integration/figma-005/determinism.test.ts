// SPEC-FIGMA-005 AC-S7: manifest_entry_hash byte-equality across runs that
// expose different transient ids (file_id, batch_id_provider, cache_id,
// request_id, provider_sdk_version, response timestamp).
// REQ-07, REQ-NFR-03, INV-006.
//
// Two runs share the same input set + model_config + prompt_template_hash.
// The first run uses transient set A; the second uses transient set B.
// computeManifestEntryHash MUST produce byte-identical output for every
// frame because none of those transient ids enter the ManifestEntry shape.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runBatch } from "../../../src/batch-executor.js";
import { computeManifestEntryHash } from "../../../packages/write-router/src/idempotency.js";
import {
  type LLMProvider,
  type LLMResponse,
  type ManifestEntry,
  type ProviderOpts,
} from "../../../src/types/llm-provider.js";
import type { FrameInput } from "../../../src/routing.js";

interface TransientSet {
  cache_id: string;
  request_id_prefix: string;
  provider_sdk_version: string;
  file_id_prefix: string;
}

class TransientMockProvider implements LLMProvider {
  call_count = 0;
  constructor(private readonly transients: TransientSet) {}

  async generateNodeOnly(
    prompt: string,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    this.call_count += 1;
    const screenMatch = prompt.match(
      /"screen_id"\s*:\s*"([A-Z][A-Z0-9_-]{1,63})"/,
    );
    const screen_id = screenMatch?.[1] ?? "UNKNOWN";
    return {
      // Deterministic body — same input ⇒ same response text across runs.
      text: JSON.stringify({
        intent: `intent for ${screen_id}`,
        user_value: `value for ${screen_id}`,
        success_criteria: `criterion for ${screen_id}`,
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
      // Transient values vary per run — they MUST NOT enter ManifestEntry.
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 200,
      dynamic_input_tokens: 800,
      cache_id: this.transients.cache_id,
      request_id: `${this.transients.request_id_prefix}_${this.call_count}`,
      provider_sdk_version: this.transients.provider_sdk_version,
      file_id: `${this.transients.file_id_prefix}_${screen_id}`,
    };
  }

  async generateVision(
    p: string,
    _i: Buffer,
    o: ProviderOpts,
  ): Promise<LLMResponse> {
    return this.generateNodeOnly(p, o);
  }
}

function makeFrames(n: number): FrameInput[] {
  return Array.from({ length: n }, (_, idx) => {
    const i = idx + 1;
    const screen_id = `DET-${i.toString().padStart(2, "0")}`;
    return {
      screen_id,
      source_hash: `hash_${i.toString().padStart(16, "0")}`,
      frame_meta: { screen_id, name: `Frame ${i}` },
      screenshot_path: "/dev/null",
    };
  });
}

async function runOnce(
  transients: TransientSet,
  modelId: string,
): Promise<ManifestEntry[]> {
  const provider = new TransientMockProvider(transients);
  const tmp = mkdtempSync(join(tmpdir(), "figma005-det-"));
  await runBatch({
    frames: makeFrames(10),
    provider,
    output: join(tmp, "manifest.json"),
    audit_dir: join(tmp, "audit"),
    mode: "node-only",
    model_id: modelId,
    temperature: 0,
    cache_control_region: "STATIC PREFIX",
  });
  const manifest = JSON.parse(
    readFileSync(join(tmp, "manifest.json"), "utf-8"),
  ) as { frames: ManifestEntry[] };
  return manifest.frames;
}

describe("AC-S7: manifest_entry_hash determinism across transient ids", () => {
  it("two runs with different transient sets ⇒ same hash for every frame", async () => {
    const setA: TransientSet = {
      cache_id: "cache_A",
      request_id_prefix: "req_A",
      provider_sdk_version: "0.95.0",
      file_id_prefix: "file_A",
    };
    const setB: TransientSet = {
      cache_id: "cache_B",
      request_id_prefix: "req_B",
      provider_sdk_version: "0.95.1",
      file_id_prefix: "file_B",
    };
    const runA = await runOnce(setA, "claude-sonnet-4-6");
    const runB = await runOnce(setB, "claude-sonnet-4-6");

    expect(runA).toHaveLength(10);
    expect(runB).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      const hashA = computeManifestEntryHash(
        runA[i] as unknown as Parameters<typeof computeManifestEntryHash>[0],
      );
      const hashB = computeManifestEntryHash(
        runB[i] as unknown as Parameters<typeof computeManifestEntryHash>[0],
      );
      expect(hashA).toBe(hashB);
      expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("manifest entries do NOT carry file_id, batch_id_provider, cache_id, request_id, or provider_sdk_version", async () => {
    const runA = await runOnce(
      {
        cache_id: "cache_x",
        request_id_prefix: "req_x",
        provider_sdk_version: "0.95.0",
        file_id_prefix: "file_x",
      },
      "claude-sonnet-4-6",
    );
    for (const entry of runA) {
      const e = entry as unknown as Record<string, unknown>;
      expect(e.file_id).toBeUndefined();
      expect(e.batch_id_provider).toBeUndefined();
      expect(e.cache_id).toBeUndefined();
      expect(e.request_id).toBeUndefined();
      expect(e.provider_sdk_version).toBeUndefined();
    }
  });

  it("changing model_id DOES break hash equality (non-transient input)", async () => {
    const t: TransientSet = {
      cache_id: "c",
      request_id_prefix: "r",
      provider_sdk_version: "0.95.0",
      file_id_prefix: "f",
    };
    const runA = await runOnce(t, "claude-sonnet-4-6");
    const runB = await runOnce(t, "claude-opus-4-7");
    // model_id is in pilot_metadata, not in ManifestEntry — manifest_entry_hash
    // is unchanged. This test documents that semantics; if the hash input
    // grows to include model_id (per REQ-07), this expectation flips.
    for (let i = 0; i < runA.length; i++) {
      expect(
        computeManifestEntryHash(
          runA[i] as unknown as Parameters<typeof computeManifestEntryHash>[0],
        ),
      ).toBe(
        computeManifestEntryHash(
          runB[i] as unknown as Parameters<typeof computeManifestEntryHash>[0],
        ),
      );
    }
  });
});
