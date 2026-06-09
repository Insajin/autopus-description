# SPEC-FIGMA-018: Native Figma Annotation Write Target for Developer Handoff

> Status: completed

**Status**: completed
**Created**: 2026-06-09
**Domain**: FIGMA
**Module**: `.` (root) — `@autopus/figma-read` monorepo
**Mode**: brownfield
**Depends on**: SPEC-FIGMA-004 (write-router, `annotation_card` adapter + registry), SPEC-FIGMA-007 (plugin command dispatch + AC-S8 partial-disconnect rollback), SPEC-FIGMA-017 (vendor write-surface unification, native annotation MCP tools)

## 목적 (Purpose)

Frame and area descriptions are delivered today only as a free-floating text card — the `annotation_card` write target, which renders a rich multi-section narrative (`renderAnnotationText` in `packages/write-router/src/annotation-text.ts:67`) as a `TEXT` node positioned next to the frame. A developer inspecting a component in Figma Dev Mode must locate that card on the canvas instead of reading the description anchored to the node.

This SPEC adds an additive write target, `native_annotation`, that delivers descriptions through Figma's native Dev-Mode annotation primitive (`labelMarkdown` plus optional `categoryId`, attached per node). The native primitive already exists in the codebase: `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/code.js:2554` (`setAnnotation`) sets `node.annotations = [newAnnotation]` at line 2629, but no description write path is wired to it. This SPEC wires it additively, leaving the `annotation_card` path and its AC-S8 rollback invariant untouched.

### Trust boundary: captured prior annotation state is untrusted input

Two distinct text surfaces exist in this feature, and they have opposite trust levels:

- The `labelMarkdown` this SPEC composes (`native-label.ts`) is author-controlled output. REQ-05 routes it through the daemon wire redactor (`redactWire`, `src/daemon/figma-plugin-client.ts:141`).
- The prior `node.annotations` value captured for undo is untrusted external input. Existing Figma annotations may have been written by any file collaborator and may contain reviewer notes, `xoxb-`/bearer tokens, or privileged absolute paths. This snapshot is embedded in the `restore-annotation` undo descriptor, persisted in `AppliedWrite` (`src/daemon/write-mcp-resources.ts:17-24`, recorded at `src/daemon/apply-tool.ts:232-240`), and served via the `autopus://applied_writes` MCP resource. That resource path applies only the `figd_`-specific redactor (`redact` at `src/daemon/mcp-stdio-handlers.ts:180`), which does not catch `xoxb-`/bearer/absolute-path secrets.

REQ-05 closes the outbound-wire path but not this retained-artifact path. REQ-14 closes it by redacting and minimizing the captured prior snapshot at capture time, before it is persisted or served.

### Naming-collision constraint (must not be violated)

The op literal `set_annotation` is overloaded across two bridges, and this SPEC keeps the new target lexically distinct from it:

- `packages/write-router/src/plan-emit/annotation-card-plan.ts:20-22` emits three `{ op: "set_annotation", ... }` plugin commands for the CARD (a fixed 3-step decomposition; line 13 carries an `@AX:NOTE` declaring it an AC-S8 rollback invariant).
- The autopus dispatcher `vendor/.../autopus_command_dispatch.ts` routes op `set_annotation` through `dispatchSetAnnotation` (line 124) to `figma.createText` / `createAreaHandoff` — that is, it draws the CARD, not a native annotation.
- The vendor runtime `code.js` `case "set_annotation"` (line 185) calls the real native API (`setAnnotation`).
- `TOOL_NAME_MAP` (`autopus_command_dispatch.ts:75`) maps autopus op `set_annotation` to vendor tool `set_annotation`.
- `TARGET_TO_OP` (`packages/write-router/src/plan-emit/types.ts:70`) maps `annotation_card` to `set_annotation`, and the `@AX:ANCHOR` at line 69 warns that drift from `TOOL_NAME_MAP` breaks AC-S1 set equality.

The native target therefore introduces a NEW plugin op name `set_native_annotation` on the autopus dispatcher path that maps to the vendor tool `set_annotation`. It never reuses the autopus `set_annotation` op, which already means draw a card.

