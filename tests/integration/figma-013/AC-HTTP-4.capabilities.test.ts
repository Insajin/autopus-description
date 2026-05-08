// SPEC-FIGMA-013 T9 / AC-HTTP-4 — Phase 1.5 RED scaffold.
// Maps to: REQ-02, INV-13.3.
// post-initialize audit row capabilities byte-equal ["resources.read","tools.call"],
// transport === "http", profile_id === "codex-windows-stdio".

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHttpHarness,
  type HttpHarness,
} from "./__helpers/in-process-http-pair.js";

let workDir: string;
let harness: HttpHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-4-"));
  harness = await createHttpHarness({
    auditDir: workDir,
    clientName: "claude-code",
  });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

// @AX:ANCHOR: [AUTO] HTTP capability audit must remain read+call only, not tools.write.
// @AX:REASON: [AUTO] This guards the transport authorization boundary published to clients.
describe("AC-HTTP-4: client_profile_attached audit row baseline (transport=http)", () => {
  it("audit.jsonl contains exactly 1 client_profile_attached row with byte-equal capabilities", () => {
    const path = harness.clientProfileAuditPath;
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
    expect(row.transport).toBe("http");
    expect(row.profile_id).toBe("codex-windows-stdio");
    // No tools.write flag anywhere in the row.
    const json = JSON.stringify(row);
    expect(json.includes("tools.write")).toBe(false);
  });
});
