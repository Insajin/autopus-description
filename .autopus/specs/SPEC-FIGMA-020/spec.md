# SPEC-FIGMA-020: Hybrid Dual-Write — Native Annotation Summary + Real-Table Policy Card in One Apply

> Status: approved

**Status**: approved
**Created**: 2026-06-10
**Domain**: FIGMA
**Module**: `.` (root) — `@autopus/figma-mcp` monorepo (cross-package: `packages/write-router` + `apps/review-ui` + `vendor/cursor-talk-to-figma-mcp` integration layer + `schema/` + `src/prompts` + `src/daemon` + `tools/validate-manifest`)
**Mode**: brownfield
**Depends on**: SPEC-FIGMA-018 (`native_annotation` target, `restore-annotation` descriptor, daemon `redactAndMinimizePrior`, AC-S8 naming-collision rule), SPEC-FIGMA-019 (router/HTTP-path `redactRestoreDescriptor` seam, `KNOWN_WRITE_TARGETS` gate, `@autopus/redact-patterns`), SPEC-FIGMA-017 (vendor write-surface unification, native annotation tools), SPEC-FIGMA-007 (plugin command dispatch, AC-S8 partial-disconnect rollback, `TARGET_TO_OP`/`TOOL_NAME_MAP` parity), SPEC-FIGMA-004 (`WriteRouter`, adapter registry, undo registry)

## 목적 (Purpose)

A frame's handoff content is delivered today through exactly one surface per apply. `native_annotation` (SPEC-FIGMA-018) attaches a concise `labelMarkdown` to the resolved node, readable inline in Dev Mode, but the native primitive's `labelMarkdown` does not render tables, so the policy definition (states, edge_cases, data_requirements, area policies) collapses into prose. `annotation_card` renders a rich multi-section narrative as a separate node via the real-node renderer `createAreaHandoffCanvas` (`vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_area_handoff_renderer.ts:214`), but it is a free-floating card a developer must hunt for and it is not anchored to the node. A PM must choose one surface or run two applies manually. SPEC-FIGMA-018 research.md `## Evolution Ideas` explicitly DEFERRED the coupled hybrid dual-write (PRD Option c).

This SPEC delivers both surfaces in a single apply through a new composite write target. The native annotation carries the concise description (frame intent / user_value / success_criteria summary, plus short per-area description+policy) anchored to the node; a separate card next to the frame renders the policy definition as REAL Figma auto-layout tables (states, edge_cases, data_requirements, and area_annotations as row/column cells). The native annotation is committed first and is authoritative; if the card step fails the native annotation is KEPT and only the card is retryable.

### Surface split (locked decision D1)

The two surfaces carry different content for a reason rooted in the runtime, not preference.

- Native annotation `labelMarkdown` does NOT support tables. It therefore carries the CONCISE description only — the frame summary and short per-area description+policy — reusing the existing `composeFrameLabel` and `composeAreaLabel` composers (`packages/write-router/src/native-label.ts:27-44`) unchanged.
- The card carries the POLICY DEFINITION as real Figma tables (auto-layout cells), NOT markdown pipe pseudo-tables inside a TEXT node. It is built additively on the real-node renderer `createAreaHandoffCanvas` (gated by `supportsAreaHandoffRuntime`, `autopus_area_handoff_renderer.ts:249`), extending it with table-cell construction.

### Trust boundary: both authored text and captured prior must stay redacted (locked decision D4)

Three distinct text surfaces exist and they carry distinct trust handling, all of which this SPEC MUST preserve without regression.

- Authored `labelMarkdown` (native) AND all card text are author-controlled output but still routed through the daemon wire redactor `redactWire` (`src/daemon/figma-plugin-client.ts:141`) before leaving the daemon (REQ-05 parity, INV-W2). Both ops in the composite emit text that crosses this boundary.
- The captured prior `node.annotations` snapshot for the native undo is untrusted external input: any file collaborator may have left reviewer notes, `xoxb-`/bearer tokens, or privileged absolute paths. It is minimized and passed through the full daemon redactor (`redactAndMinimizePrior` in `src/daemon/redact-prior-annotation.ts`, which calls `redactExtendedObject` in `src/daemon/redact-extended.ts`) before persistence in `AppliedWrite` and serving via `autopus://applied_writes` (REQ-14 parity, INV-011).
- The review-ui HTTP apply path (`apps/review-ui/src/app/api/apply/route.ts`) has a `KNOWN_WRITE_TARGETS` allow-list gate (lines 30-37) and a write-router-side `redactRestoreDescriptor` injected into the process-scoped `WriteRouter` (line 24). The NEW composite target MUST be added to that allow-list AND its captured-prior snapshot MUST route through the write-router `redactRestoreDescriptor` seam (`packages/write-router/src/index.ts:144`) so the HTTP path does not leak the same class of secret SPEC-FIGMA-019 closed.

