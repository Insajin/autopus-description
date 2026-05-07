// SPEC-FIGMA-011 T11 / AC-WR-4 — Phase 1.5 RED scaffold.
// apply with bridge=null → JSON-RPC error AND 1 audit row with REJECTION_KEYS_7
// keys, reason="APPLY_PARTIAL_DISCONNECT", status="rejected". Mock bridge
// dispatchCommand counter is 0 (REQ-03 security invariant).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";
import { REJECTION_KEYS_7 } from "../../../src/daemon/write-audit.js";

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-4-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-4: apply with disconnected plugin → JSON-RPC error + REJECTION_KEYS_7 audit row", () => {
  it("dryRun first, then detach bridge, then apply → isError true and 1 partial-disconnect row", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-DC", write_target: "frame_name" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string; source_hash_dryrun: string };

    const eventsBefore = harness.writeExtension.events.length;
    harness.detachBridge();

    const applyResp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: pending.source_hash_dryrun,
      },
    });
    expect(applyResp.isError).toBe(true);
    const text = (applyResp.content as Array<{ type: string; text: string }>)[0].text;
    expect(
      text.includes("PLUGIN_NOT_CONNECTED") || text.includes("APPLY_PARTIAL_DISCONNECT"),
    ).toBe(true);

    const newRows = harness.writeExtension.events.slice(eventsBefore);
    expect(newRows.length).toBe(1);
    expect(Object.keys(newRows[0]).sort()).toEqual([...REJECTION_KEYS_7].sort());
    expect(newRows[0].reason).toBe("APPLY_PARTIAL_DISCONNECT");
    expect(newRows[0].status).toBe("rejected");
  });

  it("no Figma mutation occurred — mock bridge dispatchCommand counter is 0", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-DC", write_target: "frame_name" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string; source_hash_dryrun: string };
    harness.detachBridge();
    await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: pending.source_hash_dryrun,
      },
    });
    expect(harness.bridge.snapshot().callCount).toBe(0);
  });
});
