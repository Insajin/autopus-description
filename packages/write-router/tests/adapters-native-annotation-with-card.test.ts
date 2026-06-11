// SPEC-FIGMA-020 T14 — composite adapter oracle (S4, S5, REQ-01, REQ-02,
// REQ-07, REQ-08).
//
// `applyNativeAnnotationWithCard` delivers BOTH surfaces in one apply (native
// annotation first, authoritative; policy card second). The compound undo
// reverses both surfaces with a single descriptor (card delete-node first, then
// native restore-annotation). The mock-figma client extends the sibling native
// test's mock with the card surface the adapter type-narrows.

import { describe, it, expect, vi } from "vitest";
import {
  applyNativeAnnotationWithCard,
  undoNativeAnnotationWithCard,
} from "../src/adapters/native-annotation-with-card.js";
import type {
  AreaAnnotation,
  ManifestEntry,
  UndoDescriptor,
} from "../src/types.js";

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
    write_target: "native_annotation_with_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

const oneArea: AreaAnnotation[] = [
  {
    area_id: "1",
    title: "결과",
    target_area: "결과 리스트",
    description: "검색 결과를 표시한다",
  },
];

// Combined mock: the native surface (scan/getAnnotations/setAnnotation, mutating
// an in-memory annotations map so we can observe roll-forward/roll-back) PLUS the
// card surface (createPolicyCard/deleteNode). `cardId` is the node id returned by
// createPolicyCard. `failCard` forces the card op to throw at the bridge (S4).
function makeMockClient(opts: {
  cardId?: string;
  failCard?: boolean;
  priorByNode?: Record<string, Array<{ labelMarkdown: string }>>;
  scanNodes?: Array<{ id: string; name: string }>;
} = {}) {
  const annotations: Record<string, Array<{ labelMarkdown: string }>> = {
    ...(opts.priorByNode ?? {}),
  };
  const createdCardNodes: string[] = [];
  const deletedNodes: string[] = [];
  return {
    annotations,
    createdCardNodes,
    deletedNodes,
    scan: vi.fn(async () => ({
      nodes: opts.scanNodes ?? [{ id: "10:1", name: "결과 리스트" }],
    })),
    getAnnotations: vi.fn(async ({ nodeId }: { nodeId: string }) => ({
      annotations: annotations[nodeId] ?? [],
    })),
    setAnnotation: vi.fn(
      async ({ nodeId, labelMarkdown }: { nodeId: string; labelMarkdown: string }) => {
        annotations[nodeId] = [{ labelMarkdown }];
        return { success: true, nodeId, annotations: annotations[nodeId] };
      },
    ),
    createPolicyCard: vi.fn(async () => {
      if (opts.failCard) {
        throw new Error("card_bridge_failed");
      }
      const nodeId = opts.cardId ?? "card-node-1";
      createdCardNodes.push(nodeId);
      return { nodeId };
    }),
    deleteNode: vi.fn(async ({ node_id }: { node_id: string }) => {
      deletedNodes.push(node_id);
    }),
  };
}

describe("composite adapter — apply both surfaces (S5)", () => {
  it("applies the native annotation FIRST then creates the policy card", async () => {
    const client = makeMockClient({ cardId: "card-node-1" });
    const result = await applyNativeAnnotationWithCard(
      makeEntry({ frame_id: "10:0", area_annotations: oneArea }),
      { figma: client },
    );

    // Native surface committed: the annotated node carries the generated label.
    expect(client.setAnnotation).toHaveBeenCalledTimes(1);
    expect(client.annotations["10:1"][0].labelMarkdown).toContain(
      "검색 결과를 표시한다",
    );
    // Card surface committed.
    expect(client.createPolicyCard).toHaveBeenCalledTimes(1);
    expect(client.createdCardNodes).toEqual(["card-node-1"]);

    // Native MUST be ordered before the card (REQ-07 authoritative-first).
    const nativeOrder = client.setAnnotation.mock.invocationCallOrder[0];
    const cardOrder = client.createPolicyCard.mock.invocationCallOrder[0];
    expect(nativeOrder).toBeLessThan(cardOrder);

    // Compound descriptor reverses both surfaces.
    const undo = result.undo_descriptor as Extract<
      UndoDescriptor,
      { type: "native-with-card" }
    >;
    expect(undo.type).toBe("native-with-card");
    expect(undo.natives).toHaveLength(1);
    expect(undo.natives[0].type).toBe("restore-annotation");
    expect(undo.card).toEqual({ type: "delete-node", node_id: "card-node-1" });
  });
});

