// SPEC-FIGMA-019 T8 — router/HTTP prior-redaction oracle (S1, S6).
//
// RED expectation: ../src/redact-restore-descriptor.js does not exist yet (T4),
// and WriteRouterOptions has no `redactRestoreDescriptor` field yet (T5). The
// import of `redactRestoreDescriptor` fails to resolve → module-not-found, the
// expected RED failure mode for this file.
//
// Mirrors the SPEC-FIGMA-018 mock-client fixture pattern (scan/getAnnotations/
// setAnnotation as vi.fn()). The native_annotation target is registered by
// default in the AdapterRegistry, so the entry routes to it.
//
// All secrets are SYNTHETIC (acceptance.md S1):
//   labelMarkdown = "reviewer Bearer abc123def4567890 see /Users/reviewer/notes.txt"
// Placeholder per acceptance.md S1 line 17 = "***".

import { describe, it, expect, vi, afterEach } from "vitest";
import { WriteRouter } from "../src/index.js";
import { redactRestoreDescriptor } from "../src/redact-restore-descriptor.js";
import { setPluginBridgeTransport } from "../src/fallback/plugin-bridge.js";
import type { ManifestEntry, UndoDescriptor } from "../src/types.js";

// Exact synthetic secret string from acceptance.md S1 (line 11).
const SECRET_LABEL =
  "reviewer Bearer abc123def4567890 see /Users/reviewer/notes.txt";
const BEARER = "Bearer abc123def4567890";
const ABS_PATH = "/Users/reviewer/notes.txt";

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "90:0",
    title: "검색 화면",
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
    write_target: "native_annotation",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

// Mock figma client (SPEC-018 pattern). scan returns node "90:1" named
// "결과 리스트"; an area with target_area "결과 리스트" resolves to "90:1", and
// getAnnotations("90:1") returns the synthetic secret-bearing prior.
function makeMockClient(opts: {
  priorByNode?: Record<string, Array<{ labelMarkdown: string; categoryId?: string }>>;
} = {}) {
  const annotations: Record<string, Array<{ labelMarkdown: string; categoryId?: string }>> = {
    ...(opts.priorByNode ?? {}),
  };
  return {
    scan: vi.fn(async () => ({ nodes: [{ id: "90:1", name: "결과 리스트" }] })),
    getAnnotations: vi.fn(async ({ nodeId }: { nodeId: string }) => ({
      annotations: annotations[nodeId] ?? [],
    })),
    setAnnotation: vi.fn(
      async ({ nodeId, labelMarkdown, categoryId }: { nodeId: string; labelMarkdown: string; categoryId?: string }) => {
        annotations[nodeId] = [{ labelMarkdown, ...(categoryId ? { categoryId } : {}) }];
        return { success: true, nodeId };
      },
    ),
  };
}

const AREA_ENTRY = makeEntry({
  area_annotations: [
    {
      area_id: "1",
      title: "결과",
      target_area: "결과 리스트",
      description: "검색 결과를 표시한다",
    },
  ],
});

