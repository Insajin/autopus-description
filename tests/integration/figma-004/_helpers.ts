// SPEC-FIGMA-004 Phase 1.5 RED scaffold — shared test helpers.
//
// All [NEW] module imports referenced from sibling test files resolve through this
// module so a single import update can rewire the whole suite when Phase 2 lands
// the real packages. Phase 2 executors MUST NOT modify these helper exports
// without coordinating with the tester teammate.

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ManifestEntry } from "@autopus/write-router/types";

export const FIXTURE_30 = "tests/fixtures/30-frame-manifest.json";
export const PERSONA_FIXTURE = "samples/persona-render-fixture.json";

export const TOKEN_REGEX = /(figd_[A-Za-z0-9_-]{16,}|xoxb-[A-Za-z0-9_-]{8,})/g;
export const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const FAKE_FIGMA_TOKEN = "figd_TESTTOKEN1234567890ABCDEF";
export const FAKE_SLACK_TOKEN = "xoxb-TESTABCDE";

export function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "123:456",
    title: "로그인",
    intent: "사용자 인증 게이트",
    user_value: "PM이 로그인 후 즉시 대시보드 진입",
    success_criteria: "5초 이내 진입",
    states: ["default"],
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
  } as ManifestEntry;
}

export function createTmpAuditEnv(): { tmpRoot: string; auditLogPath: string; cleanup: () => void } {
  const tmpRoot = mkdtempSync(join(tmpdir(), "spec-figma-004-"));
  const auditLogPath = join(tmpRoot, "audit.log");
  process.env.AUDIT_LOG_PATH = auditLogPath;
  return {
    tmpRoot,
    auditLogPath,
    cleanup: () => {
      if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
      delete process.env.AUDIT_LOG_PATH;
    },
  };
}
