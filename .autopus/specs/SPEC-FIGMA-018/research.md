# SPEC-FIGMA-018 리서치 (Research)

> Status: draft

## 기존 코드 분석 (Existing Code Analysis — re-verified)

| Concern | Location (verified) | Fact |
|---------|---------------------|------|
| WriteTarget union (6 members) | `packages/write-router/src/types.ts:4-10` | `annotation_card`, `descriptions_page`, `comment`, `plugin_data`, `frame_name`, `none` |
| UndoDescriptor union (5 variants) | `packages/write-router/src/types.ts:70-75` | `delete-node`, `delete-comment`, `clear-plugin-data`, `restore-frame-name`, `noop` |
| AreaAnnotation fields | `packages/write-router/src/types.ts:19-31` | `area_id`, `title`, `target_area`, `description`, `interaction?`, `motion?`, `policy?`, `states?`, `data_refs?`, `qa_notes?`, `placement_hint?` — no `node_id` |
| ManifestEntry.area_annotations | `packages/write-router/src/types.ts:56` | optional array of AreaAnnotation |
| Card adapter (do not modify) | `packages/write-router/src/adapters/annotation-card.ts:49-79` | `applyAnnotationCard` to `client.createText`; undo `delete-node`; `asClient` guard at line 29 |
| Rich card composer (reuse data, not logic) | `packages/write-router/src/annotation-text.ts:67` | `renderAnnotationText` emits sections 화면 개요 / 영역별 설명 / 필요 데이터 리스트 / 상태 / 예외 / 구현 경계 |
| Card plan-emit (do not modify) | `packages/write-router/src/plan-emit/annotation-card-plan.ts:13-24` | `@AX:NOTE` AC-S8 invariant; 3 `set_annotation` steps |
| PluginCommand union + maps | `packages/write-router/src/plan-emit/types.ts:50-77` | `PluginCommand`, `PLUGIN_COMMAND_OPS`, `TARGET_TO_OP`; `@AX:ANCHOR` at line 69 (AC-S1 set equality) |
| Registry extension point | `packages/write-router/src/registry.ts:17-24, 50-96, 109` | `TARGETS`, `dynamicAdapter`, `defaultAdapters`, `register()` |
| Vendor MCP ANNOTATION schema | `src/daemon/mcp-vendor-write-handlers.ts:105-108` | `{nodeId, annotationId, labelMarkdown, categoryId, properties}`, required `[nodeId, labelMarkdown]`; tools `set_annotation` (line 202), `set_multiple_annotations` (203) |
| Native runtime (reuse, no edit) | `vendor/.../cursor_mcp_plugin/code.js:185, 2554-2640` | `case "set_annotation"` to `setAnnotation`; node-support check `"annotations" in node` (2590); overwrite `node.annotations = [newAnnotation]` (2629); returns `{success, nodeId, name, annotations}` |
| Get-annotations runtime | `vendor/.../code.js:183-184` | `case "get_annotations"` to `getAnnotations` — usable to capture prior state for undo |
| Autopus dispatcher (card op) | `vendor/.../autopus_command_dispatch.ts:75-86, 124-175, 263` | `TOOL_NAME_MAP` (`set_annotation` to `set_annotation`); `dispatchSetAnnotation` redacts `args.text` at line 130; switch `case "set_annotation"` at 263 |
| Wire redaction boundary | `src/daemon/figma-plugin-client.ts:141` | `this.ws.send(redactWire(JSON.stringify(envelope)))`; `redactWire` from `src/daemon/redact-extended.ts:51` (figd_/xoxb-/bearer/abs-path/tunnel) |
| Review UI write_target render | `apps/review-ui/src/components/FrameRow.tsx:99-101` | `<dt>write_target</dt><dd>{entry.write_target}</dd>` |
| Schema write_target enum | `schema/frame-description.schema.json:232-235` | enum `["annotation_card","descriptions_page","frame_name","plugin_data","none"]` (note: lacks `comment`, a pre-existing TS/schema gap — out of scope) |
| Test fixture pattern | `packages/write-router/tests/adapters-annotation-card.test.ts:12-42` | `makeEntry(overrides)` + mock client with `vi.fn()` `createText`/`deleteNode` |

