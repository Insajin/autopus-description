// SPEC-FIGMA-007 W2 unit test — PendingWriteStore behavior contract.
// Linked: REQ-02, REQ-15 | INV-009 (atomicity, time-bound).

import { describe, it, expect } from "vitest";

import {
  PendingWriteStore,
  DEFAULT_TTL_MS,
} from "../../src/daemon/pending-writes.js";
import type { PluginCommand } from "../../packages/write-router/src/plan-emit/types.js";

const COMMAND_FIXTURE: PluginCommand = {
  op: "set_annotation",
  args: { node_id: "1:1", text: "primary CTA" },
};

function makeStore(now = () => 1_700_000_000_000) {
  return new PendingWriteStore({ now });
}

describe("PendingWriteStore — REQ-02 / REQ-15 contract", () => {
  it("put returns a 7-key serializable record and stores by pending_id", () => {
    const store = makeStore();
    const rec = store.put({
      manifest_entry_hash: "a".repeat(64),
      source_hash_dryrun: "b".repeat(64),
      plugin_commands: [COMMAND_FIXTURE],
      frame_id: "1:1",
      write_target: "annotation_card",
    });
    expect(rec.pending_id).toMatch(/^pw-[a-z0-9]+-\d+$/);
    expect(rec.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const list = store.list();
    expect(list.length).toBe(1);
    expect(Object.keys(list[0]).sort()).toEqual(
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
  });

  it("expires_at = createdAt + 60s (DEFAULT_TTL_MS)", () => {
    const baseNow = 1_700_000_000_000;
    const store = makeStore(() => baseNow);
    const rec = store.put({
      manifest_entry_hash: "a".repeat(64),
      source_hash_dryrun: "b".repeat(64),
      plugin_commands: [COMMAND_FIXTURE],
      frame_id: "1:1",
      write_target: "annotation_card",
    });
    const expiresAt = Date.parse(rec.expires_at);
    expect(expiresAt - baseNow).toBe(DEFAULT_TTL_MS);
    expect(DEFAULT_TTL_MS).toBe(60_000);
  });

  it("get after advanceMs(60001) returns expired=true and removes the record", () => {
    const store = makeStore();
    const rec = store.put({
      manifest_entry_hash: "a".repeat(64),
      source_hash_dryrun: "b".repeat(64),
      plugin_commands: [COMMAND_FIXTURE],
      frame_id: "1:1",
      write_target: "annotation_card",
    });
    store.advanceMs(60_001);
    const r = store.get(rec.pending_id);
    expect(r.record).toBeNull();
    expect(r.expired).toBe(true);
    expect(store.size()).toBe(0);
  });

  it("get on unknown pending_id returns expired=false (distinct from expired)", () => {
    const store = makeStore();
    const r = store.get("pw-missing-1");
    expect(r.record).toBeNull();
    expect(r.expired).toBe(false);
  });

  it("remove deletes the record so subsequent get returns null", () => {
    const store = makeStore();
    const rec = store.put({
      manifest_entry_hash: "a".repeat(64),
      source_hash_dryrun: "b".repeat(64),
      plugin_commands: [COMMAND_FIXTURE],
      frame_id: "1:1",
      write_target: "annotation_card",
    });
    store.remove(rec.pending_id);
    expect(store.get(rec.pending_id).record).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("gc removes expired entries proactively", () => {
    const store = makeStore();
    store.put({
      manifest_entry_hash: "a".repeat(64),
      source_hash_dryrun: "b".repeat(64),
      plugin_commands: [COMMAND_FIXTURE],
      frame_id: "1:1",
      write_target: "annotation_card",
    });
    store.put({
      manifest_entry_hash: "c".repeat(64),
      source_hash_dryrun: "d".repeat(64),
      plugin_commands: [COMMAND_FIXTURE],
      frame_id: "1:2",
      write_target: "annotation_card",
    });
    expect(store.size()).toBe(2);
    store.advanceMs(60_001);
    const removed = store.gc();
    expect(removed).toBe(2);
    expect(store.size()).toBe(0);
  });
});