### Naming-collision constraint (locked decision D4, inherited from SPEC-FIGMA-018)

`set_annotation` is overloaded: the autopus op `set_annotation` means draw a card (`dispatchSetAnnotation`, `autopus_command_dispatch.ts:133`), and `set_native_annotation` means native Dev-Mode annotation (`dispatchSetNativeAnnotation`, line 189). The NEW plugin op for the structured-table card MUST be lexically distinct from BOTH and from the new composite target name. The composite target maps to TWO plugin ops; the new structured-table card op is introduced as a distinct literal and mapped correctly in `TOOL_NAME_MAP` (`autopus_command_dispatch.ts:80`) and the write-router maps (`packages/write-router/src/plan-emit/types.ts`).

### AC-S8 non-regression (locked decision D4)

The existing `annotation_card` 3-step `set_annotation` decomposition and its rollback invariant (`packages/write-router/src/plan-emit/annotation-card-plan.ts`) MUST NOT be modified. The new card op for the table layout stays distinct from that path; the area-handoff canvas renderer is extended additively (table-cell construction added; existing badge/text construction byte-unchanged).

## 요구사항 (Requirements — EARS form, MoSCoW on a separate meta line)

REQ-01
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL define a new composite `WriteTarget` value `native_annotation_with_card` in `packages/write-router/src/types.ts` and register a corresponding composite adapter in the registry (`packages/write-router/src/registry.ts` `TARGETS` array and `defaultAdapters`), lexically distinct from `native_annotation` and `annotation_card`.

REQ-02
Priority: Must
Type: Event-driven
WHEN a manifest entry has `write_target` equal to `native_annotation_with_card`, THE SYSTEM SHALL emit, in one apply, BOTH the native annotation operation (carrying the concise composed `labelMarkdown` per resolved node, reusing `composeFrameLabel` and `composeAreaLabel`) AND a single card operation that renders the policy definition as a real-node card, ordered so the native annotation operation precedes the card operation.

REQ-03
Priority: Must
Type: Event-driven
WHEN the card operation renders the policy definition, THE SYSTEM SHALL build the card as real Figma auto-layout tables in which `states`, `edge_cases`, `data_requirements`, and `area_annotations` each map to a table with a fixed header row and one row per source item, extending `createAreaHandoffCanvas` additively, and SHALL NOT render the policy as markdown pipe pseudo-tables inside a single TEXT node.

REQ-04
Priority: Must
Type: Event-driven
WHEN building each policy table, THE SYSTEM SHALL map each structured item field to a dedicated column so that a `state` object maps to the columns state, trigger, result; an `edge_case` object maps to the columns case, risk, handling; a `data_requirement` maps to the columns name, purpose, required values; and an `area_annotation` maps to the columns area, description, policy.

REQ-05
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL add additive structured object shapes to `schema/frame-description.schema.json` as schema version v0.4.0 so that a `state` item MAY be either a string or an object with required `state` and optional `trigger` and `result`, and an `edge_case` item MAY be either a string or an object with required `case` and optional `risk` and `handling`, while every existing string form remains accepted via a union and every existing manifest still validates.

REQ-06
Priority: Must
Type: Event-driven
WHEN the table builder receives a `state` or `edge_case` value in the legacy string form, THE SYSTEM SHALL render that string into the first column of its table row and leave the remaining columns of that row empty, so that legacy string manifests and new structured manifests render in the same table without error.

REQ-07
Priority: Must
Type: Event-driven
WHEN a `native_annotation_with_card` apply runs, THE SYSTEM SHALL commit the native annotation operation first as the authoritative surface, and WHEN the subsequent card operation fails, THE SYSTEM SHALL keep the committed native annotation, SHALL NOT roll back the native annotation, and SHALL surface the card operation as retryable.

REQ-08
Priority: Must
Type: Event-driven
WHEN a `native_annotation_with_card` apply succeeds across both surfaces, THE SYSTEM SHALL produce a single compound undo descriptor that reverses BOTH surfaces so that one undo restores the prior native annotation state and removes the card node.