describe("SPEC-FIGMA-019 S1 — captured prior is redacted before register AND return", () => {
  it("returned undo_descriptor.prior has no Bearer/abs-path secret, replaced by '***'", async () => {
    const client = makeMockClient({
      priorByNode: { "90:1": [{ labelMarkdown: SECRET_LABEL }] },
    });
    const router = new WriteRouter({
      figma: client,
      redactRestoreDescriptor,
    });

    const result = await router.apply(AREA_ENTRY);

    const undo = result.undo_descriptor as Extract<
      UndoDescriptor,
      { type: "restore-annotation" }
    >;
    expect(undo.type).toBe("restore-annotation");
    expect(undo.node_id).toBe("90:1");

    const label = undo.prior[0].labelMarkdown;
    // Secrets removed.
    expect(label).not.toContain(BEARER);
    expect(label).not.toContain(ABS_PATH);
    // Replaced by placeholder.
    expect(label).toContain("***");
    // Non-secret tokens retained (acceptance.md line 18).
    expect(label).toContain("reviewer");
    expect(label).toContain("see");
  });

  it("the prior snapshot retains only minimized restore fields (no extraneous keys)", async () => {
    const client = makeMockClient({
      priorByNode: {
        "90:1": [
          {
            labelMarkdown: SECRET_LABEL,
            categoryId: "review",
            // An untrusted author-metadata field that must be dropped.
            author: "leaker",
          } as { labelMarkdown: string; categoryId?: string },
        ],
      },
    });
    const router = new WriteRouter({ figma: client, redactRestoreDescriptor });
    const result = await router.apply(AREA_ENTRY);

    const undo = result.undo_descriptor as Extract<
      UndoDescriptor,
      { type: "restore-annotation" }
    >;
    const keys = Object.keys(undo.prior[0]).sort();
    // Only the minimized restore fields survive: {labelMarkdown, categoryId?, properties?}.
    expect(keys).not.toContain("author");
    for (const k of keys) {
      expect(["labelMarkdown", "categoryId", "properties"]).toContain(k);
    }
  });

  it("the descriptor REGISTERED in the undo registry equals the redacted returned descriptor", async () => {
    const client = makeMockClient({
      priorByNode: { "90:1": [{ labelMarkdown: SECRET_LABEL }] },
    });
    const router = new WriteRouter({ figma: client, redactRestoreDescriptor });

    const result = await router.apply(AREA_ENTRY);
    expect(router.hasUndoEntry(result.write_id)).toBe(true);

    // Drive the registered descriptor back through undo: the setAnnotation
    // restore must use the REDACTED label, proving the registry copy was
    // scrubbed (not the raw secret).
    await router.undo(result.write_id);

    const restoreCall = client.setAnnotation.mock.calls
      .map((c) => c[0])
      .find((a) => a.nodeId === "90:1" && a.labelMarkdown.includes("reviewer"));
    expect(restoreCall).toBeDefined();
    expect(restoreCall!.labelMarkdown).not.toContain(BEARER);
    expect(restoreCall!.labelMarkdown).not.toContain(ABS_PATH);
    expect(restoreCall!.labelMarkdown).toContain("***");
  });
});

describe("SPEC-FIGMA-019 S6 — undo restores structurally from the redacted minimized prior", () => {
  it("undo issues exactly one setAnnotation with the redacted label, no secret re-introduced", async () => {
    // Descriptor already carries the redacted value (acceptance.md S6 line 57).
    const REDACTED_LABEL = "reviewer *** see ***";
    const client = makeMockClient();
    const router = new WriteRouter({ figma: client, redactRestoreDescriptor });

    // Register a descriptor directly through the apply path: prior begins empty
    // so apply mutates, then we replace the registry copy by applying with a
    // secret prior and undoing — but S6 specifically asserts the redacted-label
    // restore. Use a captured prior that is already redacted to isolate undo.
    const clientWithPrior = makeMockClient({
      priorByNode: { "90:1": [{ labelMarkdown: REDACTED_LABEL }] },
    });
    const r = new WriteRouter({ figma: clientWithPrior, redactRestoreDescriptor });
    const applied = await r.apply(AREA_ENTRY);
    clientWithPrior.setAnnotation.mockClear();

    await r.undo(applied.write_id);

    const restoreCalls = clientWithPrior.setAnnotation.mock.calls
      .map((c) => c[0])
      .filter((a) => a.nodeId === "90:1");
    expect(restoreCalls).toHaveLength(1);
    expect(restoreCalls[0].labelMarkdown).toBe(REDACTED_LABEL);
    expect(restoreCalls[0].labelMarkdown).not.toContain("abc123def4567890");
    expect(restoreCalls[0].labelMarkdown).not.toContain("/Users/reviewer");
    void client;
  });
});

describe("SPEC-FIGMA-019 S5 — no-injection identity (REQ-06)", () => {
  it("a WriteRouter built WITHOUT redactRestoreDescriptor returns the prior unchanged", async () => {
    const client = makeMockClient({
      priorByNode: { "90:1": [{ labelMarkdown: SECRET_LABEL }] },
    });
    const router = new WriteRouter({ figma: client }); // no redactor injected

    const result = await router.apply(AREA_ENTRY);
    const undo = result.undo_descriptor as Extract<
      UndoDescriptor,
      { type: "restore-annotation" }
    >;
    // Identity path: the raw captured label flows through unchanged so existing
    // callers (e.g. the daemon, which redacts at its own boundary) are unaffected.
    expect(undo.prior[0].labelMarkdown).toBe(SECRET_LABEL);
  });
});