describe("composite adapter — one compound undo reverses both surfaces (S5)", () => {
  it("undo deletes the card node and restores the empty prior native state (structural no-op)", async () => {
    // Prior native state on '10:1' was empty → the captured restore-annotation
    // prior is []; per SPEC-FIGMA-018 S6 an empty prior makes the native restore
    // a structural no-op (no annotation is written back).
    const client = makeMockClient({
      cardId: "card-node-1",
      priorByNode: { "10:1": [] },
    });
    const applyResult = await applyNativeAnnotationWithCard(
      makeEntry({ frame_id: "10:0", area_annotations: oneArea }),
      { figma: client },
    );
    const undo = applyResult.undo_descriptor as Extract<
      UndoDescriptor,
      { type: "native-with-card" }
    >;
    // The captured native prior is the empty prior the node held before apply.
    expect(undo.natives[0].prior).toEqual([]);
    // After apply the node carries the generated annotation (one setAnnotation).
    expect(client.setAnnotation).toHaveBeenCalledTimes(1);

    // ONE compound undo invocation reverses both surfaces (no second call).
    await undoNativeAnnotationWithCard(applyResult.undo_descriptor, {
      figma: client,
    });

    // Card node card-node-1 deleted.
    expect(client.deleteNode).toHaveBeenCalledTimes(1);
    expect(client.deletedNodes).toEqual(["card-node-1"]);

    // Empty-prior native restore is a structural no-op: undo issues NO further
    // setAnnotation write (the apply-time call remains the only one).
    expect(client.setAnnotation).toHaveBeenCalledTimes(1);
  });

  it("undo with a non-empty captured prior writes the prior annotation back verbatim", async () => {
    // A node whose prior carried a manual reviewer note → undo restores it.
    const client = makeMockClient({
      cardId: "card-node-2",
      priorByNode: { "10:1": [{ labelMarkdown: "manual reviewer note" }] },
    });
    const applyResult = await applyNativeAnnotationWithCard(
      makeEntry({ frame_id: "10:0", area_annotations: oneArea }),
      { figma: client },
    );
    await undoNativeAnnotationWithCard(applyResult.undo_descriptor, {
      figma: client,
    });

    // Card deleted FIRST, then the native prior written back (REQ-08 ordering).
    const deleteOrder = client.deleteNode.mock.invocationCallOrder[0];
    const restoreOrder = client.setAnnotation.mock.invocationCallOrder.at(-1)!;
    expect(deleteOrder).toBeLessThan(restoreOrder);
    // The node's annotation is the restored manual note.
    expect(client.annotations["10:1"]).toEqual([
      { labelMarkdown: "manual reviewer note" },
    ]);
  });
});

describe("composite adapter — card-step failure keeps the native annotation (S4)", () => {
  it("propagates the card failure AFTER the native annotation is committed and no card node is created", async () => {
    const client = makeMockClient({ failCard: true, priorByNode: { "10:1": [] } });
    await expect(
      applyNativeAnnotationWithCard(
        makeEntry({ frame_id: "10:0", area_annotations: oneArea }),
        { figma: client },
      ),
    ).rejects.toThrow(/card_bridge_failed/);

    // Native annotation IS present and was NOT rolled back by the adapter.
    expect(client.setAnnotation).toHaveBeenCalledTimes(1);
    expect(client.annotations["10:1"]).toHaveLength(1);
    expect(client.annotations["10:1"][0].labelMarkdown).toContain(
      "검색 결과를 표시한다",
    );

    // No policy card node was created (card surface absent).
    expect(client.createdCardNodes).toEqual([]);
    // The adapter did not delete the native node in response to the failure.
    expect(client.deleteNode).not.toHaveBeenCalled();
  });
});

