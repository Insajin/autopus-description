# PRD — SPEC-FIGMA-018: Native Figma Annotation Write Target for Developer Handoff

> Status: draft
> SPEC-ID: SPEC-FIGMA-018
> Module: `.` (root) — `@autopus/figma-read` monorepo
> Mode: brownfield (existing TypeScript monorepo, Node >=22)
> PRD format: standard
> Depends on: SPEC-FIGMA-004 (write-router, `annotation_card` adapter), SPEC-FIGMA-007 (plugin command dispatch + AC-S8 partial-disconnect rollback), SPEC-FIGMA-017 (vendor write-surface unification, native annotation MCP tools)
> Related primitives: vendor `set_annotation` / `set_multiple_annotations` / `get_annotations` (native Dev-Mode annotation API)

---

## 1. Overview (What / Why / Who / When)

### What
Today, frame descriptions are written as a free-floating text card (the `annotation_card` write target) positioned next to the target frame on the Figma canvas. The card is a rich, multi-section narrative (화면 개요 / 영역별 설명 / 필요 데이터 리스트 / 상태·예외 / 구현 경계) rendered as a `TEXT` node, plus optional `area_handoff` callouts with badges and connectors.

This PRD proposes delivering frame descriptions through Figma’s native annotation feature (the Dev-Mode annotation primitive: `labelMarkdown` + `categoryId` + `properties`, attached per node), so that developers reading the design in Dev Mode see descriptions in the native annotation panel rather than hunting for a floating card on the canvas.

### Why
- Developer reading experience (the user’s explicit request): native annotations appear in the Figma Dev Mode panel, anchored to the exact node they describe. A developer inspecting a button sees its annotation inline, instead of cross-referencing a separate text card positioned "somewhere near" the frame.
- Canvas cleanliness: native annotations do not add free-floating geometry that designers must keep out of the way during layout work.
- Semantic anchoring: an annotation attached to the resolved sub-node carries spatial meaning that a free-positioned card cannot.

### Naming-collision callout (critical context for reviewers and implementers)
The current text-card path already uses an op literally named `set_annotation`, but it is NOT a native annotation:
- `packages/write-router/src/plan-emit/annotation-card-plan.ts:20-22` emits `{ op: "set_annotation", ... }` as a fixed 3-step decomposition (create-node / set-text / attach-link).
- The autopus plugin dispatcher `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts` `dispatchSetAnnotation()` (line 124) routes that op to `figma.createText` / `createAreaHandoff` / `createAreaHandoffCanvas` — i.e. it draws a TEXT CARD.
- Meanwhile the same op name `set_annotation` in vendor `code.js` `case "set_annotation"` (line 185) calls the real native API: `node.annotations = [newAnnotation]` (line 2629), reachable through the vendor MCP tool surface (`src/daemon/mcp-vendor-write-handlers.ts:105`, `ANNOTATION` schema with `labelMarkdown`/`categoryId`).

So "set_annotation" means two different things on two different bridges. This collision is the crux of the user’s confusion: the feature called "annotation" today is a card, while the real native annotation primitive sits unused by the description path. The PRD keeps these two concepts lexically distinct (proposed: the new target is `native_annotation`, never overloading the `set_annotation` op name on the autopus dispatcher path).

### Who
| Persona | Role in this feature | Primary value |
|---------|---------------------|---------------|
| Engineer / Developer (primary beneficiary) | Reads descriptions in Figma Dev Mode during implementation handoff | Annotations anchored to the exact node, visible in the native Dev Mode panel |
| PM | Generates descriptions and chooses the write target during review | Per-frame control over how a description is delivered (card vs native annotation) |
| Designer | Owns the canvas layout | Fewer free-floating text cards cluttering the working canvas |
| QA | Cross-checks states/edge cases | Annotations colocated with the components they validate |

### When
Brownfield enhancement to the existing write-router + plugin-dispatch pipeline. Triggered whenever a description manifest entry is written and the chosen target is the new `native_annotation` target. No scheduled/batch component; it follows the existing dryRun to approve to apply to undo lifecycle (SPEC-FIGMA-007).

---

## 1.5 Discovery Q&A

Six discovery questions. Where the user has not answered, a reasonable answer is inferred from verified codebase facts and recorded as an assumption (also tracked in section 11 Open Questions). Discovery does not block PRD completion.

