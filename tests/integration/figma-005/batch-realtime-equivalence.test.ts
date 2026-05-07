// SPEC-FIGMA-005 AC-S5 (manifest equivalence portion): --batch and
// --realtime modes produce manifests where every frame's
// manifest_entry_hash matches byte-for-byte across the two lanes.
// REQ-05, REQ-06, REQ-NFR-03.
//
// The test composes a fake Anthropic client whose messages.batches
// namespace returns the same response payloads as the realtime
// messages.create path. Both runs use the same input set, model_id, and
// prompt_template. The hash equality holds because the audit-only
// transient ids (batch_id_provider) never enter ManifestEntry.

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

function frame(id: string): FrameInput {
  return {
    screen_id: id,
    source_hash: `hash_${id}`,
    frame_meta: { screen_id: id, name: id },
    screenshot_path: "/dev/null",
  };
}

const FRAMES = ["F1", "F2", "F3", "F4", "F5"].map(frame);

function deterministicResponseText(screen_id: string): string {
  return JSON.stringify({
    intent: `intent for ${screen_id}`,
    user_value: `value for ${screen_id}`,
    success_criteria: `criterion for ${screen_id}`,
    intent_mismatch: false,
    confidence: 0.9,
    states: [],
    edge_cases: [],
    data_io: [],
  });
}

class RealtimeMockProvider implements LLMProvider {
  async generateNodeOnly(
    prompt: string,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    const screen_id =
      prompt.match(/"screen_id"\s*:\s*"([A-Z0-9_-]+)"/)?.[1] ?? "F0";
    return {
      text: deterministicResponseText(screen_id),
      input_tokens: 800,
      output_tokens: 250,
      confidence: 0.9,
      intent_mismatch: false,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
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

// Bundles a fake batch client and a provider whose `.client` exposes it,
// so runBatch's --batch lane can pick up the SDK shim.
class BatchAwareProvider implements LLMProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;

  constructor() {
    this.client = makeFakeBatchClient();
  }

  async generateNodeOnly(
    p: string,
    o: ProviderOpts,
  ): Promise<LLMResponse> {
    return new RealtimeMockProvider().generateNodeOnly(p, o);
  }
  async generateVision(
    p: string,
    _i: Buffer,
    o: ProviderOpts,
  ): Promise<LLMResponse> {
    return this.generateNodeOnly(p, o);
  }
}

function makeFakeBatchClient() {
  return {
    messages: {
      batches: {
        create: async (_req: { requests: Array<{ custom_id: string }> }) => ({
          id: "msgbatch_test_001",
        }),
        retrieve: async (id: string) => ({
          id,
          processing_status: "ended" as const,
          request_counts: { succeeded: 5, errored: 0 },
          results_url: "https://mock/results",
        }),
        results: function* (_id: string) {
          for (const f of FRAMES) {
            yield {
              custom_id: f.screen_id,
              result: {
                type: "succeeded" as const,
                message: {
                  id: `msg_${f.screen_id}`,
                  content: [
                    {
                      type: "text",
                      text: deterministicResponseText(f.screen_id),
                    },
                  ],
                  usage: {
                    input_tokens: 800,
                    output_tokens: 250,
                    cache_read_input_tokens: 0,
                    cache_creation_input_tokens: 0,
                  },
                },
              },
            };
          }
        },
      },
    },
  };
}

describe("AC-S5: --batch / --realtime manifest equivalence", () => {
  it("manifest_entry_hash equals byte-for-byte for every frame across lanes", async () => {
    const tmpA = mkdtempSync(join(tmpdir(), "figma005-realtime-"));
    const tmpB = mkdtempSync(join(tmpdir(), "figma005-batch-"));

    const realtime = await runBatch({
      frames: FRAMES,
      provider: new RealtimeMockProvider(),
      output: join(tmpA, "manifest.json"),
      audit_dir: join(tmpA, "audit"),
      mode: "node-only",
      lane: "realtime",
      model_id: "claude-sonnet-4-6",
    });
    expect(realtime.exit_code).toBe(0);

    const batch = await runBatch({
      frames: FRAMES,
      provider: new BatchAwareProvider(),
      output: join(tmpB, "manifest.json"),
      audit_dir: join(tmpB, "audit"),
      mode: "node-only",
      lane: "batch",
      model_id: "claude-sonnet-4-6",
      provider_sdk_version: "0.95.0",
    });
    expect(batch.exit_code).toBe(0);
    expect(batch.batch_id_provider).toBe("msgbatch_test_001");

    const mfA = JSON.parse(
      readFileSync(join(tmpA, "manifest.json"), "utf-8"),
    ) as { frames: ManifestEntry[] };
    const mfB = JSON.parse(
      readFileSync(join(tmpB, "manifest.json"), "utf-8"),
    ) as { frames: ManifestEntry[] };

    expect(mfA.frames).toHaveLength(5);
    expect(mfB.frames).toHaveLength(5);

    // Order preservation: both lanes emit frames in input order.
    expect(mfA.frames.map((f) => f.screen_id)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
    ]);
    expect(mfB.frames.map((f) => f.screen_id)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
    ]);

    // Hash equality per frame. computeManifestEntryHash canonicalizes by
    // sorted Object.keys → does not require any specific field name; the
    // cast bridges the SPEC-FIGMA-003 (screen_id) vs SPEC-FIGMA-004
    // (frame_id) ManifestEntry shapes for the cross-package test boundary.
    for (let i = 0; i < 5; i++) {
      expect(
        computeManifestEntryHash(mfA.frames[i] as unknown as Parameters<typeof computeManifestEntryHash>[0]),
      ).toBe(
        computeManifestEntryHash(mfB.frames[i] as unknown as Parameters<typeof computeManifestEntryHash>[0]),
      );
    }
  });

  it("--batch audit rows carry batch_id_provider; --realtime audit rows do not", async () => {
    const tmpA = mkdtempSync(join(tmpdir(), "figma005-rt-aud-"));
    const tmpB = mkdtempSync(join(tmpdir(), "figma005-bt-aud-"));
    const realtime = await runBatch({
      frames: FRAMES,
      provider: new RealtimeMockProvider(),
      output: join(tmpA, "manifest.json"),
      audit_dir: join(tmpA, "audit"),
      mode: "node-only",
      lane: "realtime",
    });
    const batch = await runBatch({
      frames: FRAMES,
      provider: new BatchAwareProvider(),
      output: join(tmpB, "manifest.json"),
      audit_dir: join(tmpB, "audit"),
      mode: "node-only",
      lane: "batch",
      provider_sdk_version: "0.95.0",
    });

    for (const a of realtime.audit_entries) {
      expect(a.batch_id_provider).toBeNull();
    }
    for (const a of batch.audit_entries) {
      expect(a.batch_id_provider).toBe("msgbatch_test_001");
    }
  });
});
