// SPEC-FIGMA-011 T14 / AC-WR-7 — Phase 1.5 RED scaffold.
// Leak fixture figd_AAAAAAAAAAAAAAAA (20 chars) embedded across 7 surfaces
// (5 CallTool + 2 ReadResource). For each captured outbound text:
// expect(text).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/). Total leak count = 0.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";

const LEAK = "figd_AAAAAAAAAAAAAAAA";
const FIGD_RE = /figd_[A-Za-z0-9_-]{16,}/;

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-7-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-7: zero figd_* across 7 write-surface wire texts", () => {
  it("captures 7 outbound text frames; total leak count is 0", async () => {
    const captured: string[] = [];

    // Surface 1: plan_emit with leak in frame_id.
    const planEmitResp = await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: LEAK, write_target: "frame_name" },
    });
    captured.push(
      (planEmitResp.content as Array<{ type: string; text: string }>)[0].text,
    );

    // Surface 2: dryRun with leak in frame_id.
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: LEAK, write_target: "frame_name" },
    });
    const dryRunText = (
      dryRunResp.content as Array<{ type: string; text: string }>
    )[0].text;
    captured.push(dryRunText);
    const pending = JSON.parse(dryRunText) as {
      pending_id: string;
      source_hash_dryrun: string;
    };

    // Surface 3: approve with valid pending_id.
    const approveResp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pending.pending_id },
    });
    captured.push(
      (approveResp.content as Array<{ type: string; text: string }>)[0].text,
    );

    // Surface 4: apply with leak fixture as source_hash_recomputed.
    const applyResp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: LEAK,
      },
    });
    captured.push(
      (applyResp.content as Array<{ type: string; text: string }>)[0].text,
    );

    // Surface 5: undo with leak fixture as write_id.
    const undoResp = await harness.client.callTool({
      name: "undo",
      arguments: { write_id: LEAK },
    });
    captured.push(
      (undoResp.content as Array<{ type: string; text: string }>)[0].text,
    );

    // Surface 6: ReadResource pending_writes.
    const pendingRead = await harness.client.readResource({
      uri: "autopus://pending_writes",
    });
    captured.push((pendingRead.contents[0] as { text: string }).text);

    // Surface 7: ReadResource applied_writes.
    const appliedRead = await harness.client.readResource({
      uri: "autopus://applied_writes",
    });
    captured.push((appliedRead.contents[0] as { text: string }).text);

    expect(captured.length).toBe(7);
    let leakCount = 0;
    for (const text of captured) {
      expect(text).not.toMatch(FIGD_RE);
      if (text.includes(LEAK)) leakCount += 1;
    }
    expect(leakCount).toBe(0);
  });
});
