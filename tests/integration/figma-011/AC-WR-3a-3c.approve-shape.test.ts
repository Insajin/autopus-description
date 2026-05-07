// SPEC-FIGMA-011 T22 / AC-WR-3a + 3b + 3c — Phase 1.5 RED scaffold.
// approve returns the 3-key shape {approved, approved_at, rejected_reason}
// with concrete byte-equal values on APPROVE / REJECT paths, and a JSON-RPC
// error containing "pending_id expired" on TIMEOUT path. No Figma mutation.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const APPROVE_KEYS_3 = ["approved", "approved_at", "rejected_reason"];

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-3a-3c-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function dryRunFor(frame_id: string): Promise<string> {
  const resp = await harness.client.callTool({
    name: "dryRun",
    arguments: { frame_id, write_target: "frame_name" },
  });
  const parsed = JSON.parse(
    (resp.content as Array<{ type: string; text: string }>)[0].text,
  ) as { pending_id: string };
  return parsed.pending_id;
}

describe("AC-WR-3a: approve APPROVE path returns 3-key shape with concrete values", () => {
  it("approved===true, approved_at matches ISO-8601 UTC, rejected_reason===null", async () => {
    const pendingIdA = await dryRunFor("F-A");
    harness.writeExtension.approveResponseStub = new Map();
    harness.writeExtension.approveResponseStub.set(pendingIdA, {
      approved: true,
      approved_at: "2026-05-07T12:00:00.000Z",
      rejected_reason: null,
    });

    const resp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pendingIdA },
    });
    expect(resp.isError).not.toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(APPROVE_KEYS_3);
    expect(parsed.approved).toBe(true);
    expect(typeof parsed.approved_at).toBe("string");
    expect(parsed.approved_at as string).toMatch(ISO_UTC_RE);
    expect(parsed.rejected_reason).toBeNull();
  });

  it("APPROVE path: mock bridge dispatchCommand counter is 0 (gate-only)", async () => {
    const pendingIdA = await dryRunFor("F-A");
    harness.writeExtension.approveResponseStub = new Map();
    harness.writeExtension.approveResponseStub.set(pendingIdA, {
      approved: true,
      approved_at: "2026-05-07T12:00:00.000Z",
      rejected_reason: null,
    });
    await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pendingIdA },
    });
    expect(harness.bridge.snapshot().callCount).toBe(0);
  });
});

describe("AC-WR-3b: approve REJECT path returns 3-key shape with non-empty reason string", () => {
  it("approved===false, approved_at===null, rejected_reason byte-equals supplied string", async () => {
    const pendingIdB = await dryRunFor("F-B");
    const rejectReason = "designer-rejected: copy not approved";
    harness.writeExtension.approveResponseStub = new Map();
    harness.writeExtension.approveResponseStub.set(pendingIdB, {
      approved: false,
      approved_at: null,
      rejected_reason: rejectReason,
    });

    const resp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pendingIdB },
    });
    expect(resp.isError).not.toBe(true);
    const parsed = JSON.parse(
      (resp.content as Array<{ type: string; text: string }>)[0].text,
    ) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(APPROVE_KEYS_3);
    expect(parsed.approved).toBe(false);
    expect(parsed.approved_at).toBeNull();
    expect(parsed.rejected_reason).toBe(rejectReason);
  });

  it("REJECT path: mock bridge dispatchCommand counter is 0", async () => {
    const pendingIdB = await dryRunFor("F-B");
    harness.writeExtension.approveResponseStub = new Map();
    harness.writeExtension.approveResponseStub.set(pendingIdB, {
      approved: false,
      approved_at: null,
      rejected_reason: "designer-rejected: copy not approved",
    });
    await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pendingIdB },
    });
    expect(harness.bridge.snapshot().callCount).toBe(0);
  });
});

describe("AC-WR-3c: approve TIMEOUT path returns JSON-RPC error", () => {
  it("expired pending_id (clock advanced 60001ms) → isError true with 'pending_id expired'", async () => {
    const pendingIdC = await dryRunFor("F-C");
    harness.writeExtension.advanceClockMs(60_001);
    const resp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pendingIdC },
    });
    expect(resp.isError).toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("pending_id expired");
    expect(text).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
  });

  it("TIMEOUT path: mock bridge dispatchCommand counter is 0", async () => {
    const pendingIdC = await dryRunFor("F-C");
    harness.writeExtension.advanceClockMs(60_001);
    await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pendingIdC },
    });
    expect(harness.bridge.snapshot().callCount).toBe(0);
  });
});
