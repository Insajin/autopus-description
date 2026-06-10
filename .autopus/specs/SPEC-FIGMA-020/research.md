# SPEC-FIGMA-020 리서치 (Research)

> Status: draft

## 기존 코드 분석 (Existing Code Analysis — verified by Read/Grep)

| Concern | Location (verified) | Fact |
|---------|---------------------|------|
| WriteTarget union (7 members) | `packages/write-router/src/types.ts:4-11` | `annotation_card`, `descriptions_page`, `comment`, `plugin_data`, `frame_name`, `none`, `native_annotation` |
| UndoDescriptor union (6 variants) | `packages/write-router/src/types.ts:82-88` | `delete-node`, `delete-comment`, `clear-plugin-data`, `restore-frame-name`, `restore-annotation`, `noop` (no compound variant yet) |
| AnnotationSnapshot | `packages/write-router/src/types.ts:17-21` | `{ labelMarkdown; categoryId?; properties? }` |
| Registry TARGETS + dynamicAdapter | `packages/write-router/src/registry.ts:18-26, 52-103, 144` | `TARGETS` array, `dynamicAdapter` namespace dispatch, `defaultAdapters`, `KNOWN_TARGETS` export |
| Native adapter (reuse) | `packages/write-router/src/adapters/native-annotation.ts:116-180` | `applyNativeAnnotation` (capture-prior seam `@AX:WARN` line 114), `undoNativeAnnotation`, `minimizePrior` (96-102), `LABEL_BUDGET=500` |
| Native label composers (reuse) | `packages/write-router/src/native-label.ts:27-55` | `composeAreaLabel`, `composeFrameLabel`, `truncateLabel`, omit-empty behavior |
| Card text/visual builder (extend for tables) | `packages/write-router/src/annotation-text.ts:67-135` | `renderAnnotationText`, `renderArea`, `renderDataRequirement`, `buildAnnotationVisualPayload`, `buildAnnotationCreateArgs` (the area-callout payload feeding the card) |
| Card plan-emit (DO NOT MODIFY) | `packages/write-router/src/plan-emit/annotation-card-plan.ts:13-24` | `@AX:NOTE` AC-S8 invariant; fixed 3 `set_annotation` steps create-node/set-text/attach-link |
| Native plan-emit (reuse) | `packages/write-router/src/plan-emit/native-annotation-plan.ts:42-72` | `planNativeAnnotation`; single `set_native_annotation` op per node; `LABEL_BUDGET=500` |
| PluginCommand union + maps | `packages/write-router/src/plan-emit/types.ts:50-90` | `SetNativeAnnotationArgs`, `PluginCommand`, `PLUGIN_COMMAND_OPS`, `TARGET_TO_OP`; `@AX:NOTE` naming-collision (line 50), `@AX:ANCHOR` (line 80) |
| Plan-emit dispatch + UNDO_TEMPLATE | `packages/write-router/src/plan-emit/index.ts:26-90` | `UNDO_TEMPLATE` per target (native = `restore-annotation` empty prior, line 28), `dispatchPlan`, `templateFor`, `planEmit` |
| WriteRouter apply + redact seam | `packages/write-router/src/index.ts:38-51, 144-173` | `redactRestoreDescriptor?` option (line 50, identity default line 81), capture-redaction seam `@AX:ANCHOR` line 142-144 applied to `undo_descriptor` |
| Router redactor (extend recursion) | `packages/write-router/src/redact-restore-descriptor.ts:54-65` | `redactRestoreDescriptor`: scrubs only the `restore-annotation` variant; returns other variants unchanged |
| Package exports | `packages/write-router/package.json:8-17` | `./redact-restore-descriptor`, `./redactor`, `./types` subpaths exist |
| Vendor renderer (extend additively) | `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_area_handoff_renderer.ts:214-252` | `createAreaHandoffCanvas` (frame + badges + doc text via `createFrame`/`createText`/`createRectangle`), `supportsAreaHandoffRuntime`, helpers `chooseDocumentBox`, `boxOf`, `addText`, `addBadge` |
| Vendor dispatcher + TOOL_NAME_MAP | `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts:80-95, 133-201, 282-309` | `TOOL_NAME_MAP`, `dispatchSetAnnotation` (card, line 133), `dispatchSetNativeAnnotation` (native, line 189), `dispatchPluginCommand` switch (line 282) all redact via `autopusRedact`/`autopusRedactObject` |
| Daemon apply (compound hydrate + partial) | `src/daemon/apply-tool.ts:94-119, 196-230` | `hydrateUndoDescriptor` (restore-annotation branch line 108-115), sequential `for cmd of pending.plugin_commands` (199), partial-disconnect stash-all-completed rollback (205-215), `redactAndMinimizePrior` applied before recordApplied (227-229) |
| Daemon prior redactor (extend recursion) | `src/daemon/redact-prior-annotation.ts:53-61` | `redactAndMinimizePrior`: scrubs the `restore-annotation` prior via `redactExtendedObject`; no compound variant |
| Daemon extended redactor | `src/daemon/redact-extended.ts:36-67` | `redactExtended`, `redactWire` (line 51), `redactExtendedObject` (figd_/xoxb-/bearer/abs-path) |
| Wire redactor boundary | `src/daemon/figma-plugin-client.ts:141` | outbound `redactWire(JSON.stringify(envelope))` (per SPEC-FIGMA-018 research) |
| Review-UI HTTP route | `apps/review-ui/src/app/api/apply/route.ts:24, 30-37, 47-72` | `redactRestoreDescriptor` injected (line 24), `KNOWN_WRITE_TARGETS` allow-list (lacks `native_annotation`), `validateEntryShape` enum gate |
| Review-UI FrameRow render | `apps/review-ui/src/components/FrameRow.tsx:99-113` | `write_target` dd; existing `native_annotation` Dev-Mode hint block |
| Schema | `schema/frame-description.schema.json:60-68, 232-235` | `states.items`/`edge_cases.items` are `{type: string, minLength: 1}`; `write_target` enum (6 values incl. native_annotation, lacks comment) |
| Schema changelog | `schema/CHANGELOG.md:8-17` | v0.3.0 latest (native_annotation enum add); additive-minor versioning policy |
| Prompt | `src/prompts/node-only.ts:55-114` | `SCHEMA_HINT` (states/edge_cases as tight string lines), `HANDOFF_RULES`, `systemBase` |
| Prompt substring lock | `tests/unit/project-brief-prompt.test.ts:77-99` | asserts "trigger -> UI/data/motion expectation", "area_annotations", "data_requirements", "numbered UI regions", "배지 1", "reset scope", "reduced-motion", "text alternatives", "exact user-facing copy", etc. |
| Validator | `tools/validate-manifest/src/index.ts:61-68, 130` | AJV 2020 strict, compiles `frame-description.schema.json` + `description-manifest.schema.json` directly from `schema/` dir (no enum hardcode) |

