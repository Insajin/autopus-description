// SPEC-FIGMA-011 T13 / AC-WR-6 — Phase 1.5 RED scaffold.
// happy dryRun → apply → undo. Audit row keys exactly UNDO_KEYS (=
// REJECTION_KEYS_7), reason="UNDO_REQUESTED", status="undone". applied_writes
// resource no longer contains write_id.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";
import { UNDO_KEYS } from "../../../src/daemon/write-audit.js";

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-6-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-6: undo after apply → 7-key UNDO_KEYS audit row, status=undone", () => {
  it("dryRun → apply → undo emits UNDO_KEYS row and removes write_id from applied_writes", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-U", write_target: "frame_name" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string; source_hash_dryrun: string };

    const applyResp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: pending.source_hash_dryrun,
      },
    });
    const apply = JSON.parse(
      (applyResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { write_id: string };
    expect(typeof apply.write_id).toBe("string");

    const eventsBefore = harness.writeExtension.events.length;
    const undoResp = await harness.client.callTool({
      name: "undo",
      arguments: { write_id: apply.write_id },
    });
    expect(undoResp.isError).not.toBe(true);
    const undoParsed = JSON.parse(
      (undoResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as Record<string, unknown>;
    expect(undoParsed.status).toBe("undone");
    expect(undoParsed.write_id).toBe(apply.write_id);

    const newRows = harness.writeExtension.events.slice(eventsBefore);
    const undoRows = newRows.filter((r) => r.reason === "UNDO_REQUESTED");
    expect(undoRows.length).toBe(1);
    expect(Object.keys(undoRows[0]).sort()).toEqual([...UNDO_KEYS].sort());
    expect(undoRows[0].status).toBe("undone");

    const appliedRead = await harness.client.readResource({
      uri: "autopus://applied_writes",
    });
    const appliedText = (appliedRead.contents[0] as { text: string }).text;
    expect(appliedText.includes(apply.write_id)).toBe(false);
  });
});
