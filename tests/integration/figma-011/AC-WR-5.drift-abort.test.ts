// SPEC-FIGMA-011 T12 / AC-WR-5 — Phase 1.5 RED scaffold.
// dryRun records source_hash_dryrun=X; apply with source_hash_recomputed=Y
// (Y≠X) → 9-key DRIFT_ABORT_KEYS row, reason="APPLY_DRIFT_ABORT",
// source_hash_dryrun==="X", source_hash_recomputed==="Y", status="rejected".

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";
import { DRIFT_ABORT_KEYS } from "../../../src/daemon/write-audit.js";

const MUTATED_HASH =
  "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-5-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-5: apply with drifted source_hash → 9-key DRIFT_ABORT_KEYS audit row", () => {
  it("dryRun yields source_hash_dryrun=X; apply with Y≠X → DRIFT_ABORT_KEYS keyset, reason APPLY_DRIFT_ABORT", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-D", write_target: "frame_name" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string; source_hash_dryrun: string };
    expect(pending.source_hash_dryrun).not.toBe(MUTATED_HASH);

    const eventsBefore = harness.writeExtension.events.length;
    const applyResp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: MUTATED_HASH,
      },
    });
    const text = (applyResp.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.error).toBe("APPLY_DRIFT_ABORT");

    const newRows = harness.writeExtension.events.slice(eventsBefore);
    expect(newRows.length).toBe(1);
    expect(Object.keys(newRows[0]).sort()).toEqual([...DRIFT_ABORT_KEYS].sort());
    expect(newRows[0].reason).toBe("APPLY_DRIFT_ABORT");
    expect(newRows[0].status).toBe("rejected");
    expect(newRows[0].source_hash_dryrun).toBe(pending.source_hash_dryrun);
    expect(newRows[0].source_hash_recomputed).toBe(MUTATED_HASH);
  });

  it("no Figma mutation on drift abort — mock bridge dispatchCommand counter is 0", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-D", write_target: "frame_name" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string };
    await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: MUTATED_HASH,
      },
    });
    expect(harness.bridge.snapshot().callCount).toBe(0);
  });
});
