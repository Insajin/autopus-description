// SPEC-FIGMA-004 W2 unit — descriptions_page adapter (REQ-04(b), REQ-08).
//
// Verifies lazy page creation, text creation, and reverse-by-deleteNode.

import { describe, it, expect } from "vitest";

import {
  applyDescriptionsPage,
  undoDescriptionsPage,
  DESCRIPTIONS_PAGE_NAME,
} from "@autopus/write-router/adapters/descriptions-page";
import type { ManifestEntry } from "@autopus/write-router/types";

interface PageCall {
  pageName: string;
}
interface TextCall {
  pageId: string;
  text: string;
}

function makeClient(opts: { nodeId?: string; pageId?: string } = {}) {
  const calls = {
    getOrCreatePage: [] as PageCall[],
    createTextOnPage: [] as TextCall[],
    deleteNode: [] as string[],
  };
  return {
    calls,
    async getOrCreatePage(args: { pageName: string }) {
      calls.getOrCreatePage.push({ pageName: args.pageName });
      return { pageId: opts.pageId ?? "page-desc-1" };
    },
    async createTextOnPage(args: { pageId: string; text: string }) {
      calls.createTextOnPage.push({ pageId: args.pageId, text: args.text });
      return { nodeId: opts.nodeId ?? "node-desc-1" };
    },
    async deleteNode(nodeId: string) {
      calls.deleteNode.push(nodeId);
    },
  };
}

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "로그인",
    intent: "사용자 인증 게이트",
    user_value: "PM 빠른 진입",
    success_criteria: "5초 내 진입",
    states: ["default"],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "abc",
    write_target: "descriptions_page",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  } as ManifestEntry;
}

describe("descriptions_page adapter", () => {
  it("lazily resolves Descriptions page and creates a text node with entry content", async () => {
    const client = makeClient({ nodeId: "node-desc-42" });
    const entry = makeEntry();

    const result = await applyDescriptionsPage(entry, { figma: client });

    expect(client.calls.getOrCreatePage).toHaveLength(1);
    expect(client.calls.getOrCreatePage[0].pageName).toBe(DESCRIPTIONS_PAGE_NAME);
    expect(client.calls.createTextOnPage).toHaveLength(1);
    expect(client.calls.createTextOnPage[0].pageId).toBe("page-desc-1");
    expect(client.calls.createTextOnPage[0].text).toContain("AUTH-01");
    expect(client.calls.createTextOnPage[0].text).toContain("사용자 인증 게이트");
    expect(result.undo_descriptor).toEqual({
      type: "delete-node",
      node_id: "node-desc-42",
    });
    expect(result.node_id).toBe("node-desc-42");
    expect(result.fallback_used).toBe(false);
  });

  it("undo invokes deleteNode with the recorded node id exactly once", async () => {
    const client = makeClient({ nodeId: "node-desc-99" });
    const entry = makeEntry();

    const result = await applyDescriptionsPage(entry, { figma: client });
    await undoDescriptionsPage(result.undo_descriptor, { figma: client });

    expect(client.calls.deleteNode).toEqual(["node-desc-99"]);
  });

  it("rejects when client is missing required methods", async () => {
    const broken = { getOrCreatePage: () => undefined } as unknown;
    const err = await applyDescriptionsPage(makeEntry(), { figma: broken }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("WRITE_TARGET_ROUTING_ERROR");
  });
});