REQ-09
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL route all native `labelMarkdown` and all card text emitted by the composite target through the daemon wire redactor `redactWire` (`src/daemon/figma-plugin-client.ts:141`) before the payload leaves the daemon, preserving the SPEC-FIGMA-018 REQ-05 boundary (INV-W2) for both operations.

REQ-10
Priority: Must
Type: Event-driven
WHEN the composite apply captures the prior `node.annotations` snapshot for the native undo, THE SYSTEM SHALL minimize that snapshot and pass it through the full daemon redactor (`redactAndMinimizePrior`, which calls `redactExtendedObject`) before it is persisted in `AppliedWrite` or served via `autopus://applied_writes`, preserving the SPEC-FIGMA-018 REQ-14 behavior (INV-011).

REQ-11
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL add `native_annotation_with_card` to the `KNOWN_WRITE_TARGETS` allow-list in `apps/review-ui/src/app/api/apply/route.ts` AND SHALL route the composite captured-prior snapshot through the write-router `redactRestoreDescriptor` seam (`packages/write-router/src/index.ts:144`) so the HTTP `undo_descriptor` response body never carries an unredacted captured prior secret, closing the SPEC-FIGMA-019 class of leak for the new target.

REQ-12
Priority: Must
Type: Unwanted-behavior
IF the composite target is implemented, THEN THE SYSTEM SHALL leave the `annotation_card` 3-step `set_annotation` decomposition (`packages/write-router/src/plan-emit/annotation-card-plan.ts`) and its AC-S8 rollback invariant byte-unchanged, and the new structured-table card operation SHALL use a plugin op literal distinct from both `set_annotation` and `set_native_annotation`.

REQ-13
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL map the composite target to its two plugin ops consistently across `TARGET_TO_OP` and `PLUGIN_COMMAND_OPS` (`packages/write-router/src/plan-emit/types.ts`) and `TOOL_NAME_MAP` (`vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts:80`), and SHALL add a dispatch case for the new structured-table card op that routes through `createAreaHandoffCanvas`.

REQ-14
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL add `native_annotation_with_card` to the `write_target` enum in `schema/frame-description.schema.json` and mirror both the enum widening and the structured `state` and `edge_case` union in `schema/CHANGELOG.md` as the v0.4.0 additive-minor entry.

REQ-15
Priority: Must
Type: Event-driven
WHEN the generation prompt emits a frame description, THE SYSTEM SHALL update `src/prompts/node-only.ts` (`SCHEMA_HINT` and `HANDOFF_RULES`) to emit the structured `state` and `edge_case` object shapes, while preserving the exact prompt substrings asserted by `tests/unit/project-brief-prompt.test.ts`.

REQ-16
Priority: Must
Type: Event-driven
WHEN a manifest is validated, THE SYSTEM SHALL keep the validator under `tools/validate-manifest/` accepting both the legacy string forms and the new structured object forms of `state` and `edge_case`, and SHALL continue to reject genuinely malformed entries.

REQ-17
Priority: Should
Type: Event-driven
WHEN the review-ui renders a frame whose `write_target` is `native_annotation_with_card`, THE SYSTEM SHALL surface a hint in `apps/review-ui/src/components/FrameRow.tsx` that the apply writes both a Dev-Mode annotation and a separate policy card, mirroring the existing `native_annotation` Dev-Mode hint pattern (lines 102-111).

REQ-18
Priority: Should
Type: State-driven
WHILE a consumer such as the daemon already redacts the captured prior at its own boundary, THE SYSTEM SHALL keep the write-router `redactRestoreDescriptor` seam injectable or omittable as a no-op for the composite target without changing the SPEC-FIGMA-018 daemon redaction behavior.

## 생성/변경 파일 상세 (Files Created / Changed)

