import { describe, expect, it, vi } from "vitest";

import {
  dispatchPluginCommand,
  type FigmaPluginLike,
} from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.js";

describe("autopus plugin command dispatch — area handoff", () => {
  it("routes area_handoff annotation payloads to createAreaHandoff when available", async () => {
    const figma: FigmaPluginLike = {
      createAreaHandoff: vi.fn(async () => ({
        id: "doc-1",
        node_ids: ["doc-1", "badge-1", "line-1"],
      })),
      createText: vi.fn(async () => ({ id: "text-1" })),
    };

    const result = await dispatchPluginCommand(figma, {
      op: "set_annotation",
      args: {
        frameId: "1:1",
        text: "영역 설명",
        step: "create-node",
        layout: "area_handoff",
        documentPosition: "right_of_frame",
        areaCallouts: [
          {
            areaId: "1",
            badgeLabel: "1",
            title: "검색 영역",
            targetArea: "상단 검색 입력",
            description: "조건 입력 후 목록을 갱신한다",
            dataRefs: ["DATA-1"],
          },
        ],
      },
    });

    expect(result).toEqual({ ok: true, node_ids: ["doc-1", "badge-1", "line-1"] });
    expect(figma.createAreaHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        frameId: "1:1",
        text: "영역 설명",
        documentPosition: "right_of_frame",
        areaCallouts: [
          expect.objectContaining({
            areaId: "1",
            badgeLabel: "1",
            title: "검색 영역",
          }),
        ],
      }),
    );
    expect(figma.createText).not.toHaveBeenCalled();
  });

  it("keeps set-text and attach-link annotation steps as no-op bridge steps", async () => {
    const figma: FigmaPluginLike = {
      createText: vi.fn(async () => ({ id: "text-1" })),
    };

    const result = await dispatchPluginCommand(figma, {
      op: "set_annotation",
      args: { frameId: "1:1", text: "본문", step: "set-text" },
    });

    expect(result).toEqual({ ok: true, node_ids: [] });
    expect(figma.createText).not.toHaveBeenCalled();
  });

  it("can render area_handoff directly with a Figma canvas runtime fallback", async () => {
    let id = 0;
    const makeNode = (prefix: string) => ({
      id: `${prefix}-${++id}`,
      name: prefix,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      children: [] as unknown[],
      appendChild(child: unknown) {
        this.children.push(child);
      },
      resize(width: number, height: number) {
        this.width = width;
        this.height = height;
      },
    });
    const page = makeNode("page");
    const source = {
      ...makeNode("source"),
      absoluteBoundingBox: { x: 100, y: 200, width: 640, height: 480 },
    };
    const figma = {
      currentPage: page,
      getNodeByIdAsync: vi.fn(async () => source),
      createFrame: vi.fn(() => makeNode("doc")),
      createText: vi.fn(() => makeNode("text")),
      createEllipse: vi.fn(() => makeNode("badge")),
      createLine: vi.fn(() => makeNode("line")),
      loadFontAsync: vi.fn(async () => undefined),
    } as unknown as FigmaPluginLike;

    const result = await dispatchPluginCommand(figma, {
      op: "set_annotation",
      args: {
        frameId: "1:1",
        text: "문서 본문",
        step: "create-node",
        layout: "area_handoff",
        areaCallouts: [
          {
            areaId: "1",
            badgeLabel: "1",
            title: "필터",
            targetArea: "상단 필터",
            description: "조건을 바꾼다",
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.node_ids?.length).toBeGreaterThanOrEqual(4);
    expect((figma as unknown as { createFrame: ReturnType<typeof vi.fn> }).createFrame).toHaveBeenCalled();
    expect((figma as unknown as { createEllipse: ReturnType<typeof vi.fn> }).createEllipse).toHaveBeenCalled();
    expect((figma as unknown as { createLine: ReturnType<typeof vi.fn> }).createLine).toHaveBeenCalled();
  });
});
