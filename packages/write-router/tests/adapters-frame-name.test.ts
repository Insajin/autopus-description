// SPEC-FIGMA-004 W2 unit — frame_name adapter (REQ-05, REQ-08, INV-005).
//
// Verifies the X4 canvas-pollution opt-in gate:
//   - Gate OFF (default) → throws FRAME_NAME_OPT_IN_REQUIRED, ZERO Figma calls.
//   - Gate ON via env    → setFrameName invoked, warning emitted, undo restores.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  applyFrameName,
  undoFrameName,
  setFrameNameOptInProvider,
  FRAME_NAME_WARNING,
} from "@autopus/write-router/adapters/frame-name";
import type { ManifestEntry } from "@autopus/write-router/types";

interface SetNameCall {
  node_id: string;
  name: string;
}

function makeClient(initialName = "Login") {
  let current = initialName;
  const calls = {
    getFrameName: [] as string[],
    setFrameName: [] as SetNameCall[],
  };
  return {
    calls,
    async getFrameName(node_id: string) {
      calls.getFrameName.push(node_id);
      return current;
    },
    async setFrameName(node_id: string, name: string) {
      calls.setFrameName.push({ node_id, name });
      current = name;
    },
    readFrameName(): string {
      return current;
    },
  };
}

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "Login",
    intent: "auth gate",
    user_value: "v",
    success_criteria: "s",
    states: [],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "h",
    write_target: "frame_name",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  } as ManifestEntry;
}

beforeEach(() => {
  setFrameNameOptInProvider(null);
  delete process.env.ALLOW_FRAME_NAME;
});

afterEach(() => {
  setFrameNameOptInProvider(null);
  delete process.env.ALLOW_FRAME_NAME;
  vi.restoreAllMocks();
});

describe("frame_name adapter — gate OFF (default disabled, REQ-05/INV-005)", () => {
  it("throws FRAME_NAME_OPT_IN_REQUIRED and invokes zero Figma methods", async () => {
    const client = makeClient();

    const err = await applyFrameName(makeEntry(), { figma: client }).catch((e) => e);

    expect((err as { code?: string }).code).toBe("FRAME_NAME_OPT_IN_REQUIRED");
    expect(client.calls.getFrameName).toHaveLength(0);
    expect(client.calls.setFrameName).toHaveLength(0);
  });
});

describe("frame_name adapter — gate ON via env (REQ-05)", () => {
  beforeEach(() => {
    process.env.ALLOW_FRAME_NAME = "1";
  });

  it("sets new name 'Login · AUTH-01' and emits the X4 warning literal", async () => {
    const client = makeClient("Login");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entry = makeEntry({ screen_id: "AUTH-01" });

    const result = await applyFrameName(entry, { figma: client });

    expect(client.calls.setFrameName).toHaveLength(1);
    expect(client.calls.setFrameName[0].name).toBe("Login · AUTH-01");
    expect(result.undo_descriptor).toEqual({
      type: "restore-frame-name",
      node_id: "1:1",
      original_name: "Login",
    });
    expect(result.fallback_used).toBe(false);
    const warnings = warnSpy.mock.calls.flat().join(" ");
    expect(warnings).toContain(FRAME_NAME_WARNING);
  });

  it("undo restores the original frame name byte-for-byte", async () => {
    const client = makeClient("Login");
    const entry = makeEntry({ screen_id: "AUTH-01" });

    const result = await applyFrameName(entry, { figma: client });
    await undoFrameName(result.undo_descriptor, { figma: client });

    expect(client.readFrameName()).toBe("Login");
  });

  it("uses ctx.warn when provided instead of console.warn", async () => {
    const client = makeClient("Login");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctxWarn = vi.fn();

    await applyFrameName(makeEntry(), { figma: client, warn: ctxWarn });

    expect(ctxWarn).toHaveBeenCalledTimes(1);
    expect(ctxWarn.mock.calls[0][0]).toBe(FRAME_NAME_WARNING);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("frame_name adapter — gate ON via injected provider", () => {
  it("respects a custom opt-in provider that returns true", async () => {
    setFrameNameOptInProvider({ isAllowed: () => true });
    const client = makeClient("Frame");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await applyFrameName(makeEntry({ screen_id: "X-1" }), {
      figma: client,
    });

    expect(client.calls.setFrameName[0].name).toBe("Frame · X-1");
    expect((result.undo_descriptor as { original_name?: string }).original_name).toBe(
      "Frame",
    );
  });
});