| File | New? | Role |
|------|------|------|
| `packages/write-router/src/types.ts` | existing | Add `native_annotation_with_card` to `WriteTarget`; add a compound undo descriptor variant carrying both the `restore-annotation` prior and the card `delete-node` (REQ-01, REQ-08) |
| `packages/write-router/src/registry.ts` | existing | Add `native_annotation_with_card` to `TARGETS` and `defaultAdapters` via the existing `dynamicAdapter` pattern (REQ-01) |
| `[NEW] packages/write-router/src/adapters/native-annotation-with-card.ts` | new | Composite adapter: applies native annotation first (authoritative), then the card; composes the compound undo descriptor; partial-failure keeps native (REQ-02, REQ-07, REQ-08) |
| `[NEW] packages/write-router/src/card-table-payload.ts` | new | Pure builder: maps structured/legacy `states`, `edge_cases`, `data_requirements`, `area_annotations` into a column-mapped table payload (REQ-03, REQ-04, REQ-06) |
| `[NEW] packages/write-router/src/structured-policy.ts` | new | Union normalizers: coerce a string-or-object `state` and `edge_case` into a uniform internal row shape for the table builder (REQ-05, REQ-06) |
| `[NEW] packages/write-router/src/plan-emit/native-annotation-with-card-plan.ts` | new | Plan-emit helper: emits the native op(s) then ONE card-table op; distinct op literal; never touches `annotation-card-plan.ts` (REQ-02, REQ-12, REQ-13) |
| `packages/write-router/src/plan-emit/types.ts` | existing | Add the new card-table op to `PluginCommand` and `PLUGIN_COMMAND_OPS`; map `native_annotation_with_card` in `TARGET_TO_OP` and document the secondary op (REQ-13) |
| `packages/write-router/src/plan-emit/index.ts` | existing | Add `native_annotation_with_card` to `dispatchPlan`, `UNDO_TEMPLATE` (compound), and `templateFor` (REQ-08, REQ-13) |
| `packages/write-router/src/index.ts` | existing | Extend `redactRestoreDescriptor` application to reach the compound descriptor embedded `restore-annotation` prior on the executor path (REQ-11, REQ-18) |
| `packages/write-router/src/redact-restore-descriptor.ts` | existing | Recurse into the compound descriptor variant and scrub its embedded `restore-annotation` prior (REQ-11) |
| `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_area_handoff_renderer.ts` | existing | Add additive table-cell construction (header row + per-item rows, auto-layout) reused by the new card op; existing badge/text construction byte-unchanged (REQ-03, REQ-04, D4 AC-S8) |
| `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts` | existing | Add the new card-table op to `TOOL_NAME_MAP` and a dispatch case routing through `createAreaHandoffCanvas`; redact text via `autopusRedact` (REQ-13, REQ-09) |
| `src/daemon/apply-tool.ts` | existing | Hydrate the compound undo descriptor; commit native first; keep native on card-step failure and surface card as retryable rather than rolling back native (REQ-07, REQ-08, REQ-10) |
| `src/daemon/redact-prior-annotation.ts` | existing | Recurse into the compound descriptor variant so the embedded captured prior is redacted+minimized before persistence/serving on the daemon path (REQ-10) |
| `schema/frame-description.schema.json` | existing | Widen `write_target` enum with `native_annotation_with_card`; make `states[]` and `edge_cases[]` items a union of the existing string and the new structured object (REQ-05, REQ-14) |
| `schema/CHANGELOG.md` | existing | v0.4.0 additive-minor entry: enum widening + structured `state`/`edge_case` union + back-compat statement (REQ-14) |
| `src/prompts/node-only.ts` | existing | Update `SCHEMA_HINT` + `HANDOFF_RULES` to emit structured `state`/`edge_case` shapes; preserve the `project-brief-prompt.test.ts` substrings (REQ-15) |
| `tools/validate-manifest/src/index.ts` | existing | No code change expected when the validator compiles the schema directly; if a fixture or schema-path assumption breaks, adjust additively (REQ-16) |
| `apps/review-ui/src/app/api/apply/route.ts` | existing | Add `native_annotation_with_card` to `KNOWN_WRITE_TARGETS` (REQ-11) |
| `apps/review-ui/src/components/FrameRow.tsx` | existing | Add a dual-surface hint for the composite target, mirroring the native hint (REQ-17) |
| `[NEW] packages/write-router/tests/card-table-payload.test.ts` | new | Oracle: 2 states + 1 edge case + 2 data requirements produce expected table/row/column counts and cell contents (S1); legacy string state row (S3) |
| `[NEW] packages/write-router/tests/structured-policy.test.ts` | new | Unit: union normalizer for string vs object `state`/`edge_case` (S3) |
| `[NEW] packages/write-router/tests/adapters-native-annotation-with-card.test.ts` | new | Oracle: both surfaces applied; compound undo reverses both (S5); card-step failure keeps native + card absent + retryable (S4) |
| `[NEW] packages/write-router/tests/plan-emit-native-annotation-with-card.test.ts` | new | Oracle: emits native op then ONE distinct card op; `annotation-card-plan` output byte-unchanged (S6, S8) |
| `[NEW] tests/integration/figma-020/dual-write.test.ts` | new | Integration: composite apply dispatches both ops; combined undo; partial-failure native-kept (S4, S5) |
| `[NEW] tests/integration/figma-020/redaction-parity.test.ts` | new | Oracle: synthetic xoxb token + absolute path in captured prior absent in persisted artifact AND in HTTP response, for the composite target (S7) |
| `[NEW] tests/unit/schema-v0_4_0-backcompat.test.ts` | new | Oracle: a manifest using the OLD string `states` form still validates against v0.4.0; a new structured form validates (S2) |