## 요구사항 (Requirements — EARS form, MoSCoW on a separate meta line)

REQ-01
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL define a `WriteTarget` value `native_annotation` in `packages/write-router/src/types.ts` and register a corresponding adapter in the registry (`packages/write-router/src/registry.ts` `TARGETS` array and `defaultAdapters`).

REQ-02
Priority: Must
Type: Event-driven
WHEN a manifest entry has `write_target` equal to `native_annotation` and contains one or more `area_annotations`, THE SYSTEM SHALL produce exactly one native annotation per area, each attached to the node resolved for that area via the native annotation primitive carrying `labelMarkdown` and an optional `categoryId`.

REQ-03
Priority: Must
Type: Event-driven
WHEN a `native_annotation` entry contains no `area_annotations`, THE SYSTEM SHALL produce a single frame-level native annotation attached to the frame node, summarizing the entry intent, user value, and success criteria.

REQ-04
Priority: Must
Type: Event-driven
WHEN the system resolves an area to a node, THE SYSTEM SHALL match `target_area` and `placement_hint` against node names, and WHEN no confident match is found, THE SYSTEM SHALL attach the annotation to the frame node and record `fallback_used` equal to true in an observable resolution result.

REQ-05
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL route all native annotation `labelMarkdown` content through the daemon redaction boundary `redactWire` (`src/daemon/figma-plugin-client.ts:141`) before the content leaves the daemon, satisfying INV-W2.

REQ-06
Priority: Must
Type: Event-driven
WHEN a `native_annotation` apply succeeds, THE SYSTEM SHALL return an undo descriptor that captures each affected node prior `annotations` value, such that undo restores that exact prior value.

REQ-07
Priority: Must
Type: State-driven
WHILE the plugin bridge is disconnected, THE SYSTEM SHALL reject a `native_annotation` apply through the existing plugin-consent error path (INV-PLUGIN-CONSENT) and SHALL perform no mutation.

REQ-08
Priority: Must
Type: Event-driven
WHEN the same `native_annotation` entry is applied twice to the same nodes with identical content, THE SYSTEM SHALL produce an observable idempotent result with no net change to annotation state.

REQ-09
Priority: Should
Type: Event-driven
WHEN the Review UI renders a manifest entry whose `write_target` equals `native_annotation`, THE SYSTEM SHALL display the target with an indication that native annotations are visible only in Figma Dev Mode.

REQ-10
Priority: Should
Type: Event-driven
WHEN an area `labelMarkdown` exceeds the configured native annotation label length budget, THE SYSTEM SHALL truncate the label with a continuation indicator and SHALL keep the full narrative available through the existing `annotation_card` and `descriptions_page` targets.

REQ-11
Priority: Should
Type: Optional
WHERE a manifest area carries a category signal, THE SYSTEM SHALL set the native annotation `categoryId`, and WHERE no category resource exists, THE SYSTEM SHALL omit `categoryId` rather than fail the apply.

REQ-12
Priority: Nice
Type: Optional
WHERE area-to-node resolution returns multiple candidate nodes, THE SYSTEM SHALL record the candidate node id set in the resolution result for future disambiguation.

REQ-13
Priority: Nice
Type: Optional
WHERE a PM previously chose `native_annotation` for a frame, THE SYSTEM SHALL retain that choice as the suggested default on subsequent writes for the same frame.

REQ-14
Priority: Must
Type: Event-driven
WHEN the system captures the prior `node.annotations` value for a `restore-annotation` undo descriptor, THE SYSTEM SHALL minimize the snapshot to the fields required for restore and pass every captured text field through the full daemon redactor (`redactExtended` / `redactExtendedObject`, which catches `figd_`, `xoxb-`, bearer, and absolute-path secrets) before the descriptor is persisted in `AppliedWrite` or served via `autopus://applied_writes`, and undo SHALL restore the redacted minimized prior state.

## 생성/변경 파일 상세 (Files Created / Changed)