describe("SPEC-FIGMA-019 — redactRestoreDescriptor unit (T4 contract)", () => {
  it("non-restore-annotation (noop) descriptor is returned unchanged (REQ-06 no-op)", () => {
    const noop: UndoDescriptor = { type: "noop" };
    expect(redactRestoreDescriptor(noop)).toEqual(noop);
  });

  it("minimizes prior to {labelMarkdown, categoryId?, properties?} and scrubs each text field", () => {
    const input: UndoDescriptor = {
      type: "restore-annotation",
      node_id: "90:1",
      prior: [
        {
          labelMarkdown: SECRET_LABEL,
          categoryId: "review",
        } as { labelMarkdown: string; categoryId?: string },
      ],
    };
    const out = redactRestoreDescriptor(input) as Extract<
      UndoDescriptor,
      { type: "restore-annotation" }
    >;
    expect(out.prior[0].labelMarkdown).not.toContain(BEARER);
    expect(out.prior[0].labelMarkdown).toContain("***");
    expect(out.prior[0].categoryId).toBe("review");
    // Input not mutated (new descriptor returned).
    expect(input.prior[0].labelMarkdown).toBe(SECRET_LABEL);
  });
});

describe("SPEC-FIGMA-019 — fallback path scrubs the plugin-bridge restore-annotation prior", () => {
  // Restore the default transport after every case so the injected
  // restore-annotation transport never leaks into other tests (e.g. AC-S7).
  afterEach(() => {
    setPluginBridgeTransport(null);
  });

  it("apply→fallbackToPluginBridge redacts a restore-annotation prior in BOTH the return and the registry", async () => {
    // Inject a plugin-bridge transport that returns a restore-annotation
    // descriptor carrying the synthetic secret prior (the default transport
    // returns delete-node, which exercises neither the redactor nor the seam).
    setPluginBridgeTransport({
      async send() {
        return {
          nodeId: "95:1",
          undo_descriptor: {
            type: "restore-annotation",
            node_id: "95:1",
            prior: [{ labelMarkdown: SECRET_LABEL }],
          },
        };
      },
    });

    // A figma client whose scan throws a 403 → classifyMcpError returns
    // MCP_PERMISSION_ERROR → apply routes into fallbackToPluginBridge.
    const permissionError = Object.assign(new Error("seat required"), {
      status: 403,
    });
    const client = {
      scan: vi.fn(async () => {
        throw permissionError;
      }),
      getAnnotations: vi.fn(async () => ({ annotations: [] })),
      setAnnotation: vi.fn(async () => ({ success: true })),
    };

    const router = new WriteRouter({ figma: client, redactRestoreDescriptor });

    const result = await router.apply(AREA_ENTRY);

    expect(result.fallback_used).toBe(true);
    const undo = result.undo_descriptor as Extract<
      UndoDescriptor,
      { type: "restore-annotation" }
    >;
    expect(undo.type).toBe("restore-annotation");

    // Returned descriptor is scrubbed: secrets gone, placeholder present,
    // non-secret tokens retained.
    const label = undo.prior[0].labelMarkdown;
    expect(label).not.toContain(BEARER);
    expect(label).not.toContain(ABS_PATH);
    expect(label).toContain("***");
    expect(label).toContain("reviewer");

    // Only minimized restore fields survive.
    const keys = Object.keys(undo.prior[0]);
    for (const k of keys) {
      expect(["labelMarkdown", "categoryId", "properties"]).toContain(k);
    }

    // The registry copy is the SAME scrubbed value: driving undo restores via
    // the redacted label, never the raw secret.
    expect(router.hasUndoEntry(result.write_id)).toBe(true);
    await router.undo(result.write_id);

    const restoreCall = client.setAnnotation.mock.calls
      .map((c) => c[0] as { nodeId: string; labelMarkdown: string })
      .find((a) => a.nodeId === "95:1");
    expect(restoreCall).toBeDefined();
    expect(restoreCall!.labelMarkdown).not.toContain(BEARER);
    expect(restoreCall!.labelMarkdown).not.toContain(ABS_PATH);
    expect(restoreCall!.labelMarkdown).toContain("***");
  });
});