## 설계 결정 (Design Decisions)

- D1 — Additive target, isolated modules. The new target is built entirely from new modules plus additive enum/map entries (PRD Option d). This is the only option that does not rewrite the shared card path and therefore the only one consistent with the AC-S8 invariant (`annotation-card-plan.ts:13`) and the AC-S1 op set equality (`plan-emit/types.ts:69`). High confidence.
- D2 — Reuse the native runtime, zero vendor runtime edits for the happy path. `setAnnotation` (`code.js:2554`) already does the overwrite and node-support validation. The only vendor file touched is `autopus_command_dispatch.ts` (mapping + dispatch case), which is the autopus integration layer, not the pinned upstream runtime (NFR-02). High confidence.
- D3 — Redaction via the existing wire boundary. The native path serializes through `figma-plugin-client.ts:141` `redactWire`, which already covers the entire outbound JSON including `labelMarkdown`. The added dispatch case also applies `autopusRedact` to `labelMarkdown`, mirroring the card path's `autopusRedact(args.text)` at line 130. Two layers, same redactor family. High confidence (REQ-05, NFR-04).
- D4 — Distinct op name. The autopus op is `set_native_annotation`, mapped to the vendor tool `set_annotation`. Reusing the autopus `set_annotation` op would route to the card (`dispatchSetAnnotation`), so a distinct op is mandatory, not cosmetic. High confidence.
- D5 — Resolver is a pure, injected-index function. Keeping `resolveAreaNode` free of live-bridge calls (the adapter supplies the name-to-id index) makes S1/S3/S9 testable without a socket and keeps each module under the 300-line limit. Medium-high confidence.
- D6 — Treat the captured prior annotation snapshot as untrusted input and redact + minimize it at capture (security). The `restore-annotation` undo descriptor is not transient: it is persisted in `AppliedWrite` (`src/daemon/write-mcp-resources.ts:17-24`, recorded at `src/daemon/apply-tool.ts:232-240`) and served via `autopus://applied_writes`, whose read path applies only the `figd_`-specific `redact` (`src/daemon/mcp-stdio-handlers.ts:180`, the frozen `src/token-redactor.ts::redact`). Existing Figma annotations are author-uncontrolled and may carry `xoxb-`/bearer/absolute-path secrets that the `figd_`-only redactor misses. REQ-05 (wire redaction at `figma-plugin-client.ts:141`) does not cover this retained-artifact path, so the captured prior is passed through the full daemon redactor `redactExtendedObject` (`src/daemon/redact-extended.ts:56`) and minimized to restore-only fields before `recordApplied` persists it (REQ-14, INV-011, S13). Undo restores the redacted minimized state — restoring a secret-bearing annotation verbatim is itself undesirable. High confidence (the exposure path and the redactor asymmetry are both verified in the cited files).

## Open Question Resolutions