## 설계 결정 (Design Decisions)

- D1 — Two surfaces, two content shapes, by runtime constraint. The native `labelMarkdown` primitive does not render tables (confirmed by the SPEC-FIGMA-018 design and the `composeAreaLabel`/`composeFrameLabel` line-based composers in `native-label.ts`). Therefore the concise description goes to the native annotation and the policy tables go to the card. This is the locked decision D1, not a preference. High confidence.
- D2 — Composite adapter orchestrates two existing surfaces; no shared-path rewrite. The composite adapter `[NEW] adapters/native-annotation-with-card.ts` calls the existing `applyNativeAnnotation` first, then the card render. It does not fork either path. This keeps the SPEC-FIGMA-018 native adapter and the AC-S8 card plan untouched. High confidence.
- D3 — Compound undo descriptor as a new union variant. `UndoDescriptor` gains `{ type: "native-with-card"; native: restore-annotation; card: delete-node }`. One descriptor, one undo, both surfaces reversed. The alternative (two independent descriptors tracked separately) was rejected because `WriteResult.undo_descriptor` and `AppliedWrite.undo_descriptor` are single-valued and the undo registry keys one descriptor per write_id; a single compound variant is the minimal change that fits the existing single-descriptor contract. High confidence.
- D4 — Partial-failure is enforced at the daemon dispatch loop, not only in the adapter. The existing `applyApprovedWrite` loop treats ANY mid-stream command failure as a partial disconnect and stashes ALL completed commands for rollback (`apply-tool.ts:198-215`). The locked D3 semantics (native committed first and KEPT, card retryable, native NOT rolled back) therefore require a focused branch for the compound variant so the native op is excluded from the stash-all rollback when only the card fails. This is the single most load-bearing design choice and the reason T8 touches the daemon. The native op is ordered first in `plugin_commands` so it is the committed prefix. Medium-high confidence (the existing loop semantics are verified; the new branch is additive and gated on the compound write_target).
- D5 — New distinct plugin op `set_policy_card`. The autopus op `set_annotation` draws a card via `dispatchSetAnnotation`, and `set_native_annotation` writes the native primitive via `dispatchSetNativeAnnotation`. The structured-table card needs its own dispatch behavior (build auto-layout tables) and MUST be lexically distinct from both per the SPEC-FIGMA-018 naming-collision rule. `set_policy_card` maps in `TOOL_NAME_MAP` and `TARGET_TO_OP`. Reusing either existing op would route to the wrong renderer or collide with the AC-S8 invariant. High confidence.
- D6 — Real tables via additive renderer extension. The card tables are built by extending `autopus_area_handoff_renderer.ts` with an auto-layout table-cell helper and a new exported `createPolicyCardCanvas`, reusing `chooseDocumentBox`/`boxOf` for placement. `createAreaHandoffCanvas` itself is not modified (its badge/text construction stays byte-identical), so the existing `annotation_card` area-handoff path is non-regression. Vendor is treated as a pinned integration layer: additive functions only, no broad refactor. Medium-high confidence.
- D7 — Both text surfaces keep REQ-05 wire redaction. The native op already redacts `labelMarkdown` (`dispatchSetNativeAnnotation` line 194) and the daemon wire applies `redactWire`. The new `dispatchSetPolicyCard` applies `autopusRedact` to its text exactly as `dispatchSetAnnotation` does, and all card text crosses `redactWire`. No new outbound surface bypasses redaction. High confidence (mirrors the verified card and native dispatch redaction).
- D8 — Captured-prior redaction recurses into the compound variant on BOTH paths. `redactAndMinimizePrior` (daemon) and `redactRestoreDescriptor` (router/HTTP) currently scrub only the flat `restore-annotation` variant and pass other variants through unchanged. For the compound variant they must recurse into the embedded `native` descriptor. Without this recursion the compound variant would bypass both SPEC-FIGMA-018 (daemon) and SPEC-FIGMA-019 (HTTP) closures and re-open the exact leak class those SPECs fixed. This is a security-critical, verified gap in the current redactors (both return the descriptor unchanged when `type !== "restore-annotation"`). High confidence.

