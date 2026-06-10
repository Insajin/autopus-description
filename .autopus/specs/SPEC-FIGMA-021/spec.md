# SPEC-FIGMA-021: Plugin Runtime Dispatch Integration for Annotation / Policy-Card Write Targets

**Status**: completed
**Created**: 2026-06-10
**Domain**: FIGMA
**Module**: `.` (root) — `scripts/build-figma-plugin.mjs` + `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/` (built `dist/plugin/code.js`)
**Mode**: brownfield

## 목적 (Purpose)

autopus plugin command dispatcher 와 그 렌더러는 단위 테스트로 검증되어 있지만 빌드된 Figma 플러그인 런타임에 통합된 적이 없다. 그 결과 어떤 annotation/card write target 도 라이브 플러그인에서 실제로 실행되지 못한다. native_annotation, native_annotation_with_card, annotation_card 를 연결된 플러그인에 적용하면 "Unknown command: set_native_annotation" (MCP error -32603) 으로 실패한다.

이 문제는 SPEC-FIGMA-020 dogfooding(2026-06-10) 중 발견되었다. 전체 write 파이프라인은 플러그인 경계 직전까지 정확하다. dryRun/plan_emit 은 정확한 plugin_commands (5x set_native_annotation + 1x set_policy_card, 4 개 policy table 포함, oracle-correct) 를 emit 하고, daemon apply→plugin bridge 는 SPEC-FIGMA-020 follow-up fix(commit ba9b3b0) 에서 배선되었다. 남은 단 하나의 공백은 플러그인 측 실행이다.

## Root cause

- scripts/build-figma-plugin.mjs 는 dist/plugin/code.js 를 vendor code.js verbatim + 손으로 작성한 AUTOPUS_PATCH switch(handleCommand wrapping) 로 빌드한다. 이 switch 는 set_text_content, set_stroke_color, create_text, create_image, set_plugin_data, clear_plugin_data, set_frame_name, restore_frame_name, rename_node, upsert_descriptions_page_node, set_range_font, noop 만 처리한다. 알려지지 않은 command 는 vendor handler 로 fall through 한다.
- set_native_annotation, set_policy_card, set_annotation 은 이 switch 에 부재한다.
- vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts (dispatchPluginCommand + dispatchSetNativeAnnotation + dispatchSetPolicyCard) 와 렌더러 autopus_policy_card_renderer.ts / autopus_area_handoff_renderer.ts 는 단위 테스트(tests/unit/autopus-command-dispatch.test.ts) 에서만 참조된다. code.js 로 import/bundle 되지 않는다.

순효과: dispatch 로직과 렌더러는 고립적으로 검증되어 있으나 출하 플러그인에서 분리되어 있다. annotation/card surface 는 라이브 플러그인에서 한 번도 실행 가능한 적이 없었다.

## 요구사항 (Requirements — EARS form, MoSCoW on a separate meta line)

REQ-01
Priority: Must
Type: Event-driven
WHEN the built plugin receives a set_native_annotation command, THE SYSTEM SHALL route it to the native Dev-Mode annotation handler (the SPEC-FIGMA-018 dispatchSetNativeAnnotation behavior) and return a command_result with ok / node_ids / error fields instead of falling through to the vendor handler with Unknown command.

REQ-02
Priority: Must
Type: Event-driven
WHEN the built plugin receives a set_policy_card command, THE SYSTEM SHALL render the policy definition as real Figma auto-layout tables via the SPEC-FIGMA-020 createPolicyCardCanvas renderer and return the created card node ids in node_ids so the compound undo can delete the card.

REQ-03
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL integrate the canonical autopus_command_dispatch.ts dispatcher (and the renderers it calls) into dist/plugin/code.js as the single source of truth for these ops, so the unit-tested behavior and the shipped behavior cannot diverge, rather than duplicating rendering logic in the build-script patch.

