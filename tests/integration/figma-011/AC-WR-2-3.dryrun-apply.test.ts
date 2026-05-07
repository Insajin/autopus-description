// SPEC-FIGMA-011 T10 / AC-WR-2 + AC-WR-3 — Phase 1.5 RED scaffold.
// dryRun returns a 7-key PendingWriteSerializable with `pending_id` matching
// the PendingWriteStore opaque token format. apply (with bridge ack) returns
// success and emits a 5-key SUCCESS_KEYS_5 audit row.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";
import { SUCCESS_KEYS_5 } from "../../../src/daemon/write-audit.js";

const PENDING_ID_RE = /^pw-[0-9a-f]{8}\d+-\d+$/;

const EXPECTED_PENDING_KEYS = [
  "pending_id",
  "manifest_entry_hash",
  "source_hash_dryrun",
  "plugin_commands",
  "frame_id",
  "write_target",
  "expires_at",
].sort();

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-2-3-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-2: dryRun returns 7-key PendingWrite shape with pending_id", () => {
  it("dryRun({frame_id:'F1', write_target:'frame_name'}) returns object with byte-equal keyset", async () => {
    const resp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F1", write_target: "frame_name" },
    });
    expect(resp.isError).not.toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(EXPECTED_PENDING_KEYS);
    expect(typeof parsed.pending_id).toBe("string");
    expect(parsed.pending_id as string).toMatch(PENDING_ID_RE);
    expect(parsed.frame_id).toBe("F1");
    expect(parsed.write_target).toBe("frame_name");
    expect(harness.writeExtension.pendingStore.size()).toBe(1);
  });
});

describe("AC-WR-3: apply happy path emits 5-key SUCCESS_KEYS_5 row", () => {
  it("dryRun → apply yields status=applied + write_id and a SUCCESS_KEYS_5 audit row", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F1", write_target: "frame_name" },
    });
    const dryText = (dryRunResp.content as Array<{ type: string; text: string }>)[0].text;
    const pending = JSON.parse(dryText) as {
      pending_id: string;
      source_hash_dryrun: string;
    };

    const applyResp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: pending.source_hash_dryrun,
      },
    });
    expect(applyResp.isError).not.toBe(true);
    const applyText = (applyResp.content as Array<{ type: string; text: string }>)[0].text;
    const applyParsed = JSON.parse(applyText) as Record<string, unknown>;
    expect(applyParsed.status).toBe("applied");
    expect(typeof applyParsed.write_id).toBe("string");
    expect((applyParsed.write_id as string).length).toBeGreaterThan(0);

    // Find the success audit row in writeExtension.events.
    const successRows = harness.writeExtension.events.filter(
      (e) => e.timestamp_iso !== undefined && e.reason === undefined && e.status === undefined,
    );
    expect(successRows.length).toBe(1);
    expect(Object.keys(successRows[0]).sort()).toEqual([...SUCCESS_KEYS_5].sort());
  });

  it("plugin bridge dispatchCommand counter is non-zero on success path (mutation occurred)", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F1", write_target: "frame_name" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string; source_hash_dryrun: string };
    await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: pending.source_hash_dryrun,
      },
    });
    expect(harness.bridge.snapshot().callCount).toBeGreaterThan(0);
  });
});