## Sibling-vs-single decision

The completion contract permits splitting the structured-schema migration into a sibling SPEC. This SPEC keeps it single, justified against Q-COH-03:

- The structured `state`/`edge_case` union (REQ-05) is a small additive schema change plus a prompt mirror (REQ-15) and a validator confirmation (REQ-16). On its own it produces NO observable end-user behavior — no apply changes, no surface changes.
- The table builder (REQ-03, REQ-04) consumes the structured shape directly; the clean-columns benefit of structured states/edge_cases is the entire reason the schema change exists. Splitting them would create a scaffold-only sibling SPEC (schema + prompt + validator with no runtime consumer), which is exactly the over-split failure Q-COH-03 warns against.
- The two task groups share one acceptance story (S1 columns depend on S2/S3 union shape). Therefore single SPEC, with the schema migration sequenced as early tasks T2/T9/T10. If the union shape later grows (e.g. adding structured `data_io` or nested policy objects across many consumers), that expansion would justify its own SPEC.

## Schema versioning decision (brownfield, additive)

- Version: v0.4.0 (additive minor per SPEC-FIGMA-001 REQ-NFR-02 — additive only, no field removal/rename/type-narrowing).
- Change 1 (enum widen): `write_target` gains `native_annotation_with_card`. Existing members unchanged and unreordered. All v0.1.0–v0.3.0 manifests remain valid.
- Change 2 (item union): `states.items` and `edge_cases.items` become a union of the existing `{type: string, minLength: 1}` and a new object form. The string branch is preserved byte-for-byte so every existing manifest validates unchanged; the object branch is purely additive. This is a constraint widening (string OR object), never a narrowing.
- States object: required `state` (string, minLength 1), optional `trigger` and `result` (string), `additionalProperties: false`. Edge_cases object: required `case` (string, minLength 1), optional `risk` and `handling` (string), `additionalProperties: false`.
- Mirror: `schema/CHANGELOG.md` v0.4.0 section records both changes and the back-compat statement, following the v0.3.0 entry format.

