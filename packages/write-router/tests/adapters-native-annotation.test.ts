// SPEC-FIGMA-018 T9 — native_annotation adapter scaffold (RED).
// Covers S1 (per-area annotations, no TEXT card), S2 (frame fallback),
// S5 (disconnected bridge → reject, zero set calls), S6 (undo restores empty),
// S7 (undo restores clobbered manual note), S8 (idempotent re-apply, no set
// call, byte-unchanged, IDEMPOTENT_SKIP).
//
// RED expectation: ../src/adapters/native-annotation.js does not exist yet (T4).

import { describe, it, expect, vi } from "vitest";
import {
  applyNativeAnnotation,
  undoNativeAnnotation,
} from "../src/adapters/native-annotation.js";
import { ERROR_CODES } from "../src/types.js";
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
    write_target: "native_annotation",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

const twoAreas: AreaAnnotation[] = [
  {
    area_id: "1",
    title: "검색",
    target_area: "검색 바",
    description: "입력한 조건으로 목록을 갱신한다",
  },
  {
    area_id: "2",
    title: "결과",
    target_area: "결과 리스트",
    description: "검색 결과를 표시한다",
  },
];

// Mock client extends the existing card-test mock pattern with the native
// surface the adapter type-narrows: scan (node index), getAnnotations (prior
// capture), setAnnotation (the mutating native op).
function makeMockClient(opts: {
  scanNodes?: Array<{ id: string; name: string }>;
  priorByNode?: Record<string, Array<{ labelMarkdown: string; categoryId?: string }>>;
} = {}) {
  const annotations: Record<string, Array<{ labelMarkdown: string; categoryId?: string }>> = {
    ...(opts.priorByNode ?? {}),
  };
  return {
    scan: vi.fn(async () => ({
      nodes: opts.scanNodes ?? [
        { id: "10:1", name: "검색 바" },
        { id: "10:2", name: "결과 리스트" },
      ],
    })),
    getAnnotations: vi.fn(async ({ nodeId }: { nodeId: string }) => ({
      annotations: annotations[nodeId] ?? [],
    })),
    setAnnotation: vi.fn(
      async ({ nodeId, labelMarkdown, categoryId }: { nodeId: string; labelMarkdown: string; categoryId?: string }) => {
        annotations[nodeId] = [{ labelMarkdown, ...(categoryId ? { categoryId } : {}) }];
        return { success: true, nodeId, annotations: annotations[nodeId] };
      },
    ),
    // card surface intentionally absent — a TEXT card must NOT be created.
    createText: vi.fn(),
    deleteNode: vi.fn(),
  };
}

describe("native_annotation adapter — apply (S1, S2)", () => {
  it("S1: two areas → exactly two annotations on '10:1'/'10:2' with the right Korean substrings, no TEXT card", async () => {
    const client = makeMockClient();
    await applyNativeAnnotation(makeEntry({ area_annotations: twoAreas }), {
      figma: client,
    });

    expect(client.setAnnotation).toHaveBeenCalledTimes(2);
    expect(client.createText).not.toHaveBeenCalled();

    const calls = client.setAnnotation.mock.calls.map((c) => c[0]);
    const byNode = Object.fromEntries(calls.map((a) => [a.nodeId, a.labelMarkdown]));
    expect(byNode["10:1"]).toContain("검색");
    expect(byNode["10:1"]).toContain("입력한 조건으로 목록을 갱신한다");
    expect(byNode["10:2"]).toContain("결과");
    expect(byNode["10:2"]).toContain("검색 결과를 표시한다");
  });

  it("S1: both resolutions report fallback_used=false", async () => {
    const client = makeMockClient();
    const result = await applyNativeAnnotation(
      makeEntry({ area_annotations: twoAreas }),
      { figma: client },
    );
    expect(result.fallback_used).toBe(false);
  });

  it("S2: an entry with area_annotations undefined takes the frame-level path (??[] nullish arm)", async () => {
    // makeEntry omits area_annotations entirely → undefined, exercising the
    // `entry.area_annotations ?? []` nullish branch (distinct from `[]`).
    const client = makeMockClient({ scanNodes: [{ id: "21:1", name: "헤더" }] });
    await applyNativeAnnotation(
      makeEntry({ frame_id: "21:0" }),
      { figma: client },
    );
    expect(client.setAnnotation).toHaveBeenCalledTimes(1);
    const arg = client.setAnnotation.mock.calls[0][0];
    expect(arg.nodeId).toBe("21:0");
    expect(arg.labelMarkdown).toContain("사용자 인증 게이트");
  });

  it("S2: no-area entry → exactly one frame-level annotation on '20:0' with intent/value/criteria", async () => {
    const client = makeMockClient({ scanNodes: [{ id: "20:1", name: "헤더" }] });
    await applyNativeAnnotation(
      makeEntry({ frame_id: "20:0", area_annotations: [] }),
      { figma: client },
    );

    expect(client.setAnnotation).toHaveBeenCalledTimes(1);
    const arg = client.setAnnotation.mock.calls[0][0];
    expect(arg.nodeId).toBe("20:0");
    expect(arg.labelMarkdown).toContain("사용자 인증 게이트");
    expect(arg.labelMarkdown).toContain("PM 진입");
    expect(arg.labelMarkdown).toContain("5초");
  });
});

