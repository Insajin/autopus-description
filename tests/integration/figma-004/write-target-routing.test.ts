// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S4 write_target routing (comment route).
// REQ-03, REQ-04, INV-003.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { WriteRouter } from "@autopus/write-router";
import * as annotationCard from "@autopus/write-router/adapters/annotation-card";
import * as descriptionsPage from "@autopus/write-router/adapters/descriptions-page";
import * as comment from "@autopus/write-router/adapters/comment";
import * as pluginData from "@autopus/write-router/adapters/plugin-data";
import * as frameName from "@autopus/write-router/adapters/frame-name";
import * as noneAdapter from "@autopus/write-router/adapters/none";

import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  env.cleanup();
});

describe("AC-S4: write_target routing — comment route (REQ-03, REQ-04)", () => {
  it("routes write_target='comment' to ONLY the comment adapter and zero invocations on other 5 adapters", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "comment" });

    const annotationSpy = vi.spyOn(annotationCard, "applyAnnotationCard");
    const descriptionsSpy = vi.spyOn(descriptionsPage, "applyDescriptionsPage");
    const commentSpy = vi.spyOn(comment, "applyComment");
    const pluginDataSpy = vi.spyOn(pluginData, "applyPluginData");
    const frameNameSpy = vi.spyOn(frameName, "applyFrameName");
    const noneSpy = vi.spyOn(noneAdapter, "applyNone");

    await router.apply(entry);

    expect(commentSpy).toHaveBeenCalledTimes(1);
    expect(annotationSpy).toHaveBeenCalledTimes(0);
    expect(descriptionsSpy).toHaveBeenCalledTimes(0);
    expect(pluginDataSpy).toHaveBeenCalledTimes(0);
    expect(frameNameSpy).toHaveBeenCalledTimes(0);
    expect(noneSpy).toHaveBeenCalledTimes(0);
    expect(server.calls.commentPost).toHaveLength(1);
  });
});
