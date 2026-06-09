# SPEC-FIGMA-018 구현 계획 (Implementation Plan)

> Status: draft

## 구현 전략 (Strategy)

Additive only. The new `native_annotation` target is built as a set of new, single-purpose modules registered through the existing extension points, so no shared card-path file is rewritten. This protects the AC-S8 fixed 3-step decomposition (`packages/write-router/src/plan-emit/annotation-card-plan.ts`, `@AX:NOTE` at line 13) and the AC-S1 op set-equality contract (`packages/write-router/src/plan-emit/types.ts`, `@AX:ANCHOR` at line 69).

Extension points reused (verified):
- `WriteTarget` union and `UndoDescriptor` union in `packages/write-router/src/types.ts` (lines 4-10 and 70-75) — additive members only.
- `AdapterRegistry` `dynamicAdapter(ns, applyKey, undoKey)` namespace-dispatch pattern in `packages/write-router/src/registry.ts` (lines 50-96) — the new adapter is registered the same way as `annotation_card`.
- `PluginCommand` discriminated union + `PLUGIN_COMMAND_OPS` + `TARGET_TO_OP` in `packages/write-router/src/plan-emit/types.ts` — gains a new `set_native_annotation` op.
- `TOOL_NAME_MAP` and the dispatch switch in `vendor/.../autopus_command_dispatch.ts` (lines 75-86, case at line 263) — gains a `set_native_annotation` mapping and a dispatch case.
- The native runtime `setAnnotation` in `vendor/.../code.js` (line 2554, overwrite at 2629) — reused unchanged (NFR-02).
- The wire redaction boundary `redactWire` in `src/daemon/figma-plugin-client.ts:141` — reused unchanged (REQ-05).

File-size rule (NFR-01, 300-line hard limit): label composition, area-to-node resolution, the adapter, and the plan-emit helper are split into four separate files so none approaches the limit.

Naming discipline: the new autopus op is `set_native_annotation`. It is NEVER named `set_annotation`, which already routes to the card on the autopus dispatcher path.

## 태스크 목록 (Tasks)

- [ ] T1 — Type contract additions
  - Files: `packages/write-router/src/types.ts`
  - Add `"native_annotation"` to the `WriteTarget` union (after `none`).
  - Add `{ type: "restore-annotation"; node_id: string; prior: AnnotationSnapshot[] }` to the `UndoDescriptor` union, where `AnnotationSnapshot` is the minimal shape captured from `node.annotations` (see research.md OQ-2: array of `{ labelMarkdown; categoryId?; properties? }`). `prior: []` represents "node had no annotations".
  - REQ: REQ-01, REQ-06. Acceptance: S1, S6, S7.

- [ ] T2 — Native label composer
  - Files: `[NEW] packages/write-router/src/native-label.ts`
  - `composeAreaLabel(area: AreaAnnotation): string` — concise `labelMarkdown` from `title`, `target_area`, `description`, `interaction`, and `states` (omit empty fields). Distinct from the rich `renderAnnotationText` card composer in `annotation-text.ts`.
  - `composeFrameLabel(entry: ManifestEntry): string` — frame-level summary from `intent`, `user_value`, `success_criteria`.
  - `truncateLabel(label, budget)` — REQ-10 truncation with a continuation indicator (e.g. trailing `…`).
  - REQ: REQ-02, REQ-03, REQ-10. Acceptance: S1, S2, S8.

- [ ] T3 — Area-to-node resolver
  - Files: `[NEW] packages/write-router/src/area-node-resolver.ts`
  - `resolveAreaNode(area, frameNodeId, nodeIndex): AreaResolution` returning `{ node_id; fallback_used; candidates: string[]; confidence: "matched" | "fallback" | "multi" }`.
  - Heuristic (OQ-1, resolved in research.md): normalized substring/token match of `target_area` then `placement_hint` against node names supplied via `nodeIndex` (name to id map). No confident match to frame node with `fallback_used = true`. Multiple matches to record `candidates` (REQ-12).
  - `nodeIndex` is injected (the adapter builds it from scan results), keeping this module pure and testable without a live bridge.
  - REQ: REQ-04, REQ-12. Acceptance: S3, S9.