## Technology Stack Decision

Mode: brownfield. No new runtime, framework, or dependency is introduced — the change is an additive schema union, new TypeScript modules inside the existing `@autopus/write-router` package (Node >=22, TypeScript ^6, per `packages/write-router/package.json:21-30`), additive vendor-plugin functions, and Vitest tests (`npm test`). Existing manifest major versions and the AJV 2020 validator stack are preserved as compatibility constraints. No `## Technology Stack Decision` version table is required because no greenfield stack selection occurs; the only versioning decision is the schema semver bump recorded above (v0.4.0 additive minor).

## Outcome Lock

Locked user-visible outcome: from one approved manifest entry whose `write_target` is `native_annotation_with_card`, a single apply writes BOTH a concise native Dev-Mode annotation anchored to the resolved node(s) AND a separate policy card next to the frame that renders `states`, `edge_cases`, `data_requirements`, and `area_annotations` as real Figma auto-layout tables. One undo reverses both surfaces. If the card step fails, the native annotation is kept and the card is retryable.

Completion evidence (observable): S5 (both surfaces applied, one compound undo reverses both), S1 (concrete table row/column/cell counts and cell contents), S4 (card-step failure leaves native present and card absent + retryable), S7 (no captured-prior secret in the persisted artifact or HTTP response).

Non-goals (locked out of this SPEC):
- No change to the single-surface `native_annotation` or `annotation_card` behavior or their undo paths.
- No markdown/pipe pseudo-tables inside a TEXT node — tables are real auto-layout cells only.
- No rollback of the native annotation when only the card fails (native is authoritative).
- No new runtime/framework/dependency; schema change is additive (string OR object union), never narrowing.

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| Composite target defined + registered | REQ-01 / T1, T5 / S5 | covered |
| Dual-surface emission in one apply, native ordered first | REQ-02 / T5, T6 / S5, S6 | covered |
| Policy rendered as real Figma tables (no pseudo-table) | REQ-03 / T3, T7 / S1 | covered |
| Fixed column mapping per policy dimension | REQ-04 / T3 / S1 | covered |
| Structured `state`/`edge_case` union, additive, back-compat | REQ-05, REQ-14, REQ-16 / T2, T9 / S2 | covered |
| Legacy string → first column, rest empty | REQ-06 / T2, T3 / S3 | covered |
| Partial-failure: native kept + card retryable | REQ-07 / T5, T8 / S4 | covered |
| Compound undo reverses both surfaces | REQ-08 / T1, T5, T8 / S5 | covered |
| Wire redaction parity (both surfaces) | REQ-09 / T6, T7 / S7 | covered |
| Captured-prior redaction parity (daemon path) | REQ-10 / T8, T11 / S7 | covered |
| HTTP path allow-list + captured-prior redaction (SPEC-019 class) | REQ-11 / T11, T12 / S7 | covered |
| AC-S8 byte-unchanged + distinct card op literal | REQ-12 / T6, T13 / S8 | covered |
| Op mapping parity across maps | REQ-13 / T6, T7 / S6, S8 | covered |
| Generation prompt emits structured shapes | REQ-15 / T10 / S2, unit | covered |
| Review-UI dual-surface hint | REQ-17 / T12 / unit | covered (Should) |
| Router redact seam injectable/no-op | REQ-18 / T11 / S7 | covered (Should) |

