// SPEC-FIGMA-013 T6 / AC-HTTP-1 — Phase 1.5 RED scaffold.
// Maps to: REQ-03, INV-13.1, INV-13.2.
// ListTools over HTTP wire returns 9 entries: 4 read-only (preserved INV-13.1)
// + 5 write tools (preserved INV-13.2) in fixed byte-equal order.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHttpHarness,
  type HttpHarness,
} from "./__helpers/in-process-http-pair.js";

// @AX:ANCHOR: [AUTO] Byte-equal tool order is the SPEC-FIGMA-013 HTTP tool contract.
// @AX:REASON: [AUTO] Multiple assertions depend on this tuple to catch write-tool drift.
const EXPECTED_NAMES = [
  "get_active_selection",
  "get_pending_descriptions",
  "get_audit_events",
  "get_stale_frames",
  "plan_emit",
  "dryRun",
  "approve",
  "apply",
  "undo",
] as const;

let workDir: string;
let harness: HttpHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-1-"));
  harness = await createHttpHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-HTTP-1: ListTools over HTTP wire — 9-entry byte-equal order", () => {
  it("listTools returns exactly 9 tools and tools.map(t => t.name) byte-equals expected sequence", async () => {
    const resp = await harness.client.listTools();
    expect(resp.tools).toHaveLength(9);
    expect(resp.tools.map((t) => t.name)).toEqual([...EXPECTED_NAMES]);
  });

  it("each entry's inputSchema.type is 'object'", async () => {
    const resp = await harness.client.listTools();
    expect(resp.tools).toHaveLength(9);
    for (const tool of resp.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("no extra entry beyond the 9-entry baseline (length strictly equals 9)", async () => {
    const resp = await harness.client.listTools();
    const names = resp.tools.map((t) => t.name);
    expect(names.length).toBe(9);
    // Ensure the set of names equals exactly the expected baseline (no superset).
    expect([...names].sort()).toEqual([...EXPECTED_NAMES].sort());
  });
});
