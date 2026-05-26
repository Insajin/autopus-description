# SPEC-FIGMA-017 — Designer Write Surface Unification

> Status: draft
> Depends on: SPEC-FIGMA-006/009 (MCP baseline), SPEC-FIGMA-011 (write tools), SPEC-FIGMA-014/015/016 (P0-P2 expansion), SPEC-FIGMA-007 (plugin command dispatch), vendor/cursor-talk-to-figma-mcp (MIT, 50+ tools)
> Scope: absorb the vendored cursor-talk-to-figma-mcp surface into autopus-mcp so designers using Claude Desktop (where the official Figma MCP is read-only) can run the full design-creation loop through a single autopus MCP + a single rebranded plugin

## 1. Problem

Designers work in **Claude Desktop on Windows**. The official Figma MCP exposes only **read** capabilities in that surface — designers cannot create frames, set variables, build components, or draw diagrams through it. They need write capability through *some* MCP.

`autopus-mcp` currently exposes 26 tools (after SPEC-FIGMA-014/015/016) but only **6 write tools**, all of which write description-related artifacts (`plan_emit`, `dryRun`, `approve`, `apply`, `undo`, `generate_description`). None create design elements.

`vendor/cursor-talk-to-figma-mcp` (MIT-licensed, already vendored) provides **46 MCP tools and 6 MCP prompts** that cover frame/text/component creation, fill/stroke/corner/layout styling, auto-layout, component instance operations, prototype reactions, diagram connectors, and exports. The vendored plugin (`vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/code.js`, 4121 LOC) implements the matching command handlers.

The autopus plugin and the cursor plugin are **two separate dispatchers in two different plugin folders**. Designers cannot install both — Figma allows one plugin per `id`. Unifying the surface requires:

1. Merging the two dispatchers into one plugin
2. Surfacing all 46 vendor tools through `autopus-mcp` so the designer registers one MCP, not two
3. Resolving the WebSocket transport — vendor uses a separate Bun relay on `:3055`; autopus has its own daemon with a different bridge

## 2. Goals

- WHEN a designer registers `autopus-mcp-stdio` in Claude Desktop, THE SYSTEM SHALL expose all 46 vendor design-creation tools alongside the existing 26 autopus tools (72 total) without breaking SPEC-FIGMA-009 / 011 / 014 / 015 / 016 invariants.
- WHEN a designer installs the rebranded Autopus Figma plugin (from Figma Organization private), THE SYSTEM SHALL handle BOTH description-workflow commands (set_annotation, post_comment, set_plugin_data, ...) AND design-creation commands (create_frame, set_fill_color, set_layout_mode, ...) through a single plugin instance.
- WHEN the designer issues a tool call, THE SYSTEM SHALL dispatch the command through a single WebSocket bridge (either the existing autopus daemon bridge or the vendor relay, decided in §4).
- WHEN vendor receives an upstream update, THE SYSTEM SHALL be able to pull the change via `git subtree` without manual replay — the tool mapping table is the only point of contact (REQ-13).

## 3. Tool Inventory (vendor)

### 3.1 MCP tools — 46 (categorized for SPEC purposes; final dispatcher categorization may differ)

| Category | Count | Tools |
|----------|-------|-------|
| **Inspect** | 8 | `get_document_info`, `get_selection`, `get_node_info`, `get_nodes_info`, `read_my_design`, `get_styles`, `get_local_components`, `get_reactions` |
| **Create** | 4 | `create_rectangle`, `create_frame`, `create_text`, `create_component_instance` |
| **Modify (node)** | 9 | `set_fill_color`, `set_stroke_color`, `set_corner_radius`, `set_text_content`, `set_multiple_text_contents`, `move_node`, `resize_node`, `clone_node`, `swap_overrides_instances` |
| **Modify (auto-layout)** | 5 | `set_layout_mode`, `set_padding`, `set_axis_align`, `set_layout_sizing`, `set_item_spacing` |
| **Component / instance** | 2 | `get_instance_overrides`, `set_instance_overrides` |
| **Annotation** | 3 | `get_annotations`, `set_annotation`, `set_multiple_annotations` |
| **Scan** | 2 | `scan_text_nodes`, `scan_nodes_by_types` |
| **Diagram / connector** | 2 | `set_default_connector`, `create_connections` |
| **Delete** | 2 | `delete_node`, `delete_multiple_nodes` |
| **Selection / focus** | 2 | `set_focus`, `set_selections` |
| **Export** | 1 | `export_node_as_image` |
| **Channel** | 1 | `join_channel` |
| **Strategy** ([NEW] — likely MCP prompts mislabeled) | 5 | `annotation_conversion_strategy`, `design_strategy`, `read_design_strategy`, `reaction_to_connector_strategy`, `text_replacement_strategy` (subject to reclassification during implementation) |

### 3.2 MCP prompts — 6

