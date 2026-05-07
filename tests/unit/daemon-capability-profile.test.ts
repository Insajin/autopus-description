// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-10, AC-S11.
// 3 transport classes emit client_profile_attached audit rows with exact
// `capabilities` array values per class.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../src/daemon/server.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-cap-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("Capability profile (REQ-10, AC-S11)", () => {
  it("3 client classes produce 3 client_profile_attached rows with exact capabilities", async () => {
    const daemon = new Daemon({ transport: "stdio", port: 0, auditDir: workDir });
    await daemon.boot();

    await daemon.attachClient({ client_id: "claude-code", transport: "stdio" });
    await daemon.attachClient({ client_id: "codex-windows", transport: "http" });
    await daemon.attachClient({ client_id: "claude-cowork", transport: "tunnel" });

    const lines = readFileSync(join(workDir, "audit.jsonl"), "utf8").trim().split("\n");
    const profiles = lines
      .map((l) => JSON.parse(l))
      .filter((r) => r.event === "client_profile_attached");
    expect(profiles).toHaveLength(3);

    const claudeCode = profiles.find((p) => p.client_id === "claude-code");
    const codex = profiles.find((p) => p.client_id === "codex-windows");
    const cowork = profiles.find((p) => p.client_id === "claude-cowork");

    expect(claudeCode.transport).toBe("stdio");
    expect(claudeCode.capabilities).toEqual(["resources.read", "tools.call"]);

    expect(codex.transport).toBe("http");
    expect(codex.capabilities).toEqual(["resources.read", "tools.call"]);

    expect(cowork.transport).toBe("tunnel");
    expect(cowork.capabilities).toEqual([
      "resources.read",
      "tools.call",
      "fallback.polling",
    ]);

    for (const p of profiles) {
      expect(new Set(p.capabilities).size).toBe(p.capabilities.length);
    }

    await daemon.shutdown();
  });
});
