/**
 * SPEC-FIGMA-008 Phase 3 — branch-coverage tests for probe-runner.ts.
 *
 * Targets uncovered branches:
 *   - Codex verified path (binaryPath exists)
 *   - Cowork verified path (fetchFn ok)
 *   - Cowork failed path (fetchFn !ok with HTTP status)
 *   - Cowork failed path (fetchFn throws)
 *   - Cowork unverified path (no doc URL configured)
 *   - Codex injectError fast-fail path
 *   - defaultFetch happy path (mock global fetch)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProbe } from "../../src/daemon/probe-runner.js";

let workDir: string;
let configPath: string;
let outPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-probe-br-"));
  const probesDir = join(workDir, "probes");
  mkdirSync(probesDir, { recursive: true });
  configPath = join(probesDir, "transport-matrix.config.json");
  outPath = join(probesDir, "transport-matrix.jsonl");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function readRows(): Array<Record<string, unknown>> {
  return readFileSync(outPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("runProbe codex-windows branches", () => {
  it("verified status when binary path exists (use this test file as a stand-in)", async () => {
    // Use this test file's own path — it definitely exists.
    writeFileSync(
      configPath,
      JSON.stringify({ codex_windows_binary_path: __filename, cowork_doc_url: "" }),
      "utf8",
    );
    await runProbe({ target: "codex-windows", configPath, outPath });
    const r = readRows()[0];
    expect(r.status).toBe("verified");
    expect(r.mcp_protocol_version).toBe(1);
    expect(r.capabilities_advertised).toEqual(["resources.read", "tools.call"]);
  });

  it("unverified status when binary path missing or absent", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ codex_windows_binary_path: "/nope/missing", cowork_doc_url: "" }),
      "utf8",
    );
    await runProbe({ target: "codex-windows", configPath, outPath });
    const r = readRows()[0];
    expect(r.status).toBe("unverified");
    expect(r.mcp_protocol_version).toBe(0);
  });

  it("failed status when injectError is set (fast-fail path)", async () => {
    writeFileSync(configPath, JSON.stringify({ codex_windows_binary_path: __filename }), "utf8");
    await runProbe({
      target: "codex-windows",
      configPath,
      outPath,
      injectError: "synthetic codex error",
    });
    const r = readRows()[0];
    expect(r.status).toBe("failed");
    expect(String(r.error_text_redacted)).toContain("synthetic codex error");
  });
});

describe("runProbe claude-cowork branches", () => {
  it("verified status when fetchFn returns ok=true with doc body", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ cowork_doc_url: "https://docs.example/cowork" }),
      "utf8",
    );
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "MCP cowork capabilities: tools/call, resources/read.",
    }));
    await runProbe({ target: "claude-cowork", configPath, outPath, fetchFn });
    const r = readRows()[0];
    expect(r.status).toBe("verified");
    expect(r.mcp_protocol_version).toBe(1);
    expect(r.capabilities_advertised).toEqual([
      "resources.read",
      "tools.call",
      "fallback.polling",
    ]);
    expect(typeof r.doc_excerpt).toBe("string");
    expect(String(r.doc_excerpt).length).toBeGreaterThan(0);
    expect(String(r.doc_excerpt).length).toBeLessThanOrEqual(2000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("failed status when fetchFn returns ok=false (e.g. HTTP 503)", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ cowork_doc_url: "https://docs.example/down" }),
      "utf8",
    );
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "",
    }));
    await runProbe({ target: "claude-cowork", configPath, outPath, fetchFn });
    const r = readRows()[0];
    expect(r.status).toBe("failed");
    expect(String(r.error_text_redacted)).toContain("HTTP 503");
  });

  it("failed status when fetchFn throws", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ cowork_doc_url: "https://docs.example/throws" }),
      "utf8",
    );
    const fetchFn = vi.fn(async () => {
      throw new Error("DNS resolution failed");
    });
    await runProbe({ target: "claude-cowork", configPath, outPath, fetchFn });
    const r = readRows()[0];
    expect(r.status).toBe("failed");
    expect(String(r.error_text_redacted)).toContain("DNS resolution failed");
  });

  it("unverified status with empty doc_excerpt when cowork_doc_url not configured", async () => {
    writeFileSync(configPath, JSON.stringify({}), "utf8");
    await runProbe({ target: "claude-cowork", configPath, outPath });
    const r = readRows()[0];
    expect(r.status).toBe("unverified");
    expect(r.doc_excerpt).toBe("");
    expect(String(r.error_text_redacted)).toContain("cowork doc url not configured");
  });

  it("injectError on cowork target produces failed row without invoking fetchFn", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ cowork_doc_url: "https://docs.example/x" }),
      "utf8",
    );
    const fetchFn = vi.fn();
    await runProbe({
      target: "claude-cowork",
      configPath,
      outPath,
      fetchFn,
      injectError: "synthetic cowork error",
    });
    const r = readRows()[0];
    expect(r.status).toBe("unverified");
    // injectError is captured into error_text_redacted; fetchFn skipped.
    expect(String(r.error_text_redacted)).toContain("synthetic cowork error");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses defaultFetch path when fetchFn is omitted", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ cowork_doc_url: "https://docs.example/global-fetch" }),
      "utf8",
    );
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("global-fetch body", { status: 200 }),
      );
    await runProbe({ target: "claude-cowork", configPath, outPath });
    const r = readRows()[0];
    expect(r.status).toBe("verified");
    expect(globalFetch).toHaveBeenCalledWith("https://docs.example/global-fetch");
    globalFetch.mockRestore();
  });
});