- [ ] T4 — Native annotation adapter (apply + undo)
  - Files: `[NEW] packages/write-router/src/adapters/native-annotation.ts`
  - `applyNativeAnnotation(entry, ctx)`: build the node index, for each `area_annotation` call `resolveAreaNode` (T3) and `composeAreaLabel` (T2); when there are no areas, produce one frame-level annotation via `composeFrameLabel`. For each target node, read prior `node.annotations` (via the client `getAnnotations`), then set the new annotation (vendor native op, overwrite semantics). Return one `restore-annotation` undo descriptor per node capturing `prior`.
  - `undoNativeAnnotation(descriptor, ctx)`: assert `descriptor.type === "restore-annotation"`; restore `node.annotations` to `descriptor.prior` (empty array clears). Mirrors `undoAnnotationCard`'s guard style in `adapters/annotation-card.ts:66`.
  - Idempotency (REQ-08): when the prior annotation set already equals the computed new set, return an observable no-op result (no set call), consistent with the `IDEMPOTENT_SKIP` code in `types.ts:109`.
  - `categoryId` (REQ-11): set when a category signal resolves; omit otherwise (never fail).
  - Client capability surface used: `getAnnotations`, `setAnnotation` (and `scan` for the node index) — the adapter type-narrows `ctx.figma` like `annotation-card.ts` `asClient` (line 29). The mock client in tests provides these.
  - REQ: REQ-02, REQ-03, REQ-04, REQ-06, REQ-08, REQ-11, REQ-12. Acceptance: S1, S2, S3, S6, S7, S9.

- [ ] T5 — Plan-emit helper (separate from card)
  - Files: `[NEW] packages/write-router/src/plan-emit/native-annotation-plan.ts`
  - `planNativeAnnotation(entry, ctx): readonly PluginCommand[]` — emit one `{ op: "set_native_annotation", args: { nodeId, labelMarkdown, categoryId? } }` per resolved node. This is a single-step decomposition; it does NOT reuse the card's fixed 3-step `set_annotation` decomposition and does NOT touch `annotation-card-plan.ts`.
  - REQ: REQ-02, REQ-03. Acceptance: S1, S10.

- [ ] T6 — Wire op + registry registration
  - Files: `packages/write-router/src/plan-emit/types.ts`, `packages/write-router/src/registry.ts`, `vendor/.../autopus_command_dispatch.ts`
  - In `plan-emit/types.ts`: add `{ op: "set_native_annotation"; args: SetNativeAnnotationArgs }` to `PluginCommand`, add `"set_native_annotation"` to `PLUGIN_COMMAND_OPS`, and add `native_annotation: "set_native_annotation"` to `TARGET_TO_OP`.
  - In `registry.ts`: add `"native_annotation"` to `TARGETS` and a `dynamicAdapter(nativeAnnotation, "applyNativeAnnotation", "undoNativeAnnotation")` entry in `defaultAdapters`.
  - In `autopus_command_dispatch.ts`: add `set_native_annotation: "set_annotation"` to `TOOL_NAME_MAP` (autopus op to vendor native tool), and a dispatch `case "set_native_annotation"` that runs `autopusRedact` over `labelMarkdown` and forwards to the native `set_annotation` tool. The card `case "set_annotation"` is left unchanged.
  - REQ: REQ-01, REQ-05. Acceptance: S4, S10.

- [ ] T7 — Schema mirror
  - Files: `schema/frame-description.schema.json`
  - Add `"native_annotation"` to the `write_target` enum (currently line 234). Update `schema/CHANGELOG.md` with the additive entry. No new runtime dependency.
  - REQ: REQ-01. Acceptance: covered indirectly by manifest validation; no dedicated oracle scenario.

- [ ] T8 — Review UI surface
  - Files: `apps/review-ui/src/components/FrameRow.tsx`
  - At the `write_target` rendering (line 99-101: `<dd>{entry.write_target}</dd>`), when the value is `native_annotation`, render an adjacent Dev-Mode-only-visibility hint (e.g. a `title`/badge stating native annotations show only in Figma Dev Mode). Existing rows for other targets render unchanged.
  - REQ: REQ-09. Acceptance: S11.

