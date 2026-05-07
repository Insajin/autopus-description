// SPEC-FIGMA-009 T11 / AC-W2 — Phase 1.5 RED scaffold (in-process).
// Verifies ReadResource for the 4 canonical URIs returns redacted JSON text
// with the expected key set + frame_id values, and unknown URI rejects with
// "Unknown resource URI" substring.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPairedHarness, type PairedHarness } from "./__helpers/in-memory-pair.js";

let workDir: string;
let harness: PairedHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig009-AC-W2-"));
  harness = await createPairedHarness({ auditDir: workDir });
  await harness.mcp.publish({
    frame_id: "FRAME-A",
    screen_id: "SCREEN-A",
    source_hash: "h1",
    generated_at: "2026-05-07T00:00:00Z",
    description: "ok",
  });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

const FIGD_RE = /figd_[A-Za-z0-9_-]{16,}/;

describe("AC-W2: ReadResource — 4 URIs with concrete payload oracles", () => {
  it("active_selection — keyset + frame_id == FRAME-A + redacted text", async () => {
    const resp = await harness.client.readResource({ uri: "autopus://active_selection" });
    expect(resp.contents).toHaveLength(1);
    expect(resp.contents[0].uri).toBe("autopus://active_selection");
    expect(resp.contents[0].mimeType).toBe("application/json");
    const text = (resp.contents[0] as { text: string }).text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(new Set(Object.keys(parsed))).toEqual(
      new Set(["frame_id", "screen_id", "source_hash", "generated_at", "description"]),
    );
    expect(parsed.frame_id).toBe("FRAME-A");
    expect(FIGD_RE.test(text)).toBe(false);
  });

  it("pending_descriptions — array length 1, frame_id == FRAME-A", async () => {
    const resp = await harness.client.readResource({ uri: "autopus://pending_descriptions" });
    const text = (resp.contents[0] as { text: string }).text;
    const parsed = JSON.parse(text) as Array<{ frame_id: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].frame_id).toBe("FRAME-A");
    expect(FIGD_RE.test(text)).toBe(false);
  });

  it("audit_events — JSON array (length >= 0)", async () => {
    const resp = await harness.client.readResource({ uri: "autopus://audit_events" });
    const text = (resp.contents[0] as { text: string }).text;
    const parsed = JSON.parse(text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(0);
    expect(FIGD_RE.test(text)).toBe(false);
  });

  it("stale_frames — empty array (no markStale called)", async () => {
    const resp = await harness.client.readResource({ uri: "autopus://stale_frames" });
    const text = (resp.contents[0] as { text: string }).text;
    const parsed = JSON.parse(text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
    expect(FIGD_RE.test(text)).toBe(false);
  });

  it("unknown URI rejects with 'Unknown resource URI' in error message", async () => {
    let err: unknown = null;
    try {
      await harness.client.readResource({ uri: "autopus://nonexistent" });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    const message = (err as Error)?.message ?? "";
    expect(message).toContain("Unknown resource URI");
  });
});
