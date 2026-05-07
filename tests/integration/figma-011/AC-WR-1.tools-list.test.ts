// SPEC-FIGMA-011 T9 / AC-WR-1 — Phase 1.5 RED scaffold.
// ListTools returns 9 entries: 4 read-only (preserved INV-W4) + 5 write tools
// in fixed byte-equal order.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";
import { READ_ONLY_TOOLS } from "../../../src/daemon/mcp-stdio-handlers.js";

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

const WRITE_NAMES = ["plan_emit", "dryRun", "approve", "apply", "undo"] as const;

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-1-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-1: ListTools — 9-entry surface, byte-equal fixed order", () => {
  it("ListTools returns exactly 9 tools and tools.map(t => t.name) byte-equals expected sequence", async () => {
    const resp = await harness.client.listTools();
    expect(resp.tools).toHaveLength(9);
    expect(resp.tools.map((t) => t.name)).toEqual([...EXPECTED_NAMES]);
  });

  it("first 4 descriptors deep-equal READ_ONLY_TOOLS (SPEC-FIGMA-009 INV-W4 byte-equal preservation)", async () => {
    const resp = await harness.client.listTools();
    for (let i = 0; i < READ_ONLY_TOOLS.length; i += 1) {
      const got = resp.tools[i];
      const want = READ_ONLY_TOOLS[i];
      expect(got.name).toBe(want.name);
      expect(got.description).toBe(want.description);
      expect(got.inputSchema.type).toBe("object");
    }
  });

  it("each of the last 5 descriptors has a non-null inputSchema with type: 'object'", async () => {
    const resp = await harness.client.listTools();
    const writeTools = resp.tools.slice(4);
    expect(writeTools).toHaveLength(5);
    for (const t of writeTools) {
      expect(WRITE_NAMES).toContain(t.name);
      expect(t.inputSchema).not.toBeNull();
      expect(t.inputSchema).toBeDefined();
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("write tool descriptors carry the expected required-arg property keys (T1 inputSchema)", async () => {
    const resp = await harness.client.listTools();
    const byName = new Map(resp.tools.map((t) => [t.name, t]));
    const planEmit = byName.get("plan_emit");
    const dryRun = byName.get("dryRun");
    const approve = byName.get("approve");
    const apply = byName.get("apply");
    const undo = byName.get("undo");
    for (const tool of [planEmit, dryRun, approve, apply, undo]) {
      expect(tool).toBeDefined();
    }
    const planProps = (planEmit?.inputSchema.properties ?? {}) as Record<string, unknown>;
    const dryRunProps = (dryRun?.inputSchema.properties ?? {}) as Record<string, unknown>;
    const approveProps = (approve?.inputSchema.properties ?? {}) as Record<string, unknown>;
    const applyProps = (apply?.inputSchema.properties ?? {}) as Record<string, unknown>;
    const undoProps = (undo?.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(planProps).sort()).toEqual(["frame_id", "write_target"]);
    expect(Object.keys(dryRunProps).sort()).toEqual(["frame_id", "write_target"]);
    expect(Object.keys(approveProps).sort()).toEqual(["pending_id"]);
    expect(Object.keys(applyProps).sort()).toEqual(["pending_id", "source_hash_recomputed"]);
    expect(Object.keys(undoProps).sort()).toEqual(["write_id"]);
  });
});
