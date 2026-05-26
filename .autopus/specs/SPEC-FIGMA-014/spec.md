# SPEC-FIGMA-014 — MCP Surface Expansion (P0)

> Status: draft
> Depends on: SPEC-FIGMA-006 (McpResources), SPEC-FIGMA-009 (stdio wire), SPEC-FIGMA-011 (write tools), SPEC-FIGMA-003 (description generation loop)
> Scope: extends frozen read-only and write tool baselines to surface description generation, Figma read, and manifest validation through the MCP wire transport

## 1. Problem

`autopus-mcp-stdio` currently exposes 4 read-only tools and 5 write tools (total 9). All description generation, Figma file reads, and manifest validation still require CLI invocation (`generate-descriptions`, `figma-read`, `validate-manifest`). Internal users running Claude Desktop or Codex CLI cannot complete the description authoring loop inside their MCP client — they must context-switch to a terminal.

Without P0 expansion the MCP wire transport is a write-back gateway only, not a full authoring surface. SPEC-FIGMA-001 manifest production lives outside the MCP envelope.

## 2. Goals

- WHEN an MCP client requests description generation, THE SYSTEM SHALL accept a Figma file ref and return a description manifest entry without requiring CLI invocation.
- WHEN an MCP client lists or inspects Figma frames, THE SYSTEM SHALL surface the existing `FigmaReadAdapter` 4-method contract (`listTopLevelFrames`, `getFrameMeta`, `exportImage`, `getPrototypeGraph`) as MCP tools.
- WHEN an MCP client validates a manifest payload, THE SYSTEM SHALL invoke `tools/validate-manifest` and return a structured PASS/FAIL response.
- WHEN any new tool is added, THE SYSTEM SHALL preserve all existing read-only and write tool entries, names, descriptions, and ordering (no breaking change to SPEC-FIGMA-011 `WRITE_TOOLS` byte-equal contract).

## 3. Requirements

### REQ-01 — figma read tool surface (read-only)

WHEN ListTools is invoked, THE SYSTEM SHALL append 4 figma read tools AFTER the 4 baseline read-only tools and BEFORE the 5 write tools.

Tools:
- `figma_list_frames` — args `{ file_id: string }` → returns `FrameRef[]`
- `figma_get_frame_meta` — args `{ file_id: string, node_id: string }` → returns `FrameMeta`
- `figma_export_image` — args `{ file_id: string, node_id: string, scale?: number }` → returns `{ image_bytes_base64: string, content_type: string }`
- `figma_get_prototype_graph` — args `{ file_id: string }` → returns `PrototypeGraph`

INV-W4 invariant (baseline 4 read-only entries frozen) MUST remain — the figma tools are an ADDITIVE extension, not a replacement.

### REQ-02 — generate_description write tool

WHEN an MCP client invokes `generate_description`, THE SYSTEM SHALL run a single-frame description generation using the configured provider and return a `ManifestEntry`.

Tool:
- `generate_description` — args `{ file_id: string, node_id: string, provider?: "mock"|"anthropic"|"openai", model?: string, mode?: "auto"|"node-only" }` → returns `ManifestEntry`

INV-W4 invariant restated as INV-W4a: baseline read-only entries (4) and SPEC-FIGMA-011 write tools (5) remain byte-equal. The new write tool `generate_description` MUST be appended AFTER the 5 SPEC-FIGMA-011 write tools (plan_emit, dryRun, approve, apply, undo).

### REQ-03 — validate_manifest read tool

WHEN an MCP client invokes `validate_manifest`, THE SYSTEM SHALL accept either an inline manifest object or a manifest file path and return `{ valid: boolean, errors: ValidationError[] }`.

Tool:
- `validate_manifest` — args `{ manifest?: object, manifest_path?: string }` (exactly one required) → returns validation result

### REQ-04 — additive ListTools ordering

WHEN ListTools is invoked, THE SYSTEM SHALL emit tools in this exact order:
1. 4 baseline read-only (`get_active_selection`, `get_pending_descriptions`, `get_audit_events`, `get_stale_frames`)
2. 4 figma read (REQ-01)
3. 1 validate read (REQ-03)
4. 5 SPEC-FIGMA-011 write (plan_emit, dryRun, approve, apply, undo)
5. 1 generate write (REQ-02)