Q1. Should the native annotation REPLACE the existing `annotation_card`, or be added alongside it?
- Inference: Add alongside as a new `WriteTarget` (`native_annotation`). The current `WriteTarget` union (`packages/write-router/src/types.ts:4-10`) has six members and `annotation_card` is depended on by AC-S8’s fixed 3-step decomposition (SPEC-FIGMA-007). Replacing it is a breaking change to a tested rollback invariant.
- Assumption A1: both targets coexist; PM selects per frame. Removing the old card is explicitly out of scope (section 9).

Q2. One native annotation per FRAME (concise summary) or one per AREA (`area_annotation`)?
- Inference: One per `area_annotation`, attached to the resolved sub-node, with a frame-level fallback when no areas exist. `ManifestEntry.area_annotations[]` (types.ts:56) already carries `target_area`, `title`, `description`, `interaction`, `states`, `data_refs`, `placement_hint` — exactly the per-region granularity Dev-Mode annotations want.
- Assumption A2: per-area is the default; frame-level annotation is the fallback when `area_annotations` is empty.

Q3. How is an `area_annotation` mapped to a concrete `nodeId`?
- Inference: native annotations require a `nodeId` (`ANNOTATION` schema required: [nodeId, labelMarkdown]). `AreaAnnotation` has no `node_id` field today — only `target_area` (free text) and `placement_hint`. A resolution step is required.
- Assumption A3: introduce an area-to-node resolution step (heuristic: match `target_area`/`placement_hint` against node names via the existing scan tools; fall back to the frame node when no confident match). Resolution confidence and fallback are observable. This is the single highest-risk piece (see section 10 pre-mortem).

Q4. Does native annotation output need the same redaction guarantee (INV-W2) as the card?
- Inference: Yes, non-negotiable. The card path redacts in `dispatchSetAnnotation` (`autopus_command_dispatch.ts:130`, `autopusRedact(asString(args.text))`). The native path, when routed through the daemon plugin client, is redacted at the wire boundary: `src/daemon/figma-plugin-client.ts:141` sends `redactWire(JSON.stringify(envelope))`, which covers the full outbound JSON including `labelMarkdown`.
- Assumption A4: native annotation `labelMarkdown` passes redaction before leaving the daemon; the design routes through the redaction boundary rather than bypassing it.

Q5. What is the undo/idempotency model for native annotations?
- Inference: native `set_annotation` overwrites (`node.annotations = [newAnnotation]`, code.js:2629) rather than appending. The card path uses an `UndoDescriptor` of `{ type: "delete-node", node_id }` (annotation-card.ts:55-58). Native annotations are node properties, not nodes — deleting a node is wrong.
- Assumption A5: add a new `UndoDescriptor` variant for native annotations (restore-annotation) that captures the prior `node.annotations` value for restore-on-undo. Re-applying the same manifest entry to the same node is idempotent (overwrite with identical content = no-op observably). The `UndoDescriptor` union (types.ts:70-75) gains this variant.

Q6. Where does the new target surface to the PM (Review UI)?
- Inference: the Review UI (`apps/review-ui/`) renders `write_target` and dashboard rows. A new enum value must render there without breaking existing rows.
- Assumption A6: `native_annotation` appears as a selectable/visible target in the Review UI with a Dev-Mode-only-visibility hint, so PMs are not surprised that non-Dev-Mode viewers cannot see it.

---

## 2. Codebase Context

### Current description write path (verified)
| Concern | Location | Note |
|---------|----------|------|
| `annotation_card` adapter | `packages/write-router/src/adapters/annotation-card.ts:49-60` | `client.createText(buildAnnotationCreateArgs(entry))`; undo = delete-node |
| Text composition | `packages/write-router/src/annotation-text.ts:67-136` | multi-section narrative + `area_handoff` visual payload (badges, connectors, `#FF6200`) |
| Plan decomposition | `packages/write-router/src/plan-emit/annotation-card-plan.ts:13-24` | fixed 3-step `set_annotation` ops; AC-S8 rollback invariant — DO NOT alter |
| Plugin dispatch (card) | `vendor/.../autopus_command_dispatch.ts:124-168` | `dispatchSetAnnotation` to `createText`/`createAreaHandoff`; redacts at line 130 |
| WriteTarget union | `packages/write-router/src/types.ts:4-10` | 6 members; new member added here |
| Adapter registry | `packages/write-router/src/registry.ts:17-24, 65-96` | `TARGETS` array + `defaultAdapters`; new adapter registered here |
| UndoDescriptor union | `packages/write-router/src/types.ts:70-75` | new variant added here |