- OQ-1 (area-to-node heuristic) — RESOLVED. Recommendation: normalized name match in two passes. Pass 1 compares a normalized `target_area` (trim, lowercase, collapse whitespace) against normalized node names for exact or substring match; Pass 2 falls back to `placement_hint`. On a single match, use it (confidence "matched"). On multiple matches, record all in `candidates` and pick the first deterministically (confidence "multi", REQ-12). On no match, attach to the frame node (confidence "fallback", `fallback_used = true`, REQ-04). Geometry-overlap matching is explicitly deferred — name/hint matching is sufficient for v1 and the frame-node fallback bounds the worst case to "strictly better than a floating card". Author-provided `node_id` enrichment of `AreaAnnotation` remains a separate follow-up SPEC if name matching proves insufficient.
- OQ-2 (UndoDescriptor shape) — RESOLVED. Recommendation: minimal snapshot, not a full node clone. `{ type: "restore-annotation"; node_id: string; prior: AnnotationSnapshot[] }` where `AnnotationSnapshot = { labelMarkdown: string; categoryId?: string; properties?: unknown[] }`. This mirrors exactly what the native runtime accepts and returns (`code.js:2602-2640` builds `{ labelMarkdown, categoryId?, properties? }` and returns `node.annotations`). `prior: []` encodes "node had no annotations" so undo clears correctly (S6). One descriptor is emitted per affected node so multi-area applies are fully reversible. Because the captured `prior` is untrusted external content, it is passed through `redactExtendedObject` and reduced to the restore-only fields before being persisted in `AppliedWrite` (REQ-14, D6); undo restores that redacted minimized value.
- OQ-3 (coexistence) — Assumption A1 in effect: both targets coexist; removing the card is out of scope (tracked in `## Evolution Ideas` below).
- OQ-4 (label length limit) — Assumption in effect: truncate conservatively at a configured budget (default 500 chars in S9) with a continuation indicator; full narrative remains in card/page. The exact Figma Dev-Mode limit needs empirical confirmation and does not block v1 because truncation degrades safely.
- OQ-5 (categoryId derivation) — Assumption in effect: omit `categoryId` when uncertain (REQ-11). Deriving it from persona/area signal is a refinement, and omission never fails the apply (`code.js:2607` only adds `categoryId` when truthy).

## Semantic Invariant Inventory

Each invariant traces to a requirement, a plan task, and at least one Must oracle acceptance scenario (Q-COMP-05).

| ID | source clause (untrusted prompt evidence) | invariant type | affected outputs | REQ | plan task | Must acceptance |
|----|-------------------------------------------|----------------|------------------|-----|-----------|-----------------|
| INV-001 | "one native annotation per area, attached to the resolved node" | paired matching (area to node, one-to-one) | per-node annotation set; annotation count | REQ-02, REQ-04 | T3, T4 | S1 |
| INV-002 | "frame-level fallback when no areas exist" | grouping/fallback selection | frame-node annotation; summary content | REQ-03 | T2, T4 | S2 |
| INV-003 | "unresolved target_area falls back to frame node, resolution marks fallback" | comparison + fallback flag | resolution result `fallback_used`/confidence | REQ-04 | T3, T4 | S3 |
| INV-004 | "labelMarkdown redacted before leaving the daemon" | redaction-before-wire boundary | serialized wire payload | REQ-05 | T6 | S4 |
| INV-005 | "undo restores prior node.annotations, incl. clobbered manual annotation" | restore-prior-state (reversibility) | node.annotations after undo | REQ-06 | T1, T4 | S6, S7 |
| INV-006 | "re-apply identical content is an observable no-op" | idempotency | set-call issued? node.annotations bytes | REQ-08 | T4 | S8 |
| INV-007 | "set_native_annotation op stays distinct from card set_annotation" | naming/routing invariant | emitted op literals; TARGET_TO_OP/TOOL_NAME_MAP | REQ-01, REQ-02 | T5, T6 | S10 |
| INV-008 | "disconnected bridge rejects with zero mutation" | precondition gate (consent) | rejection path; absence of set call | REQ-07 | T4 | S5 |
| INV-009 | "multiple candidate nodes recorded for disambiguation" | candidate-set capture | resolution result `candidates` | REQ-12 | T3 | (unit; S9 path) |
| INV-010 | "AC-S8 card 3-step decomposition unchanged" | non-regression invariant | planAnnotationCard output; touched files | NFR-03 | T9 | S12 |
| INV-011 | "captured prior node.annotations is untrusted; redact + minimize before persist/serve" | redaction + minimization of retained artifact (trust boundary) | AppliedWrite undo_descriptor prior; autopus://applied_writes payload | REQ-14 | T4, T10 | S13 |

## Outcome Lock

Locked completion outcome (the single sentence this SPEC must satisfy to be considered done):

> A PM can select `native_annotation` for a frame; on apply, each `area_annotation` becomes exactly one native Figma Dev-Mode annotation on its resolved node (frame-level fallback when no area resolves), every authored `labelMarkdown` is redacted on the wire, the captured prior annotation state is redacted and minimized in the retained `AppliedWrite` artifact, undo restores that prior state, re-apply is a no-op, a disconnected bridge mutates nothing, and the existing `annotation_card` AC-S8 decomposition is unchanged.

