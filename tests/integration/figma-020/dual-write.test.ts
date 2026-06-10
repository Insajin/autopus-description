// SPEC-FIGMA-020 T14 — composite dual-write at the daemon dispatch level
// (S4 + S5, REQ-02, REQ-07, REQ-08).
//
// Exercises applyApprovedWrite / undoWrite through the DaemonWriteExtension with
// the MockPluginBridge: the composite apply dispatches the native op THEN exactly
// one set_policy_card op in order; one undo reverses both surfaces; a card-step
// failure leaves the native annotation committed and surfaces the card as
// retryable (the native op is NOT rolled back).

import { describe, it, expect } from "vitest";
import { DaemonWriteExtension } from "../../../src/daemon/daemon-write-extension.js";
import { MockPluginBridge } from "../figma-007/__helpers/mock-plugin-bridge.js";

const COMPOSITE = "native_annotation_with_card" as const;

async function dryRunAndApply(
  ext: DaemonWriteExtension,
  bridge: MockPluginBridge,
) {
  ext.attachPluginBridge(bridge as never);
  // dryRun returns Record<string, unknown>; narrow the two fields the apply
  // call consumes (both strings on the pending record) to string.
  const pending = (await ext.dryRun({
    frame_id: "10:0",
    write_target: COMPOSITE,
  })) as { pending_id: string; source_hash_dryrun: string };
  const applied = await ext.apply({
    pending_id: pending.pending_id,
    source_hash_recomputed: pending.source_hash_dryrun,
  });
  return { pending, applied };
}

describe("S5: composite apply dispatches native then card in order", () => {
  it("dispatches exactly one set_native_annotation then exactly one set_policy_card", async () => {
    const ext = new DaemonWriteExtension();
    const bridge = new MockPluginBridge();
    const { applied } = await dryRunAndApply(ext, bridge);

    expect("status" in applied && applied.status).toBe("applied");
    const ops = bridge.dispatched.map((d) => d.command.op);
    expect(ops).toEqual(["set_native_annotation", "set_policy_card"]);
    // Native dispatched strictly before the card op.
    const nativeAt = bridge.dispatched.find(
      (d) => d.command.op === "set_native_annotation",
    )!.at;
    const cardAt = bridge.dispatched.find(
      (d) => d.command.op === "set_policy_card",
    )!.at;
    expect(nativeAt).toBeLessThanOrEqual(cardAt);
  });

  it("one undo reverses BOTH surfaces (card delete-node then native restore)", async () => {
    const ext = new DaemonWriteExtension();
    const bridge = new MockPluginBridge();
    const { applied } = await dryRunAndApply(ext, bridge);
    const writeId = (applied as { write_id: string }).write_id;

    const before = bridge.dispatched.length;
    const undo = await ext.undo({ write_id: writeId });
    // Narrow the UndoResult union to its success member before asserting the
    // real undone path (the error member { error: "UNKNOWN_WRITE_ID" } has no
    // `status` field).
    expect("status" in undo && undo.status).toBe("undone");

    // The compound undo dispatched the ordered inverse pair: card delete-node
    // FIRST, then the native restore-annotation surface (REQ-08).
    const inverseOps = bridge.dispatched
      .slice(before)
      .map((d) => d.command.op);
    expect(inverseOps[0]).toBe("delete_node");
    expect(inverseOps).toHaveLength(2);

    // The undo registry entry is cleared after a single undo invocation.
    expect(ext.hasUndoEntry(writeId)).toBe(false);
  });
});

describe("S4: card-step failure keeps native applied + card retryable", () => {
  it("native op committed, card op failed → status applied with card_retryable, no rollback of native", async () => {
    const ext = new DaemonWriteExtension();
    // Responder fails ONLY the set_policy_card op; the native op succeeds.
    const bridge = new MockPluginBridge({
      responder: (cmd) =>
        cmd.op === "set_policy_card"
          ? { ok: false, error: "card_render_failed" }
          : { ok: true, node_ids: ["10:1"] },
    });
    const { applied } = await dryRunAndApply(ext, bridge);

    // The native op committed; the apply still reports applied (not partial-fail).
    expect("status" in applied && applied.status).toBe("applied");
    const result = applied as {
      status: string;
      card_retryable?: { op: string; error: string };
      undo_descriptor: { type: string };
    };
    // The card op is surfaced as retryable, not reported as a reverted native.
    expect(result.card_retryable).toEqual({
      op: "set_policy_card",
      error: "card_render_failed",
    });
    // Persisted descriptor is downgraded to the native-only flat restore (no
    // card node to delete on undo).
    expect(result.undo_descriptor.type).toBe("restore-annotation");

    // The native op was dispatched and NOT rolled back: the bridge saw the
    // native op succeed and the card op fail, with no inverse dispatched.
    const ops = bridge.dispatched.map((d) => d.command.op);
    expect(ops).toEqual(["set_native_annotation", "set_policy_card"]);
    expect(ops).not.toContain("delete_node");

    // The applied-writes artifact records the native-only descriptor.
    const persisted = ext.readAppliedWrites();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].undo_descriptor.type).toBe("restore-annotation");
  });
});
