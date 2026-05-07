/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T10.
 *
 * REQ-09, REQ-10, REQ-16; INV-T8 probe row shape.
 *
 * [NEW] surfaces:
 *   - src/daemon/probe-runner.ts → runProbe({target, configPath, outPath})
 *   - .autopus/probes/transport-matrix.config.json (read by probe runner)
 *   - .autopus/probes/transport-matrix.jsonl (append-only sink)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProbe } from "../../../src/daemon/probe-runner.js";

const CODEX_KEYS = [
  "capabilities_advertised",
  "error_text_redacted",
  "finished_at",
  "mcp_protocol_version",
  "probe_target",
  "started_at",
  "status",
];

const COWORK_KEYS = [
  "capabilities_advertised",
  "doc_excerpt",
  "error_text_redacted",
  "finished_at",
  "mcp_protocol_version",
  "probe_target",
  "started_at",
  "status",
];

const STATUS_ENUM = new Set(["verified", "unverified", "failed"]);

let workDir: string;
let probesDir: string;
let configPath: string;
let outPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t10-"));
  probesDir = join(workDir, ".autopus", "probes");
  mkdirSync(probesDir, { recursive: true });
  configPath = join(probesDir, "transport-matrix.config.json");
  outPath = join(probesDir, "transport-matrix.jsonl");
  writeFileSync(
    configPath,
    JSON.stringify({
      codex_windows_binary_path: "/nonexistent/codex-app",
      cowork_doc_url: "https://example.invalid/cowork-mcp",
    }),
    "utf8",
  );
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T10 probe acceptance for codex-windows AND claude-cowork", () => {
  it("Test_Probe_BothTargets_AppendsRowsWithExpectedKeySetsAndRedactedErrors", async () => {
    await runProbe({ target: "codex-windows", configPath, outPath });
    await runProbe({ target: "claude-cowork", configPath, outPath });

    expect(existsSync(outPath)).toBe(true);
    const lines = readFileSync(outPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const codex = lines.find((r) => r.probe_target === "codex-windows");
    const cowork = lines.find((r) => r.probe_target === "claude-cowork");

    expect(codex).toBeDefined();
    expect(cowork).toBeDefined();
    expect(Object.keys(codex!).sort()).toEqual(CODEX_KEYS);
    expect(Object.keys(cowork!).sort()).toEqual(COWORK_KEYS);

    for (const r of lines) {
      expect(STATUS_ENUM.has(String(r.status))).toBe(true);
    }

    // Cowork doc_excerpt ≤ 2000 chars.
    expect(String(cowork!.doc_excerpt).length).toBeLessThanOrEqual(2000);

    // Redacted error text → no figd_/trycloudflare leaks.
    for (const r of lines) {
      const err = String(r.error_text_redacted ?? "");
      expect(err).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
      expect(err).not.toMatch(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    }
  });
});