### Native annotation primitive (verified — already in codebase, NOT wired to descriptions)
| Concern | Location | Note |
|---------|----------|------|
| Vendor MCP tool schema | `src/daemon/mcp-vendor-write-handlers.ts:105-108, 202` | `ANNOTATION` = {nodeId, annotationId, labelMarkdown, categoryId, properties}; required [nodeId, labelMarkdown] |
| Native plugin runtime | `vendor/.../cursor_mcp_plugin/code.js:185, 2555-2639` | `case "set_annotation"` validates node supports annotations then `node.annotations = [newAnnotation]` (overwrite) |
| Wire-level redaction | `src/daemon/figma-plugin-client.ts:141` | `redactWire(JSON.stringify(envelope))` — redaction boundary the native path crosses |

### Manifest data available for mapping (verified)
- `ManifestEntry.area_annotations[]` — `area_id`, `title`, `target_area`, `description`, `interaction`, `motion`, `policy`, `states[]`, `data_refs[]`, `qa_notes[]`, `placement_hint` (types.ts:19-31, 56).
- `ManifestEntry.data_requirements[]` (types.ts:33-43, 57).
- Schemas mirrored in `schema/description-manifest.schema.json`, `schema/frame-description.schema.json`.

### Constraints (verified)
- 300-line file limit (CLAUDE.md, file-size-limit rule) — excludes generated / `*.md` / `*.yaml` / `*.json`.
- Vendor pin: `vendor/cursor-talk-to-figma-mcp/` is PINNED external source (SPEC-FIGMA-017 freshness path). Minimize edits there; prefer the autopus dispatcher / write-router layer.
- INV-W2: all outbound text passes `autopusRedact` / `redactWire`.
- INV-PLUGIN-CONSENT: every mutation requires the plugin bridge connected.
- AC-S8 invariant: `annotation_card` 3-step decomposition is contracted for partial-disconnect rollback — must not change unless explicitly scoped.

---

## 3. Goals & Success Criteria

### Goals
- Deliver frame/area descriptions as native Figma annotations so developers read them in the Dev Mode panel, anchored to the relevant node.
- Add the capability additively, without breaking the existing `annotation_card` target or the AC-S8 rollback invariant.
- Preserve redaction parity (INV-W2) and the dryRun to approve to apply to undo lifecycle.

### Success Criteria
- A manifest entry written with `write_target: "native_annotation"` results in one native annotation per resolved area (or one frame-level annotation as fallback), visible in Figma Dev Mode.
- Annotation `labelMarkdown` content is verified redacted before leaving the daemon.
- Undo restores the node’s prior annotation state; re-apply of identical content is an observable no-op.
- The Review UI displays `native_annotation` as a target with a Dev-Mode-visibility hint.
- Zero regressions in existing `annotation_card` AC-S8 tests.

---

## 4. Design Options & Recommendation

Four mapping options were evaluated against eight trade-off axes.

| Axis | (a) Replace card w/ 1 native/frame | (b) 1 native per area, replace card | (c) Hybrid (native + keep card/page) | (d) NEW `native_annotation` target, 1 per area |
|------|-----------------------------------|-------------------------------------|--------------------------------------|----------------------------------------------------|
| Dev visibility (Dev Mode panel) | Good | Best | Best | Best |
| Expressiveness vs label limits | Poor (loses richness) | Good (per-area concise) | Best (card keeps full narrative) | Good (per-area concise) |
| Non-Dev-Mode visibility | Lost | Lost | Preserved (card/page) | PM-selectable (card stays available) |
| Area-to-node mapping reliability burden | Low (frame only) | High | High | High (but isolated to new adapter) |
| Category management (file-level resource) | Required | Required | Required | Required |
| Undo / idempotency | New descriptor | New descriptor | New descriptor | New descriptor (isolated) |
| Backward compatibility | Breaks AC-S8 | Breaks AC-S8 | Safe | Safe — additive |
| Vendor-pin edit risk | Low | Low | Low | Low (reuses existing native op) |

### Recommendation: Option (d) — additive new `native_annotation` write target, one native annotation per `area_annotation` (frame-level fallback)

