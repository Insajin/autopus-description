/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T11.
 *
 * REQ-03, REQ-08, REQ-11, NFR-01: default-safe binding (no --tunnel flag).
 *
 * [NEW] surfaces:
 *   - Daemon.startWithFlags({transport, tunnel?: false}) → boot result with
 *     listeningSockets[] (loopback only) and stdout opsec_default_safe line.
 *   - PluginStatusStripPort.current() === "tunnel: off"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";
import { PluginStatusStripPort } from "../../../src/daemon/plugin-port.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t11-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T11 default-safe binding (no --tunnel flag)", () => {
  it("Test_DaemonStart_NoTunnelFlag_PrintsDefaultSafeLine_ZeroNonLoopback_StripOff", async () => {
    const daemon = new Daemon({
      transport: "http",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    const statusStrip = new PluginStatusStripPort();
    daemon.attachStatusStrip(statusStrip);

    const stdoutLines: string[] = [];
    // [NEW] startWithFlags returns sockets info + captures stdout JSON lines.
    const result = await daemon.startWithFlags({
      transport: "http",
      tunnel: false,
      port: 0,
      stdoutSink: (l: string) => stdoutLines.push(l),
    });

    const safeLine = stdoutLines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((o) => o && o.event === "opsec_default_safe");
    expect(safeLine).toHaveLength(1);
    expect(safeLine[0].tunnel).toBe(false);

    // Listening sockets — at most 2, all loopback.
    expect(result.listeningSockets.length).toBeLessThanOrEqual(2);
    for (const s of result.listeningSockets) {
      expect(["127.0.0.1", "::1"]).toContain(s.address);
    }
    const nonLoopback = result.listeningSockets.filter(
      (s) => s.address !== "127.0.0.1" && s.address !== "::1",
    );
    expect(nonLoopback).toHaveLength(0);

    // No cloudflared spawn.
    expect(result.cloudflaredSpawnCount).toBe(0);

    // Status strip default off.
    expect(statusStrip.current()).toBe("tunnel: off");

    await daemon.shutdown();
  });
});
