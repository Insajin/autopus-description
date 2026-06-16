// SPEC-FIGMA-021 S4 + S5 — the live-plugin adapter routes set_native_annotation
// and set_policy_card through the canonical dispatcher against a RAW figma stub.
// The adapter must simultaneously satisfy the high-level setAnnotation primitive
// and the RAW canvas runtime (createFrame/createText/...). S5 confirms the
// dispatch redaction boundary still strips secrets from labelMarkdown.

import { describe, expect, it, vi } from "vitest";

import { createAutopusPluginAdapter } from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_plugin_adapter.js";
import { dispatchPluginCommand } from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.js";

// A node that supports native annotations (`'annotations' in node` is true).
function makeAnnotatableNode(id: string): Record<string, unknown> {
  return { id, annotations: [] as unknown[] };
}

// RAW canvas runtime stub (mirrors the dispatch test's source node shape so the
// policy-card renderer's chooseDocumentBox sees an absoluteBoundingBox).
//
// SPEC-FIGMA-021 regression guard: text nodes enforce Figma's real font-load
// constraint — writing `fontSize`/`characters` while the node's CURRENT font is
// not loaded throws (exactly like the live runtime). A fresh text node defaults
// to an UNLOADED Inter Regular, so a renderer that sets fontSize before
// loadFontAsync + fontName will fail this test. This is the live bug that the
// previous (constraint-free) stub could not catch.
function makeCanvasStub() {
  let counter = 0;
  const loaded = new Set<string>();
  const fontKey = (f: { family: string; style: string }) => `${f.family}|${f.style}`;
  const makeNode = (prefix: string) => ({
    id: `${prefix}-${++counter}`,
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
  const makeTextNode = () => {
    const node = makeNode("text") as Record<string, unknown>;
    let font = { family: "Inter", style: "Regular" }; // default, UNLOADED
    let size = 0;
    let chars = "";
    const ensureLoaded = (op: string) => {
      if (!loaded.has(fontKey(font))) {
        throw new Error(
          `Cannot write ${op} to node with unloaded font "${font.family} ${font.style}". ` +
            `Call figma.loadFontAsync first.`,
        );
      }
    };
    Object.defineProperty(node, "fontName", {
      get: () => font,
      set: (v: { family: string; style: string }) => {
        font = v;
      },
    });
    Object.defineProperty(node, "fontSize", {
      get: () => size,
      set: (v: number) => {
        ensureLoaded("fontSize");
        size = v;
      },
    });
    Object.defineProperty(node, "characters", {
      get: () => chars,
      set: (v: string) => {
        ensureLoaded("characters");
        chars = v;
      },
    });
    return node;
  };
  const page = makeNode("page");
  const source = {
    ...makeNode("source"),
    absoluteBoundingBox: { x: 100, y: 200, width: 640, height: 480 },
  };
  return {
    currentPage: page,
    getNodeByIdAsync: vi.fn(async () => source),
    createFrame: vi.fn(() => makeNode("frame")),
    createText: vi.fn(() => makeTextNode()),
    createRectangle: vi.fn(() => makeNode("rect")),
    loadFontAsync: vi.fn(async (f: { family: string; style: string }) => {
      loaded.add(fontKey(f));
    }),
  };
}

describe("autopus plugin adapter — set_native_annotation (S4/S5)", () => {
  it("writes node.annotations via the resolved node and returns node_ids", async () => {
    const node = makeAnnotatableNode("80:1");
    const figma = {
      getNodeByIdAsync: vi.fn(async () => node),
    };
    const adapter = createAutopusPluginAdapter(figma);

    const result = await dispatchPluginCommand(adapter, {
      op: "set_native_annotation",
      args: { nodeId: "80:1", labelMarkdown: "**검색**", categoryId: "ready-for-dev" },
    });

    expect(result).toEqual({ ok: true, node_ids: ["80:1"] });
    expect(node.annotations).toEqual([
      { labelMarkdown: "**검색**", categoryId: "ready-for-dev" },
    ]);
  });

  it("S5 — redacts a leaked secret before it reaches node.annotations", async () => {
    const node = makeAnnotatableNode("83:1");
    const figma = { getNodeByIdAsync: vi.fn(async () => node) };
    const adapter = createAutopusPluginAdapter(figma);

    await dispatchPluginCommand(adapter, {
      op: "set_native_annotation",
      args: { nodeId: "83:1", labelMarkdown: "token xoxb-LEAKEDSECRET trailing" },
    });

    const written = (node.annotations as Array<{ labelMarkdown: string }>)[0];
    expect(written.labelMarkdown).not.toContain("xoxb-LEAKEDSECRET");
  });
});

// SPEC-FIGMA-022 — regression for the op-name collision bug. The user-facing
// MCP tool `set_annotation` (described "Set or update a single annotation on a
// node", native args { nodeId, labelMarkdown }) MUST reach the NATIVE
// node.annotations write — not the legacy text-card path, which created an empty
// stray TEXT node at (0,0) and left node.annotations untouched.
describe("autopus plugin adapter — set_annotation routes to NATIVE (SPEC-022 bug)", () => {
  it("sets node.annotations and creates NO stray text node for native args", async () => {
    const node = makeAnnotatableNode("90:1");
    const createText = vi.fn(() => ({ id: "stray-text" }));
    const figma = {
      getNodeByIdAsync: vi.fn(async () => node),
      // If the bug regresses (card path), the dispatcher calls createText.
      createText,
    };
    const adapter = createAutopusPluginAdapter(figma);

    const result = await dispatchPluginCommand(adapter, {
      op: "set_annotation",
      args: { nodeId: "90:1", labelMarkdown: "**검색 영역**\n조건 입력 후 목록 갱신" },
    });

    // Native write happened on the resolved node.
    expect(result).toEqual({ ok: true, node_ids: ["90:1"] });
    expect(node.annotations).toEqual([
      { labelMarkdown: "**검색 영역**\n조건 입력 후 목록 갱신" },
    ]);
    // The bug signature: NO text node created (no junk node at (0,0)).
    expect(createText).not.toHaveBeenCalled();
  });

  it("forwards an optional categoryId to node.annotations", async () => {
    const node = makeAnnotatableNode("91:1");
    const figma = { getNodeByIdAsync: vi.fn(async () => node) };
    const adapter = createAutopusPluginAdapter(figma);

    await dispatchPluginCommand(adapter, {
      op: "set_annotation",
      args: { nodeId: "91:1", labelMarkdown: "**결과**", categoryId: "ready-for-dev" },
    });

    expect(node.annotations).toEqual([
      { labelMarkdown: "**결과**", categoryId: "ready-for-dev" },
    ]);
  });

  it("redacts a leaked secret in labelMarkdown before the native write", async () => {
    const node = makeAnnotatableNode("92:1");
    const figma = { getNodeByIdAsync: vi.fn(async () => node) };
    const adapter = createAutopusPluginAdapter(figma);

    await dispatchPluginCommand(adapter, {
      op: "set_annotation",
      args: { nodeId: "92:1", labelMarkdown: "token xoxb-LEAKEDSECRET trailing" },
    });

    const written = (node.annotations as Array<{ labelMarkdown: string }>)[0];
    expect(written.labelMarkdown).not.toContain("xoxb-LEAKEDSECRET");
  });
});

describe("autopus plugin adapter — set_policy_card (S4)", () => {
  it("renders auto-layout tables and returns the card id plus child node ids", async () => {
    const figma = makeCanvasStub();
    const adapter = createAutopusPluginAdapter(figma);

    const result = await dispatchPluginCommand(adapter, {
      op: "set_policy_card",
      args: {
        frameId: "1:1",
        tables: [
          { section: "states", header: ["state", "desc"], rows: [["loading", "spinner"]] },
          { section: "edge_cases", header: ["case"], rows: [["empty"]] },
          { section: "data_requirements", header: ["data"], rows: [["DATA-1"]] },
          { section: "area_annotations", header: ["area"], rows: [["검색"]] },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.node_ids?.length).toBeGreaterThanOrEqual(5);
    // The first node id is the card frame itself (chooseDocumentBox card).
    const cardId = (figma.createFrame.mock.results[0].value as { id: string }).id;
    expect(result.node_ids?.[0]).toBe(cardId);
  });
});