To be enumerated during Phase 1; vendor declares them via `server.prompt(...)` (6 call sites at server.ts line 1373, 1460, 1644, 1887, 2044, 2530). Out of scope for v1 absorption (`MCP prompts` capability is currently unused in autopus-mcp — defer to a follow-up SPEC).

### 3.3 Overlapping tool names — Phase 1 audit result

**MCP tool name collisions: 0.** All 46 vendor tool names are disjoint from the 26 autopus tool names. The vendor's plugin-level command names (`delete_node`, `set_annotation`, etc.) inside `autopus_command_dispatch.ts` are *internal* plugin dispatch keys, NOT MCP tool surface names.

**Functional overlaps** (same intent, different implementation):
- vendor `export_node_as_image` (via plugin) ↔ autopus `figma_export_image` (via Figma REST). Both kept; runbook documents which to use.
- vendor `get_node_info` / `get_document_info` (via plugin) ↔ autopus `figma_get_frame_meta` / `figma_list_frames` (via REST). Both kept.

**Decision — Strategy B (direct adoption).** vendor tool names stay as-is. No prefix. Designers and AI clients can use upstream cursor-talk-to-figma docs verbatim. Zero rename work.

## 4. WebSocket Bridge Architecture

vendor architecture:
```
Cursor/Claude  ──stdio──>  vendor MCP Server  ──ws──>  Bun Relay (:3055)  ──ws──>  Figma Plugin
```

autopus architecture (current):
```
Claude         ──stdio──>  autopus-mcp-stdio  ──ws──>  autopus daemon bridge  ──ws──>  Figma Plugin
```

Two paths to unify:

