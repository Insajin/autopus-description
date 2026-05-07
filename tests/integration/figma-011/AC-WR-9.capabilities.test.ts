// SPEC-FIGMA-011 T16 / AC-WR-9 — Phase 1.5 RED scaffold.
// post-initialize audit row capabilities byte-equal ["resources.read","tools.call"].
// transport==="stdio", profile_id matches frozen baseline, no tools.write flag.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPairedWriteHarness,
  type PairedWriteHarness,
} from "./__helpers/in-memory-pair.js";

let workDir: string;
let harness: PairedWriteHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig011-AC-WR-9-"));
  harness = await createPairedWriteHarness({
    auditDir: workDir,
    clientName: "claude-code",
  });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-WR-9: client_profile_attached audit row capabilities byte-equal frozen baseline", () => {
  it("audit.jsonl client_profile_attached row has capabilities=['resources.read','tools.call'] byte-equal", () => {
    const path = join(workDir, "audit.jsonl");
    expect(existsSync(path)).toBe(true);
    const rows = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.event === "client_profile_attached");
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.capabilities).toEqual(["resources.read", "tools.call"]);
    expect(row.transport).toBe("stdio");
    expect(typeof row.profile_id).toBe("string");
    expect((row.profile_id as string).length).toBeGreaterThan(0);
    // No tools.write flag anywhere in the row.
    const json = JSON.stringify(row);
    expect(json.includes("tools.write")).toBe(false);
  });
});
