import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyComment,
  undoComment,
  commentAdapter,
} from "../src/adapters/comment.js";
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
    write_target: "comment",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

function makeMockClient(commentId = "cmt-1") {
  return {
    commentPost: vi.fn(async () => ({ commentId })),
    deleteComment: vi.fn(async () => undefined),
  };
}

let savedFileKey: string | undefined;
beforeEach(() => {
  savedFileKey = process.env.FIGMA_FILE_KEY;
  process.env.FIGMA_FILE_KEY = "FILE-KEY-TEST";
});
afterEach(() => {
  if (savedFileKey === undefined) delete process.env.FIGMA_FILE_KEY;
  else process.env.FIGMA_FILE_KEY = savedFileKey;
});

describe("comment adapter (REQ-04(c) / REQ-08 / INV-002 / INV-003)", () => {
  it("apply calls commentPost exactly once with the resolved fileKey + frameId", async () => {
    const client = makeMockClient("cmt-1");
    await applyComment(makeEntry(), { figma: client });

    expect(client.commentPost).toHaveBeenCalledTimes(1);
    const arg = client.commentPost.mock.calls[0][0];
    expect(arg.fileKey).toBe("FILE-KEY-TEST");
    expect(arg.frameId).toBe("123:456");
    expect(arg.text).toContain("AUTH-01");
    expect(arg.text).toContain("사용자 인증 게이트");
  });

  it("apply returns delete-comment undo descriptor with the returned commentId", async () => {
    const client = makeMockClient("cmt-42");
    const result = await applyComment(makeEntry(), { figma: client });
    expect(result.undo_descriptor).toEqual<UndoDescriptor>({
      type: "delete-comment",
      comment_id: "cmt-42",
    });
    expect(result.fallback_used).toBe(false);
  });

  it("apply prefers ctx.fileKey over FIGMA_FILE_KEY env", async () => {
    const client = makeMockClient();
    await applyComment(makeEntry(), { figma: client, fileKey: "OVERRIDE-KEY" });
    expect(client.commentPost.mock.calls[0][0].fileKey).toBe("OVERRIDE-KEY");
  });

  it("apply throws when fileKey cannot be resolved (no env, no ctx)", async () => {
    delete process.env.FIGMA_FILE_KEY;
    const client = makeMockClient();
    await expect(applyComment(makeEntry(), { figma: client })).rejects.toThrow(
      /FIGMA_FILE_KEY/,
    );
    expect(client.commentPost).not.toHaveBeenCalled();
  });

  it("apply throws when ctx.figma is null", async () => {
    await expect(applyComment(makeEntry(), { figma: null })).rejects.toThrow(
      /Figma write client/,
    );
  });

  it("apply throws when client is missing commentPost", async () => {
    const broken = { deleteComment: vi.fn() };
    await expect(
      applyComment(makeEntry(), { figma: broken }),
    ).rejects.toThrow(/missing required methods/);
  });

  it("undo calls deleteComment exactly once with the resolved fileKey + commentId", async () => {
    const client = makeMockClient();
    await undoComment(
      { type: "delete-comment", comment_id: "cmt-9" },
      { figma: client },
    );
    expect(client.deleteComment).toHaveBeenCalledTimes(1);
    expect(client.deleteComment).toHaveBeenCalledWith({
      fileKey: "FILE-KEY-TEST",
      commentId: "cmt-9",
    });
  });

  it("undo throws when given a non-delete-comment descriptor", async () => {
    const client = makeMockClient();
    await expect(
      undoComment(
        { type: "delete-node", node_id: "x" },
        { figma: client },
      ),
    ).rejects.toThrow(/expected delete-comment/);
    expect(client.deleteComment).not.toHaveBeenCalled();
  });

  it("undo throws when fileKey is unset", async () => {
    delete process.env.FIGMA_FILE_KEY;
    const client = makeMockClient();
    await expect(
      undoComment(
        { type: "delete-comment", comment_id: "x" },
        { figma: client },
      ),
    ).rejects.toThrow(/FIGMA_FILE_KEY/);
  });

  it("commentAdapter exposes both apply and undo bound to the named functions", () => {
    expect(commentAdapter.apply).toBe(applyComment);
    expect(commentAdapter.undo).toBe(undoComment);
  });
});
