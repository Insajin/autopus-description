import { describe, it, expect, vi } from "vitest";
import {
  applyAnnotationCard,
  undoAnnotationCard,
  annotationCardAdapter,
} from "../src/adapters/annotation-card.js";
import type {
  ManifestEntry,
  UndoDescriptor,
} from "../src/types.js";

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "123:456",
    title: "로그인",
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
    write_target: "annotation_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

function makeMockClient(nodeId = "node-9001") {
  return {
    createText: vi.fn(async () => ({ nodeId })),
    deleteNode: vi.fn(async () => undefined),
  };
}

describe("annotation_card adapter (REQ-04(a) / REQ-08 / INV-002)", () => {
  it("apply calls createText exactly once with the entry's intent in the text body", async () => {
    const client = makeMockClient("node-9001");
    const result = await applyAnnotationCard(makeEntry(), { figma: client });

    expect(client.createText).toHaveBeenCalledTimes(1);
    const arg = client.createText.mock.calls[0][0];
    expect(arg.frameId).toBe("123:456");
    expect(arg.text).toContain("사용자 인증 게이트");
    expect(result.fallback_used).toBe(false);
  });

  it("renders numbered region notes and product-level data list when supplied", async () => {
    const client = makeMockClient("node-9001");
    await applyAnnotationCard(
      makeEntry({
        area_annotations: [
          {
            area_id: "1",
            title: "검색 영역",
            target_area: "상단 검색 입력창",
            description: "입력한 조건으로 목록을 갱신한다",
            interaction: "Enter와 검색 아이콘은 동일한 실행으로 본다",
            data_refs: ["DATA-1"],
          },
        ],
        data_requirements: [
          {
            data_id: "DATA-1",
            name: "검색 조건",
            purpose: "목록 갱신 기준을 유지한다",
            required_values: ["검색어", "필터 조건"],
          },
        ],
      }),
      { figma: client },
    );

    const text = client.createText.mock.calls[0][0].text;
    expect(text).toContain("[영역별 설명]");
    expect(text).toContain("1. 검색 영역");
    expect(text).toContain("상단 검색 입력창");
    expect(text).toContain("[필요 데이터 리스트]");
    expect(text).toContain("DATA-1. 검색 조건");
    expect(text).toContain("[구현 경계]");
    expect(client.createText.mock.calls[0][0].layout).toBe("area_handoff");
    expect(client.createText.mock.calls[0][0].documentPosition).toBe("right_of_frame");
    expect(client.createText.mock.calls[0][0].areaCallouts).toEqual([
      expect.objectContaining({
        areaId: "1",
        badgeLabel: "1",
        documentAnchor: "area-1",
      }),
    ]);
  });

  it("apply returns delete-node undo descriptor with the returned nodeId", async () => {
    const client = makeMockClient("node-9001");
    const result = await applyAnnotationCard(makeEntry(), { figma: client });
    expect(result.undo_descriptor).toEqual<UndoDescriptor>({
      type: "delete-node",
      node_id: "node-9001",
    });
    expect(result.node_id).toBe("node-9001");
  });

  it("apply throws WRITE_TARGET_ROUTING_ERROR when ctx.figma is null", async () => {
    await expect(
      applyAnnotationCard(makeEntry(), { figma: null }),
    ).rejects.toThrow(/Figma write client/);
  });

  it("apply throws when the client is missing createText", async () => {
    const broken = { deleteNode: vi.fn() };
    await expect(
      applyAnnotationCard(makeEntry(), { figma: broken }),
    ).rejects.toThrow(/missing required methods/);
  });

  it("undo calls deleteNode exactly once with the node_id from the descriptor", async () => {
    const client = makeMockClient();
    await undoAnnotationCard(
      { type: "delete-node", node_id: "node-9001" },
      { figma: client },
    );
    expect(client.deleteNode).toHaveBeenCalledTimes(1);
    expect(client.deleteNode).toHaveBeenCalledWith({ node_id: "node-9001" });
  });

  it("undo throws when given a non-delete-node descriptor", async () => {
    const client = makeMockClient();
    await expect(
      undoAnnotationCard(
        { type: "delete-comment", comment_id: "x" },
        { figma: client },
      ),
    ).rejects.toThrow(/expected delete-node/);
    expect(client.deleteNode).not.toHaveBeenCalled();
  });

  it("annotationCardAdapter exposes both apply and undo bound to the named functions", () => {
    expect(annotationCardAdapter.apply).toBe(applyAnnotationCard);
    expect(annotationCardAdapter.undo).toBe(undoAnnotationCard);
  });
});