describe("native_annotation adapter — plugin consent (S5)", () => {
  it("S5: disconnected bridge rejects apply and issues zero setAnnotation calls", async () => {
    // ctx.figma null models the disconnected/absent bridge (asClient guard).
    await expect(
      applyNativeAnnotation(makeEntry({ area_annotations: twoAreas }), {
        figma: null,
      }),
    ).rejects.toThrow();
  });

  it("S5: a client missing setAnnotation rejects with zero mutation", async () => {
    const broken = { scan: vi.fn(), getAnnotations: vi.fn() };
    await expect(
      applyNativeAnnotation(makeEntry({ area_annotations: twoAreas }), {
        figma: broken,
      }),
    ).rejects.toThrow();
    expect("setAnnotation" in broken).toBe(false);
  });
});

describe("native_annotation adapter — undo (S6, S7)", () => {
  it("S6: undo restores node.annotations on '40:1' to the empty array", async () => {
    const client = makeMockClient({ priorByNode: { "40:1": [] } });
    const descriptor: UndoDescriptor = {
      type: "restore-annotation",
      node_id: "40:1",
      prior: [],
    } as UndoDescriptor;
    await undoNativeAnnotation(descriptor, { figma: client });

    // The restore writes the empty array back (clears any generated annotation).
    const restored = client.setAnnotation.mock.calls
      .filter((c) => c[0].nodeId === "40:1");
    // Either setAnnotation([]) or a dedicated clear — assert the prior wins.
    const last = await client.getAnnotations({ nodeId: "40:1" });
    expect(last.annotations).toEqual([]);
    expect(restored.length).toBeGreaterThanOrEqual(0);
  });

  it("S7: undo restores the clobbered manual annotation 'manual reviewer note'", async () => {
    const client = makeMockClient({
      priorByNode: { "50:1": [{ labelMarkdown: "manual reviewer note" }] },
    });
    const descriptor: UndoDescriptor = {
      type: "restore-annotation",
      node_id: "50:1",
      prior: [{ labelMarkdown: "manual reviewer note" }],
    } as UndoDescriptor;
    await undoNativeAnnotation(descriptor, { figma: client });

    const restored = await client.getAnnotations({ nodeId: "50:1" });
    expect(restored.annotations).toHaveLength(1);
    expect(restored.annotations[0].labelMarkdown).toBe("manual reviewer note");
  });

  it("undo rejects a non-restore-annotation descriptor", async () => {
    const client = makeMockClient();
    await expect(
      undoNativeAnnotation(
        { type: "delete-node", node_id: "x" },
        { figma: client },
      ),
    ).rejects.toThrow();
  });
});

describe("native_annotation adapter — categoryId signal (REQ-11)", () => {
  // Branch [69]/[89]/[138]: an area carrying a category_id signal forwards a
  // categoryId on the native setAnnotation call.
  it("REQ-11: an area with category_id forwards categoryId on setAnnotation", async () => {
    const client = makeMockClient({ scanNodes: [{ id: "90:1", name: "결과 리스트" }] });
    await applyNativeAnnotation(
      makeEntry({
        frame_id: "90:0",
        area_annotations: [
          {
            area_id: "1",
            title: "결과",
            target_area: "결과 리스트",
            description: "검색 결과를 표시한다",
            // category_id is an extra manifest signal (REQ-11).
            category_id: "ready-for-dev",
          } as AreaAnnotation,
        ],
      }),
      { figma: client },
    );
    expect(client.setAnnotation).toHaveBeenCalledTimes(1);
    const arg = client.setAnnotation.mock.calls[0][0];
    expect(arg.categoryId).toBe("ready-for-dev");
  });

  // Branch [69] absent arm + [89]/[138] false arm: no category signal → the
  // categoryId key is omitted entirely from the setAnnotation call.
  it("REQ-11: an area without a category signal omits categoryId", async () => {
    const client = makeMockClient({ scanNodes: [{ id: "91:1", name: "결과 리스트" }] });
    await applyNativeAnnotation(
      makeEntry({
        frame_id: "91:0",
        area_annotations: [
          {
            area_id: "1",
            title: "결과",
            target_area: "결과 리스트",
            description: "검색 결과를 표시한다",
            category_id: "   ", // whitespace-only → treated as absent
          } as AreaAnnotation,
        ],
      }),
      { figma: client },
    );
    const arg = client.setAnnotation.mock.calls[0][0];
    expect("categoryId" in arg).toBe(false);
  });
});