## Semantic Invariant Inventory

| INV | Source clause | Type | Affected outputs | REQ | Plan task(s) | Must oracle |
|-----|---------------|------|------------------|-----|--------------|-------------|
| INV-01 | "native op precedes card op" | ordering | emitted `plugin_commands` order | REQ-02 | T5, T6 | S5, S6 (native op index < card op index) |
| INV-02 | "header row + one row per source item; fixed columns" | grouping/table | card table node structure | REQ-03, REQ-04 | T3, T7 | S1 (concrete row/column/cell counts) |
| INV-03 | "string OR object union; legacy validates; string → first column" | back-compat/union | schema validation + table cells | REQ-05, REQ-06, REQ-16 | T2, T9 | S2 (old + new both validate), S3 (string row shape) |
| INV-04 | "native committed first and KEPT on card failure; card retryable" | paired/partial-failure | applied surfaces + retry flag | REQ-07 | T5, T8 | S4 (native present, card absent, retryable) |
| INV-05 | "one compound undo reverses BOTH surfaces" | paired/dedup | undo descriptor + post-undo state | REQ-08 | T1, T5, T8 | S5 (undo restores prior native + removes card node) |
| INV-06 | "all native + card text through `redactWire`" | security boundary | outbound wire payload | REQ-09 | T6, T7 | S7 (no secret on wire) |
| INV-07 | "captured prior minimized + `redactExtendedObject` before persist/serve" | security boundary | `AppliedWrite` / `autopus://applied_writes` | REQ-10 | T8, T11 | S7 (synthetic xoxb/abs-path absent in artifact) |
| INV-08 | "composite in `KNOWN_WRITE_TARGETS` + captured prior through `redactRestoreDescriptor`" | security boundary | HTTP `undo_descriptor` body | REQ-11 | T11, T12 | S7 (secret absent in HTTP response) |
| INV-09 | "`annotation_card` 3-step decomposition byte-unchanged; new card op distinct literal" | invariant/parity | `annotation-card-plan.ts` output + op literals | REQ-12 | T6, T13 | S8 (card-plan output byte-equal; op ≠ set_annotation/set_native_annotation) |
| INV-10 | "composite ops consistent across `TARGET_TO_OP`/`PLUGIN_COMMAND_OPS`/`TOOL_NAME_MAP`" | parity/set-equality | op mapping tables | REQ-13 | T6, T7 | S6, S8 (mapped op present in all three maps) |

Oracle note: S1 uses a heterogeneous input (2 states + 1 edge_case + 2 data_requirements + 2 area_annotations) and asserts exact table counts (states table = 1 header + 2 rows × 3 cols, etc.) and specific cell contents, not heading/existence only. S2 asserts a legacy-string-only manifest validates AND a structured manifest validates against v0.4.0. S7 asserts a synthetic `xoxb-LEAKEDSECRET` and `/Users/reviewer/notes.txt` planted in the captured prior are absent from both the persisted `AppliedWrite` and the HTTP `undo_descriptor` response.

## Reviewer Brief

