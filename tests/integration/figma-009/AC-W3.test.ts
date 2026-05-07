// SPEC-FIGMA-009 T11 / AC-W3 — Phase 1.5 RED scaffold (in-process).
// Verifies ListTools returns exactly 4 read-only tools with matching shape and
// zero entries from the SPEC-FIGMA-007 write-tool surface (INV-W4); CallTool
// of a known tool succeeds, of an unknown name returns isError:true with
// "unknown tool" substring.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPairedHarness, type PairedHarness } from "./__helpers/in-memory-pair.js";

const WRITE_TOOL_SURFACE = new Set([
  "plan_emit",
  "dry_run",
  "approve",
  "apply",
  "undo",
]);

let workDir: string;
let harness: PairedHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig009-AC-W3-"));
  harness = await createPairedHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-W3: ListTools — 4 read-only entries, 0 write entries", () => {
  it("listTools returns 4 entries in canonical order", async () => {
    const resp = await harness.client.listTools();
    expect(resp.tools).toHaveLength(4);
    expect(resp.tools.map((t) => t.name)).toEqual([
      "get_active_selection",
      "get_pending_descriptions",
      "get_audit_events",
      "get_stale_frames",
    ]);
  });

  it("every tool has empty-object inputSchema with additionalProperties:false", async () => {
    const resp = await harness.client.listTools();
    for (const tool of resp.tools) {
      const schema = tool.inputSchema as {
        type: string;
        properties: Record<string, unknown>;
        additionalProperties: boolean;
      };
      expect(schema.type).toBe("object");
      expect(Object.keys(schema.properties)).toHaveLength(0);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it("zero entries belong to the SPEC-FIGMA-007 write-tool surface (INV-W4)", async () => {
    const resp = await harness.client.listTools();
    const write = resp.tools.filter((t) => WRITE_TOOL_SURFACE.has(t.name));
    expect(write).toHaveLength(0);
  });

  it("callTool('get_active_selection') returns content[0].type=text (success path)", async () => {
    const resp = await harness.client.callTool({
      name: "get_active_selection",
      arguments: {},
    });
    const content = resp.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(resp.isError === undefined || resp.isError === false).toBe(true);
  });

  it("callTool('plan_emit') returns isError:true with 'unknown tool' substring", async () => {
    const resp = await harness.client.callTool({
      name: "plan_emit",
      arguments: {},
    });
    expect(resp.isError).toBe(true);
    const content = resp.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("unknown tool");
  });
});
