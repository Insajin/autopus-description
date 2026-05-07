// SPEC-FIGMA-005 T17 / AC-S8: audit row schema + token redaction.
// REQ-08, REQ-NFR-07. The emitted audit row carries 18 keys (10 baseline
// from EmittedAudit + 8 new from this SPEC). figd_ tokens leaked into any
// string field MUST be replaced with `***` before write.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildAuditRecord,
  computeAggregateSummary,
  emitAuditRecord,
  formatAggregateSummary,
} from "../../src/audit-emitter.js";

const EXPECTED_KEY_SET = [
  "batch_id",
  "batch_id_provider",
  "cache_creation_input_tokens",
  "cache_hit",
  "cache_read_input_tokens",
  "dynamic_input_tokens",
  "file_id",
  "input_tokens",
  "mode",
  "output_tokens",
  "prompt_sha256",
  "provider",
  "provider_sdk_version",
  "response_sha256",
  "screen_id",
  "strict_mode_used",
  "ts",
  "untrusted_text_processed",
];

describe("audit row schema (AC-S8, SPEC-FIGMA-005)", () => {
  function buildSampleInput(): {
    batch_id: string;
    screen_id: string;
    provider: string;
    mode: "vision";
    input_tokens: number;
    output_tokens: number;
    untrusted_text_processed: boolean;
    cache_hit: boolean;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    dynamic_input_tokens: number;
    file_id: string | null;
    batch_id_provider: string | null;
    strict_mode_used: boolean;
    provider_sdk_version: string;
    prompt_text: string;
    response_text: string;
  } {
    return {
      batch_id: "batchhash01abcdef",
      screen_id: "AUTH-01",
      provider: "AnthropicClaudeAdapter",
      mode: "vision",
      input_tokens: 800,
      output_tokens: 250,
      untrusted_text_processed: true,
      cache_hit: true,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 200,
      dynamic_input_tokens: 800,
      file_id: "file_redact_test_figd_ABCDEF1234567890",
      batch_id_provider: null,
      strict_mode_used: true,
      provider_sdk_version: "0.95.0",
      prompt_text: "system + schema instruction + frame body",
      response_text:
        '{"intent":"ok","user_value":"x","success_criteria":"y","intent_mismatch":false,"confidence":0.9,"states":[],"edge_cases":[],"data_io":[]}',
    };
  }

  it("18-key set: Object.keys(parsed).sort() matches expected", () => {
    const rec = buildAuditRecord(buildSampleInput());
    const keys = Object.keys(rec).sort();
    // untrusted_text_processed is optional in the type but present here
    expect(keys).toEqual(EXPECTED_KEY_SET);
  });

  it("file_id figd_ substring is redacted to ***", () => {
    const rec = buildAuditRecord(buildSampleInput());
    expect(rec.file_id).toBe("file_redact_test_***");
  });

  it("provider_sdk_version passes through redactor (no figd_ ⇒ unchanged)", () => {
    const rec = buildAuditRecord(buildSampleInput());
    expect(rec.provider_sdk_version).toBe("0.95.0");
  });

  it("realtime mode: batch_id_provider stays null", () => {
    const rec = buildAuditRecord(buildSampleInput());
    expect(rec.batch_id_provider).toBeNull();
  });

  it("--batch lane: batch_id_provider is a string and redacted", () => {
    const input = buildSampleInput();
    input.batch_id_provider = "msgbatch_safe_1234567890abcdef";
    const rec = buildAuditRecord(input);
    expect(rec.batch_id_provider).toBe("msgbatch_safe_1234567890abcdef");
  });

  it("integer fields are integers ≥ 0", () => {
    const rec = buildAuditRecord(buildSampleInput());
    expect(Number.isInteger(rec.cache_read_input_tokens)).toBe(true);
    expect(rec.cache_read_input_tokens).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(rec.cache_creation_input_tokens)).toBe(true);
    expect(Number.isInteger(rec.dynamic_input_tokens)).toBe(true);
  });

  it("emitAuditRecord appends one JSONL line under .audit/<batch_id>/", () => {
    const dir = mkdtempSync(join(tmpdir(), "figma005-audit-"));
    const out = emitAuditRecord(buildSampleInput(), dir);
    const path = join(dir, out.batch_id, "calls.jsonl");
    const raw = readFileSync(path, "utf-8").trim().split("\n");
    expect(raw.length).toBe(1);
    const parsed = JSON.parse(raw[0]) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(EXPECTED_KEY_SET);
    expect(parsed.cache_hit).toBe(true);
  });
});

describe("aggregate summary (REQ-22)", () => {
  it("ratio = read / (read + creation + dynamic)", () => {
    const audits = [
      {
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 200,
        dynamic_input_tokens: 800,
        provider_sdk_version: "0.95.0",
      } as never,
      {
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 200,
        dynamic_input_tokens: 800,
        provider_sdk_version: "0.95.0",
      } as never,
    ];
    const summary = computeAggregateSummary(audits, 3);
    // ratio = (5000+5000) / (5000+5000 + 200+200 + 800+800) = 10000/12000 = 0.8333...
    expect(summary.aggregate_cache_hit_ratio).toBeCloseTo(10000 / 12000, 5);
    expect(summary.aggregate_cached_input_tokens).toBe(10400);
    expect(summary.aggregate_dynamic_input_tokens).toBe(1600);
    expect(summary.aggregate_files_api_dedup_count).toBe(3);
    expect(summary.provider_sdk_version).toBe("0.95.0");
  });

  it("empty audits ⇒ ratio is 0 (no division by zero)", () => {
    const summary = computeAggregateSummary([], 0);
    expect(summary.aggregate_cache_hit_ratio).toBe(0);
  });

  it("formatAggregateSummary emits parsable key=value pairs", () => {
    const line = formatAggregateSummary({
      aggregate_cache_hit_ratio: 0.80556,
      aggregate_dynamic_input_tokens: 24000,
      aggregate_cached_input_tokens: 156000,
      aggregate_files_api_dedup_count: 5,
      provider_sdk_version: "0.95.0",
    });
    expect(line).toContain("aggregate_cache_hit_ratio=0.80556");
    expect(line).toContain("aggregate_files_api_dedup_count=5");
    expect(line).toContain("provider_sdk_version=0.95.0");
  });
});