REQ-04
Priority: Must
Type: Event-driven
WHEN a native_annotation_with_card apply runs end-to-end through the daemon apply bridge against the live plugin, THE SYSTEM SHALL produce both the native annotation and the policy card, and WHEN one compound undo runs, THE SYSTEM SHALL restore the prior native annotation state and delete the card node (SPEC-FIGMA-020 REQ-08 verified live).

REQ-05
Priority: Should
Type: Event-driven
WHEN set_native_annotation carries a per-area node id (area-node resolution), THE SYSTEM SHALL attach each area annotation to its resolved node rather than collapsing all area annotations onto the frame node.

REQ-06
Priority: Must
Type: Event-driven
WHEN a compound native-with-card undo runs on the live plugin, THE SYSTEM SHALL delete the card node via the adapter deleteNode AND write the prior native-annotation snapshot back to the resolved node, so one undo reverses BOTH surfaces; WHERE no prior annotation existed, THE SYSTEM SHALL clear the node annotations to an empty array.

## Hard constraints

- HC-1 (verbatim): vendor code.js SHALL remain byte-identical to the committed vendor file (SPEC-FIGMA-017 REQ-07) so git subtree pull keeps working. The dispatcher bundle is INJECTED at build time, not committed into vendor code.js.
- HC-2 (local additions): the autopus_*.ts files are local additions inside the vendor directory, not upstream files. Bundling and editing them is allowed. The verbatim rule applies only to upstream files (code.js, ui.html, setcharacters.js, manifest.json source).
- HC-3 (frozen MCP schema): MCP WRITE_TOOLS ListTools schema is FROZEN (SPEC-FIGMA-020 AC-WR-1). THE SYSTEM SHALL NOT add or modify MCP tool schemas.
- HC-4 (redaction boundary): the adapter setAnnotation SHALL preserve the redaction boundary already enforced inside dispatch (autopusRedact runs on labelMarkdown and table cells BEFORE node mutation). The adapter receives already-redacted strings and SHALL NOT re-introduce raw user text or bypass redaction.
- HC-5 (file size): every NEW source file SHALL stay at or under 300 lines (target under 200). The pre-existing autopus_command_dispatch.ts (372 lines) is a vendor-local file and is NOT required to be split by this SPEC.

## 생성/변경 파일 상세

- [NEW] vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_plugin_adapter.ts — createAutopusPluginAdapter(figmaGlobal) 를 export 한다. RAW figma surface(AreaHandoffRuntime) 와 고수준 FigmaPluginLike.setAnnotation 을 동시에 만족하는 단일 adapter 객체를 구성한다. 300 lines 이하.
- package.json (변경) — esbuild@0.28.0 을 devDependency 로 추가한다(runtime dependencies 불변).
- scripts/build-figma-plugin.mjs (변경) — esbuild 로 autopus_command_dispatch.ts(+import 그래프) 를 IIFE global AutopusDispatch 로 번들하고, 그 문자열을 code.js 에 주입한다. AUTOPUS_PATCH switch 에 set_native_annotation, set_policy_card, set_annotation arm 을 추가하여 AutopusDispatch.dispatchPluginCommand(adapter, { op: command, args: params }) 로 위임한다.
- [NEW] tests/unit/autopus-plugin-adapter.test.ts — stub figma 로 adapter+dispatch forward 라우팅을 검증한다.
- vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts (변경) — dispatchInverse 에 restore_annotation arm 을 추가하여 prior snapshot 의 labelMarkdown 을 adapter setAnnotation 으로 write-back 한다(prior 없으면 annotations 를 빈 배열로). 기존 372-line vendor-local 파일이므로 분할 대상 아님(HC-5).
- src/daemon/undo-tool.ts (변경) — bridgeInverseCommand 의 restore-annotation 분기(현재 line 75-79 의 {op:"noop"})를 prior snapshot 을 실어 나르는 실제 inverse PluginCommand 로 교체한다. compoundInverseCommands 의 ordered pair(card delete-node 먼저, native restore 나중)는 유지한다.
- [NEW] tests/unit/autopus-undo-inverse.test.ts — stub figma 로 compound undo inverse(card delete + native restore) 라우팅을 검증한다.

