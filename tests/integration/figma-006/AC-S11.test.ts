// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S11.
// 3 transport classes — exact capabilities array per class, no duplicates.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-cap-int-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-S11: capability profile flags for 3 client classes", () => {
  it("3 attached clients produce 3 client_profile_attached rows with exact capabilities arrays", async () => {
    const daemon = new Daemon({
      transport: "stdio",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    await daemon.attachClient({ client_id: "claude-code", transport: "stdio" });
    await daemon.attachClient({ client_id: "codex-windows", transport: "http" });
    await daemon.attachClient({ client_id: "claude-cowork", transport: "tunnel" });

    const lines = readFileSync(join(workDir, ".autopus", "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.event === "client_profile_attached");
    expect(lines).toHaveLength(3);

    const cc = lines.find((r) => r.client_id === "claude-code");
    const cx = lines.find((r) => r.client_id === "codex-windows");
    const cw = lines.find((r) => r.client_id === "claude-cowork");

    expect(cc.transport).toBe("stdio");
    expect(cc.capabilities).toEqual(["resources.read", "tools.call"]);

    expect(cx.transport).toBe("http");
    expect(cx.capabilities).toEqual(["resources.read", "tools.call"]);

    expect(cw.transport).toBe("tunnel");
    expect(cw.capabilities).toEqual([
      "resources.read",
      "tools.call",
      "fallback.polling",
    ]);

    for (const r of lines) {
      expect(new Set(r.capabilities).size).toBe(r.capabilities.length);
    }

    await daemon.shutdown();
  });
});