Reasoning (with confidence levels):
- Backward compatibility (high confidence): options (a) and (b) replace `annotation_card`, which directly breaks the AC-S8 fixed 3-step rollback invariant (`annotation-card-plan.ts:13` carries an explicit `@AX:NOTE` warning that changing it alters the partial-disconnect observation surface). Option (d) leaves that path untouched. This alone disqualifies (a)/(b) without an explicit migration scope.
- Reversibility (high confidence): an additive enum member + adapter + undo variant is reversible by removing the registration; no existing behavior is rewritten.
- Vendor-pin risk (high confidence): the native `set_annotation` runtime already exists in vendor `code.js` and is reachable through the daemon’s vendor write handlers. Option (d) reuses it, requiring zero vendor edits — fully consistent with the SPEC-FIGMA-017 pin constraint.
- Dev UX (medium-high confidence): per-area annotations give the richest Dev-Mode handoff. The cost is area-to-node resolution reliability, but that cost is isolated inside the new adapter rather than spread across the shared card path.
- vs Option (c) Hybrid (medium confidence): (c) is functionally a superset of (d) — (d) plus "keep card/page for full narrative." Since (d) does not remove the card, a PM can already achieve the hybrid outcome by running both targets. Formalizing (c) as a coupled dual-write adds orchestration complexity (two undo descriptors per entry, partial-failure semantics across two targets) that is not justified for v1. (c) is the natural follow-up if users later want guaranteed dual-delivery in one apply.

Challenge to the main-session leaning: the leaning (option d, concise `labelMarkdown` per area attached to mapped nodes, lowest-risk and reversible) is confirmed, with one sharpening: the per-area mapping (Q2/Q3) is where the real engineering risk lives, not the enum/adapter wiring. The PRD therefore elevates area-to-node resolution to a Must requirement with an explicit confidence/fallback observable, rather than treating it as an implementation detail. If area-to-node resolution proves unreliable in practice, the safe degradation is frame-level annotation (one annotation on the frame node), which is still a strict improvement over the floating card for Dev Mode readers.

---

## 5. Functional Requirements (EARS, MoSCoW)

### Must

REQ-01 (Ubiquitous / Priority: Must) — THE SYSTEM SHALL define a new `WriteTarget` value `native_annotation` in the write-router type contract, registered in the adapter registry alongside the existing six targets.

REQ-02 (Event-driven / Priority: Must) — WHEN a manifest entry has `write_target: "native_annotation"` and contains one or more `area_annotations`, THE SYSTEM SHALL produce one native Figma annotation per area, each attached to the area resolved node via the native annotation primitive (`labelMarkdown`, optional `categoryId`).

REQ-03 (Event-driven / Priority: Must) — WHEN a `native_annotation` entry has no `area_annotations`, THE SYSTEM SHALL produce a single frame-level native annotation attached to the frame node, summarizing intent, user value, and success criteria.

REQ-04 (Event-driven / Priority: Must) — WHEN resolving an area to a node, THE SYSTEM SHALL attempt to match `target_area` and `placement_hint` against node names, and WHEN no confident match is found, THE SYSTEM SHALL fall back to the frame node and record the fallback in an observable resolution result.

REQ-05 (Ubiquitous / Priority: Must) — THE SYSTEM SHALL pass all native annotation `labelMarkdown` content through the daemon redaction boundary (`redactWire` / `autopusRedact`) before the content leaves the daemon, satisfying INV-W2.

REQ-06 (Event-driven / Priority: Must) — WHEN a `native_annotation` apply succeeds, THE SYSTEM SHALL return an undo descriptor that captures each affected node prior annotation state, such that undo restores that prior state.

REQ-07 (State-driven / Priority: Must) — WHILE the plugin bridge is disconnected, THE SYSTEM SHALL reject `native_annotation` apply with the existing plugin-consent error path (INV-PLUGIN-CONSENT), performing no mutation.

REQ-08 (Event-driven / Priority: Must) — WHEN the same `native_annotation` entry is applied twice to the same nodes with identical content, THE SYSTEM SHALL produce an observable idempotent result (no net change to annotation state).

### Should

REQ-09 (Event-driven / Priority: Should) — WHEN a `native_annotation` entry is written, THE SYSTEM SHALL surface the `native_annotation` target in the Review UI with an indication that native annotations are visible in Figma Dev Mode.

REQ-10 (Event-driven / Priority: Should) — WHEN an area `labelMarkdown` would exceed the practical native annotation label length, THE SYSTEM SHALL truncate with a clear continuation indicator and keep the full narrative available via the existing `annotation_card` / `descriptions_page` targets.

