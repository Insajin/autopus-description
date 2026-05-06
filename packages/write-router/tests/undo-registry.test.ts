import { describe, it, expect } from "vitest";
import { UndoRegistry } from "../src/undo-registry.js";
import type {
  ManifestEntry,
  UndoDescriptor,
} from "../src/types.js";

function entry(): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "로그인",
    intent: "사용자 인증",
    user_value: "PM",
    success_criteria: "5초",
    states: [],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "abcd1234",
    write_target: "annotation_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
  };
}

describe("UndoRegistry (REQ-08 / REQ-NFR-02 / INV-002)", () => {
  it("registers and retrieves a record by write_id", () => {
    const reg = new UndoRegistry();
    const desc: UndoDescriptor = { type: "delete-node", node_id: "n-1" };
    reg.register({
      write_id: "wr-1",
      target: "annotation_card",
      entry: entry(),
      descriptor: desc,
      timestamp_iso: "2026-05-06T12:00:00Z",
      fallback_used: false,
    });
    expect(reg.has("wr-1")).toBe(true);
    expect(reg.get("wr-1")?.descriptor).toEqual(desc);
    expect(reg.size()).toBe(1);
  });

  it("rejects duplicate write_id registration", () => {
    const reg = new UndoRegistry();
    const rec = {
      write_id: "wr-1",
      target: "annotation_card" as const,
      entry: entry(),
      descriptor: { type: "delete-node" as const, node_id: "n-1" },
      timestamp_iso: "2026-05-06T12:00:00Z",
      fallback_used: false,
    };
    reg.register(rec);
    expect(() => reg.register(rec)).toThrow(/duplicate write_id/);
  });

  it("remove deletes the record and updates size", () => {
    const reg = new UndoRegistry();
    reg.register({
      write_id: "wr-1",
      target: "annotation_card",
      entry: entry(),
      descriptor: { type: "delete-node", node_id: "n-1" },
      timestamp_iso: "2026-05-06T12:00:00Z",
      fallback_used: false,
    });
    const removed = reg.remove("wr-1");
    expect(removed?.write_id).toBe("wr-1");
    expect(reg.has("wr-1")).toBe(false);
    expect(reg.size()).toBe(0);
  });

  it("remove of unknown write_id returns undefined", () => {
    const reg = new UndoRegistry();
    expect(reg.remove("nope")).toBeUndefined();
  });

  it("lastWriteId returns the most recently registered write_id", () => {
    const reg = new UndoRegistry();
    reg.register({
      write_id: "wr-1",
      target: "annotation_card",
      entry: entry(),
      descriptor: { type: "delete-node", node_id: "n-1" },
      timestamp_iso: "2026-05-06T12:00:00Z",
      fallback_used: false,
    });
    reg.register({
      write_id: "wr-2",
      target: "comment",
      entry: entry(),
      descriptor: { type: "delete-comment", comment_id: "c-1" },
      timestamp_iso: "2026-05-06T12:00:01Z",
      fallback_used: false,
    });
    expect(reg.lastWriteId()).toBe("wr-2");
    reg.remove("wr-2");
    expect(reg.lastWriteId()).toBe("wr-1");
    reg.remove("wr-1");
    expect(reg.lastWriteId()).toBeNull();
  });

  it("clear empties the registry", () => {
    const reg = new UndoRegistry();
    reg.register({
      write_id: "wr-1",
      target: "annotation_card",
      entry: entry(),
      descriptor: { type: "delete-node", node_id: "n-1" },
      timestamp_iso: "2026-05-06T12:00:00Z",
      fallback_used: false,
    });
    reg.clear();
    expect(reg.size()).toBe(0);
    expect(reg.lastWriteId()).toBeNull();
  });
});
