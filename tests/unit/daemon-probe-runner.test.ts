/**
 * SPEC-FIGMA-008 Phase 1.5 RED unit scaffold — probe runner.
 *
 * REQ-09, REQ-10; INV-T8 probe row shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProbe } from "../../src/daemon/probe-runner.js";

let workDir: string;
let configPath: string;
let outPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-probe-unit-"));
  const probesDir = join(workDir, "probes");
  mkdirSync(probesDir, { recursive: true });
  configPath = join(probesDir, "transport-matrix.config.json");
  outPath = join(probesDir, "transport-matrix.jsonl");
  writeFileSync(
    configPath,
    JSON.stringify({
      codex_windows_binary_path: "/nonexistent/codex",
      cowork_doc_url: "https://example.invalid/cowork",
    }),
    "utf8",
  );
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("runProbe (SPEC-FIGMA-008 unit)", () => {
  it("codex-windows probe writes one JSONL row with the codex key set", async () => {
    await runProbe({ target: "codex-windows", configPath, outPath });
    expect(existsSync(outPath)).toBe(true);
    const rows = readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = rows[rows.length - 1];
    expect(Object.keys(last).sort()).toEqual([
      "capabilities_advertised",
      "error_text_redacted",
      "finished_at",
      "mcp_protocol_version",
      "probe_target",
      "started_at",
      "status",
    ]);
    expect(["verified", "unverified", "failed"]).toContain(last.status);
  });

  it("cowork probe writes one JSONL row including doc_excerpt ≤ 2000 chars", async () => {
    await runProbe({ target: "claude-cowork", configPath, outPath });
    const rows = readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = rows[rows.length - 1];
    expect(last.probe_target).toBe("claude-cowork");
    expect(typeof last.doc_excerpt).toBe("string");
    expect(String(last.doc_excerpt).length).toBeLessThanOrEqual(2000);
  });

  it("error_text_redacted strips figd_ and trycloudflare URLs", async () => {
    await runProbe({
      target: "codex-windows",
      configPath,
      outPath,
      // [NEW] inject a synthetic failing path so error text is non-empty.
      injectError: "boot failed: figd_LEAKLEAKLEAKLEAK at https://abc.trycloudflare.com/path",
    });
    const rows = readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = rows[rows.length - 1];
    const err = String(last.error_text_redacted ?? "");
    expect(err).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
    expect(err).not.toMatch(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  });

  it("missing config file makes the probe fail with status:'failed' (no throw)", async () => {
    rmSync(configPath, { force: true });
    await expect(runProbe({ target: "codex-windows", configPath, outPath })).resolves.toBeUndefined();
    const rows = readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = rows[rows.length - 1];
    expect(last.status).toBe("failed");
  });
});