Total: 15 tools. Existing positions 1-4 and 10-14 stay byte-equal with prior SPECs.

### REQ-05 — redaction parity

WHEN any new tool returns text, THE SYSTEM SHALL pass output through `redact()` (token-redactor) and `wrapUntrustedFigmaText` where text originates from Figma node names or user-controlled fields (INV-W2 redaction parity).

### REQ-06 — adapter injection

WHEN `figma_*` tools are dispatched, THE SYSTEM SHALL use the configured `FigmaReadAdapter` implementation (default `UseFigmaAdapter` via official Figma REST API). Adapter selection mirrors `generate-descriptions` CLI logic.

### REQ-07 — credential boundary

WHEN any new tool requires a Figma token, THE SYSTEM SHALL read it from `FIGMA_TOKEN` env var (or `FIGMA_PERSONAL_ACCESS_TOKEN`) at daemon startup. Tools MUST NOT accept tokens through their argument schema (prevents leakage to audit/wire).

### NFR-01 — coverage parity

Test coverage for new code MUST be ≥ 85% (project standard). Each new tool MUST have at least one positive and one error-path test.

### NFR-02 — file size limit

No source file MUST exceed 300 lines (project rule). New tool dispatch logic SHALL be split across at least 2 files (read handlers, write handlers) when total exceeds 200 lines.

### NFR-03 — schema-version metadata

`generate_description` output MUST include the same `schema_version` field as SPEC-FIGMA-001 manifest schema, even when the entry is single-frame (not a full manifest).

## 4. Invariants

- INV-W4a: 4 baseline read-only tools (`get_active_selection`, `get_pending_descriptions`, `get_audit_events`, `get_stale_frames`) byte-equal name, description, inputSchema, position 1-4.
- INV-W4b: 5 SPEC-FIGMA-011 write tools (`plan_emit`, `dryRun`, `approve`, `apply`, `undo`) byte-equal name, description, inputSchema, relative ordering preserved at positions 10-14.
- INV-W2: every outbound `text` payload passes through `redact()`.
- INV-FIGMA-READ: `figma_*` tools MUST emit only HTTP GET to Figma REST (no POST/PUT/PATCH/DELETE).

## 5. Out of Scope

- Project brief workflow (see SPEC-FIGMA-015)
- Read tool argument filters (see SPEC-FIGMA-015)
- Batch lane / vision force / preview / status (see SPEC-FIGMA-016)
- HTTP MCP entry point (SPEC-FIGMA-013) — REQ-04 ordering applies to stdio; HTTP wire surface parity is deferred.
- New write paths to Figma (figma_* tools are read-only per INV-FIGMA-READ).

## 6. Acceptance Criteria

- AC-T1: `ListTools` returns exactly 15 entries in the order specified by REQ-04.
- AC-T2: Positions 1-4 and 10-14 are byte-equal with SPEC-FIGMA-009 / SPEC-FIGMA-011 reference snapshots.
- AC-T3: `figma_list_frames` with a valid `file_id` returns `FrameRef[]` matching `UseFigmaAdapter.listTopLevelFrames` output.
- AC-T4: `generate_description` with mock provider returns a `ManifestEntry` containing `schema_version`, `screen_id`, `intent`, `user_value`, `success_criteria`.
- AC-T5: `validate_manifest` with a valid manifest returns `{ valid: true, errors: [] }`.
- AC-T6: `validate_manifest` with an invalid manifest returns `{ valid: false, errors: ValidationError[] }` containing at least one entry.
- AC-T7: Token never appears in any tool's `redacted_args` or output `text` field.
- AC-T8: Unit test coverage for new code ≥ 85%.

## 7. References

- SPEC-FIGMA-006 — McpResources baseline (4 read-only tools)
- SPEC-FIGMA-009 — stdio wire transport (`autopus-mcp-stdio`)
- SPEC-FIGMA-011 — write tool surface (5 entries)
- SPEC-FIGMA-002 — FigmaReadAdapter contract
- SPEC-FIGMA-003 — description generation loop (batch-executor)
- SPEC-FIGMA-001 — manifest schema (`schema/description-manifest.schema.json`)
