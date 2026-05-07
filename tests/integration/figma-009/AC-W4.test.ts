// SPEC-FIGMA-009 T7 / AC-W4 — Phase 1.5 RED scaffold (in-process).
// Verifies wire-side redaction: figd_* tokens published into resources or
// passed as tool arguments are replaced with *** before reaching the client,
// and the audit.jsonl file contains zero figd_* matches across all lines.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPairedHarness, type PairedHarness } from "./__helpers/in-memory-pair.js";

const FIGD_TOKEN = "figd_abcdefghijklmnop1234";
const FIGD_RE = /figd_[A-Za-z0-9_-]{16,}/g;

let workDir: string;
let harness: PairedHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig009-AC-W4-"));
  harness = await createPairedHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-W4: outbound figd_* redaction (wire + audit)", () => {
  it("ReadResource on active_selection redacts figd_* in description payload", async () => {
    await harness.mcp.publish({
      frame_id: "FRAME-X",
      screen_id: "SCREEN-X",
      source_hash: "h2",
      generated_at: "2026-05-07T00:00:00Z",
      description: `leaked ${FIGD_TOKEN} inside payload`,
    });

    const resp = await harness.client.readResource({ uri: "autopus://active_selection" });
    const text = (resp.contents[0] as { text: string }).text;
    expect(text.match(FIGD_RE) ?? []).toHaveLength(0);
    expect(text.match(/\*\*\*/g) ?? []).toHaveLength(1);
    const parsed = JSON.parse(text) as { description: string };
    expect(parsed.description).toBe("leaked *** inside payload");
  });

  it("CallTool with figd_* argument redacts the token in returned content[0].text", async () => {
    const resp = await harness.client.callTool({
      name: "get_active_selection",
      arguments: { payload: "another figd_zzzzzzzzzzzzzzzz9999" },
    });
    const content = resp.content as Array<{ type: string; text: string }>;
    expect(content[0].text.match(FIGD_RE) ?? []).toHaveLength(0);
  });

  it("audit.jsonl contains zero figd_* matches across all lines (INV-W2 / INV-006)", async () => {
    await harness.mcp.publish({
      frame_id: "FRAME-X",
      screen_id: "SCREEN-X",
      source_hash: "h2",
      generated_at: "2026-05-07T00:00:00Z",
      description: `leaked ${FIGD_TOKEN} inside payload`,
    });
    await harness.client.callTool({
      name: "get_active_selection",
      arguments: { payload: `another ${FIGD_TOKEN}` },
    });

    const auditPath = join(workDir, "audit.jsonl");
    if (existsSync(auditPath)) {
      const raw = readFileSync(auditPath, "utf8");
      expect(raw.match(FIGD_RE) ?? []).toHaveLength(0);
    }
  });
});