## Out of scope

- SPEC-FIGMA-020 follow-up fix(commit ba9b3b0) 에서 이미 제공된 daemon 측 enabler: MCP WRITE_TARGETS allow-list(native_annotation, native_annotation_with_card), mcp-stdio-entry.ts 의 apply→plugin bridge adapter, buildStubEntry section carry, off-by-default dryRun entry-override dev affordance.
- composite target 로직, schema v0.4.0, plan-emit (SPEC-FIGMA-020, completed).
- MCP tool 스키마 변경(HC-3 으로 금지).

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| set_native_annotation 을 native Dev-Mode handler 로 라우팅 (REQ-01) | this SPEC | covered |
| set_policy_card 를 실제 auto-layout table 렌더러로 라우팅 (REQ-02) | this SPEC | covered |
| 정본 dispatcher 를 dist/plugin/code.js 에 single-source 통합 (REQ-03) | this SPEC | covered |
| native_annotation_with_card 두 surface live 생성 (REQ-04) | this SPEC (S1) | covered |
| 단일 compound undo 가 두 surface 를 모두 reverse (REQ-04/REQ-06) | this SPEC (S2) | covered |
| compound undo 의 inverse-execution 경로(card delete + native restore) (REQ-06) | this SPEC | covered |
| area annotation per-node 부착 (REQ-05) | this SPEC | covered |
| daemon apply→plugin bridge, WRITE_TARGETS allow-list | SPEC-FIGMA-020 follow-up (commit ba9b3b0) | done |
| composite target/schema v0.4.0/plan-emit | SPEC-FIGMA-020 | done |

## Traceability Matrix

| REQ | Priority | Plan task(s) | Acceptance scenario(s) |
|-----|----------|--------------|------------------------|
| REQ-01 set_native_annotation 라우팅 | Must | T2, T3 | S1, S3, S4 |
| REQ-02 set_policy_card 라우팅 | Must | T3 | S1, S3, S4 |
| REQ-03 정본 dispatcher single-source 통합 | Must | T1, T3 | S3, S6 |
| REQ-04 두 surface live + 단일 undo | Must | T3, T6, T7, T8, T5 | S1, S2 |
| REQ-05 area annotation per-node 부착 | Should | T2 | S4 |
| REQ-06 compound undo inverse-execution (card delete + native restore) | Must | T6, T7, T8 | S2, S7 |

## Related SPECs

- SPEC-FIGMA-020 — composite target native_annotation_with_card + set_policy_card op + createPolicyCardCanvas renderer + compound undo template.
- SPEC-FIGMA-020 follow-up fix (commit ba9b3b0) — daemon apply→plugin bridge wiring + WRITE_TARGETS allow-list (이 SPEC 의 전제 조건).
- SPEC-FIGMA-018 — native_annotation target + set_native_annotation op + dispatchSetNativeAnnotation.
- SPEC-FIGMA-017 — vendor 플러그인 빌드(verbatim 규칙 REQ-07).
- SPEC-FIGMA-007/011 — daemon write apply 경로, plugin dispatcher, redaction port.

## Verification (live oracle)

dryRun(1307:143792, native_annotation_with_card) → approve → apply(연결된 플러그인) 가 resolved node 에 native annotation 을 부착하고 4 개 table(states/edge_cases/data_requirements/area_annotations) 을 가진 policy-card node 를 생성해야 한다. 단일 compound undo 가 두 surface 를 모두 되돌려야 한다: card node 삭제 + resolved node 의 node.annotations 가 apply 직전 prior snapshot 으로 복원(없었으면 빈 배열). pre-fix 실패 시그니처는 "Unknown command: set_native_annotation"(forward) 와 "unknown_inverse_op:restore_annotation" 또는 noop 무동작(undo) 이다. build/unit oracle 은 acceptance.md S3/S4/S6/S7 참조.
