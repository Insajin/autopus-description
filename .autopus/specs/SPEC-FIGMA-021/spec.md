# SPEC-FIGMA-021: Plugin Runtime Dispatch Integration for Annotation / Policy-Card Write Targets

> Status: draft

**Status**: draft
**Created**: 2026-06-10
**Domain**: FIGMA
**Module**: `.` (root) — `scripts/build-figma-plugin.mjs` + `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/` (built `dist/plugin/code.js`)
**Mode**: brownfield
**Depends on**: SPEC-FIGMA-020 (composite target + `set_policy_card` op + renderer), SPEC-FIGMA-018 (`native_annotation` + `set_native_annotation` op), SPEC-FIGMA-017 (vendor plugin build), SPEC-FIGMA-007/011 (daemon write apply path)

## 목적 (Purpose)

The autopus plugin command dispatcher and its renderers are unit-tested but **never integrated into the built Figma plugin runtime**, so no annotation/card write target can actually execute in the live plugin. Applying `native_annotation`, `native_annotation_with_card`, or `annotation_card` against the connected plugin fails with `Unknown command: set_native_annotation` (MCP error -32603).

This was discovered during SPEC-FIGMA-020 dogfooding (2026-06-10). The full write pipeline is correct up to the plugin boundary — `dryRun`/`plan_emit` emit the exact `plugin_commands` (verified: 5× `set_native_annotation` + 1× `set_policy_card` with all four policy tables, oracle-correct) — and the daemon apply→plugin bridge was wired in the accompanying SPEC-FIGMA-020 follow-up fix. The only remaining gap is plugin-side execution.

## Root cause

- `scripts/build-figma-plugin.mjs` builds `dist/plugin/code.js` as **vendor `code.js` verbatim + a hand-written `AUTOPUS_PATCH` switch** that wraps `handleCommand`. That switch handles only: `set_text_content`, `set_stroke_color`, `create_text`, `create_image`, `set_plugin_data`, `clear_plugin_data`, `set_frame_name`, `restore_frame_name`, `rename_node`, `upsert_descriptions_page_node`, `set_range_font`, `noop`. Unknown commands fall through to the vendor handler.
- `set_native_annotation`, `set_policy_card`, and `set_annotation` are **absent** from that switch.
- `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts` (`dispatchPluginCommand` + `dispatchSetNativeAnnotation` + `dispatchSetPolicyCard`) and the renderers `autopus_policy_card_renderer.ts` / `autopus_area_handoff_renderer.ts` are referenced **only by unit tests** (`tests/unit/autopus-command-dispatch.test.ts`). They are not imported or bundled into `code.js`.

Net effect: the dispatch logic and renderers are validated in isolation but orphaned from the shipped plugin. The annotation/card surfaces have never been executable in the live plugin.

## 요구사항 (Requirements — EARS form, MoSCoW on a separate meta line)

REQ-01
Priority: Must
Type: Event-driven
WHEN the built plugin receives a `set_native_annotation` command, THE SYSTEM SHALL route it to the native Dev-Mode annotation handler (the SPEC-FIGMA-018 `dispatchSetNativeAnnotation` behavior) and return a `command_result { ok, node_ids?, error? }`, instead of falling through to the vendor handler with `Unknown command`.

REQ-02
Priority: Must
Type: Event-driven
WHEN the built plugin receives a `set_policy_card` command, THE SYSTEM SHALL render the policy definition as real Figma auto-layout tables via the SPEC-FIGMA-020 `createPolicyCardCanvas` renderer and return the created card node id(s) in `node_ids` so the compound undo can delete the card.

REQ-03
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL integrate the canonical `autopus_command_dispatch.ts` dispatcher (and the renderers it calls) into `dist/plugin/code.js` as the single source of truth for these ops, rather than duplicating rendering logic in the build-script patch, so the unit-tested behavior and the shipped behavior cannot diverge. (If a bundler step is introduced, vendor `code.js` MUST remain verbatim per SPEC-FIGMA-017 REQ-07 so `git subtree pull` keeps working.)

REQ-04
Priority: Must
Type: Event-driven
WHEN a `native_annotation_with_card` apply runs end-to-end through the daemon apply bridge against the live plugin, THE SYSTEM SHALL produce both surfaces (the native annotation(s) and the policy card), and WHEN one compound undo runs, THE SYSTEM SHALL restore the prior native annotation state and delete the card node (SPEC-FIGMA-020 REQ-08 verified live).

REQ-05
Priority: Should
Type: Event-driven
WHEN `set_native_annotation` resolves to a per-area node (area-node resolution), THE SYSTEM SHALL attach each area annotation to its resolved node rather than all to the frame node, so multiple area annotations do not collapse onto a single node.

## Out of scope

- Daemon-side enablers already delivered in the SPEC-FIGMA-020 follow-up fix: the MCP `WRITE_TARGETS` allow-list (`native_annotation`, `native_annotation_with_card`), the apply→plugin bridge adapter in `mcp-stdio-entry.ts`, the `buildStubEntry` section carry, and the off-by-default `dryRun` entry-override dev affordance.
- The composite target logic, schema v0.4.0, and plan-emit (SPEC-FIGMA-020, completed).

## Verification (live oracle)

- `dryRun(1307:143792, native_annotation_with_card)` followed by `approve` + `apply` against a connected plugin SHALL mutate the node (native annotation present) and create a policy-card node with the four tables (states/edge_cases/data_requirements/area_annotations); `undo` SHALL reverse both. The pre-fix failure signature is `Unknown command: set_native_annotation`.

## Next step

`/auto plan --from-idea` is not required; run `/auto plan "SPEC-FIGMA-021 plugin runtime dispatch integration"` (or `/auto go SPEC-FIGMA-021` after the plan/acceptance/research files are authored) to expand this draft into the full SPEC set and decide between bundling vs. patch-porting.
