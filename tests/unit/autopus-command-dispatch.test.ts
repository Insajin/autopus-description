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
        node_ids: ["doc-1", "badge-1", "doc-badge-1"],
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

    expect(result).toEqual({ ok: true, node_ids: ["doc-1", "badge-1", "doc-badge-1"] });
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
      createRectangle: vi.fn(() => makeNode("badge")),
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
    expect(result.node_ids?.length).toBeGreaterThanOrEqual(6);
    expect((figma as unknown as { createFrame: ReturnType<typeof vi.fn> }).createFrame).toHaveBeenCalled();
    expect((figma as unknown as { createRectangle: ReturnType<typeof vi.fn> }).createRectangle).toHaveBeenCalled();
    expect((figma as unknown as { createLine: ReturnType<typeof vi.fn> }).createLine).not.toHaveBeenCalled();
    expect(
      page.children
        .flatMap((node) => (node as { children?: Array<{ name: string }> }).children ?? [])
        .some((node) => node.name === "Autopus document badge 1"),
    ).toBe(true);
  });

  it("moves the area handoff document when right-of-frame placement collides", async () => {
    let id = 0;
    const makeNode = (prefix: string) => ({
      id: `${prefix}-${++id}`,
      name: prefix,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      children: [] as unknown[],
      parent: null as unknown,
      appendChild(child: unknown) {
        this.children.push(child);
      },
      resize(width: number, height: number) {
        this.width = width;
        this.height = height;
      },
    });
    const page = makeNode("page");
    const parent = makeNode("section");
    const source = {
      ...makeNode("source"),
      parent,
      absoluteBoundingBox: { x: 100, y: 200, width: 640, height: 480 },
    };
    const blocker = {
      ...makeNode("blocker"),
      parent,
      absoluteBoundingBox: { x: 836, y: 200, width: 720, height: 462 },
    };
    parent.children.push(source, blocker);
    const figma = {
      currentPage: page,
      getNodeByIdAsync: vi.fn(async () => source),
      createFrame: vi.fn(() => makeNode("doc")),
      createText: vi.fn(() => makeNode("text")),
      createRectangle: vi.fn(() => makeNode("badge")),
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

    const doc = page.children[0] as { x: number; y: number };
    expect(result.ok).toBe(true);
    expect(doc.x).toBe(100);
    expect(doc.y).toBe(776);
  });
});

// SPEC-FIGMA-018 S10 — the new set_native_annotation dispatch case. These tests
// target ONLY the new native dispatch branch (dispatchSetNativeAnnotation), not
// the pre-existing card / inverse dispatch logic.
describe("autopus plugin command dispatch — set_native_annotation (SPEC-018)", () => {
  it("routes set_native_annotation to the native setAnnotation tool with redacted label", async () => {
    const figma: FigmaPluginLike = {
      setAnnotation: vi.fn(async () => ({ id: "anno-1" })),
      createText: vi.fn(async () => ({ id: "text-1" })),
    };

    const result = await dispatchPluginCommand(figma, {
      op: "set_native_annotation",
      args: {
        nodeId: "80:1",
        labelMarkdown: "**검색**\n영역: 검색 바",
        categoryId: "ready-for-dev",
      },
    });

    expect(result).toEqual({ ok: true, node_ids: ["80:1"] });
    expect(figma.setAnnotation).toHaveBeenCalledTimes(1);
    expect(figma.setAnnotation).toHaveBeenCalledWith({
      nodeId: "80:1",
      labelMarkdown: "**검색**\n영역: 검색 바",
      categoryId: "ready-for-dev",
    });
    // It must NOT draw a card.
    expect(figma.createText).not.toHaveBeenCalled();
  });

  // Branch [196]: categoryId arg absent → categoryId forwarded as undefined,
  // never reusing the card path.
  it("forwards categoryId=undefined when the command omits a categoryId", async () => {
    const figma: FigmaPluginLike = {
      setAnnotation: vi.fn(async () => ({ id: "anno-2" })),
    };

    const result = await dispatchPluginCommand(figma, {
      op: "set_native_annotation",
      args: { nodeId: "81:1", labelMarkdown: "**결과**\n영역: 결과 리스트" },
    });

    expect(result).toEqual({ ok: true, node_ids: ["81:1"] });
    const arg = (figma.setAnnotation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.nodeId).toBe("81:1");
    expect(arg.categoryId).toBeUndefined();
  });

  // Branch [193]: the native tool is unavailable on the bridge → graceful no-op
  // result, zero mutation.
  it("returns a no-op result when the native setAnnotation tool is unavailable", async () => {
    const figma: FigmaPluginLike = {
      createText: vi.fn(async () => ({ id: "text-1" })),
    };

    const result = await dispatchPluginCommand(figma, {
      op: "set_native_annotation",
      args: { nodeId: "82:1", labelMarkdown: "**미연결**" },
    });

    expect(result).toEqual({ ok: true, node_ids: [] });
    expect(figma.createText).not.toHaveBeenCalled();
  });

  // The labelMarkdown carried to the native tool passes through the dispatch
  // redactor (autopusRedact) — a leaked secret must not reach the bridge.
  it("redacts a leaked secret in labelMarkdown before forwarding to the native tool", async () => {
    const figma: FigmaPluginLike = {
      setAnnotation: vi.fn(async () => ({ id: "anno-3" })),
    };

    await dispatchPluginCommand(figma, {
      op: "set_native_annotation",
      args: {
        nodeId: "83:1",
        labelMarkdown: "token xoxb-LEAKEDSECRET trailing",
      },
    });

    const arg = (figma.setAnnotation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.labelMarkdown).not.toContain("xoxb-LEAKEDSECRET");
  });
});
