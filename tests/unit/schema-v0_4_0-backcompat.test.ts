// SPEC-FIGMA-020 T14 — v0.4.0 schema back-compat oracle (S2, REQ-05, REQ-14,
// REQ-15, REQ-16).
//
// The v0.4.0 states/edge_cases item union accepts BOTH the legacy string form
// AND a structured object form, while a malformed object (missing the required
// state/case discriminator, or carrying an extra property under
// additionalProperties:false) is rejected. These tests run the real
// validate-manifest CLI against synthetic manifests and assert the exact exit
// code and RESULT line (oracle acceptance, not structural-only).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PKG_ROOT = resolve(REPO_ROOT, "tools/validate-manifest");
const CLI_ENTRY = resolve(PKG_ROOT, "src/index.ts");

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "figma-020-schema-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(manifest: unknown): CliResult {
  const path = join(tmp, `m-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(manifest), "utf8");
  const r = spawnSync("npx", ["tsx", CLI_ENTRY, path], {
    cwd: PKG_ROOT,
    encoding: "utf-8",
    // Windows resolves `npx` to `npx.cmd`, which spawnSync cannot exec without a
    // shell (ENOENT → status -1). The golden test runs under node:test where the
    // PATH resolution differs; under vitest the shell is required.
    shell: true,
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function summaryLine(stdout: string): string {
  return (
    stdout.split("\n").find((l) => l.startsWith("RESULT "))?.trim() ?? ""
  );
}

function frame(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    screen_id: "AUTH-01",
    display_id: "AUTH-01",
    title: "검색 화면",
    intent: "intent",
    user_value: "value",
    success_criteria: "criteria",
    states: ["default"],
    edge_cases: ["none"],
    component_refs: ["btn"],
    data_io: ["input"],
    design_tokens: ["color/primary"],
    variants: ["default"],
    navigation: ["root"],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "a000000000000000",
    write_target: "none",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    stale: false,
    ...overrides,
  };
}

function manifest(frameOverrides: Record<string, unknown>): unknown {
  return {
    schema_version: "0.4.0",
    pilot_metadata: {
      pm_reviewer_id: "pm-test",
      pilot_date: "2026-06-10",
      figma_file_ids: ["test-fixture"],
      total_token_cost: 0,
    },
    frames: [frame(frameOverrides)],
  };
}

describe("S2: v0.4.0 accepts legacy-string and structured manifests, rejects malformed", () => {
  it("legacy string states + write_target native_annotation → exit 0, RESULT pass=1 fail=0 total=1", () => {
    const r = runCli(
      manifest({
        states: ["loading", "empty", "populated"],
        write_target: "native_annotation",
      }),
    );
    expect(r.exitCode).toBe(0);
    expect(summaryLine(r.stdout)).toBe("RESULT pass=1 fail=0 total=1");
  });

  it("structured object states + write_target native_annotation_with_card → exit 0, RESULT pass=1 fail=0 total=1", () => {
    const r = runCli(
      manifest({
        states: [{ state: "loading", trigger: "제출 직후", result: "스피너" }],
        write_target: "native_annotation_with_card",
      }),
    );
    expect(r.exitCode).toBe(0);
    expect(summaryLine(r.stdout)).toBe("RESULT pass=1 fail=0 total=1");
  });

  it("malformed states object missing the required 'state' field → exit 1 with an error", () => {
    const r = runCli(
      manifest({
        states: [{ trigger: "x" }],
        write_target: "native_annotation_with_card",
      }),
    );
    expect(r.exitCode).toBe(1);
    // The validator emits at least one error line for the malformed item.
    expect(r.stderr.trim().length).toBeGreaterThan(0);
    expect(summaryLine(r.stdout)).toMatch(/^RESULT pass=0 fail=\d+ total=\d+$/);
  });

  it("malformed states object with an extra property (additionalProperties:false) → exit 1", () => {
    const r = runCli(
      manifest({
        states: [{ state: "loading", bogus: "extra" }],
        write_target: "native_annotation_with_card",
      }),
    );
    expect(r.exitCode).toBe(1);
    expect(summaryLine(r.stdout)).toMatch(/^RESULT pass=0 fail=\d+/);
  });

  it("structured edge_cases object validates; malformed edge_cases missing 'case' is rejected", () => {
    const ok = runCli(
      manifest({
        edge_cases: [{ case: "빈 결과", risk: "혼란", handling: "안내" }],
      }),
    );
    expect(ok.exitCode).toBe(0);
    expect(summaryLine(ok.stdout)).toBe("RESULT pass=1 fail=0 total=1");

    const bad = runCli(manifest({ edge_cases: [{ risk: "혼란" }] }));
    expect(bad.exitCode).toBe(1);
    expect(summaryLine(bad.stdout)).toMatch(/^RESULT pass=0 fail=\d+/);
  });
});