- **Path X — Adopt vendor relay**: ship `src/socket.ts` (or a node port of it) as part of the autopus daemon. autopus daemon launches it on `:3055`, plugin connects there, both sides use a single channel. *Pros*: minimal change to vendor code, vendor's reconnection / chunking / progress-update protocol preserved. *Cons*: an extra long-running server inside the daemon process; port collision risk.
- **Path Y — Adopt autopus bridge**: vendor commands flow through the existing autopus daemon bridge (modify vendor plugin to point at autopus's WebSocket URL/port). *Pros*: one bridge, one port, reuses autopus tunnel infra (SPEC-FIGMA-008 tunnel redaction). *Cons*: vendor plugin code modification required; vendor's chunking/progress protocol must be reimplemented on autopus side.

**Decision (tentative — confirmed in Phase 2)**: **Path X**. autopus daemon hosts both bridges; the description-write bridge stays as-is, a new `:3055` relay accepts vendor-style commands. Plugin holds two WebSocket connections internally. Reason: vendor command set is large (46) and vendor relay protocol is hardened; reimplementing would risk silent regressions.

**Phase 1 follow-up — autopus bridge investigation**: `src/daemon/bridge.ts:55-60` declares "Hermetic start — the test surface does not require a real socket. Production binds to 127.0.0.1 ONLY". The current `WebSocketBridge` class is largely a test stub; the production WebSocket plumbing must be located OR confirmed missing before Phase 2 can finalize Path X vs Y. Add to Phase 2 entry checklist: find production WS server (search for `WebSocketServer`, `createServer.*ws`, or plugin connect-back code) and report findings to this SPEC.

## 5. Requirements

### REQ-01 — additive ListTools

WHEN ListTools is invoked, THE SYSTEM SHALL append the 46 vendor tools AFTER the existing 26 autopus tools. SPEC-FIGMA-009/011/014/015/016 byte-equal positions stay intact.

### REQ-02 — plugin command dispatch unification

WHEN the plugin receives a WebSocket command, THE SYSTEM SHALL route it to either the autopus description dispatcher OR the vendor design dispatcher based on the command name. A single fenced dispatch entry-point in `autopus_command_dispatch.ts` SHALL be the only call site (extend the existing `dispatchInverse` default arm).

### REQ-03 — single bridge surface from the designer's perspective

WHEN a designer launches the plugin, THE SYSTEM SHALL show **one** plugin instance ("Autopus Figma") in Figma's plugin list. The plugin SHALL connect to the unified daemon (Path X or Y per §4) and accept the full command set.

### REQ-04 — redaction parity preserved

WHEN any vendor design command carries text fields (frame names, text contents, annotation text), THE SYSTEM SHALL pass them through `autopusRedact` BEFORE applying to Figma nodes — INV-W2 inherited from SPEC-FIGMA-009/011 extends to all 46 new tools.

### REQ-05 — name collision resolution

WHEN a vendor tool name conflicts with an existing autopus tool, THE SYSTEM SHALL resolve per the Phase 1 strategy decision (§3.3). The resolution SHALL be documented in this SPEC and surfaced in the runbook.

### REQ-06 — file size limit compliance

NO source file added or modified by this SPEC may exceed 300 lines (project rule). The vendor's 4121-line `code.js` MUST NOT be inlined as-is; the dispatcher SHALL delegate to small per-category modules (one per §3.1 category) OR keep `code.js` in vendor/ and import its dispatch entry point.

### REQ-07 — vendor freshness path

THE SYSTEM SHALL preserve `vendor/cursor-talk-to-figma-mcp/AUTOPUS_PIN.md` and the `Tool Mapping Changes` table so future vendor updates can be pulled via `git subtree` without losing local mappings.

### REQ-08 — plugin manifest rebranding

WHEN the plugin is published, THE SYSTEM SHALL rebrand:
- `name`: "Cursor MCP Plugin" → "Autopus Figma"
- `id`: new Figma-assigned ID at publish
- `editorType`: `["figma", "figjam"]` (unchanged)
- `documentAccess`: `"dynamic-page"` (unchanged)
- `networkAccess.allowedDomains`: `["ws://localhost:3055"]` + (if applicable) sanctioned internal hosts (added in Phase 5)

### INV — preserved invariants

- INV-W4a, INV-W4b: baseline read/write byte-equal (SPEC-FIGMA-009/011)
- INV-W2: redaction on all outbound `text` payloads
- INV-FIGMA-READ: figma_* read tools HTTP GET only (SPEC-FIGMA-014) — vendor tools that hit Figma REST inherit this
- INV-BRIEF-PATH (SPEC-FIGMA-015), INV-TUNNEL-REDACT / INV-BATCH-DURABILITY / INV-MODE-SESSION (SPEC-FIGMA-016)
- INV-PLUGIN-CONSENT (SPEC-FIGMA-007): every Figma mutation requires the plugin to be connected; bridge-disconnected `apply` returns `PLUGIN_NOT_CONNECTED` — vendor design commands inherit this gate

## 6. Phase Plan

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| **Phase 1 — Inventory + decisions** | 1d | Name collision audit, Strategy A/B/C decision, prompt enumeration, ws bridge decision (Path X/Y) committed back to this SPEC |
| **Phase 2 — WebSocket bridge unification** | 1-2d | Either embed vendor `src/socket.ts` into autopus daemon (Path X) or modify vendor plugin to point at autopus bridge (Path Y); single port, single channel concept end-to-end |
| **Phase 3 — Plugin code unification** | 2-3d | Single plugin folder, dispatcher merges description + vendor commands, manifest rebranded; vendor's `code.js` either imported as-is from `vendor/` or split into per-category modules under the plugin folder |
| **Phase 4 — MCP server tool absorption** | 2-3d | 46 new dispatchers in autopus-mcp, split into category modules under `src/daemon/figma-design/*.ts`, ListTools order finalized, byte-equal tests for positions 1-26 |
| **Phase 5 — Tests + freshness path** | 1d | 46-tool dispatch tests, regression against 55 existing MCP tests, AUTOPUS_PIN.md ToolMapping table updated, `git subtree` pull procedure documented |
| **Phase 6 — Org publish + designer guide v2** | 1d | manifest finalization, Figma Org publish steps documented, designer guide v2 (Claude Desktop / Windows) |

**Total: 8-11 days.**

## 7. Out of Scope

- MCP `prompts` capability absorption (vendor's 6 prompts) — deferred to SPEC-FIGMA-018.
- HTTP MCP transport parity (`autopus-mcp-http`) for the new 46 tools — deferred; stdio first.
- Generic design AI (e.g., LLM-driven layout suggestions on top of vendor tools) — out of scope; vendor tools are pure Figma operations.
- Vendor's Cursor-specific install commands (`bun setup`, `.cursor/mcp.json`) — autopus's existing install path takes over.

## 8. Acceptance Criteria

- AC-T1: `ListTools` returns 72 entries (26 autopus + 46 vendor) in the documented order; positions 1-26 byte-equal SPEC-FIGMA-016 reference.
- AC-T2: A `create_frame` MCP call results in a frame node visible in Figma when the rebranded plugin is connected.
- AC-T3: A description-workflow `apply` call still works after plugin unification (no regression in SPEC-FIGMA-011).
- AC-T4: Any text-bearing vendor command (e.g., `set_text_content` with `"figd_LEAKED"` in args) results in node text that does NOT contain the redacted token (INV-W2).
- AC-T5: `git subtree pull` of vendor changes does not require touching any file outside `vendor/cursor-talk-to-figma-mcp/`; tool mapping diffs only.
- AC-T6: All 55 prior MCP regression tests pass without modification.
- AC-T7: 46 new dispatch tests (one positive + one error path per tool) pass with ≥85% coverage on new code.
- AC-T8: Plugin manifest under Figma Organization private publish accepts the renamed plugin; designer can install via Figma plugin browser.

## 9. References

- `vendor/cursor-talk-to-figma-mcp/CLAUDE.md` — vendor architecture
- `vendor/cursor-talk-to-figma-mcp/src/talk_to_figma_mcp/server.ts` — 46 tool definitions
- `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/code.js` — 4121-line plugin dispatcher (vendor)
- `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts` — autopus description dispatcher (existing)
- SPEC-FIGMA-014/015/016 — current 26-tool surface
- `AUTOPUS_PIN.md` — vendor pin + Tool Mapping Changes table (REQ-13)
