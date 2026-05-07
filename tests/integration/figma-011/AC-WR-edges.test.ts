// SPEC-FIGMA-011 Phase 3 — branch coverage uplift for write-handlers.ts.
// Targets the validator/error branches not exercised by the AC oracle suite:
//   - planEmit invalid args (line 178)
//   - dryRun invalid args (line 191)
//   - apply missing pending_id / source_hash_recomputed (line 221)
//   - apply with bridge=null AND pending_id not found (T4 design fork)
//   - approve unknown pending_id (line 202)
//   - approve "TIMEOUT" stub sentinel (line 204)
//   - undo invalid args (line 245)
//   - dispatch unknown tool name (line 270)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-edges-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("Edge: invalid args branches return JSON-RPC error", () => {
  it("plan_emit with empty frame_id returns isError + descriptive message", async () => {
    const resp = await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: "", write_target: "frame_name" },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("invalid plan_emit args");
  });

  it("plan_emit with unknown write_target returns isError", async () => {
    const resp = await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: "F-1", write_target: "not_a_real_target" },
    });
    expect(resp.isError).toBe(true);
  });

  it("dryRun with empty frame_id returns isError + descriptive message", async () => {
    const resp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "", write_target: "frame_name" },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("invalid dryRun args");
  });

  it("apply with missing pending_id returns isError", async () => {
    const resp = await harness.client.callTool({
      name: "apply",
      arguments: { pending_id: "", source_hash_recomputed: "abc" },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("invalid apply args");
  });

  it("apply with missing source_hash_recomputed returns isError", async () => {
    const resp = await harness.client.callTool({
      name: "apply",
      arguments: { pending_id: "pw-x-1", source_hash_recomputed: "" },
    });
    expect(resp.isError).toBe(true);
  });

  it("undo with empty write_id returns isError", async () => {
    const resp = await harness.client.callTool({
      name: "undo",
      arguments: { write_id: "" },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("invalid undo args");
  });
});

describe("Edge: approve corner cases", () => {
  it("approve with empty pending_id returns isError", async () => {
    const resp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: "" },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("invalid approve args");
  });

  it("approve with non-existent pending_id (never-issued) returns isError with 'unknown pending_id'", async () => {
    const resp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: "pw-deadbeef99999-9999" },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("unknown pending_id");
  });

  it("approve with TIMEOUT sentinel stub returns isError with 'approve timed out'", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-T", write_target: "frame_name" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string };
    harness.writeExtension.approveResponseStub = new Map();
    harness.writeExtension.approveResponseStub.set(pending.pending_id, "TIMEOUT");

    const resp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pending.pending_id },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("approve timed out");
  });

  it("approve without stub map produces concrete approved=true default branch", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-DEF", write_target: "frame_name" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string };

    const resp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pending.pending_id },
    });
    expect(resp.isError).not.toBe(true);
    const parsed = JSON.parse(
      (resp.content as Array<{ type: string; text: string }>)[0].text,
    ) as Record<string, unknown>;
    expect(parsed.approved).toBe(true);
    expect(parsed.rejected_reason).toBeNull();
    expect(typeof parsed.approved_at).toBe("string");
  });
});

describe("Edge: apply with bridge=null and missing pending_id (T4 design fork)", () => {
  it("returns JSON-RPC error WITHOUT emitting an audit row (avoids leaking pending_id existence)", async () => {
    const eventsBefore = harness.writeExtension.events.length;
    harness.detachBridge();
    const resp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: "pw-nonexistent00000-9999",
        source_hash_recomputed: "abc",
      },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("PLUGIN_NOT_CONNECTED");
    // No new audit row when pending_id is absent (REQ-03 / T4 invariant).
    expect(harness.writeExtension.events.length).toBe(eventsBefore);
  });
});