Scope: one additive composite write target that orchestrates two existing surfaces (native annotation + a new real-table policy card), plus the small additive structured-schema union that gives the tables clean columns. No redesign of the single-surface targets.

What reviewers should check first:
- Partial-failure branch (the load-bearing change): confirm `apply-tool.ts` excludes the already-committed native op from the stash-all rollback when only the card op fails (D4 / REQ-07 / S4). This is the reason SPEC-FIGMA-018 deferred this work.
- Redaction recursion on BOTH paths: confirm `redactAndMinimizePrior` (daemon) and `redactRestoreDescriptor` (router/HTTP) recurse into the new `native-with-card` compound variant and scrub its embedded `restore-annotation` prior (D8 / REQ-10, REQ-11 / S7). A non-recursing redactor silently re-opens the SPEC-018/019 leak class.
- Non-regression: `annotation-card-plan.ts` and the `createAreaHandoffCanvas` badge/text construction are byte-unchanged; the new card op is a distinct literal `set_policy_card` (REQ-12 / S8).
- Back-compat: a v0.1.0–v0.3.0 manifest with string `states`/`edge_cases` still validates against v0.4.0 (REQ-05, REQ-16 / S2, S3).
- Oracle quality: S1/S2/S4/S5/S7 carry concrete expected values, not structural checks.

Out of review scope (tracked in Completion Debt / Evolution Ideas): exact Figma table cell sizing/typography, structured shapes for `data_io`, geometry-based area-to-node matching.

## Completion Debt

| Item | Status | Owner / closure |
|------|--------|-----------------|
| Compound captured-prior secret exposure on BOTH daemon and HTTP paths if redactors do not recurse | closed-by-REQ-10/REQ-11 | D8 / T8, T11 / S7 — recurse + scrub at both boundaries |
| Native-authoritative partial-failure in the stash-all daemon loop | closed-by-REQ-07 | D4 / T8 / S4 — focused compound-variant branch |
| Exact Figma table cell width/height/typography polish | bounded | Conservative auto-layout defaults reused from `createAreaHandoffCanvas` doc box; visual polish is a non-blocking refinement (degrades to readable cells) |
| Validator code change | bounded | Validator compiles the schema directly (no enum hardcode); REQ-16 expects no code change unless a fixture/path assumption breaks, then additive only |

## Evolution Ideas

Speculative follow-ups, each its own SPEC if pursued:
- Structured `data_io` and nested policy objects across all consumers (would justify a dedicated schema SPEC; deferred per Q-COH-03).
- Geometry-overlap area-to-node matching for the native surface (inherited deferral from SPEC-FIGMA-018 INV-009).
- Per-cell rich text / links inside policy tables (current tables carry plain redacted text).
- A `descriptions_page` variant of the policy tables for a file-level archive surface.
- PM-configurable column selection per policy dimension.

## Self-Verify Summary

Applied `content/rules/spec-quality.md` across spec.md, plan.md, acceptance.md, research.md. Status legend: PASS / FAIL / N/A.

