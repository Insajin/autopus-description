// SPEC-FIGMA-011 T17 / AC-WR-10 — Phase 1.5 RED scaffold.
// ListResources returns 6 entries; URI array byte-equals expected sequence.
// ReadResource on autopus://pending_writes returns text parsing as JSON array.
// Zero figd_* in response text.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";

const EXPECTED_URIS = [
  "autopus://active_selection",
  "autopus://pending_descriptions",
  "autopus://audit_events",
  "autopus://stale_frames",
  "autopus://pending_writes",
  "autopus://applied_writes",
];

const FIGD_RE = /figd_[A-Za-z0-9_-]{16,}/;

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-10-"));
  harness = await createPairedWriteHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-10: ListResources — 6 entries in fixed byte-equal order", () => {
  it("listResources returns 6 entries with URIs byte-equal expected array", async () => {
    const resp = await harness.client.listResources();
    expect(resp.resources).toHaveLength(6);
    expect(resp.resources.map((r) => r.uri)).toEqual(EXPECTED_URIS);
  });

  it("ReadResource autopus://pending_writes returns text parsing as JSON array, zero figd_*", async () => {
    const resp = await harness.client.readResource({
      uri: "autopus://pending_writes",
    });
    const text = (resp.contents[0] as { text: string }).text;
    const parsed = JSON.parse(text) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect(text).not.toMatch(FIGD_RE);
  });

  it("ReadResource autopus://applied_writes returns text parsing as JSON array, zero figd_*", async () => {
    const resp = await harness.client.readResource({
      uri: "autopus://applied_writes",
    });
    const text = (resp.contents[0] as { text: string }).text;
    const parsed = JSON.parse(text) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect(text).not.toMatch(FIGD_RE);
  });
});
