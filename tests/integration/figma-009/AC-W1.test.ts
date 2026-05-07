// SPEC-FIGMA-009 T11 / AC-W1 — Phase 1.5 RED scaffold (in-process).
// Verifies stdio handshake establishes exactly one client_profile_attached
// audit row with byte-equal capabilities baseline; ListResources returns the
// 4 canonical URIs in canonical order.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync as fsReadFileSync } from "node:fs";

import { createPairedHarness, type PairedHarness } from "./__helpers/in-memory-pair.js";

const SDK_VERSION_MAJOR = 1;

let workDir: string;
let harness: PairedHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig009-AC-W1-"));
  harness = await createPairedHarness({
    auditDir: workDir,
    clientName: "claude-code",
  });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-W1: stdio handshake + 4 resources + 1 audit row", () => {
  it("listResources returns the 4 canonical URIs in canonical order", async () => {
    const resp = await harness.client.listResources();
    expect(resp.resources).toHaveLength(4);
    expect(resp.resources.map((r) => r.uri)).toEqual([
      "autopus://active_selection",
      "autopus://pending_descriptions",
      "autopus://audit_events",
      "autopus://stale_frames",
    ]);
  });

  it("audit.jsonl has exactly one client_profile_attached row with byte-equal capabilities", () => {
    const path = join(workDir, "audit.jsonl");
    expect(existsSync(path)).toBe(true);
    const rows = fsReadFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.event === "client_profile_attached");
    expect(rows).toHaveLength(1);
    expect(rows[0].client_id).toBe("claude-code");
    expect(rows[0].transport).toBe("stdio");
    expect(rows[0].profile_id).toBe("claude-code-local");
    expect(rows[0].capabilities).toEqual(["resources.read", "tools.call"]);
    expect(typeof rows[0].attached_at).toBe("string");
    expect(Number.isFinite(Date.parse(rows[0].attached_at as string))).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(rows[0], "tunnel_session_id")).toBe(false);
  });

  it("package.json declares @modelcontextprotocol/sdk in dependencies (REQ-01)", () => {
    const repoRoot = process.cwd();
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies?.["@modelcontextprotocol/sdk"]).toBeDefined();
    const range = pkg.dependencies?.["@modelcontextprotocol/sdk"] ?? "";
    // ^1.x family.
    expect(range.startsWith("^") || range.startsWith(">=")).toBe(true);
    expect(range).toContain(String(SDK_VERSION_MAJOR));
  });
});