| File | New? | Role |
|------|------|------|
| `packages/write-router/src/types.ts` | existing | Add `native_annotation` to `WriteTarget`; add `restore-annotation` variant to `UndoDescriptor` carrying a minimized `prior` snapshot (REQ-14) |
| `[NEW] packages/write-router/src/native-label.ts` | new | Concise per-area and frame-level `labelMarkdown` composer (distinct from `annotation-text.ts`) |
| `[NEW] packages/write-router/src/area-node-resolver.ts` | new | `target_area`/`placement_hint` to node id resolution with fallback and confidence |
| `[NEW] packages/write-router/src/adapters/native-annotation.ts` | new | `applyNativeAnnotation` plus `undoNativeAnnotation`; minimizes the captured prior snapshot (REQ-14) |
| `[NEW] packages/write-router/src/plan-emit/native-annotation-plan.ts` | new | Single-step `set_native_annotation` plan-emit helper (separate from `annotation-card-plan.ts`) |
| `packages/write-router/src/plan-emit/types.ts` | existing | Add `set_native_annotation` op to `PluginCommand`, `PLUGIN_COMMAND_OPS`, `TARGET_TO_OP` |
| `packages/write-router/src/registry.ts` | existing | Register the native adapter via the `dynamicAdapter` pattern in `defaultAdapters`; add to `TARGETS` |
| `vendor/.../autopus_command_dispatch.ts` | existing | Add `set_native_annotation` to vendor `set_annotation` in `TOOL_NAME_MAP`; add a dispatch case that redacts `labelMarkdown` and forwards (kept minimal; no card-path edit) |
| `schema/frame-description.schema.json` | existing | Add `native_annotation` to the `write_target` enum (line 234) |
| `apps/review-ui/src/components/FrameRow.tsx` | existing | Render Dev-Mode-only-visibility hint when `write_target` is `native_annotation` (line 99-101 region) |

## Related SPECs

This is a single SPEC. It depends on SPEC-FIGMA-004, SPEC-FIGMA-007, and SPEC-FIGMA-017 (existing, already implemented). No sibling SPEC is required to close the requested outcome.

Deferred follow-ups and tracked debt are itemized authoritatively in `research.md` under `## Completion Debt` and `## Evolution Ideas` (they are not duplicated here to keep ownership single-sourced).

## Feature Completion Scope

The requested outcome — descriptions delivered as native Dev-Mode annotations anchored to nodes — closes entirely within this SPEC: one additive `WriteTarget`, one adapter (apply plus undo), one plan-emit helper, one area-to-node resolver, one label composer, the wire op wiring, the schema mirror, the Review UI surface, and the redaction/undo/idempotency tests. All modules live in the `packages/write-router` plus `apps/review-ui` plus autopus-dispatcher boundary and share one acceptance story (see `acceptance.md`). The `annotation_card` AC-S8 path is explicitly not modified (NFR-03, PM-6).

## Traceability Matrix

Every requirement maps to at least one plan task and one acceptance scenario. Plan task IDs are defined in `plan.md`; scenario IDs in `acceptance.md`.

| REQ | Priority | Plan task(s) | Acceptance scenario(s) |
|-----|----------|--------------|------------------------|
| REQ-01 | Must | T1, T6, T7 | S10 (+ schema validation via T7) |
| REQ-02 | Must | T2, T3, T4, T5 | S1, S10 |
| REQ-03 | Must | T2, T4, T5 | S2 |
| REQ-04 | Must | T3, T4 | S1, S3 |
| REQ-05 | Must | T6 | S4 |
| REQ-06 | Must | T1, T4 | S6, S7 |
| REQ-07 | Must | T4 | S5 |
| REQ-08 | Must | T4 | S8 |
| REQ-09 | Should | T8 | S11 |
| REQ-10 | Should | T2 | S9 |
| REQ-11 | Should | T4 | adapter unit (categoryId omit-on-absent) |
| REQ-12 | Nice | T3 | resolver unit (multi-candidate); S9 path |
| REQ-13 | Nice | T8 | UI unit (suggested-default persistence) |
| REQ-14 | Must | T4, T10 | S13 |
