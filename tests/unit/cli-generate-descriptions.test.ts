// SPEC-FIGMA-003 Phase 3 coverage: src/cli/generate-descriptions.ts (T12 CLI).
// Imports main() directly so vitest v8 coverage instruments execution.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { main } from "../../src/cli/generate-descriptions.js";

// Capture writes to process.stdout/stderr without spawning a subprocess.
function captureStreams() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    stdout,
    stderr,
    restore: () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
  };
}

let cap: ReturnType<typeof captureStreams>;
beforeEach(() => {
  cap = captureStreams();
});
afterEach(() => {
  cap.restore();
});

describe("CLI main — help and missing-args paths", () => {
  it("--help prints usage banner and exits 0", async () => {
    const code = await main(["--help"]);
    cap.restore();
    expect(code).toBe(0);
    const out = cap.stdout.join("");
    expect(out).toContain("Usage: generate-descriptions <input-dir> <output-manifest>");
    expect(out).toContain("--parallelism=N");
    expect(out).toContain("--audit-dir=PATH");
    expect(out).toContain("--project-brief=PATH");
  });

  it("-h alias also prints usage and exits 0", async () => {
    const code = await main(["-h"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.stdout.join("")).toContain("Usage: generate-descriptions");
  });

  it("no arguments → exit 2 with 'error: missing arguments'", async () => {
    const code = await main([]);
    cap.restore();
    expect(code).toBe(2);
    const err = cap.stderr.join("");
    expect(err).toContain("error: missing arguments");
    expect(err).toContain("Usage: generate-descriptions");
  });

  it("only one positional → exit 2 (output missing)", async () => {
    const code = await main(["/some/path"]);
    cap.restore();
    expect(code).toBe(2);
    expect(cap.stderr.join("")).toContain("error: missing arguments");
  });

  it("nonexistent input dir → exit 2 with 'input directory not found'", async () => {
    const code = await main(["/definitely/does/not/exist", "/tmp/out.json"]);
    cap.restore();
    expect(code).toBe(2);
    expect(cap.stderr.join("")).toContain("input directory not found");
  });
});

describe("CLI main — argument parsing exercised via end-to-end run", () => {
  // A tiny inline fixture: 1 frame in a temp dir. Mock provider via fixture
  // dir loads response.json from each subdir.
  function makeTinyFixture(): { input: string; output: string } {
    const root = mkdtempSync(join(tmpdir(), "cli-cov-"));
    const frameDir = join(root, "AUTH-01");
    mkdirSync(frameDir);
    writeFileSync(
      join(frameDir, "frame_meta.json"),
      JSON.stringify({
        screen_id: "AUTH-01",
        name: "AUTH-01",
        source_hash: "deadbeefcafe",
      }),
    );
    writeFileSync(
      join(frameDir, "response.json"),
      JSON.stringify({
        text: JSON.stringify({
          intent: "로그인",
          user_value: "사용자가 로그인",
          success_criteria: "토큰 발급",
          states: ["default"],
          edge_cases: [],
          data_io: [],
        }),
        input_tokens: 800,
        output_tokens: 200,
        confidence: 0.85,
        intent_mismatch: false,
      }),
    );
    return { input: root, output: join(root, "manifest.json") };
  }

  it("runs with mock provider and all flags parsed (parallelism, temperature, mode, audit-dir, model)", async () => {
    const { input, output } = makeTinyFixture();
    const auditDir = mkdtempSync(join(tmpdir(), "cli-audit-"));
    const code = await main([
      input,
      output,
      "--provider=mock",
      "--parallelism=1",
      "--temperature=0",
      "--mode=node-only",
      `--audit-dir=${auditDir}`,
      "--model=test-model-id",
    ]);
    cap.restore();
    expect(code).toBe(0);
    // Output path resolves and runBatch writes — manifest content
    // is the proof that flag parsing reached runBatch successfully.
    expect(cap.stdout.join("")).toMatch(/RESULT pass=1/);
  });

  it("auto mode is the default and is parseable", async () => {
    const { input, output } = makeTinyFixture();
    const code = await main([input, output, "--mode=auto"]);
    cap.restore();
    expect(code).toBe(0);
  });

  it("invalid --mode value is silently ignored (parser fall-through)", async () => {
    const { input, output } = makeTinyFixture();
    // --mode=garbage is not 'node-only' or 'auto' so parser leaves args.mode undefined.
    const code = await main([input, output, "--mode=garbage"]);
    cap.restore();
    expect(code).toBe(0);
  });

  it("invalid --provider value falls back to mock default", async () => {
    const { input, output } = makeTinyFixture();
    // --provider=garbage is not 'mock' or 'anthropic' so buildProvider uses mock branch.
    const code = await main([input, output, "--provider=garbage"]);
    cap.restore();
    expect(code).toBe(0);
  });

  it("unknown flag (e.g. --foo) is ignored — positional parsing still succeeds", async () => {
    const { input, output } = makeTinyFixture();
    const code = await main([input, "--foo=bar", output]);
    cap.restore();
    expect(code).toBe(0);
  });

  it("--init-project-brief writes the project question template and exits 0", async () => {
    const root = mkdtempSync(join(tmpdir(), "cli-brief-init-"));
    const briefPath = join(root, "project-brief.json");
    const code = await main([`--init-project-brief=${briefPath}`]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.stdout.join("")).toContain("wrote project brief template");
    const text = readFileSync(briefPath, "utf8");
    expect(text).toContain("Autopus project brief questions");
    expect(text).toContain("\"feature_policies\"");
  });

  it("--require-project-brief blocks generation and prints the question flow", async () => {
    const { input, output } = makeTinyFixture();
    const code = await main([input, output, "--require-project-brief"]);
    cap.restore();
    expect(code).toBe(2);
    const err = cap.stderr.join("");
    expect(err).toContain("project brief required");
    expect(err).toContain("기능별 정책");
  });

  it("--project-brief feeds trusted project policy context into generation", async () => {
    const { input, output } = makeTinyFixture();
    const briefPath = join(input, "brief.json");
    writeFileSync(
      briefPath,
      JSON.stringify({
        project_name: "Sample Project",
        product_summary: "리서치 리포트 검색 및 상세 탐색",
        feature_policies: [
          {
            feature: "Report Search",
            user_rules: ["검색어는 제목, 내용, 키워드 범위를 지원한다"],
            data_io: ["query", "scope", "filters"],
          },
        ],
      }),
    );
    const code = await main([input, output, "--project-brief=" + briefPath]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.stdout.join("")).toContain("RESULT pass=1");
  });
});

describe("CLI main — anthropic provider branch", () => {
  it("--provider=anthropic constructs adapter without making network calls when no frames are loaded", async () => {
    // Empty input dir → loadFrames returns []; runBatch produces an empty manifest.
    const root = mkdtempSync(join(tmpdir(), "cli-empty-"));
    const out = join(root, "manifest.json");
    const code = await main([root, out, "--provider=anthropic", "--model=claude-test"]);
    cap.restore();
    // Empty batch is a clean exit; AnthropicClaudeAdapter constructor ran but
    // never reached this.client.messages.create.
    expect(code).toBe(0);
    expect(cap.stdout.join("")).toContain("RESULT");
  });
});

describe("CLI main — frame loader edge cases", () => {
  it("frame dir without frame_meta.json uses default shell metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "cli-noshell-"));
    const frameDir = join(root, "BARE-01");
    mkdirSync(frameDir);
    writeFileSync(
      join(frameDir, "response.json"),
      JSON.stringify({
        text: JSON.stringify({ intent: "기본" }),
        input_tokens: 500,
        output_tokens: 100,
        confidence: 0.9,
        intent_mismatch: false,
      }),
    );
    const out = join(root, "manifest.json");
    const code = await main([root, out, "--provider=mock", "--parallelism=1"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.stdout.join("")).toMatch(/RESULT pass=1/);
  });

  it("non-directory entries inside input dir are skipped", async () => {
    const root = mkdtempSync(join(tmpdir(), "cli-mixed-"));
    // A loose file (not a directory) — loadFrames must skip it via statSync check.
    writeFileSync(join(root, "stray.txt"), "ignore me");
    const frameDir = join(root, "ONLY-01");
    mkdirSync(frameDir);
    writeFileSync(
      join(frameDir, "frame_meta.json"),
      JSON.stringify({ screen_id: "ONLY-01", name: "ONLY-01", source_hash: "abc12345" }),
    );
    writeFileSync(
      join(frameDir, "response.json"),
      JSON.stringify({
        text: JSON.stringify({ intent: "단일" }),
        input_tokens: 400,
        output_tokens: 80,
        confidence: 0.8,
        intent_mismatch: false,
      }),
    );
    const out = join(root, "manifest.json");
    const code = await main([root, out, "--provider=mock", "--parallelism=1"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.stdout.join("")).toMatch(/total=1/);
  });
});

// SEC-M1: path-traversal containment + null-byte rejection. These tests use
// real fs operations (no mocks) — security checks must hit the actual code.
describe("CLI main — SEC-M1 security guards", () => {
  it("rejects symlinked screenshot.png (refuses leak via symlink target)", async () => {
    const root = mkdtempSync(join(tmpdir(), "sec-symlink-"));
    const frameDir = join(root, "EVIL-01");
    mkdirSync(frameDir);
    writeFileSync(
      join(frameDir, "frame_meta.json"),
      JSON.stringify({ screen_id: "EVIL-01", source_hash: "deadbeefcafe" }),
    );
    // Symlink screenshot.png → /etc/hosts (a stable, world-readable path).
    // The CLI must lstat() and reject before any read happens.
    try {
      symlinkSync("/etc/hosts", join(frameDir, "screenshot.png"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EPERM") return;
      throw err;
    }
    const code = await main([root, join(root, "out.json"), "--provider=mock"]);
    cap.restore();
    expect(code).toBe(2);
    const err = cap.stderr.join("");
    expect(err).toContain("refused: symlink not allowed");
    expect(err).toContain("screenshot.png");
  });

  it("rejects null byte in input path argument", async () => {
    const code = await main(["/tmp/bad\u0000path", "/tmp/out.json"]);
    cap.restore();
    expect(code).toBe(2);
    expect(cap.stderr.join("")).toContain("null byte in path argument");
  });

  it("rejects null byte in output path argument", async () => {
    // Use an existing tmp dir as input so the null-byte check is reached for output.
    const root = mkdtempSync(join(tmpdir(), "sec-null-out-"));
    const code = await main([root, "/tmp/out\u0000bad.json"]);
    cap.restore();
    expect(code).toBe(2);
    expect(cap.stderr.join("")).toContain("null byte in path argument");
  });

  it("regression: legitimate 30-frame fixture run still exits 0 with full pass", async () => {
    const fixture = resolve(process.cwd(), "tests/fixtures/mock-30frame");
    const out = join(mkdtempSync(join(tmpdir(), "sec-regress-")), "manifest.json");
    const code = await main([fixture, out, "--provider=mock", "--parallelism=5"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.stdout.join("")).toContain("RESULT pass=30 fail=0 total=30");
  });
});
