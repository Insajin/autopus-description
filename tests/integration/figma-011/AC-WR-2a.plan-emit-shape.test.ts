// SPEC-FIGMA-011 T21 / AC-WR-2a — Phase 1.5 RED scaffold.
// plan_emit returns the 3-key preview shape {plan_id, manifest_entry_hash,
// plugin_commands}, redacts figd_* fixtures, and does NOT mutate
// PendingWriteStore (distinguishes from dryRun).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";

const LEAK_FIXTURE = "figd_TESTLEAK1234567890ABCDEFG";
const FIGD_RE = /figd_[A-Za-z0-9_-]{16,}/;
const PLAN_ID_RE = /^pw-[0-9a-f]{8}\d+-\d+$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-2a-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-2a: plan_emit returns the 3-key shape with byte-equal redact zero-leak", () => {
  it("response.content[0].text JSON-parses to {manifest_entry_hash, plan_id, plugin_commands} byte-equal sorted keyset", async () => {
    const resp = await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: "F-7-fixture-A", write_target: "frame_name" },
    });
    expect(resp.isError).not.toBe(true);
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "manifest_entry_hash",
      "plan_id",
      "plugin_commands",
    ]);
  });

  it("plan_id matches the PendingWriteStore opaque-token regex", async () => {
    const resp = await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: "F-7-fixture-A", write_target: "frame_name" },
    });
    const parsed = JSON.parse(
      (resp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { plan_id: string };
    expect(parsed.plan_id).toMatch(PLAN_ID_RE);
  });

  it("manifest_entry_hash matches /^[0-9a-f]{64}$/", async () => {
    const resp = await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: "F-7-fixture-A", write_target: "frame_name" },
    });
    const parsed = JSON.parse(
      (resp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { manifest_entry_hash: string };
    expect(parsed.manifest_entry_hash).toMatch(HEX64_RE);
  });

  it("plugin_commands is a JSON array with length >= 1", async () => {
    const resp = await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: "F-7-fixture-A", write_target: "frame_name" },
    });
    const parsed = JSON.parse(
      (resp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { plugin_commands: unknown[] };
    expect(Array.isArray(parsed.plugin_commands)).toBe(true);
    expect(parsed.plugin_commands.length).toBeGreaterThanOrEqual(1);
  });

  it("leak fixture appears 0 times in response.content[0].text after redact", async () => {
    // Inject leak fixture via frame_id arg; redact() MUST strip figd_ tokens
    // even when echoed back through plan or plugin_commands payloads.
    const resp = await harness.client.callTool({
      name: "plan_emit",
      arguments: {
        frame_id: `F-7-${LEAK_FIXTURE}`,
        write_target: "frame_name",
      },
    });
    const text = (resp.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.indexOf(LEAK_FIXTURE)).toBe(-1);
    expect(text).not.toMatch(FIGD_RE);
  });

  it("PendingWriteStore.size() is unchanged after plan_emit (does not populate TTL store)", async () => {
    const before = harness.writeExtension.pendingStore.size();
    await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: "F-7-fixture-A", write_target: "frame_name" },
    });
    const after = harness.writeExtension.pendingStore.size();
    expect(after).toBe(before);
  });
});