REQ-11 (Optional / Priority: Should) — WHERE a manifest area carries enough signal to classify the annotation, THE SYSTEM SHALL set a native annotation `categoryId` so Dev-Mode grouping is meaningful; WHERE no category resource exists in the file, THE SYSTEM SHALL omit `categoryId` rather than fail.

### Nice

REQ-12 (Optional / Priority: Nice) — WHERE area-to-node resolution returns multiple candidate nodes, THE SYSTEM SHALL record the candidate set in the resolution result to aid future disambiguation.

REQ-13 (Optional / Priority: Nice) — WHERE a PM has previously chosen `native_annotation` for a frame, THE SYSTEM SHALL retain that choice as the suggested default on subsequent writes for the same frame.

---

## 6. Non-Functional Requirements

- NFR-01 (file size): every new/modified source file stays under the 300-line hard limit; split the adapter, plan-emit helper, and area-to-node resolver into separate files if needed.
- NFR-02 (vendor pin): no edits to `vendor/cursor-talk-to-figma-mcp/` runtime are required for the happy path; the native `set_annotation` op is reused as-is. Any unavoidable vendor touch is flagged and minimized.
- NFR-03 (backward compatibility): the `annotation_card` adapter, `annotation-card-plan.ts` 3-step decomposition, and AC-S8 tests remain unchanged and passing.
- NFR-04 (redaction parity): native path redaction is demonstrably equivalent to the card path — same redactor, applied before the wire boundary.
- NFR-05 (lifecycle parity): `native_annotation` participates in the existing dryRun to approve to apply to undo lifecycle without a parallel code path.
- NFR-06 (observability): area-to-node resolution outcomes (matched / fallback / multi-candidate) are observable for debugging and PM trust.

---

## 7. User Experience

Developer (Dev Mode): opens the frame in Figma Dev Mode, sees native annotations anchored to the components they describe in the annotation panel, reads concise per-area intent/states/data without locating a floating card.

PM (Review UI): generates a description, in review selects `native_annotation` as the write target for a frame, sees a hint that the output is visible in Dev Mode (and that non-Dev-Mode viewers will not see it), approves, applies.

Designer (canvas): the working canvas is not populated with an additional free-floating text card when `native_annotation` is chosen; descriptions live as node properties.

---

## 8. Data Model & Contract Changes

- `WriteTarget` union (`types.ts:4-10`): add `"native_annotation"`.
- `UndoDescriptor` union (`types.ts:70-75`): add a variant capturing prior annotation state per node (e.g. `{ type: "restore-annotation"; node_id; prior: <annotation snapshot> }`). Exact shape decided in `spec.md`.
- New adapter module `packages/write-router/src/adapters/native-annotation.ts` (apply + undo), registered in `registry.ts` `TARGETS` and `defaultAdapters`.
- New plan-emit helper for the native target (separate from `annotation-card-plan.ts` to protect AC-S8).
- New area-to-node resolver module (kept separate for the 300-line limit and testability).
- Native label composition helper (concise per-area `labelMarkdown`), distinct from the rich `renderAnnotationText` card composer.
- Schema mirrors (`schema/*.json`) updated if the manifest gains a resolution hint field; no new runtime dependency.

---

## 9. Out of Scope

- Removing the existing `annotation_card` target — both targets coexist; removal is a separate decision/SPEC.
- Coupled hybrid dual-write (option c) — guaranteed simultaneous native + card/page delivery in one apply is deferred; PMs can run both targets manually.
- HTTP MCP parity — this PRD targets the stdio/daemon write path; HTTP MCP surface parity is out of scope.
- Generic annotation editing UI — no standalone UI for browsing/editing native annotations beyond surfacing the target choice in the Review UI.
- File-level annotation category resource creation/management — creating new Dev-Mode annotation categories in the Figma file is out of scope; the feature uses existing categories or omits `categoryId`.
- Enriching `AreaAnnotation` with an explicit author-provided `node_id` — if heuristic resolution proves insufficient, a manifest-level `node_id` field is a follow-up.

---

## 10. Pre-Mortem (Risks & Mitigations)