This outcome is fully owned by SPEC-FIGMA-018 (no sibling SPEC dependency). The `## Feature Coverage Map` below decomposes it into slices and the `## Completion Debt` / `## Evolution Ideas` sections record what is intentionally not in this SPEC.

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| Native annotation per area | REQ-02, REQ-04 / T3, T4 / S1 | covered |
| Frame-level fallback | REQ-03, REQ-04 / T2, T4 / S2, S3 | covered |
| Redaction parity (INV-W2) | REQ-05 / T6 / S4 | covered |
| Undo and clobber-restore | REQ-06 / T1, T4 / S6, S7 | covered |
| Idempotency | REQ-08 / T4 / S8 | covered |
| Plugin consent | REQ-07 / T4 / S5 | covered |
| Op-name distinctness | REQ-01, REQ-02 / T5, T6 / S10 | covered |
| Review UI surface | REQ-09 / T8 / S11 | covered |
| Label length safety | REQ-10 / T2 / S9 | covered |
| categoryId omit-on-absent | REQ-11 / T4 / unit | covered (unit) |
| Multi-candidate recording | REQ-12 / T3 / unit | covered (unit) |
| Suggested-default persistence | REQ-13 / T8 / unit | covered (Nice) |
| Backward compatibility (AC-S8) | NFR-03, PM-6 / T9 / S12 | covered |
| Captured-prior redaction (retained artifact) | REQ-14 / T4, T10 / S13 | covered |

## Reviewer Brief

Scope of this SPEC: an additive `native_annotation` write target (PRD Option d) plus the security closure for the captured prior annotation snapshot. No redesign of the existing card path.

What reviewers should check first:
- Q-SEC focus: confirm REQ-14 + INV-011 + S13 actually close the retained-artifact exposure on `autopus://applied_writes`, i.e. the captured `prior` is passed through the full daemon redactor (`redactExtendedObject`, `src/daemon/redact-extended.ts:56`) and minimized before `recordApplied` (`src/daemon/apply-tool.ts:232-240`), not merely on the outbound wire (REQ-05).
- Trust-boundary separation: authored `labelMarkdown` (REQ-05) vs untrusted captured prior (REQ-14) are distinct surfaces with distinct redaction points.
- Non-regression: AC-S8 card 3-step decomposition and `annotation-card-plan.ts` / `adapters/annotation-card.ts` are untouched (S12, T9 verification step).
- Naming collision: emitted op is `set_native_annotation`, never the card `set_annotation` (S10).
- Oracle quality: S1/S2/S3/S6/S7/S8/S10/S13 carry concrete expected values, not structural checks.

Out of review scope (tracked below): hybrid dual-write, author-provided `node_id`, exact Figma label-length limit.

## Completion Debt

Tracked debt that this SPEC either closes or consciously bounds. These are completion-relevant items, distinct from speculative ideas.

| Item | Status | Owner / closure |
|------|--------|-----------------|
| Captured-prior secret exposure on `autopus://applied_writes` (xoxb-/bearer/absolute-path not caught by the figd_-only `redact`) | closed-by-REQ-14 | REQ-14 / T4 + T10 / S13 — redact + minimize at capture |
| Exact native annotation `labelMarkdown` length limit (OQ-4) | bounded | Conservative truncation at a configured budget (S9); empirical confirmation is a non-blocking refinement because truncation degrades safely |
| `categoryId` derivation from manifest signal (OQ-5) | bounded | Omit-on-uncertain (REQ-11); never fails apply |
| Multi-candidate disambiguation (REQ-12) | partial | Candidates recorded now; richer disambiguation (geometry) deferred to Evolution Ideas |

## Evolution Ideas

Speculative follow-ups that are NOT required for this SPEC's locked outcome. Each would be its own SPEC if pursued.

