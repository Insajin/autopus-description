// SPEC-FIGMA-005 T9 / REQ-03: strict-bridge AJV second-pass.
// Smoke test that runAjvValidate returns ok=false with errors when
// validator binary exits non-zero. Real AJV runtime is not exercised here
// — the binary is mocked via a tiny shell stub that exits 1 with a JSON
// error array on stdout.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertAjvValid,
  runAjvValidate,
} from "../../src/validators/strict-bridge.js";
import { ErrorCode, ProviderError, type ManifestEntry } from "../../src/types/llm-provider.js";

function sampleEntry(): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    display_id: "AUTH-01",
    title: "Login",
    intent: "authenticate user",
    user_value: "secure access",
    success_criteria: "user lands on dashboard",
    states: ["loading"],
    edge_cases: ["wrong password"],
    component_refs: [],
    data_io: ["POST /auth"],
    design_tokens: [],
    variants: [],
    navigation: ["dashboard"],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "abc123def456",
    write_target: "annotation_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 800, output_tokens: 250 },
  };
}

function makeStubValidator(scenario: "pass" | "fail"): string {
  const dir = mkdtempSync(join(tmpdir(), "figma005-strict-stub-"));
  const path = join(dir, "stub.sh");
  let body: string;
  if (scenario === "pass") {
    body = "#!/bin/sh\nexit 0\n";
  } else {
    body =
      "#!/bin/sh\n" +
      'cat <<JSON\n{"errors":[{"instancePath":"/frames/0/intent","message":"must be string","schemaPath":"#/definitions/ManifestEntry/properties/intent/type"}]}\nJSON\nexit 1\n';
  }
  writeFileSync(path, body, { mode: 0o755 });
  // Some POSIX setups require explicit chmod after Write.
  mkdirSync(dir, { recursive: true });
  return path;
}

describe("strict-bridge (REQ-03)", () => {
  it("validator pass ⇒ ok: true", () => {
    const stub = makeStubValidator("pass");
    const res = runAjvValidate(sampleEntry(), {
      validatorBinary: `sh ${stub}`,
    });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("validator fail ⇒ ok: false with instancePath surfaced", () => {
    const stub = makeStubValidator("fail");
    const res = runAjvValidate(sampleEntry(), {
      validatorBinary: `sh ${stub}`,
    });
    expect(res.ok).toBe(false);
    expect(res.errors[0].instancePath).toBe("/frames/0/intent");
    expect(res.errors[0].message).toBe("must be string");
  });

  it("assertAjvValid throws SCHEMA_AJV_VIOLATION with json_pointer", () => {
    const stub = makeStubValidator("fail");
    try {
      assertAjvValid(sampleEntry(), { validatorBinary: `sh ${stub}` });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe(ErrorCode.SCHEMA_AJV_VIOLATION);
      expect((err as ProviderError).metadata?.json_pointer).toBe(
        "/frames/0/intent",
      );
      expect((err as ProviderError).screen_id).toBe("AUTH-01");
    }
  });

  it("assertAjvValid is a no-op on validator pass", () => {
    const stub = makeStubValidator("pass");
    expect(() =>
      assertAjvValid(sampleEntry(), { validatorBinary: `sh ${stub}` }),
    ).not.toThrow();
  });
});