| # | Failure scenario | Likelihood | Impact | Mitigation |
|---|------------------|-----------|--------|------------|
| PM-1 | Annotation label too long — `labelMarkdown` exceeds practical native limit, content truncated or rejected | Medium | Medium | REQ-10 truncation with continuation indicator; full narrative remains in card/page target |
| PM-2 | Area-to-node resolution fails — `target_area`/`placement_hint` does not match any node name, annotations land on wrong node or nowhere | High | High | REQ-04 frame-node fallback + observable resolution result (NFR-06); frame-level annotation is the safe degradation |
| PM-3 | Category not created in file — `categoryId` references a non-existent file resource, native API rejects | Medium | Low | REQ-11 omit `categoryId` when the category resource is absent rather than fail |
| PM-4 | Dev-Mode-only invisibility surprises PM — PM applies native annotation, then a non-Dev-Mode stakeholder cannot see it and reports it missing | High | Medium | REQ-09 Review UI hint stating Dev-Mode-only visibility; documented in UX (section 7) |
| PM-5 | Overwrite clobbers a pre-existing manual annotation — native `set_annotation` overwrites `node.annotations` (code.js:2629) | Medium | Medium | REQ-06 capture prior annotation state in undo descriptor so a clobbered manual annotation is restorable; surface a warning when prior annotations exist |
| PM-6 | AC-S8 regression — a shared change accidentally alters the card 3-step decomposition | Low | High | NFR-03 isolate native target in its own modules; do not touch `annotation-card-plan.ts`; keep AC-S8 tests green |
| PM-7 | Redaction bypass — native `labelMarkdown` reaches Figma unredacted via a code path that skips `redactWire` | Low | High | REQ-05/NFR-04 route exclusively through the daemon redaction boundary; add a test asserting redaction on the native path |

---

## 11. Open Questions

- OQ-1 (from Q3/A3): What is the most reliable area-to-node resolution heuristic given that `AreaAnnotation` has no `node_id` today — node-name match on `target_area`, `placement_hint`, geometry overlap, or a combination? Resolve in `spec.md` / `research.md`. (Assumption A3 in effect: name/hint match + frame fallback.)
- OQ-2 (from Q5/A5): Exact `UndoDescriptor` shape for restoring prior annotation state — full snapshot of `node.annotations` vs minimal descriptor. (Assumption A5 in effect: capture prior state for restore.)
- OQ-3 (from Q1/A1): Confirm with the user that both targets should coexist long-term (vs eventual card deprecation). (Assumption A1 in effect: coexist; removal out of scope.)
- OQ-4 (from REQ-10): What is the concrete native annotation `labelMarkdown` length limit to truncate against? Needs empirical confirmation against the Figma Dev-Mode API. (Assumption: truncate conservatively, keep full text in card/page.)
- OQ-5 (from REQ-11): How should an annotation `categoryId` be derived from manifest signal (persona tags? area kind?) when categories exist? (Assumption: omit when uncertain.)

---

## SPEC Decomposition Decision

One SPEC suffices (SPEC-FIGMA-018). The requested outcome — descriptions delivered as native annotations for developer handoff — closes within a single cohesive change: one additive `WriteTarget`, one adapter (apply + undo), one plan-emit helper, one area-to-node resolver, one label composer, plus a Review UI surface and redaction/undo tests. All modules live in the same `packages/write-router` + `apps/review-ui` boundary and share one acceptance story (happy path per-area annotation, frame fallback, redaction parity, undo restore, idempotency, plugin-consent rejection, AC-S8 non-regression).

No sibling SPEC is required for v1. Two clearly-bounded follow-ups are recorded as out-of-scope rather than hand-waved: (1) coupled hybrid dual-write (option c) and (2) author-provided `node_id` enrichment of `AreaAnnotation` if heuristic resolution proves insufficient. Each would be its own SPEC if pursued.

### Feature Coverage Map
| Outcome slice | Owning requirement(s) | Acceptance responsibility (to be authored) |
|---------------|----------------------|-------------------------------------------|
| Native annotation per area | REQ-02, REQ-04 | Must scenario: multi-area entry to one annotation per resolved node |
| Frame-level fallback | REQ-03, REQ-04 | Must scenario: no-area entry to single frame annotation; unresolved area to frame fallback |
| Redaction parity (INV-W2) | REQ-05, NFR-04 | Must scenario: secret in `labelMarkdown` redacted before wire |
| Undo / idempotency | REQ-06, REQ-08 | Must scenario: undo restores prior state; re-apply is no-op |
| Plugin consent | REQ-07 | Must scenario: disconnected bridge to reject, no mutation |
| Review UI surface | REQ-09 | Should scenario: target visible with Dev-Mode hint |
| Label length safety | REQ-10 | Should scenario: oversized label truncated, full text in card/page |
| Backward compatibility | NFR-03, PM-6 | Must scenario: AC-S8 card decomposition unchanged and passing |