- Coupled hybrid dual-write (PRD Option c): guaranteed simultaneous native + card/page delivery in one apply, with two-target partial-failure semantics. A PM can already approximate this by running both targets manually, so it is deferred.
- Author-provided `node_id` enrichment of `AreaAnnotation`: if heuristic name/hint resolution proves insufficient in practice, add an explicit manifest `node_id` field and schema mirror. Deferred until resolution telemetry justifies it.
- Geometry-overlap area-to-node matching: use `absoluteBoundingBox` overlap to disambiguate multi-candidate matches (INV-009). Deferred; name/hint + frame fallback is sufficient for v1.
- Card target deprecation (OQ-3): only if the user later confirms native annotations fully replace the floating card. Currently both coexist by design.

## Self-Verify Summary

Applied `content/rules/spec-quality.md` across spec.md, plan.md, acceptance.md, research.md. Status legend: PASS / FAIL / N/A.

| Q | status | attempt | files | reason |
|---|--------|---------|-------|--------|
| Q-CORR-01 | PASS | 1 | research.md, spec.md, plan.md | Non-`[NEW]` references re-verified by Read/Grep: types.ts:4-10/70-75, annotation-card.ts:49-79, annotation-card-plan.ts:13-24, registry.ts:50-96, plan-emit/types.ts:50-77, mcp-vendor-write-handlers.ts:105-108, code.js:2554-2640, autopus_command_dispatch.ts:75-86, figma-plugin-client.ts:141, FrameRow.tsx:99-101, schema enum:234 |
| Q-CORR-02 | PASS | 1 | spec.md, plan.md | New modules marked `[NEW]` (native-label.ts, area-node-resolver.ts, adapters/native-annotation.ts, plan-emit/native-annotation-plan.ts, test files); not used as existing-reference evidence |
| Q-CORR-03 | PASS | 1 | spec.md, acceptance.md | EARS forms valid (Ubiquitous/Event/State/Optional); Gherkin uses bare Given/When/Then/And; Priority on separate meta line, not in description |
| Q-COMP-01 | PASS | 1 | all four | spec.md (requirements), plan.md (tasks+ownership), acceptance.md (oracle scenarios), research.md (evidence+invariants+decisions) — each distinct and complementary |
| Q-COMP-02 | PASS | 3 | spec.md, plan.md, acceptance.md | REQ to task to scenario traceable via the spec.md `## Traceability Matrix` plus the plan.md and acceptance.md maps; all 14 REQ rows present incl. REQ-14; REQ-11/12/13 routed to unit coverage with stated rationale |
| Q-COMP-03 | PASS | 1 | spec.md, acceptance.md | Each REQ has EARS type, trigger, expected result; observability points named (resolution result, wire payload, node.annotations, emitted op) |
| Q-COMP-04 | PASS | 2 | research.md, spec.md | `## Outcome Lock` states the single locked completion outcome; `## Feature Coverage Map` decomposes it; deferred work is itemized in `## Completion Debt` / `## Evolution Ideas`, not hand-waved |
| Q-COMP-05 | PASS | 3 | research.md, spec.md, plan.md, acceptance.md | Semantic Invariant Inventory: 11 invariants (incl. INV-011 captured-prior redaction) each traced to REQ + plan task + Must oracle scenario; S1/S2/S3/S6/S7/S8/S10/S13 carry concrete expected outputs (label substrings, fallback flags, byte-unchanged, op literals, absent secret substrings) — no structural-only Must scenario |
| Q-COMP-06 | PASS | 1 | spec.md, research.md | spec.md carries `## Traceability Matrix` (REQ to plan task to acceptance scenario); research.md carries `## Reviewer Brief` (scope + ordered what-to-check for reviewers) |
| Q-COMP-07 | PASS | 1 | research.md | `## Completion Debt` (closed-by-REQ-14 security item + bounded OQ-4/OQ-5 + partial REQ-12) is separated from `## Evolution Ideas` (hybrid dual-write, author node_id, geometry match, card deprecation); follow-ups no longer mixed into Related SPECs / Coverage Map |
| Q-FEAS-01 | PASS | 1 | spec.md, plan.md | Scope split correctly: runtime code (write-router + dispatcher), schema mirror, UI, tests; native runtime reused not reimplemented |
| Q-FEAS-02 | PASS | 1 | plan.md | Edit paths match real module ownership; `content/`-vs-installed distinction N/A (this repo edits source under packages/, apps/, vendor/ integration layer, schema/) |
| Q-FEAS-03 | PASS | 1 | plan.md, acceptance.md | Verification is runnable: existing vitest suite under packages/write-router/tests/ + new tests; S12 names AC-S8 non-regression run |
| Q-STYLE-01 | PASS | 2 | spec.md | Requirement descriptions are assertive THE SYSTEM SHALL; ambiguous words (should/might/could) appear only as MoSCoW Priority labels on separate meta lines, never in requirement text |
| Q-STYLE-02 | PASS | 1 | spec.md | Priority (Must/Should/Nice) and EARS Type are separate meta lines; no P0/P1 aliases |
| Q-STYLE-03 | PASS | 1 | spec.md, acceptance.md | Sentences complete; Gherkin steps are bare keywords without bullet/bold markup |
| Q-SEC-01 | PASS | 2 | spec.md, research.md, acceptance.md | Two trust boundaries analyzed: authored `labelMarkdown` (REQ-05, wire) and the untrusted captured prior annotation snapshot (REQ-14, retained artifact). spec.md `### Trust boundary` + research.md D6 + INV-011 name the `autopus://applied_writes` exposure and its closure; S4 and S13 are the oracles |
| Q-SEC-02 | PASS | 2 | acceptance.md, spec.md, research.md | Captured prior is minimized to restore-only fields and scrubbed of `figd_`/`xoxb-`/bearer/absolute-path via `redactExtendedObject` before persist (REQ-14); S13 uses synthetic `xoxb-LEAKEDSECRET` + `/Users/reviewer/notes.txt` and asserts their absence in the persisted artifact; no real secret committed |
| Q-SEC-03 | PASS | 2 | spec.md, research.md, acceptance.md | Corrected from N/A: the `restore-annotation` undo descriptor IS a retained, served artifact (persisted in `AppliedWrite`, served via `autopus://applied_writes`). REQ-14 makes it redacted + minimized at capture; undo restores the redacted state so no secret is re-introduced; format stays the existing AppliedWrite shape (no new diff-noisy artifact) |
| Q-COH-01 | PASS | 1 | spec.md | One cohesive change story: deliver descriptions as native annotations; all modules in one bounded area |
| Q-COH-02 | PASS | 1 | research.md | Follow-on work split into `## Completion Debt` (closure-tracked) and `## Evolution Ideas` (speculative); each Evolution item would be its own SPEC |
| Q-COH-03 | PASS | 1 | plan.md | Tasks are independently implementable with non-overlapping ownership and a stated execution order; not over-fragmented |

