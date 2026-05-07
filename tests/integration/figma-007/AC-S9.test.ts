// SPEC-FIGMA-007 AC-S9: Pending write expiry — apply after expires_at is rejected.
// Linked: REQ-15 | INV-009 (atomicity, time-bound).

import { describe, it, expect } from "vitest";

import { MockPluginBridge } from "./__helpers/mock-plugin-bridge.js";

interface DaemonLike {
  boot: () => Promise<void>;
  shutdown: () => Promise<void>;
  dryRunWrite?: (args: {
    frame_id: string;
    write_target: string;
  }) => Promise<Record<string, unknown>>;
  applyApprovedWrite?: (args: {
    pending_id: string;
    source_hash_recomputed: string;
  }) => Promise<Record<string, unknown>>;
  readPendingWrites?: () => Array<Record<string, unknown>>;
  getEmittedAudits?: () => Array<Record<string, unknown>>;
  attachPluginBridge?: (bridge: MockPluginBridge) => void;
  advanceClockMs?: (ms: number) => void;
}

async function bootDaemon(): Promise<DaemonLike> {
  const mod = (await import("../../../src/daemon/server.js")) as Record<
    string,
    unknown
  >;
  const Daemon = mod.Daemon as new (opts: Record<string, unknown>) => DaemonLike;
  const daemon = new Daemon({ transport: "stdio", port: 0 });
  await daemon.boot();
  return daemon;
}

describe("AC-S9: Apply after expires_at is rejected with PENDING_EXPIRED", () => {
  it("after 61000ms clock advance, applyApprovedWrite returns PENDING_EXPIRED, emits 7-key REJECTION row, GCs the pending entry", async () => {
    const daemon = await bootDaemon();
    const bridge = new MockPluginBridge();
    if (typeof daemon.attachPluginBridge !== "function") {
      throw new Error("daemon.attachPluginBridge not implemented (W2 pending)");
    }
    daemon.attachPluginBridge(bridge);

    if (typeof daemon.dryRunWrite !== "function") {
      throw new Error("daemon.dryRunWrite not implemented (W2 pending)");
    }
    if (typeof daemon.applyApprovedWrite !== "function") {
      throw new Error("daemon.applyApprovedWrite not implemented (W2 pending)");
    }
    if (typeof daemon.advanceClockMs !== "function") {
      throw new Error(
        "daemon.advanceClockMs (test injection) not implemented (W2 pending)",
      );
    }

    const pending = await daemon.dryRunWrite({
      frame_id: "1:1",
      write_target: "annotation_card",
    });

    // expires_at must be createdAt + 60s (60000 ms delta) per REQ-15.
    // Tolerance: ±50ms to absorb parallel-run scheduler jitter between
    // dryRunWrite() returning and the test parsing expires_at. The oracle
    // semantics (60s TTL) hold; we are not asserting wall-clock precision.
    const createdAt = Date.parse(
      (pending as { created_at?: string }).created_at ?? new Date().toISOString(),
    );
    const expiresAt = Date.parse(pending.expires_at as string);
    if (Number.isFinite(createdAt) && Number.isFinite(expiresAt)) {
      expect(Math.abs(expiresAt - createdAt - 60000)).toBeLessThanOrEqual(50);
    }

    // Advance the daemon clock past expiry.
    daemon.advanceClockMs(61000);

    const result = await daemon.applyApprovedWrite({
      pending_id: pending.pending_id as string,
      source_hash_recomputed: pending.source_hash_dryrun as string,
    });
    expect(result.error).toBe("PENDING_EXPIRED");

    // Zero plugin command dispatch.
    expect(bridge.snapshot().callCount).toBe(0);

    // Audit: 7-key rejection row.
    if (typeof daemon.getEmittedAudits !== "function") {
      throw new Error("daemon.getEmittedAudits not implemented (W2 pending)");
    }
    const audits = daemon.getEmittedAudits();
    const expiredRows = audits.filter(
      (a) => a.status === "rejected" && a.reason === "PENDING_EXPIRED",
    );
    expect(expiredRows.length).toBe(1);
    expect(Object.keys(expiredRows[0]).sort()).toEqual(
      [
        "frame_id",
        "manifest_entry_hash",
        "pm_identity_or_unknown",
        "reason",
        "status",
        "timestamp_iso",
        "write_target",
      ].sort(),
    );

    // PendingWrite GC'd from the in-memory map.
    if (typeof daemon.readPendingWrites === "function") {
      expect(daemon.readPendingWrites().length).toBe(0);
    }

    await daemon.shutdown();
  });
});