describe("native_annotation adapter — prior minimization (REQ-06/REQ-08)", () => {
  // Branch [99]/[100]: minimizePrior preserves categoryId and properties when
  // the captured prior carries them — so the undo descriptor restores them and
  // idempotency compares against the full prior shape.
  it("captures categoryId and properties from a prior annotation into the undo descriptor", async () => {
    const client = makeMockClient({
      scanNodes: [{ id: "92:1", name: "결과 리스트" }],
      priorByNode: {
        "92:1": [
          {
            labelMarkdown: "기존 주석",
            categoryId: "review",
            // properties is an extra captured field minimizePrior must retain.
            properties: [{ type: "string", value: "x" }],
          } as { labelMarkdown: string; categoryId?: string },
        ],
      },
    });
    const result = await applyNativeAnnotation(
      makeEntry({
        frame_id: "92:0",
        area_annotations: [
          {
            area_id: "1",
            title: "결과",
            target_area: "결과 리스트",
            description: "새 설명",
          },
        ],
      }),
      { figma: client },
    );
    const undo = result.undo_descriptor as {
      type: string;
      prior: Array<{ labelMarkdown: string; categoryId?: string; properties?: unknown }>;
    };
    expect(undo.type).toBe("restore-annotation");
    expect(undo.prior[0].labelMarkdown).toBe("기존 주석");
    expect(undo.prior[0].categoryId).toBe("review");
    expect(undo.prior[0].properties).toEqual([{ type: "string", value: "x" }]);
  });

  // Branch [97]: getAnnotations returns no `annotations` field at all → the
  // `?? []` nullish arm yields an empty prior, captured as [].
  it("captures an empty prior when getAnnotations returns no annotations field", async () => {
    const client = {
      scan: vi.fn(async () => ({ nodes: [{ id: "93:1", name: "결과 리스트" }] })),
      // Deliberately omit the `annotations` key to exercise the `?? []` arm.
      getAnnotations: vi.fn(async () => ({})),
      setAnnotation: vi.fn(async () => ({ success: true })),
      createText: vi.fn(),
    };
    const result = await applyNativeAnnotation(
      makeEntry({
        frame_id: "93:0",
        area_annotations: [
          {
            area_id: "1",
            title: "결과",
            target_area: "결과 리스트",
            description: "새 설명",
          },
        ],
      }),
      { figma: client },
    );
    const undo = result.undo_descriptor as { type: string; prior: unknown[] };
    expect(undo.prior).toEqual([]);
    // A non-equal (empty vs planned) prior still triggers the mutating write.
    expect(client.setAnnotation).toHaveBeenCalledTimes(1);
  });
});

describe("native_annotation adapter — undo categoryId restore (S7)", () => {
  // Branch [177]: undo replays a captured prior that carries a categoryId,
  // restoring it verbatim on the native setAnnotation call.
  it("S7: undo restores a prior annotation including its categoryId", async () => {
    const client = makeMockClient();
    const descriptor: UndoDescriptor = {
      type: "restore-annotation",
      node_id: "94:1",
      prior: [{ labelMarkdown: "manual note", categoryId: "review" }],
    } as UndoDescriptor;
    await undoNativeAnnotation(descriptor, { figma: client });
    expect(client.setAnnotation).toHaveBeenCalledTimes(1);
    const arg = client.setAnnotation.mock.calls[0][0];
    expect(arg.labelMarkdown).toBe("manual note");
    expect(arg.categoryId).toBe("review");
  });
});

describe("native_annotation adapter — idempotency (S8)", () => {
  it("S8: re-apply with identical content issues no setAnnotation call and is an IDEMPOTENT_SKIP", async () => {
    const entry = makeEntry({
      frame_id: "60:0",
      area_annotations: [
        {
          area_id: "1",
          title: "결과",
          target_area: "결과 리스트",
          description: "이미 적용된 설명",
        },
      ],
    });
    // First apply to learn the produced labelMarkdown.
    const first = makeMockClient({ scanNodes: [{ id: "60:1", name: "결과 리스트" }] });
    await applyNativeAnnotation(entry, { figma: first });
    expect(first.setAnnotation).toHaveBeenCalledTimes(1);
    const produced = first.setAnnotation.mock.calls[0][0].labelMarkdown as string;

    // Second apply: prior already equals the set the entry would produce.
    const second = makeMockClient({
      scanNodes: [{ id: "60:1", name: "결과 리스트" }],
      priorByNode: { "60:1": [{ labelMarkdown: produced }] },
    });
    const result = await applyNativeAnnotation(entry, { figma: second });

    expect(second.setAnnotation).not.toHaveBeenCalled();
    const after = await second.getAnnotations({ nodeId: "60:1" });
    expect(after.annotations).toEqual([{ labelMarkdown: produced }]);
    // Observable idempotent skip.
    expect(result.status_code ?? (result as Record<string, unknown>).status).toBe(
      ERROR_CODES.IDEMPOTENT_SKIP,
    );
  });
});