Result: 22 PASS, 0 N/A, 0 FAIL across 22 checklist items after the review-driven retry. No Open Issues.

Notes on retries (incl. the multi-provider REJECT closure):
- THEME 1 security (Q-SEC-01/02/03): added REQ-14, the spec.md `### Trust boundary` statement, research.md D6 + INV-011, and the S13 oracle. Q-SEC-03 was corrected from N/A to PASS because the `restore-annotation` undo descriptor is a retained, served artifact (`AppliedWrite` / `autopus://applied_writes`), not an in-memory-only value. Verified the figd_-only `redact` at `mcp-stdio-handlers.ts:180` vs the full `redactExtended` family at `redact-extended.ts` to confirm the asymmetry the fix closes.
- THEME 2 format (Q-COMP-04/06/07): added `## Outcome Lock`, `## Reviewer Brief`, `## Completion Debt`, and `## Evolution Ideas` to research.md and `## Traceability Matrix` to spec.md; moved deferred follow-ups out of Related SPECs / Coverage Map into Completion Debt vs Evolution Ideas.
- Earlier passes: Q-COMP-02 unit-coverage routing for REQ-11/12/13; Q-COMP-05 concrete oracle outputs for every Must scenario; Q-STYLE-01 MoSCoW words confined to Priority meta lines.
