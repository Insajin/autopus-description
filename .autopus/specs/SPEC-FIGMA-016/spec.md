# SPEC-FIGMA-016 — Batch / Vision / Preview / Status (P2)

> Status: draft
> Depends on: SPEC-FIGMA-014 (P0 MCP expansion), SPEC-FIGMA-015 (P1 brief + filters), SPEC-FIGMA-005 (Anthropic batch API), SPEC-FIGMA-006 (daemon resources), SPEC-FIGMA-008 (tunnel redaction)
> Scope: production-grade MCP features for batch processing, mode override, preview, and operational visibility

## 1. Problem

After P0+P1 the MCP wire transport supports the full description authoring loop, but is missing four production-quality affordances:

1. **Cost control** — Anthropic Message Batches API (SPEC-FIGMA-005 REQ-05) cuts cost 50% with 24h SLA. CLI exposes `--batch`; MCP does not.
2. **Mode override** — generation routing auto-selects `auto` (vision) or `node-only`. Operators cannot force a mode via MCP.
3. **Preview** — `dryRun` returns a 7-key serializable view, but it is unreadable for non-developer reviewers (PM/QA). A human-readable preview tool is needed.
4. **Operational visibility** — daemon status, tunnel state, redacted session info is hidden behind the plugin status panel. MCP clients (especially headless Codex CLI sessions) cannot diagnose connection state.

## 2. Goals

- WHEN an MCP client submits a batch job, THE SYSTEM SHALL forward the request to Anthropic Message Batches API and return a batch handle.
- WHEN an MCP client polls a batch handle, THE SYSTEM SHALL return current state (`in_progress | completed | failed`) and (on completion) result manifest.
- WHEN an MCP client forces a generation mode, THE SYSTEM SHALL override the auto-routing for subsequent `generate_description` calls until cleared.
- WHEN an MCP client requests a preview, THE SYSTEM SHALL render a human-readable summary of a pending write.
- WHEN an MCP client requests daemon status, THE SYSTEM SHALL return redacted operational state including tunnel attach status, audit row count, and pending/applied queue sizes.

## 3. Requirements

### REQ-01 — batch lane submission

Tool:
- `submit_batch_lane` (write) — args `{ file_id: string, node_ids: string[], provider?: "anthropic", model?: string }` → returns `{ batch_id: string, submitted_at: string, expected_completion: string }`

`node_ids` length ≥ 2; single-frame jobs should use `generate_description` (SPEC-FIGMA-014 REQ-02) for realtime path.

### REQ-02 — batch lane polling

Tool:
- `get_batch_status` (read) — args `{ batch_id: string }` → returns `{ batch_id, state: "in_progress"|"completed"|"failed", entries?: ManifestEntry[], error?: string }`

The daemon SHALL cache batch handles in `.autopus/batch/` and not require external state.

### REQ-03 — mode override

Tools:
- `force_generation_mode` (write) — args `{ mode: "auto"|"node-only"|"vision-only", clear?: boolean }` → returns `{ active_mode: string, cleared: boolean }`
- `get_generation_mode` (read) — args `{}` → returns `{ active_mode: string, source: "default"|"forced", forced_until?: string }`

`force_generation_mode` is session-scoped. Daemon restart resets to default `auto`. `clear: true` removes the override.

### REQ-04 — preview rendering

Tool:
- `preview_description` (read) — args `{ pending_id: string }` → returns `{ pending_id, markdown: string, intent: string, user_value: string, success_criteria: string, states: string[], edge_cases: string[] }`

`markdown` is a human-readable formatted view of the pending write suitable for PM/QA review. Must invoke `redact()` on output text.

### REQ-05 — daemon status

Tool:
- `get_daemon_status` (read) — args `{}` → returns:
  ```
  {
    version: string,
    uptime_seconds: number,
    transport: "stdio"|"http",
    tunnel: { attached: boolean, redacted_url: string|null },
    pending_count: number,
    applied_count: number,
    audit_row_count: number,
    last_initialize_at: string|null
  }
  ```

