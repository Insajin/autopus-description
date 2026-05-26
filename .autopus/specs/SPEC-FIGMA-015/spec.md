# SPEC-FIGMA-015 — Project Brief + Read Tool Filters (P1)

> Status: draft
> Depends on: SPEC-FIGMA-014 (MCP expansion baseline), SPEC-FIGMA-003 project brief flow
> Scope: surface project-brief CLI workflow through MCP and add optional filter arguments to existing read tools

## 1. Problem

The description generation pipeline requires a `project-brief.json` before producing useful frame descriptions. Currently the brief is created/loaded only via CLI flags (`--init-project-brief`, `--project-brief`, `--require-project-brief`). MCP clients cannot:

1. Generate the brief template
2. Inspect or validate the active brief
3. Resolve an effective brief for a given run

Additionally, the baseline read-only tools accept no arguments (`get_pending_descriptions`, `get_stale_frames`, `get_audit_events` all return entire bounded queues). MCP clients cannot filter by `frame_id`, `screen_id`, time range, or limit — they must read everything and post-filter.

## 2. Goals

- WHEN an MCP client requests a project brief template, THE SYSTEM SHALL generate the brief at a caller-specified path under `.autopus/runs/<slug>/` and return its location.
- WHEN an MCP client validates a brief, THE SYSTEM SHALL apply the same checks as `--require-project-brief` and return structured results.
- WHEN an MCP client filters read-tool output, THE SYSTEM SHALL accept optional `frame_id`, `screen_id`, `limit`, `since` arguments and return filtered results.
- WHEN no filter argument is supplied, THE SYSTEM SHALL return the same payload as SPEC-FIGMA-006 (full bounded queue) to preserve backward compatibility.

## 3. Requirements

### REQ-01 — project_brief write tools

WHEN ListTools is invoked AFTER SPEC-FIGMA-014, THE SYSTEM SHALL append 2 brief write tools to the write block.

Tools:
- `init_project_brief` — args `{ project_slug: string, output_path?: string }` → returns `{ brief_path: string, created: boolean }`
- `update_project_brief` — args `{ brief_path: string, patch: object }` → returns `{ brief_path: string, applied_fields: string[] }`

`output_path` MUST be confined to `.autopus/runs/` to enforce the SPEC-FIGMA-003 git policy (project briefs are not committed).

### REQ-02 — project_brief read tools

Tools:
- `get_project_brief` — args `{ brief_path?: string, project_slug?: string }` (exactly one required) → returns brief JSON or `{ error: "NOT_FOUND" }`
- `validate_project_brief` — args `{ brief_path: string }` → returns `{ valid: boolean, missing_required: string[], open_questions: string[] }`

### REQ-03 — read tool filter arguments (DEFERRED to SPEC-FIGMA-017)

Original goal: replace `EMPTY_INPUT_SCHEMA` on baseline read tools with optional filter arguments (`frame_id`, `screen_id`, `limit`, `since`, `event`).

Status: DEFERRED. The current read-tool dispatch path (`handleMcpToolCall` in `mcp-tools.ts`) does not return resource data — it wraps args and returns a fenced prompt. Actual resource data is delivered via the `resources/read` wire surface, not `tools/call`. Adding filter args to the tool inputSchema would also break the SPEC-FIGMA-009 `EMPTY_INPUT_SCHEMA` assertion in `daemon-mcp-stdio-tool-surface.test.ts`.

Clean follow-up path: introduce dedicated `query_pending_descriptions` / `query_stale_frames` / `query_audit_events` tools that own filter args and return data directly. Defer to SPEC-FIGMA-017.

### REQ-04 — filter semantics

- `frame_id` / `screen_id`: exact match
- `since`: ISO-8601 timestamp; entries with `timestamp >= since` are returned
- `limit`: maximum entries returned; default = bounded queue cap
- `event`: exact event name match (e.g., `"client_profile_attached"`, `"description_published"`)
- Unknown arguments → 400-equivalent error response with `redact()` applied

### REQ-05 — backward compatibility

WHEN any existing read tool is invoked with no arguments, THE SYSTEM SHALL return byte-equal output relative to SPEC-FIGMA-006 (subject to bounded-queue ordering).

### REQ-06 — additive ListTools ordering

The 4 new brief tools (2 read + 2 write) are appended AFTER SPEC-FIGMA-014 tools. New total: 19 tools.

Final order:
1-4: baseline read (with new optional schemas)
5-8: figma_* read (SPEC-FIGMA-014)
9: validate_manifest (SPEC-FIGMA-014)
10-11: project_brief read (REQ-02) — `get_project_brief`, `validate_project_brief`
12-16: SPEC-FIGMA-011 write (unchanged)
17: generate_description (SPEC-FIGMA-014)
18-19: project_brief write (REQ-01) — `init_project_brief`, `update_project_brief`

### NFR-01 — coverage parity

≥ 85% coverage for new code.

### NFR-02 — file size limit

≤ 300 lines per source file. Brief dispatch logic SHALL be split into `mcp-project-brief-handlers.ts` if dispatch exceeds 200 lines.

## 4. Invariants

- INV-BRIEF-PATH: brief files MUST be confined to `.autopus/runs/<slug>/` paths
- INV-FILTER-NOOP: empty filter `{}` returns SPEC-FIGMA-006 baseline output
- INV-W4a, INV-W4b, INV-W2: inherited from SPEC-FIGMA-014

## 5. Out of Scope

- Batch lane (SPEC-FIGMA-016)
- Vision force / preview / status (SPEC-FIGMA-016)
- Brief versioning beyond JSON schema
- Multi-client brief locking

## 6. Acceptance Criteria

- AC-T1: `ListTools` returns 19 entries in REQ-06 order.
- AC-T2: Positions 1-9 byte-equal SPEC-FIGMA-014 (modulo expanded inputSchema on positions 2, 3, 4).
- AC-T3: `init_project_brief` with valid slug creates `.autopus/runs/<slug>/project-brief.json` and returns its path.
- AC-T4: `init_project_brief` with `output_path` outside `.autopus/runs/` returns error with `INV-BRIEF-PATH`.
- AC-T5: `get_pending_descriptions` with no args returns SPEC-FIGMA-006 baseline output (byte-equal).
- AC-T6: `get_pending_descriptions` with `{ limit: 5 }` returns at most 5 entries.
- AC-T7: `get_stale_frames` with `{ frame_id: "f1" }` returns only frames matching `f1`.
- AC-T8: `validate_project_brief` on incomplete brief returns `{ valid: false, missing_required: [...] }`.

## 7. References

- SPEC-FIGMA-003 — project brief flow (`docs/runbooks/description-brief-flow.md`)
- SPEC-FIGMA-014 — MCP P0 expansion
- `src/cli/project-brief-cli.ts` — CLI handlers to wrap