| Q | status | attempt | files | reason |
|---|--------|---------|-------|--------|
| Q-CORR-01 | PASS | 1 | research.md, spec.md, plan.md | Non-`[NEW]` references verified by Read/Grep (types.ts, registry.ts, annotation-text.ts, annotation-card-plan.ts, plan-emit/types.ts, autopus_command_dispatch.ts, autopus_area_handoff_renderer.ts, apply-tool.ts, redact-prior-annotation.ts, redact-restore-descriptor.ts, route.ts, FrameRow.tsx, schema, node-only.ts) — see `## 기존 코드 분석` table |
| Q-CORR-02 | PASS | 1 | spec.md | New modules marked `[NEW]` (native-annotation-with-card.ts, card-table-payload.ts, structured-policy.ts, native-annotation-with-card-plan.ts, test files); not used as existing-reference evidence |
| Q-CORR-03 | PASS | 1 | spec.md, acceptance.md | EARS forms valid (Ubiquitous/Event-driven/Unwanted-behavior/State-driven); Priority on separate meta line; Gherkin uses bare Given/When/Then |
| Q-COMP-01 | PASS | 1 | all four | spec.md (REQ), plan.md (tasks+ownership), acceptance.md (oracle scenarios), research.md (evidence+invariants+decisions) — distinct and complementary |
| Q-COMP-02 | PASS | 1 | spec.md, plan.md, acceptance.md | 18 REQ traceable via spec.md `## Traceability Matrix`; REQ-17 routed to unit with rationale |
| Q-COMP-03 | PASS | 1 | spec.md, acceptance.md | Each REQ has EARS type, trigger, expected result; observability named (emitted op order, table node structure, undo descriptor, persisted artifact, HTTP body) |
| Q-COMP-04 | PASS | 2 | research.md | `## Outcome Lock` added: locked outcome + non-goals + completion evidence (was missing in attempt 1 — F-001) |
| Q-COMP-05 | PASS | 2 | research.md, acceptance.md | `## Semantic Invariant Inventory` added: 10 invariants each traced to REQ + plan task + Must oracle; S1/S2/S4/S5/S7 carry concrete expected outputs (was missing in attempt 1 — F-001) |
| Q-COMP-06 | PASS | 2 | research.md, spec.md | spec.md `## Traceability Matrix` present; `## Reviewer Brief` added with scope/non-goals/ordered focus (Reviewer Brief was missing in attempt 1) |
| Q-COMP-07 | PASS | 2 | research.md | `## Completion Debt` and `## Evolution Ideas` added as separate sections (dangling references in attempt 1 now resolved) |
| Q-FEAS-01 | PASS | 1 | spec.md, plan.md | Scope split correctly across write-router, vendor integration, schema, prompt, validator, daemon, review-ui; native runtime reused not reimplemented |
| Q-FEAS-02 | PASS | 1 | plan.md, research.md | Edit paths match real module ownership; vendor treated as pinned additive integration layer; source-of-truth schema under `schema/` |
| Q-FEAS-03 | PASS | 1 | plan.md, acceptance.md | Verification runnable via existing Vitest suite + new tests; S8 names AC-S8 byte-unchanged check |
| Q-STYLE-01 | PASS | 1 | spec.md | Requirement descriptions assertive THE SYSTEM SHALL; MoSCoW only on separate meta lines |
| Q-STYLE-02 | PASS | 1 | spec.md | Priority (Must/Should) and EARS Type are separate meta lines; no P0/P1 aliases |
| Q-STYLE-03 | PASS | 1 | spec.md, acceptance.md | Complete sentences; Gherkin bare keywords |
| Q-SEC-01 | PASS | 1 | spec.md, research.md, acceptance.md | Trust boundaries analyzed: authored text (REQ-09 wire) and untrusted captured prior (REQ-10 daemon, REQ-11 HTTP); S7 is the oracle |
| Q-SEC-02 | PASS | 1 | acceptance.md, research.md | Captured prior minimized + scrubbed via `redactExtendedObject`/`redactRestoreDescriptor`; S7 uses synthetic `xoxb-`/abs-path; no real secret committed |
| Q-SEC-03 | PASS | 1 | spec.md, research.md | `AppliedWrite`/`autopus://applied_writes` retained artifact redacted at capture on both paths; format stays existing AppliedWrite shape (no new diff-noisy artifact) |
| Q-COH-01 | PASS | 1 | spec.md | One cohesive change story: dual-surface delivery in one apply |
| Q-COH-02 | PASS | 2 | research.md | `## Completion Debt` + `## Outcome Lock` confirm follow-on work (Evolution Ideas) does not bypass the locked outcome (was unconfirmable in attempt 1 without these sections) |
| Q-COH-03 | PASS | 1 | research.md | `## Sibling-vs-single decision` justifies single SPEC vs over-split scaffold |