- [ ] T10 — Redact and minimize the captured prior snapshot at capture (REQ-14, security)
  - Files: `src/daemon/apply-tool.ts`
  - Before `recordApplied` persists the `AppliedWrite` (current capture path at lines 232-240), pass a `restore-annotation` descriptor through `redactExtendedObject` (`src/daemon/redact-extended.ts:56`) so every captured text field in `prior` is scrubbed of `figd_`/`xoxb-`/bearer/absolute-path secrets, and keep only the minimized restore fields (`labelMarkdown`, `categoryId?`, `properties?`). This closes the retained-artifact exposure on `autopus://applied_writes` (which only applies the `figd_`-only `redact` at `src/daemon/mcp-stdio-handlers.ts:180`).
  - The minimization shape itself is produced by the adapter (T4); T10 owns the redaction-before-persist wiring in the daemon apply path so ownership stays non-overlapping with T4.
  - Undo (T4 `undoNativeAnnotation`) consequently restores the redacted minimized prior state, per REQ-14.
  - REQ: REQ-14. Acceptance: S13.

- [ ] T9 — Tests
  - Files: `[NEW] packages/write-router/tests/adapters-native-annotation.test.ts`, `[NEW] packages/write-router/tests/native-label.test.ts`, `[NEW] packages/write-router/tests/area-node-resolver.test.ts`, `[NEW] packages/write-router/tests/plan-emit-native-annotation.test.ts`, `[NEW] apps/review-ui/tests/components-frame-row-native.test.tsx`, `[NEW] src/daemon/tests/apply-tool-native-annotation-redaction.test.ts`
  - Cover S1-S11 and S13 (acceptance.md). Reuse the `makeEntry` / mock-client fixture pattern from `packages/write-router/tests/adapters-annotation-card.test.ts`. Redaction test (S4) asserts a `figd_`-bearing label is absent from the serialized wire payload. Captured-prior redaction test (S13) asserts an `xoxb-`/absolute-path-bearing prior annotation is scrubbed in the persisted `AppliedWrite` while restore still succeeds structurally.
  - Verification step (AC-S8 non-regression, NFR-03 / PM-6): run the existing `packages/write-router/tests/` suite (including the annotation-card and plan-emit AC-S8 tests) and confirm zero changes/failures. Do NOT modify `annotation-card-plan.ts` or `adapters/annotation-card.ts`.
  - REQ: all. Acceptance: S1-S13 (S12 AC-S8 non-regression; S13 captured-prior redaction).

## Task to Requirement to Acceptance Map

| Task | Files (non-overlapping) | REQ IDs | Acceptance IDs |
|------|-------------------------|---------|----------------|
| T1 | types.ts | REQ-01, REQ-06 | S1, S6, S7 |
| T2 | native-label.ts (NEW) | REQ-02, REQ-03, REQ-10 | S1, S2, S8 |
| T3 | area-node-resolver.ts (NEW) | REQ-04, REQ-12 | S3, S9 |
| T4 | adapters/native-annotation.ts (NEW) | REQ-02, REQ-03, REQ-04, REQ-06, REQ-08, REQ-11, REQ-12 | S1, S2, S3, S6, S7, S9 |
| T5 | plan-emit/native-annotation-plan.ts (NEW) | REQ-02, REQ-03 | S1, S10 |
| T6 | plan-emit/types.ts, registry.ts, autopus_command_dispatch.ts | REQ-01, REQ-05 | S4, S10 |
| T7 | schema/frame-description.schema.json | REQ-01 | (manifest validation) |
| T8 | apps/review-ui/src/components/FrameRow.tsx | REQ-09 | S11 |
| T9 | tests (NEW) | all | S1-S13 |
| T10 | src/daemon/apply-tool.ts | REQ-14 | S13 |

## Feature Completion Scope

T1-T10 together close the requested outcome (native Dev-Mode annotations per area with frame fallback, redaction parity, undo restore, idempotency, plugin-consent reject, Review UI surface). No sibling SPEC is required. Parallelism: T2 and T3 are independent and can run in parallel; T1 precedes T4; T4 precedes T5/T6; T7/T8 are independent of the adapter internals; T10 wires daemon-side redaction-at-capture for REQ-14 and depends on the T1/T4 descriptor shape; T9 follows the modules it tests. File ownership is non-overlapping except the three shared registration files in T6, which are touched only by T6.
