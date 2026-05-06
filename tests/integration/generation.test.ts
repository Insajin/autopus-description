// SPEC-FIGMA-003 Phase 1.5 RED scaffold — generation suite (S1-S9, S11-S13).
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runBatch } from "../../src/batch-executor.js";
import { MockLLMProvider, type MockResponseSpec } from "../../src/providers/mock-provider.js";
import { RecordedAnthropicProvider } from "../../src/providers/anthropic-provider.js";
import {
  FIXTURE_5, FIXTURE_30, baseSpec, makeFrameInput, makeFrames, mockOf,
  parseStderrJsonLines, readManifest, runValidator, tmpOut,
} from "./_helpers.js";

const HASH = "abc123def456";
const fr = (id: string) => makeFrameInput(id, HASH);

describe("SPEC-FIGMA-003 generation — Must AC oracle", () => {
  it("AC-S1: confidence=1.5 emits OUT_OF_RANGE and excludes entry", async () => {
    const provider = mockOf([
      ["AUTH-01", baseSpec({ confidence: 1.5, input_tokens: 1200, output_tokens: 350 })],
    ]);
    const out = tmpOut();
    const result = await runBatch({
      frames: [fr("AUTH-01")],
      provider,
      output: out,
    });

    expect(result.exit_code).not.toBe(0);
    const lines = parseStderrJsonLines(result.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      code: "OUT_OF_RANGE",
      json_pointer: "/entries/0/confidence",
      message: "confidence 1.5 outside [0.0, 1.0]",
    });
    expect(
      (readManifest(out).frames ?? []).find((f: any) => f.screen_id === "AUTH-01"),
    ).toBeUndefined();
  });

  it("AC-S2: input>8000 emits TOKEN_BUDGET_EXCEEDED, no LLM call", async () => {
    const provider = new MockLLMProvider({
      responses: new Map(),
      forceMeasuredInputTokens: 8500,
    });
    const out = tmpOut();
    const result = await runBatch({
      frames: [fr("BIG-01")],
      provider,
      output: out,
    });

    expect(parseStderrJsonLines(result.stderr)).toContainEqual({
      code: "TOKEN_BUDGET_EXCEEDED",
      screen_id: "BIG-01",
      measured_input_tokens: 8500,
      limit: 8000,
    });
    expect(provider.spy.generateNodeOnly_count).toBe(0);
    expect(provider.spy.generateVision_count).toBe(0);
    expect(
      (readManifest(out).frames ?? []).some((f: any) => f.screen_id === "BIG-01"),
    ).toBe(false);
  });

  it("AC-S3: output>2000 emits OUTPUT_BUDGET_EXCEEDED, excludes entry", async () => {
    const provider = mockOf([
      ["DASH-02", baseSpec({ output_tokens: 2500, confidence: 0.8 })],
    ]);
    const out = tmpOut();
    const result = await runBatch({
      frames: [fr("DASH-02")],
      provider,
      output: out,
    });

    expect(parseStderrJsonLines(result.stderr)).toContainEqual({
      code: "OUTPUT_BUDGET_EXCEEDED",
      screen_id: "DASH-02",
      measured_output_tokens: 2500,
      limit: 2000,
    });
    expect(
      (readManifest(out).frames ?? []).some((f: any) => f.screen_id === "DASH-02"),
    ).toBe(false);
  });

  it("AC-S4: 30-frame batch invokes Vision exactly for 9 low-confidence frames", async () => {
    const responses: Array<[string, MockResponseSpec]> = Array.from(
      { length: 30 },
      (_, i) => [
        `F${String(i).padStart(2, "0")}`,
        baseSpec({ confidence: i <= 20 ? 0.8 : 0.5 }),
      ],
    );
    const provider = mockOf(responses);
    const out = tmpOut();
    const result = await runBatch({
      frames: makeFrames(30),
      provider,
      output: out,
      parallelism: 5,
    });

    expect(result.exit_code).toBe(0);
    expect(provider.spy.generateNodeOnly_count).toBe(30);
    expect(provider.spy.generateVision_count).toBe(9);
    expect(readManifest(out).pilot_metadata.vision_call_count).toBe(9);
  });

  it("AC-S5: confidence==0.7 boundary does NOT trigger Vision (strict <)", async () => {
    const provider = mockOf([["PROF-01", baseSpec({ confidence: 0.7 })]]);
    const out = tmpOut();
    await runBatch({
      frames: [fr("PROF-01")],
      provider,
      output: out,
    });

    expect(provider.spy.generateNodeOnly_count).toBe(1);
    expect(provider.spy.generateVision_count).toBe(0);
    expect(readManifest(out).frames[0].confidence).toBe(0.7);
  });

  it("AC-S6: source_hash preserved byte-equal", async () => {
    const provider = mockOf([["HASH-01", baseSpec()]]);
    const out = tmpOut();
    await runBatch({
      frames: [fr("HASH-01")],
      provider,
      output: out,
    });
    expect(readManifest(out).frames[0].source_hash).toBe(HASH);
  });

  it("AC-S7: [CANNOT_INFER] fields → empty string + confidence cap <= 0.5", async () => {
    const provider = mockOf([
      [
        "SETTINGS-01",
        baseSpec({
          text: JSON.stringify({
            intent: "설정 화면 진입점",
            user_value: "[CANNOT_INFER]",
            success_criteria: "[CANNOT_INFER]",
            data_io: "[CANNOT_INFER]",
          }),
          confidence: 0.85,
        }),
      ],
    ]);
    const out = tmpOut();
    await runBatch({
      frames: [fr("SETTINGS-01")],
      provider,
      output: out,
    });

    const e = readManifest(out).frames[0];
    expect(e.user_value).toBe("");
    expect(e.success_criteria).toBe("");
    expect(e.data_io).toEqual([]);
    expect(e.intent).toBe("설정 화면 진입점");
    expect(e.confidence).toBeLessThanOrEqual(0.5);
    expect(runValidator(out).status).toBe(0);
  });

  it("AC-S8: provider substitutability (mock vs recorded anthropic, identical key sets)", async () => {
    const mock = new MockLLMProvider({ responses: new Map(), useFixtureFile: FIXTURE_5 });
    const recorded = new RecordedAnthropicProvider({ fixtureFile: FIXTURE_5 });
    const fx = JSON.parse(readFileSync(FIXTURE_5, "utf-8")) as {
      frames: Array<{ screen_id: string; source_hash: string }>;
    };
    const frames = fx.frames.map((f) => makeFrameInput(f.screen_id, f.source_hash));
    const oM = tmpOut("mock.json");
    const oA = tmpOut("anthropic.json");
    await runBatch({ frames, provider: mock, output: oM });
    await runBatch({ frames, provider: recorded, output: oA });
    const M = readManifest(oM);
    const A = readManifest(oA);

    expect(M.frames.length).toBe(5);
    expect(A.frames.length).toBe(5);
    expect(runValidator(oM).status).toBe(0);
    expect(runValidator(oA).status).toBe(0);
    for (let i = 0; i < 5; i++) {
      expect(Object.keys(M.frames[i]).sort()).toEqual(Object.keys(A.frames[i]).sort());
      expect(M.frames[i].source_hash).toBe(fx.frames[i].source_hash);
      expect(A.frames[i].source_hash).toBe(fx.frames[i].source_hash);
    }
  });

  it("AC-S9: 30-frame fixture passes validate-manifest with RESULT pass=30", async () => {
    const provider = new MockLLMProvider({ responses: new Map(), useFixtureDir: FIXTURE_30 });
    const out = tmpOut();
    const result = await runBatch({ frames: makeFrames(30), provider, output: out });

    expect(result.stdout).toContain("RESULT pass=30 fail=0 total=30");
    expect(runValidator(out).status).toBe(0);
    for (const e of readManifest(out).frames) {
      expect(Number.isInteger(e.token_usage.input_tokens)).toBe(true);
      expect(e.token_usage.input_tokens).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(e.token_usage.output_tokens)).toBe(true);
      expect(e.token_usage.output_tokens).toBeGreaterThanOrEqual(0);
      expect(typeof e.intent).toBe("string");
      expect(e.intent.length).toBeGreaterThan(0);
    }
  });

  it("AC-S11: telemetry total_token_cost equals sum of per-entry tokens (>=50000)", async () => {
    const responses: Array<[string, MockResponseSpec]> = Array.from(
      { length: 30 },
      (_, i) => [
        `F${String(i).padStart(2, "0")}`,
        baseSpec({ input_tokens: 1500, output_tokens: 400 }),
      ],
    );
    const provider = mockOf(responses);
    const out = tmpOut();
    await runBatch({ frames: makeFrames(30), provider, output: out });

    const m = readManifest(out);
    const expected = m.frames.reduce(
      (a: number, e: any) => a + e.token_usage.input_tokens + e.token_usage.output_tokens,
      0,
    );
    expect(m.pilot_metadata.total_token_cost).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(50000);
  });

  it("AC-S12: determinism — two mock+temp=0 runs produce byte-equal manifest", async () => {
    const provider = new MockLLMProvider({ responses: new Map(), useFixtureDir: FIXTURE_30 });
    const frames = makeFrames(30);
    const o1 = tmpOut("run1.json");
    const o2 = tmpOut("run2.json");
    await runBatch({ frames, provider, output: o1, temperature: 0 });
    await runBatch({ frames, provider, output: o2, temperature: 0 });

    const norm = (path: string): Buffer => {
      const obj = readManifest(path);
      if (obj.pilot_metadata) {
        obj.pilot_metadata.pilot_date = "1970-01-01";
        obj.pilot_metadata.run_timestamp = "1970-01-01T00:00:00Z";
      }
      const buf = Buffer.from(JSON.stringify(obj));
      writeFileSync(path, buf);
      return buf;
    };
    const b1 = norm(o1);
    const b2 = norm(o2);
    expect(Buffer.compare(b1, b2)).toBe(0);
    expect(createHash("sha256").update(b1).digest("hex")).toBe(
      createHash("sha256").update(b2).digest("hex"),
    );
  });

  it("AC-S13: intent_mismatch is preserved as JSON boolean", async () => {
    const provider = mockOf([
      ["MISMATCH-01", baseSpec({ confidence: 0.75, intent_mismatch: true })],
      ["ALIGN-01", baseSpec({ confidence: 0.85, intent_mismatch: false })],
    ]);
    const out = tmpOut();
    await runBatch({
      frames: [fr("MISMATCH-01"), fr("ALIGN-01")],
      provider,
      output: out,
    });

    const m = readManifest(out);
    expect(m.frames.find((f: any) => f.screen_id === "MISMATCH-01").intent_mismatch).toBe(true);
    expect(m.frames.find((f: any) => f.screen_id === "ALIGN-01").intent_mismatch).toBe(false);
    expect(runValidator(out).status).toBe(0);
  });
});
