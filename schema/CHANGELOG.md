# Schema Changelog

Changes to `schema/frame-description.schema.json` and
`schema/description-manifest.schema.json`. Versioning follows semver per
SPEC-FIGMA-001 REQ-08 / REQ-NFR-02. Minor versions are additive only —
no field removal, rename, or type narrowing.

## v0.2.0 — 2026-05-06

### Added (additive minor per REQ-NFR-02)

- `pilot_metadata.vision_call_count` (optional integer ≥0) — telemetry counter for Vision-augmented LLM calls. Required by SPEC-FIGMA-003 AC-S4.
- `pilot_metadata.run_timestamp` (optional string) — ISO-8601 datetime of generation run; volatile field intentionally normalized in determinism tests (AC-S12).
- `pilot_metadata.model_id` (optional string) — pinned LLM model identifier per SPEC-FIGMA-003 REQ-NFR-05.
- `pilot_metadata.per_mode_breakdown` (optional object) — telemetry breakdown {node-only, vision} call counts and token usage.
- `pilot_metadata.prompt_version` (optional string) — prompt template version label per REQ-30.
- `pilot_metadata.prompt_git_sha` (optional string, hex 40) — active prompt template git SHA per REQ-30.
- `frame-description.review_status` (optional enum `approved | pending_review`) — post-hoc prompt-injection detector classification per SPEC-FIGMA-003 REQ-14 / AC-S14.
- `frame-description.area_annotations` (optional array) — numbered UI-region notes for side-of-frame handoff cards, including target area, product behavior, interaction, motion, policy, QA notes, and data references.
- `frame-description.data_requirements` (optional array) — product-level data list referenced by numbered regions. This records data coordination needs without prescribing endpoint, enum, DB table, component, or storage design.

### Relaxed (constraint loosening — backwards-compatible for producers, forward-compatible for consumers)

- `frame-description.intent`, `user_value`, `success_criteria`: `minLength` lowered from `1` to `0`. Reason: SPEC-FIGMA-003 REQ-09 mandates empty string substitution when the LLM emits the `[CANNOT_INFER]` sentinel. The previous `minLength: 1` made REQ-09 unimplementable without a schema violation. Existing v0.1.0 producers (always emitted ≥1 char) remain valid. Consumers SHOULD treat empty values as "field intentionally blanked, not a generation failure".

### Compatibility

- All v0.1.0 manifests remain valid against v0.2.0 (every addition is optional).
- `tools/validate-manifest` accepts both v0.1.0 and v0.2.0 manifests.
- Producers SHOULD set `schema_version: "0.2.0"` on every emitted manifest from this release forward.

## v0.1.0 — 2026-05-06

### Added

- `frame-description.schema.json` (Draft 2020-12) defining the canonical
  19 frame fields plus the `stale` derivation flag:
  - identifiers: `screen_id`, `display_id` (`^[A-Z][A-Z0-9_-]{1,63}$`)
  - PM-facing free text: `title`, `intent`, `user_value`, `success_criteria`
  - structured arrays: `states`, `edge_cases`, `component_refs`, `data_io`,
    `design_tokens`, `variants`, `navigation`
  - generator signals: `confidence` (`[0.0, 1.0]`), `intent_mismatch`
  - operator metadata: `source_hash` (`^[a-f0-9]{8,128}$`), `write_target`
    (`{annotation_card, descriptions_page, frame_name, plugin_data, none}`),
    `persona_tags` (subset of `{pm, designer, dev, qa}`),
    `token_usage` (`{input_tokens, output_tokens}` non-negative integers)
  - derived flag: `stale` boolean (default `false`, REQ-05)
- Persona membership encoded inline in each field's `description` via the
  canonical marker `[persona_tags: <comma-list>]` per spec.md § 4.1
  (no vendor extensions; AJV-strict and Draft 2020-12 compatible).
- `description-manifest.schema.json` (Draft 2020-12) declaring
  `schema_version` (semver pattern), `pilot_metadata`
  (`pm_reviewer_id`, `pilot_date` ISO-8601 date, `figma_file_ids`,
  `total_token_cost`), and `frames` (array `$ref` to
  `frame-description.schema.json`).

### Changed

(none — initial release)

### Deprecated

(none — initial release)

### Removed

(none — initial release)

### Migration

No migration required. v0.1.0 is the initial schema release.
Producers SHOULD set `schema_version: "0.1.0"` on every emitted manifest.
