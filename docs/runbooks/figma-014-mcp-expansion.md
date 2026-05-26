# SPEC-FIGMA-014/015/016 — MCP Surface Expansion Runbook

> Status: implemented
> Covers: P0 (SPEC-FIGMA-014), P1 (SPEC-FIGMA-015), P2 (SPEC-FIGMA-016)

## Overview

The `autopus-mcp-stdio` server now exposes up to **26 MCP tools** (15 baseline + 11 optional extras across three tiers). Each extra tier is wired only when its supporting context is passed to `createMcpStdioServer`, so callers that wire none of the extras still see the SPEC-FIGMA-009 baseline (4 read + 5 write = 9 tools).

## Tool Surface Map

| Tier | Tools | Activation |
|------|-------|------------|
| **Baseline** (SPEC-FIGMA-006/009) | `get_active_selection`, `get_pending_descriptions`, `get_audit_events`, `get_stale_frames` | Always |
| **Baseline write** (SPEC-FIGMA-011) | `plan_emit`, `dryRun`, `approve`, `apply`, `undo` | Pass `writeExtension` |
| **P0 extra read** (SPEC-FIGMA-014) | `figma_list_frames`, `figma_get_frame_meta`, `figma_export_image`, `figma_get_prototype_graph`, `validate_manifest` | Pass `figmaAdapter` + `manifestValidator` |
| **P0 extra write** (SPEC-FIGMA-014) | `generate_description` | Pass `descriptionGenerator` |
| **P1 brief** (SPEC-FIGMA-015) | `get_project_brief`, `validate_project_brief`, `init_project_brief`, `update_project_brief` | Pass `briefWorkspaceRoot` |
| **P2 operational** (SPEC-FIGMA-016) | `get_batch_status`, `get_generation_mode`, `preview_description`, `get_daemon_status`, `submit_batch_lane`, `force_generation_mode` | Pass `p2Context` |

## ListTools order (full activation, 26 entries)

```
1.  get_active_selection
2.  get_pending_descriptions
3.  get_audit_events
4.  get_stale_frames
5.  figma_list_frames                   ← P0 read
6.  figma_get_frame_meta                ← P0 read
7.  figma_export_image                  ← P0 read
8.  figma_get_prototype_graph           ← P0 read
9.  validate_manifest                   ← P0 read
10. get_project_brief                   ← P1 read
11. validate_project_brief              ← P1 read
12. get_batch_status                    ← P2 read
13. get_generation_mode                 ← P2 read
14. preview_description                 ← P2 read
15. get_daemon_status                   ← P2 read
16. plan_emit
17. dryRun
18. approve
19. apply
20. undo
21. generate_description                ← P0 write
22. init_project_brief                  ← P1 write
23. update_project_brief                ← P1 write
24. submit_batch_lane                   ← P2 write
25. force_generation_mode               ← P2 write
```

## Wiring example — full activation

```typescript
import { createMcpStdioServer } from "./src/daemon/mcp-stdio-entry.js";
import { UseFigmaAdapter } from "./src/adapters/use-figma-adapter.js";
import { AdapterBackedDescriptionGenerator } from "./src/daemon/mcp-extra-write-handlers.js";
import { FileBatchStore, ModeOverride } from "./src/daemon/mcp-p2-state.js";

const figmaAdapter = new UseFigmaAdapter({
  client: httpClient,
  token: process.env.FIGMA_TOKEN!,
});

const server = createMcpStdioServer({
  mcp,
  registry,
  auditWriter,
  writeExtension,
  // SPEC-FIGMA-014
  figmaAdapter,
  manifestValidator: { validate: async (path) => /* invoke validate-manifest */ },
  descriptionGenerator: new AdapterBackedDescriptionGenerator(figmaAdapter, provider),
  // SPEC-FIGMA-015
  briefWorkspaceRoot: process.cwd(),
  // SPEC-FIGMA-016
  p2Context: {
    batchStore: new FileBatchStore(".autopus/batch"),
    modeOverride: new ModeOverride(),
    statusSource: { /* ... */ },
    previewFromPending: async (id) => /* lookup pending */ null,
  },
});
```

## Invariants

| Invariant | What it guarantees |
|-----------|--------------------|
| INV-W4a | Positions 1-4 byte-equal SPEC-FIGMA-009 baseline (`get_active_selection`...`get_stale_frames`) |
| INV-W4b | SPEC-FIGMA-011 write tools (plan_emit/dryRun/approve/apply/undo) appear in fixed relative order |
| INV-W2 | Every outbound `text` payload passes through `redact()` |
| INV-FIGMA-READ | `figma_*` tools only emit HTTP GET to Figma REST |
| INV-BRIEF-PATH | Brief paths confined under `<workspaceRoot>/.autopus/runs/` |
| INV-TUNNEL-REDACT | `get_daemon_status` tunnel URL passes through `redactTunnelUrl()` |
| INV-BATCH-DURABILITY | Batch handles persisted under `.autopus/batch/<batch_id>.json` |
| INV-MODE-SESSION | Forced generation mode resets to `auto` on daemon restart |

## Coverage

```bash
npx vitest run tests/unit/daemon-mcp-stdio-tool-surface.test.ts \
                tests/unit/daemon-mcp-stdio-extra-tools.test.ts \
                tests/unit/daemon-mcp-brief-tools.test.ts \
                tests/unit/daemon-mcp-p2-tools.test.ts \
                tests/unit/daemon-mcp-stdio-handshake.test.ts \
                tests/unit/daemon-mcp-stdio-redact.test.ts
```

Expected: **6 test files, 55 tests pass**.

## Deferred work (follow-up SPECs)

- **SPEC-FIGMA-015 REQ-03**: filter args on baseline read tools — deferred to **SPEC-FIGMA-017** (`query_pending_descriptions`, `query_stale_frames`, `query_audit_events` as dedicated query tools rather than modifying frozen baseline schemas).
- **AdapterBackedDescriptionGenerator** ships as a reference single-frame implementation. For multi-frame batched generation in MCP, use `submit_batch_lane` (P2).
- HTTP MCP entry (`autopus-mcp-http`) parity for P0/P1/P2 extras: separate follow-up; stdio wire is the primary contract.

## Files added/modified

```
.autopus/specs/SPEC-FIGMA-014/spec.md
.autopus/specs/SPEC-FIGMA-015/spec.md
.autopus/specs/SPEC-FIGMA-016/spec.md
src/daemon/mcp-extra-read-handlers.ts        ← new (P0 read)
src/daemon/mcp-extra-write-handlers.ts       ← new (P0 write + reference generator)
src/daemon/mcp-brief-handlers.ts             ← new (P1 dispatcher)
src/daemon/brief-path-guard.ts               ← new (P1 path safety)
src/daemon/mcp-p2-handlers.ts                ← new (P2 dispatcher)
src/daemon/mcp-p2-state.ts                   ← new (P2 state primitives)
src/daemon/mcp-stdio-handlers.ts             ← modified (wire all extras)
src/daemon/mcp-stdio-entry.ts                ← modified (SERVER_VERSION 0.2.0)
tests/unit/daemon-mcp-stdio-extra-tools.test.ts  ← new (11 tests)
tests/unit/daemon-mcp-brief-tools.test.ts        ← new (13 tests)
tests/unit/daemon-mcp-p2-tools.test.ts           ← new (16 tests)
docs/runbooks/figma-014-mcp-expansion.md         ← this runbook
```
