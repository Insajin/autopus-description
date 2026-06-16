// SPEC-FIGMA-007 AC-S1: dryRun MCP tool produces PendingWrite with concrete shape.
// Linked: REQ-01, REQ-02, REQ-03 | INV-009 atomicity (dryRun gate 진입).
//
// RED scaffold — will GREEN once W2 lands the daemon dryRun tool +
// `autopus://pending_writes` resource and W3 lands the plugin status panel.

import { describe, it, expect } from "vitest";

describe("AC-S1: dryRun MCP tool produces PendingWrite with concrete shape", () => {
  it("daemon.dryRunWrite returns a 7-key PendingWrite for frame 1:1 with valid hash regex", async () => {
    const mod = (await import("../../../src/daemon/server.js")) as Record<
      string,
      unknown
    >;
    const Daemon = mod.Daemon as new (opts: Record<string, unknown>) => {
      boot: () => Promise<void>;
      shutdown: () => Promise<void>;
      dryRunWrite?: (args: {
        frame_id: string;
        write_target: string;
      }) => Promise<Record<string, unknown>>;
    };
    const daemon = new Daemon({ transport: "stdio", port: 0 });
    await daemon.boot();

    if (typeof daemon.dryRunWrite !== "function") {
      throw new Error(
        "daemon.dryRunWrite not implemented — REQ-02 W2 phase still pending",
      );
    }

    const response = await daemon.dryRunWrite({
      frame_id: "1:1",
      write_target: "annotation_card",
    });

    // 7-key set equality (REQ-02 contract).
    expect(Object.keys(response).sort()).toEqual(
      [
        "expires_at",
        "frame_id",
        "manifest_entry_hash",
        "pending_id",
        "plugin_commands",
        "source_hash_dryrun",
        "write_target",
      ].sort(),
    );

    // Field-level oracle assertions.
    expect(response.pending_id).toMatch(/^pw-[a-z0-9]{8,}-\d+$/);
    expect(response.manifest_entry_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.source_hash_dryrun).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(response.plugin_commands)).toBe(true);
    expect((response.plugin_commands as unknown[]).length).toBeGreaterThanOrEqual(
      1,
    );

    const allowedOps = [
      // SPEC-FIGMA-022 — annotation_card emits the renamed card op.
      "set_annotation_card",
      "upsert_descriptions_page_node",
      "post_comment",
      "set_plugin_data",
      "set_frame_name",
      "noop",
    ];
    for (const cmd of response.plugin_commands as Array<
      Record<string, unknown>
    >) {
      expect(Object.keys(cmd).sort()).toEqual(["args", "op"].sort());
      expect(allowedOps).toContain(cmd.op as string);
    }

    await daemon.shutdown();
  });

  it("autopus://pending_writes MCP resource holds exactly 1 entry byte-equal to the dryRunWrite response", async () => {
    const mod = (await import("../../../src/daemon/server.js")) as Record<
      string,
      unknown
    >;
    const Daemon = mod.Daemon as new (opts: Record<string, unknown>) => {
      boot: () => Promise<void>;
      shutdown: () => Promise<void>;
      dryRunWrite?: (args: {
        frame_id: string;
        write_target: string;
      }) => Promise<Record<string, unknown>>;
      readPendingWrites?: () => Array<Record<string, unknown>>;
    };
    const daemon = new Daemon({ transport: "stdio", port: 0 });
    await daemon.boot();
    if (typeof daemon.dryRunWrite !== "function") {
      throw new Error("daemon.dryRunWrite not implemented yet (W2 pending)");
    }
    const pending = await daemon.dryRunWrite({
      frame_id: "1:1",
      write_target: "annotation_card",
    });

    if (typeof daemon.readPendingWrites !== "function") {
      throw new Error(
        "daemon.readPendingWrites (autopus://pending_writes) not implemented yet (W2 pending)",
      );
    }
    const list = daemon.readPendingWrites();
    expect(list.length).toBe(1);

    const stableA = JSON.stringify(pending, Object.keys(pending).sort());
    const stableB = JSON.stringify(list[0], Object.keys(list[0]).sort());
    expect(stableA).toBe(stableB);

    await daemon.shutdown();
  });
});