describe("composite adapter — undo descriptor guard", () => {
  it("undo rejects a non-compound descriptor", async () => {
    const client = makeMockClient();
    await expect(
      undoNativeAnnotationWithCard(
        { type: "delete-node", node_id: "x" },
        { figma: client },
      ),
    ).rejects.toThrow();
  });
});

describe("composite adapter — native idempotent-skip propagates status_code (S5)", () => {
  it("surfaces the native IDEMPOTENT_SKIP status_code on the composite result", async () => {
    // First apply against an empty-prior node to learn the exact label the
    // native surface writes, then seed that same label as the prior so the
    // native adapter's idempotent-skip fires and sets status_code — exercising
    // the composite's `if (nativeResult.status_code)` propagation branch.
    const probe = makeMockClient({ cardId: "card-probe", priorByNode: { "10:1": [] } });
    await applyNativeAnnotationWithCard(
      makeEntry({ frame_id: "10:0", area_annotations: oneArea }),
      { figma: probe },
    );
    const writtenLabel = probe.annotations["10:1"][0].labelMarkdown;

    const client = makeMockClient({
      cardId: "card-node-skip",
      priorByNode: { "10:1": [{ labelMarkdown: writtenLabel }] },
    });
    const result = await applyNativeAnnotationWithCard(
      makeEntry({ frame_id: "10:0", area_annotations: oneArea }),
      { figma: client },
    );

    // Native surface recognized the prior as already-applied → no re-write.
    expect(client.setAnnotation).not.toHaveBeenCalled();
    // The composite forwards the native skip status.
    expect(result.status_code).toBe("IDEMPOTENT_SKIP");
    // The card surface is still additive and was created.
    expect(client.createdCardNodes).toEqual(["card-node-skip"]);
  });
});

describe("composite adapter — card client validation (asCardClient guards)", () => {
  // The native surface (scan/getAnnotations/setAnnotation) is satisfied, but the
  // card surface methods are absent — so asCardClient throws AFTER the native
  // annotation is composed. These cover the two MCP_PERMISSION_ERROR guard arms.
  function makeNativeOnlyClient() {
    const annotations: Record<string, Array<{ labelMarkdown: string }>> = {
      "10:1": [],
    };
    return {
      scan: vi.fn(async () => ({ nodes: [{ id: "10:1", name: "결과 리스트" }] })),
      getAnnotations: vi.fn(async ({ nodeId }: { nodeId: string }) => ({
        annotations: annotations[nodeId] ?? [],
      })),
      setAnnotation: vi.fn(
        async ({ nodeId, labelMarkdown }: { nodeId: string; labelMarkdown: string }) => {
          annotations[nodeId] = [{ labelMarkdown }];
          return { success: true, nodeId, annotations: annotations[nodeId] };
        },
      ),
    };
  }

  it("apply rejects with a permission error when the figma client is missing card methods", async () => {
    const client = makeNativeOnlyClient();
    await expect(
      applyNativeAnnotationWithCard(
        makeEntry({ frame_id: "10:0", area_annotations: oneArea }),
        { figma: client },
      ),
    ).rejects.toThrow(/missing required card methods/);
  });

  it("undo rejects with a permission error when the figma client is missing card methods", async () => {
    const client = makeNativeOnlyClient();
    await expect(
      undoNativeAnnotationWithCard(
        {
          type: "native-with-card",
          natives: [{ type: "restore-annotation", node_id: "10:1", prior: [] }],
          card: { type: "delete-node", node_id: "card-x" },
        },
        { figma: client },
      ),
    ).rejects.toThrow(/missing required card methods/);
  });

  it("undo rejects with a permission error when the figma client is not an object", async () => {
    await expect(
      undoNativeAnnotationWithCard(
        {
          type: "native-with-card",
          natives: [{ type: "restore-annotation", node_id: "10:1", prior: [] }],
          card: { type: "delete-node", node_id: "card-x" },
        },
        { figma: null as unknown as object },
      ),
    ).rejects.toThrow(/requires a connected Figma write client/);
  });
});
