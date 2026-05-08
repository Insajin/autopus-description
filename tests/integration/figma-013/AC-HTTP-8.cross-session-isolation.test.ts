// SPEC-FIGMA-013 T13 / AC-HTTP-8 — Phase 1.5 RED scaffold.
// Maps to: REQ-07.
// Cross-session pending_id isolation: Client B's apply on Client A's pending_id
// → JSON-RPC error containing "unknown pending_id" + 0 dispatch under SB
// + 0 apply_succeeded rows for PA on session SB.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHttpHarness,
  createSecondClient,
  type HttpHarness,
} from "./__helpers/in-process-http-pair.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

let workDir: string;
let harness: HttpHarness;
let clientB: Client;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-8-"));
  harness = await createHttpHarness({
    auditDir: workDir,
    clientName: "client-A",
  });
  clientB = await createSecondClient(harness, "client-B");
});

afterEach(async () => {
  await clientB.close();
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

// @AX:ANCHOR: [AUTO] Pending write ids are scoped to one HTTP MCP session.
// @AX:REASON: [AUTO] Reusing another session's pending_id must not dispatch plugin writes or emit success rows.
describe("AC-HTTP-8: cross-session pending_id isolation (B cannot apply A's pending_id)", () => {
  it("Client B apply on Client A's pending_id returns isError true with 'unknown pending_id'", async () => {
    expect(new Set(harness.getSessionIds()).size).toBe(2);

    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-A", write_target: "annotation_card" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string };

    const applyResp = await clientB.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: "any-hash",
      },
    });
    expect(applyResp.isError).toBe(true);
    const text = (
      applyResp.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(text.includes("unknown pending_id")).toBe(true);
  });

  it("0 dispatchCommand calls happen under session SB on cross-session apply", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-A", write_target: "annotation_card" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string };

    const beforeCallCount = harness.bridge.snapshot().callCount;
    await clientB.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: "any-hash",
      },
    });
    expect(harness.bridge.snapshot().callCount).toBe(beforeCallCount);
  });

  it("write-audit.jsonl shows 0 apply_succeeded rows for the pending_id under session SB", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-A", write_target: "annotation_card" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string };

    await clientB.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: "any-hash",
      },
    });

    const path = harness.auditLogPath;
    if (!existsSync(path)) {
      // No audit file yet means no apply_succeeded row at all — passes the
      // 0-count assertion.
      expect(0).toBe(0);
      return;
    }
    const rows = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const succeeded = rows.filter(
      (r) =>
        r.event === "apply_succeeded" &&
        r.pending_id === pending.pending_id,
    );
    expect(succeeded.length).toBe(0);
  });

  it("Client A can still apply its own pending_id after Client B is rejected", async () => {
    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-A", write_target: "annotation_card" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string; source_hash_dryrun: string };

    await clientB.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: pending.source_hash_dryrun,
      },
    });

    const applyResp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: pending.source_hash_dryrun,
      },
    });
    expect(applyResp.isError).not.toBe(true);
    const text = (
      applyResp.content as Array<{ type: string; text: string }>
    )[0].text;
    expect((JSON.parse(text) as { status: string }).status).toBe("applied");
  });
});
