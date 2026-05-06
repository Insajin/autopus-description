// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S8 token redaction.
// REQ-13, INV-007.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

import { WriteRouter } from "@autopus/write-router";
import { redact } from "@autopus/review-ui/lib/redactor";

import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import {
  createTmpAuditEnv,
  makeEntry,
  TOKEN_REGEX,
  FAKE_FIGMA_TOKEN,
  FAKE_SLACK_TOKEN,
} from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
});

afterEach(() => {
  env.cleanup();
});

describe("AC-S8: token redaction across audit log, UI display, error message (REQ-13)", () => {
  it("audit log file content matches the credential regex 0 times and contains literal '<REDACTED>'", async () => {
    const server = createMockFigmaWriteServer({
      writeFailureMessage: `unauthorized: token ${FAKE_FIGMA_TOKEN} rejected`,
      slackToken: FAKE_SLACK_TOKEN,
    });
    const router = new WriteRouter({
      figma: server,
      auditLogPath: env.auditLogPath,
      figmaToken: FAKE_FIGMA_TOKEN,
      slackToken: FAKE_SLACK_TOKEN,
    });
    const entry = makeEntry({ write_target: "annotation_card" });

    await router.apply(entry).catch(() => undefined);

    const fileContent = readFileSync(env.auditLogPath, "utf8");
    expect(fileContent.match(TOKEN_REGEX) ?? []).toHaveLength(0);
    expect(fileContent).toContain("<REDACTED>");
  });

  it("UI display string passed through redact() matches the credential regex 0 times", () => {
    const display = redact(`Error display: ${FAKE_FIGMA_TOKEN} or ${FAKE_SLACK_TOKEN}`);
    expect(display.match(TOKEN_REGEX) ?? []).toHaveLength(0);
    expect(display).toContain("<REDACTED>");
  });

  it("thrown error message string matches the credential regex 0 times", async () => {
    const server = createMockFigmaWriteServer({
      writeFailureMessage: `unauthorized: token ${FAKE_FIGMA_TOKEN} rejected`,
    });
    const router = new WriteRouter({
      figma: server,
      auditLogPath: env.auditLogPath,
      figmaToken: FAKE_FIGMA_TOKEN,
    });
    const entry = makeEntry({ write_target: "annotation_card" });

    const err = await router.apply(entry).catch((e) => e);
    const msg = String((err as Error)?.message ?? err);
    expect(msg.match(TOKEN_REGEX) ?? []).toHaveLength(0);
    expect(msg).toContain("<REDACTED>");
  });
});
