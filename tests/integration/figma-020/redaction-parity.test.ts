// SPEC-FIGMA-020 T14 — captured-prior redaction parity (S7, REQ-09, REQ-10,
// REQ-11, REQ-18).
//
// A node's prior native annotation labelMarkdown carries a synthetic Slack token
// (xoxb-LEAKEDSECRET) and an absolute path (/Users/reviewer/notes.txt). For the
// COMPOUND `native_annotation_with_card` variant the embedded native captured
// prior is the untrusted secret-bearing surface and MUST be scrubbed on BOTH:
//   - the daemon path (persisted AppliedWrite / autopus://applied_writes), and
//   - the router/HTTP path (WriteResult.undo_descriptor).
//
// Secrets here are synthetic and asserted ABSENT — never a real credential.

import { describe, it, expect } from "vitest";
import { DaemonWriteExtension } from "../../../src/daemon/daemon-write-extension.js";
import { MockPluginBridge } from "../figma-007/__helpers/mock-plugin-bridge.js";
import { WriteRouter } from "../../../packages/write-router/src/index.js";
import { redactRestoreDescriptor } from "../../../packages/write-router/src/redact-restore-descriptor.js";
import type {
  Adapter,
  ManifestEntry,
  UndoDescriptor,
} from "../../../packages/write-router/src/types.js";

const SECRET_TOKEN = "xoxb-LEAKEDSECRET";
const SECRET_PATH = "/Users/reviewer/notes.txt";
const SECRET_LABEL = `reviewer note ${SECRET_TOKEN} see ${SECRET_PATH}`;
const COMPOSITE = "native_annotation_with_card" as const;

function compoundDescriptorWithSecret(): UndoDescriptor {
  return {
    type: "native-with-card",
    native: {
      type: "restore-annotation",
      node_id: "10:1",
      prior: [{ labelMarkdown: SECRET_LABEL }],
    },
    card: { type: "delete-node", node_id: "card-node-1" },
  };
}

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "10:0",
    title: "검색 화면",
    intent: "사용자 인증 게이트",
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
    source_hash: "abc12345",
    write_target: COMPOSITE,
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

describe("S7 daemon path: persisted AppliedWrite carries no captured secret", () => {
  it("the persisted compound undo_descriptor contains neither secret substring", async () => {
    const ext = new DaemonWriteExtension();
    const bridge = new MockPluginBridge();
    ext.attachPluginBridge(bridge as never);

    // dryRun returns Record<string, unknown>; narrow the two string fields the
    // pendingStore lookup and apply call consume.
    const pending = (await ext.dryRun({
      frame_id: "10:0",
      write_target: COMPOSITE,
    })) as { pending_id: string; source_hash_dryrun: string };
    // Inject the captured prior secret into the pending record's compound
    // undo_template native member (models a node whose prior annotation carried
    // an untrusted reviewer secret captured at apply time).
    const record = ext.pendingStore.get(pending.pending_id).record!;
    if (record.undo_template?.type === "native-with-card") {
      record.undo_template.native.prior = [{ labelMarkdown: SECRET_LABEL }];
    } else {
      throw new Error("expected a native-with-card undo_template");
    }

    const applied = await ext.apply({
      pending_id: pending.pending_id,
      source_hash_recomputed: pending.source_hash_dryrun,
    });
    expect("status" in applied && applied.status).toBe("applied");

    // 1. The apply result's own descriptor is scrubbed.
    const resultJson = JSON.stringify(
      (applied as { undo_descriptor: unknown }).undo_descriptor,
    );
    expect(resultJson).not.toContain(SECRET_TOKEN);
    expect(resultJson).not.toContain(SECRET_PATH);

    // 2. The persisted autopus://applied_writes artifact is scrubbed.
    const persisted = ext.readAppliedWrites();
    expect(persisted).toHaveLength(1);
    const persistedJson = JSON.stringify(persisted[0].undo_descriptor);
    expect(persistedJson).not.toContain(SECRET_TOKEN);
    expect(persistedJson).not.toContain(SECRET_PATH);
  });
});

describe("S7 router/HTTP path: WriteResult.undo_descriptor carries no captured secret", () => {
  it("the returned compound undo_descriptor contains neither secret substring", async () => {
    // A composite adapter whose apply returns the compound descriptor with the
    // secret-bearing captured prior. The router seam applies
    // redactRestoreDescriptor (the HTTP route injects exactly this redactor).
    const compositeAdapter: Adapter = {
      async apply() {
        return {
          undo_descriptor: compoundDescriptorWithSecret(),
          node_id: "10:1",
          fallback_used: false,
        };
      },
      async undo() {
        /* noop */
      },
    };
    const router = new WriteRouter({
      adapters: { [COMPOSITE]: compositeAdapter },
      redactRestoreDescriptor,
    });

    const result = await router.apply(makeEntry());
    expect(result.status).toBe("applied");

    const undo = result.undo_descriptor as Extract<
      UndoDescriptor,
      { type: "native-with-card" }
    >;
    expect(undo.type).toBe("native-with-card");
    const undoJson = JSON.stringify(undo);
    expect(undoJson).not.toContain(SECRET_TOKEN);
    expect(undoJson).not.toContain(SECRET_PATH);
    // The card member (a node_id-only delete-node) is preserved verbatim.
    expect(undo.card).toEqual({ type: "delete-node", node_id: "card-node-1" });
  });

  it("redactRestoreDescriptor leaves the card member intact while scrubbing the native prior", () => {
    const out = redactRestoreDescriptor(
      compoundDescriptorWithSecret(),
    ) as Extract<UndoDescriptor, { type: "native-with-card" }>;
    expect(out.native.prior[0].labelMarkdown).not.toContain(SECRET_TOKEN);
    expect(out.native.prior[0].labelMarkdown).not.toContain(SECRET_PATH);
    expect(out.card).toEqual({ type: "delete-node", node_id: "card-node-1" });
  });
});
