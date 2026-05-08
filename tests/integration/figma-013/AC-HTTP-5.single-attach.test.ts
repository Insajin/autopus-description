// SPEC-FIGMA-013 T10 / AC-HTTP-5 — Phase 1.5 RED scaffold.
// Maps to: REQ-02 (single-row invariant).
// SDK Client.connect() issues both POST initialize and GET SSE stream — the
// daemon MUST emit exactly one client_profile_attached row, not two.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHttpHarness,
  type HttpHarness,
} from "./__helpers/in-process-http-pair.js";

let workDir: string;
let harness: HttpHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-5-"));
  harness = await createHttpHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

// @AX:ANCHOR: [AUTO] One client_profile_attached row per HTTP session is an audit contract.
// @AX:REASON: [AUTO] SDK POST initialize plus GET SSE must not double-count client attachment.
describe("AC-HTTP-5: single client_profile_attached row per session (POST + SSE GET dedupe)", () => {
  it("audit.jsonl client_profile_attached count is exactly 1 after SDK connect (which issues POST + GET)", async () => {
    // Drive at least one round-trip to ensure both POST initialize and GET SSE
    // streams are flushed end-to-end before reading the audit.
    await harness.client.listTools();

    const path = harness.clientProfileAuditPath;
    expect(existsSync(path)).toBe(true);
    const rows = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.event === "client_profile_attached");
    expect(rows.length).toBe(1);
  });

  it("Mcp-Session-Id is consistent across the session (single attach observable)", async () => {
    // Two sequential calls must reuse the same session — observed indirectly
    // via stable audit row count (no second client_profile_attached emission).
    await harness.client.listResources();
    await harness.client.listTools();

    const path = harness.clientProfileAuditPath;
    const rows = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.event === "client_profile_attached");
    expect(rows.length).toBe(1);
  });
});
