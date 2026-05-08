// SPEC-FIGMA-013 T11 / AC-HTTP-6 — Phase 1.5 RED scaffold.
// Maps to: REQ-05, INV-13.6.
// apply with bridge=null over HTTP → JSON-RPC error + 1 audit row whose
// keyset == REJECTION_KEYS_7 + dispatchCommand call count == 0.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHttpHarness,
  type HttpHarness,
} from "./__helpers/in-process-http-pair.js";
import { REJECTION_KEYS_7 } from "../../../src/daemon/write-audit.js";

let workDir: string;
let harness: HttpHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-6-"));
  harness = await createHttpHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

// @AX:ANCHOR: [AUTO] Partial-disconnect audit rows must keep the shared REJECTION_KEYS_7 schema.
// @AX:REASON: [AUTO] The HTTP apply path must fail closed without diverging from write-audit consumers.
describe("AC-HTTP-6: apply with bridge=null over HTTP — error + REJECTION_KEYS_7 audit + 0 dispatch", () => {
  it("dryRun, detach bridge, apply → isError true; content includes PLUGIN_NOT_CONNECTED", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-1", write_target: "annotation_card" },
    });
    const text = (
      dryRunResp.content as Array<{ type: string; text: string }>
    )[0].text;
    const pending = JSON.parse(text) as {
      pending_id: string;
      source_hash_dryrun?: string;
    };

    harness.detachBridge();

    const applyResp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: "hash-recomputed-001",
      },
    });
    expect(applyResp.isError).toBe(true);
    const applyText = (
      applyResp.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(applyText.includes("PLUGIN_NOT_CONNECTED")).toBe(true);
  });

  it("write-audit.jsonl gets exactly 1 row with REJECTION_KEYS_7 keyset and reason APPLY_PARTIAL_DISCONNECT", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-1", write_target: "annotation_card" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string };

    harness.detachBridge();

    await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: "hash-recomputed-001",
      },
    });

    const path = harness.auditLogPath;
    expect(existsSync(path)).toBe(true);
    const rows = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    // Filter to APPLY_PARTIAL_DISCONNECT rows for this pending_id.
    const partial = rows.filter(
      (r) => r.reason === "APPLY_PARTIAL_DISCONNECT",
    );
    expect(partial.length).toBe(1);
    expect(Object.keys(partial[0]).sort()).toEqual([...REJECTION_KEYS_7].sort());
    expect(partial[0].reason).toBe("APPLY_PARTIAL_DISCONNECT");
  });

  it("mock plugin bridge dispatchCommand counter is 0 on bridge=null apply path", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-1", write_target: "annotation_card" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string };

    harness.detachBridge();

    await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: "hash-recomputed-001",
      },
    });
    expect(harness.bridge.snapshot().callCount).toBe(0);
  });
});
