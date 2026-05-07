// SPEC-FIGMA-005 AC-S2: Structured Outputs strict mode rejection.
// REQ-02, REQ-NFR-02. When the SDK rejects strict mode for a frame, the
// pipeline emits SCHEMA_STRICT_INCOMPATIBLE on stderr, drops the frame
// from the manifest, and does NOT silently fall back to free-form JSON.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function makePassingValidator(): string {
  const dir = mkdtempSync(join(tmpdir(), "figma005-validator-pass-"));
  const path = join(dir, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return `sh ${path}`;
}

import { runBatch } from "../../../src/batch-executor.js";
import {
  ErrorCode,
  ProviderError,
  type LLMProvider,
  type LLMResponse,
  type ProviderOpts,
} from "../../../src/types/llm-provider.js";
import type { FrameInput } from "../../../src/routing.js";

class StrictRejectMockProvider implements LLMProvider {
  call_count = 0;
  constructor(private readonly rejectScreenId: string) {}

  async generateNodeOnly(
    prompt: string,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    this.call_count += 1;
    const match = prompt.match(/"screen_id"\s*:\s*"([A-Z][A-Z0-9_-]{1,63})"/);
    const screen_id = match?.[1];
    if (screen_id === this.rejectScreenId) {
      throw new ProviderError(
        ErrorCode.SCHEMA_STRICT_INCOMPATIBLE,
        "Schema contains anyOf which is not supported in strict mode",
        screen_id,
        { raw_error_type: "invalid_request_error" },
      );
    }
    return {
      text: JSON.stringify({
        intent: "ok",
        user_value: "v",
        success_criteria: "c",
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
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 200,
      dynamic_input_tokens: 800,
      provider_sdk_version: "0.95.0",
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

function frame(id: string): FrameInput {
  return {
    screen_id: id,
    source_hash: `hash_${id}`,
    frame_meta: { screen_id: id, name: id },
    screenshot_path: "/dev/null",
  };
}

describe("AC-S2: strict-mode rejection — silent fallback removed", () => {
  it("rejected frame is excluded from manifest and surfaces SCHEMA_STRICT_INCOMPATIBLE", async () => {
    const provider = new StrictRejectMockProvider("AUTH-02");
    const tmp = mkdtempSync(join(tmpdir(), "figma005-strict-"));
    const result = await runBatch({
      frames: [frame("AUTH-01"), frame("AUTH-02"), frame("AUTH-03")],
      provider,
      output: join(tmp, "manifest.json"),
      audit_dir: join(tmp, "audit"),
      mode: "node-only",
      structured_output_schema: { type: "object" },
      validator_binary: makePassingValidator(),
    });

    // Provider was called for each frame (not short-circuited).
    expect(provider.call_count).toBe(3);

    // Manifest contains exactly 2 entries (AUTH-01, AUTH-03; AUTH-02 dropped).
    const manifest = JSON.parse(
      readFileSync(join(tmp, "manifest.json"), "utf-8"),
    ) as { frames: Array<{ screen_id: string }> };
    expect(manifest.frames).toHaveLength(2);
    const ids = manifest.frames.map((f) => f.screen_id).sort();
    expect(ids).toEqual(["AUTH-01", "AUTH-03"]);

    // stderr emits SCHEMA_STRICT_INCOMPATIBLE referencing AUTH-02.
    expect(result.stderr).toContain("SCHEMA_STRICT_INCOMPATIBLE");
    expect(result.stderr).toContain("AUTH-02");

    // exit_code non-zero because some frames failed.
    expect(result.exit_code).toBe(1);

    // Audit rows: only successful frames have audit (rejected call returns
    // a BatchError, no audit emit).
    expect(result.audit_entries).toHaveLength(2);
    for (const a of result.audit_entries) {
      expect(a.strict_mode_used).toBe(true);
    }
  });

  it("manifest entry never carries confidence from a parseJsonBody fallback for the rejected frame", async () => {
    const provider = new StrictRejectMockProvider("AUTH-02");
    const tmp = mkdtempSync(join(tmpdir(), "figma005-strict-noslip-"));
    await runBatch({
      frames: [frame("AUTH-01"), frame("AUTH-02"), frame("AUTH-03")],
      provider,
      output: join(tmp, "manifest.json"),
      audit_dir: join(tmp, "audit"),
      mode: "node-only",
      structured_output_schema: { type: "object" },
      validator_binary: makePassingValidator(),
    });
    const manifest = JSON.parse(
      readFileSync(join(tmp, "manifest.json"), "utf-8"),
    ) as { frames: Array<{ screen_id: string; confidence: number }> };
    const auth02 = manifest.frames.find((f) => f.screen_id === "AUTH-02");
    expect(auth02).toBeUndefined();
  });
});