## Related SPECs

This is a single cohesive SPEC. It closes the locked completion outcome (dual-surface delivery: a concise native description plus a real-table policy card, in one apply, with a combined undo and native-authoritative partial-failure) as one change story across the write-router, the vendor integration layer, the schema, the prompt, the validator, the daemon apply path, and the review-ui surface. The structured-schema migration (REQ-05, REQ-06, REQ-14, REQ-15, REQ-16) is small and additive (a string-or-object union plus a prompt and validator mirror) and is sequenced as an early task group in `plan.md` rather than split into a sibling SPEC, because the table builder (REQ-03, REQ-04) depends on it directly and a standalone schema SPEC would deliver no observable behavior alone (Q-COH-03 would fail for an over-split scaffold). See `research.md` `## Sibling-vs-single decision` for the justification.

Dependencies are inbound: SPEC-FIGMA-018 (the `native_annotation` target, the `restore-annotation` descriptor, the daemon `redactAndMinimizePrior`, the naming-collision rule), SPEC-FIGMA-019 (the router and HTTP `redactRestoreDescriptor` seam and the `KNOWN_WRITE_TARGETS` gate this SPEC extends), SPEC-FIGMA-017 (vendor native annotation tools), SPEC-FIGMA-007 (plugin dispatch, AC-S8, and `TARGET_TO_OP`/`TOOL_NAME_MAP` parity), SPEC-FIGMA-004 (`WriteRouter`, registry, undo registry). All are already implemented.

## Feature Completion Scope

The full outcome closes within this SPEC. The CAPABILITY (composite target + structured schema + real-table renderer + compound undo) and the WIRING (registry registration, `TARGET_TO_OP`/`TOOL_NAME_MAP` mapping, daemon hydrate plus partial-failure handling, review-ui allow-list plus redaction seam, prompt plus validator mirror) are both delivered here. A schema or renderer addition alone does not produce a dual-surface apply, and a composite adapter alone has no structured columns to render, so they ship together. The SPEC-FIGMA-018 daemon `native_annotation` path, the SPEC-FIGMA-019 router and HTTP path, and the SPEC-FIGMA-018 AC-S8 card decomposition are all held as non-regression. Items intentionally not in scope are itemized in `research.md` `## Completion Debt` and `## Evolution Ideas`.

## Traceability Matrix

Plan task IDs are defined in `plan.md`; scenario IDs in `acceptance.md`.

| REQ | Priority | Plan task(s) | Acceptance scenario(s) |
|-----|----------|--------------|------------------------|
| REQ-01 | Must | T1, T5 | S5 |
| REQ-02 | Must | T5, T6 | S5, S6 |
| REQ-03 | Must | T3, T7 | S1 |
| REQ-04 | Must | T3 | S1 |
| REQ-05 | Must | T2, T9 | S2 |
| REQ-06 | Must | T2, T3 | S3 |
| REQ-07 | Must | T5, T8 | S4 |
| REQ-08 | Must | T1, T5, T8 | S5 |
| REQ-09 | Must | T6, T7 | S7 |
| REQ-10 | Must | T8, T11 | S7 |
| REQ-11 | Must | T11, T12 | S7 |
| REQ-12 | Must | T6, T13 | S8 |
| REQ-13 | Must | T6, T7 | S6, S8 |
| REQ-14 | Must | T9 | S2 |
| REQ-15 | Must | T10 | S2, unit |
| REQ-16 | Must | T9 | S2 |
| REQ-17 | Should | T12 | unit |
| REQ-18 | Should | T11 | S7 |
