import { describe, it, expect } from "vitest";
import {
  WriteRouter,
  AdapterRegistry,
  ERROR_CODES,
  WriteRouterError,
  type Adapter,
  type ManifestEntry,
  type WriteTarget,
  type UndoDescriptor,
} from "../../packages/write-router/src/index.js";
import { KNOWN_TARGETS } from "../../packages/write-router/src/registry.js";

const ALL_TARGETS: WriteTarget[] = [
  "annotation_card",
  "descriptions_page",
  "comment",
  "plugin_data",
  "frame_name",
  "none",
  "native_annotation",
  // SPEC-FIGMA-020 T1 — composite dual-write target widened WriteTarget.
  "native_annotation_with_card",
];

function makeEntry(target: WriteTarget = "annotation_card"): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "로그인",
    intent: "사용자 인증",
    user_value: "PM 진입",
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
    write_target: target,
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
  };
}

describe("AdapterRegistry (REQ-03 / REQ-04 / INV-003)", () => {
  it("default registry contains exactly 8 entries — one per known write_target", () => {
    const reg = new AdapterRegistry();
    expect(reg.size()).toBe(8);
    expect(reg.list().sort()).toEqual([...ALL_TARGETS].sort());
  });

  it("KNOWN_TARGETS equals the eight write_target enum values", () => {
    expect([...KNOWN_TARGETS].sort()).toEqual([...ALL_TARGETS].sort());
  });

  it("resolve returns the adapter registered for that target", () => {
    const sentinel: Adapter = {
      async apply() {
        return { undo_descriptor: { type: "noop" } };
      },
      async undo() {
        /* noop */
      },
    };
    const reg = new AdapterRegistry({ comment: sentinel });
    expect(reg.resolve("comment")).toBe(sentinel);
  });

  it("resolve throws WRITE_TARGET_ROUTING_ERROR for an unknown target", () => {
    const reg = new AdapterRegistry();
    expect(() => reg.resolve("not_a_target" as WriteTarget)).toThrowError(
      WriteRouterError,
    );
  });
});

describe("WriteRouter.apply (REQ-03 / REQ-04 / INV-003)", () => {
  it("rejects unknown write_target with WRITE_TARGET_ROUTING_ERROR", async () => {
    const router = new WriteRouter();
    const entry = makeEntry();
    (entry as { write_target: string }).write_target = "garbage";
    const err = await router.apply(entry as ManifestEntry).catch((e) => e);
    expect(err).toBeInstanceOf(WriteRouterError);
    expect((err as WriteRouterError).code).toBe(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
    );
  });

  it("explicit NotImplemented override propagates the NOT_IMPLEMENTED code", async () => {
    const stub: Adapter = {
      async apply() {
        throw new WriteRouterError(
          ERROR_CODES.NOT_IMPLEMENTED,
          "stub for assertion",
        );
      },
      async undo() {
        throw new WriteRouterError(ERROR_CODES.NOT_IMPLEMENTED, "stub undo");
      },
    };
    const router = new WriteRouter({ adapters: { annotation_card: stub } });
    const err = await router.apply(makeEntry("annotation_card")).catch((e) => e);
    expect(err).toBeInstanceOf(WriteRouterError);
    expect((err as WriteRouterError).code).toBe(ERROR_CODES.NOT_IMPLEMENTED);
  });

  it("dispatches to the adapter registered for the entry's write_target", async () => {
    const calls: WriteTarget[] = [];
    const adapters: Partial<Record<WriteTarget, Adapter>> = {};
    for (const t of ALL_TARGETS) {
      adapters[t] = {
        async apply(entry) {
          calls.push(entry.write_target);
          return { undo_descriptor: { type: "noop" } };
        },
        async undo() {
          /* noop */
        },
      };
    }
    const router = new WriteRouter({ adapters });
    await router.apply(makeEntry("annotation_card"));
    await router.apply(makeEntry("comment"));
    await router.apply(makeEntry("none"));
    expect(calls).toEqual(["annotation_card", "comment", "none"]);
  });

  it("registers undo descriptor in the undo log and clears it after undo", async () => {
    const sentinel: UndoDescriptor = {
      type: "delete-node",
      node_id: "node-1",
    };
    const adapter: Adapter = {
      async apply() {
        return { undo_descriptor: sentinel };
      },
      async undo() {
        /* noop */
      },
    };
    const router = new WriteRouter({
      adapters: { annotation_card: adapter },
    });
    const result = await router.apply(makeEntry("annotation_card"));
    expect(result.status).toBe("applied");
    expect(result.undo_descriptor).toEqual(sentinel);
    expect(router.hasUndoEntry(result.write_id)).toBe(true);
    await router.undo(result.write_id);
    expect(router.hasUndoEntry(result.write_id)).toBe(false);
  });

  it("MANIFEST_INVALID is thrown when constructed with valid:false", async () => {
    const router = new WriteRouter({ valid: false });
    const err = await router.apply(makeEntry()).catch((e) => e);
    expect((err as WriteRouterError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
  });
});