`tunnel.redacted_url` MUST be passed through `redactTunnelUrl()` (SPEC-FIGMA-008 primitive). Raw URLs MUST never appear in the response.

### REQ-06 — additive ListTools ordering

After SPEC-FIGMA-015 (19 tools), P2 adds 7 tools:
- Read additions: `get_batch_status`, `get_generation_mode`, `preview_description`, `get_daemon_status` (4)
- Write additions: `submit_batch_lane`, `force_generation_mode` (2)
- Plus: 1 implicit read (`get_generation_mode` listed above) — total 7

Final positions (after SPEC-FIGMA-015):
- Read block (P2 additions appended): `get_batch_status`, `get_generation_mode`, `preview_description`, `get_daemon_status` after position 11
- Write block (P2 additions appended): `submit_batch_lane`, `force_generation_mode` after position 19

Final ListTools size: 26 tools.

### REQ-07 — redaction parity

All new tools MUST pass output through `redact()` and `redactTunnelUrl()` where applicable. `get_daemon_status` is the highest-risk tool for tunnel/secret leakage — INV-W2 strict enforcement.

### REQ-08 — provider error surface

WHEN a batch submission fails (auth, rate limit, network), THE SYSTEM SHALL return `{ error: { code, message }, isError: true }` with `code` from a finite enum: `AUTH | RATE_LIMIT | NETWORK | INVALID_ARGS | PROVIDER_DOWN`.

### NFR-01 — coverage parity

≥ 85% coverage on new code.

### NFR-02 — file size limit

Each new feature handler in its own file:
- `mcp-batch-handlers.ts`
- `mcp-mode-handlers.ts`
- `mcp-preview-handlers.ts`
- `mcp-status-handlers.ts`

≤ 300 lines per file.

### NFR-03 — batch state durability

Batch handles stored in `.autopus/batch/<batch_id>.json` survive daemon restart. Caller can resume polling on restart.

## 4. Invariants

- INV-W4a, INV-W4b, INV-W2, INV-FIGMA-READ, INV-BRIEF-PATH, INV-FILTER-NOOP — all inherited
- INV-BATCH-DURABILITY: batch handles persisted on submit, deleted on terminal state acknowledged by caller
- INV-MODE-SESSION: forced mode does not survive daemon restart
- INV-TUNNEL-REDACT: `get_daemon_status` raw tunnel URL MUST NEVER leave the daemon process

## 5. Out of Scope

- HTTP MCP (SPEC-FIGMA-013) parity for P2 tools — stdio first
- Cross-provider batching (anthropic only for now)
- Streaming batch progress (poll-only)
- Multi-tenant daemon isolation

## 6. Acceptance Criteria

- AC-T1: `ListTools` returns 26 entries; positions 1-19 byte-equal SPEC-FIGMA-015.
- AC-T2: `submit_batch_lane` with mock provider returns `batch_id` matching `^bat_[a-z0-9]{12}$`.
- AC-T3: `get_batch_status` for an unknown `batch_id` returns `{ state: "failed", error: "UNKNOWN_BATCH" }`.
- AC-T4: `force_generation_mode { mode: "node-only" }` followed by `get_generation_mode` returns `active_mode: "node-only", source: "forced"`.
- AC-T5: `force_generation_mode { clear: true }` resets to `auto`.
- AC-T6: `preview_description` returns markdown containing `intent`, `user_value`, `success_criteria` lines.
- AC-T7: `get_daemon_status` with active tunnel returns `tunnel.redacted_url` matching `redactTunnelUrl()` output; raw URL fragments (subdomains, tokens) absent.
- AC-T8: Batch state persisted across daemon restart — submit → restart → poll returns same `batch_id`.
- AC-T9: Coverage ≥ 85% on new code.

## 7. References

- SPEC-FIGMA-005 — Anthropic Message Batches integration (REQ-05)
- SPEC-FIGMA-008 — `redactTunnelUrl` primitive
- SPEC-FIGMA-014 — MCP P0
- SPEC-FIGMA-015 — MCP P1
- `src/providers/anthropic-provider.ts` — batch submission entry point
- `src/routing.ts` — mode auto-selection logic to override
