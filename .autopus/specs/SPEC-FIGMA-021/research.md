# SPEC-FIGMA-021 리서치

플러그인 런타임에 annotation / policy-card write target dispatch를 통합하기 위한 코드베이스 분석과 설계 결정.

## 기존 코드 분석

### 빌드 경로 — scripts/build-figma-plugin.mjs
- vendor code.js (vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/code.js, 4121 lines) 를 VERBATIM 으로 읽고, 메모리상에서만 analytics IIFE 를 제거한 뒤(ANALYTICS_BLOCK 정규식), HEADER 주석을 prepend 하고 손으로 작성한 AUTOPUS_PATCH IIFE 를 append 한다.
- AUTOPUS_PATCH 는 handleCommand 를 wrapping 하는 switch 다. 현재 arm: set_text_content, set_stroke_color, create_text, create_image, set_plugin_data, clear_plugin_data, set_frame_name, restore_frame_name, rename_node, upsert_descriptions_page_node, set_range_font, noop. default 는 vendorHandleCommand(command, params) 로 fall through 한다.
- set_native_annotation / set_policy_card / set_annotation 은 이 switch 에 없다. 따라서 vendor handleCommand 로 떨어지고, vendor 도 모르므로 "Unknown command: set_native_annotation" (MCP -32603) 으로 실패한다.

### 정본 dispatcher — autopus_command_dispatch.ts (372 lines, pre-existing)
- dispatchPluginCommand(figma: FigmaPluginLike, cmd: PluginCommand): Promise<CommandResult> 를 export 한다. cmd.op 로 switch 하여 set_annotation, set_native_annotation, set_policy_card, upsert_descriptions_page_node, post_comment, set_plugin_data, set_frame_name, noop, inverse op 를 라우팅한다.
- dispatchSetNativeAnnotation (line 196): figma.setAnnotation({nodeId, labelMarkdown, categoryId}) 를 호출한다. labelMarkdown 은 autopusRedact 로 한 번 더 redact 한 뒤 전달하고 {ok, node_ids:[nodeId]} 를 반환한다. figma.setAnnotation 이 없으면 graceful no-op ({ok, node_ids:[]}).
- dispatchSetPolicyCard (line 248): args.tables 를 redactPolicyTables 로 모든 cell 까지 redact 한 뒤 supportsAreaHandoffRuntime(figma) 가드를 통과하면 createPolicyCardCanvas(figma, {frameId, tables, documentWidth}) 로 라우팅하고 {ok, node_ids: node.node_ids} 를 반환한다.
- dispatchPluginCommand 는 entry 에서 redactArgs(cmd.args) (= autopusRedactObject) 로 전체 args 를 redact 하고, switch 전체를 try/catch 로 감싸 throw 를 {ok:false, error} 로 변환한다.

### 렌더러
- autopus_policy_card_renderer.ts::createPolicyCardCanvas(figma: AreaHandoffRuntime, args) — RAW figma API 사용: getNodeByIdAsync, createFrame, createText, loadFontAsync, currentPage.appendChild, node.layoutMode/itemSpacing/appendChild. 4 개 section table (states/edge_cases/data_requirements/area_annotations) 을 실제 auto-layout frame 으로 렌더하고 생성된 모든 node id 를 반환한다.
- autopus_area_handoff_renderer.ts — AreaHandoffRuntime interface 와 supportsAreaHandoffRuntime(value) 를 정의한다. 가드는 typeof v.getNodeByIdAsync === "function" && typeof v.createFrame === "function" 만 확인한다(createLine 등은 확인하지 않음). AreaHandoffRuntime 이 요구하는 RAW surface: currentPage{children?, appendChild}, getNodeByIdAsync, createFrame, createText, createRectangle, loadFontAsync?.

### redaction 경계 — autopus_redact.ts
- autopusRedact / autopusRedactObject 는 src/redact-patterns.ts 에서 pattern source 를 import 하고, src/redact-patterns.ts 는 다시 workspace package @autopus/redact-patterns (packages/redact-patterns/src/index.ts, node_modules 에 symlink 됨) 를 re-export 한다. 즉 dispatch import 그래프는 vendor tree 를 벗어나 src/ 와 workspace package 까지 이어진다. bundler 는 이 bare specifier (@autopus/redact-patterns) 를 resolve 해야 한다.

### 단위 테스트 — tests/unit/autopus-command-dispatch.test.ts
- stub figma 모양: 고수준 mock (createAreaHandoff/createText/setAnnotation) 과 RAW canvas runtime (currentPage/getNodeByIdAsync/createFrame/createText/createRectangle/loadFontAsync) 을 둘 다 보여준다.
- set_native_annotation 테스트(line 206~)는 figma.setAnnotation 이 redacted labelMarkdown 을 받는지, 누락된 categoryId 가 undefined 로 전달되는지, native tool 부재 시 no-op 인지, leaked secret (xoxb-LEAKEDSECRET) 이 제거되는지를 검증한다. 신규 adapter 단위 테스트는 이 stub 모양을 그대로 미러링한다.

### 와이어 경로 (op→command→params→result) — 검증 완료
1. apply-tool.ts (line 189~205): pending.plugin_commands 의 각 cmd (= {op, args}) 를 deps.bridge.dispatchCommand(cmd, pending_id) 로 보낸다. set_policy_card 실패는 compound target 에서만 retryable 로 처리(native 는 이미 commit).
2. mcp-stdio-entry.ts (line 385~397): dispatchCommand 는 bridgeClient.sendCommand(cmd.op, cmd.args) 를 호출한다 → 와이어에서 command = cmd.op, params = cmd.args.
3. figma-plugin-client.ts (line 209): 응답의 inner.result 로 resolve. node_ids = r.node_ids ?? (r.id ? [r.id] : undefined) 로 normalize.
4. plugin-ui-bridge.js (line 204~212): relay broadcast 를 code.js 로 {type:'execute-command', id, command, params} 로 forward.
5. vendor code.js (line 90~95): execute-command 에서 const result = await handleCommand(msg.command, msg.params) → {type:'command-result', id, result} 를 post.
- 결론: AUTOPUS_PATCH switch arm 은 handleCommand(command, params) 에서 command(op string), params(args object) 를 받으므로, dispatchPluginCommand(adapter, { op: command, args: params }) 를 호출하고 그 {ok, node_ids} 를 그대로 return 하면 daemon 까지 정확히 흐른다. 기존 arm 이 {id,name,...} 같은 ad-hoc shape 를 반환해도 bridge 가 normalize 하므로 {ok, node_ids} 는 contract 와 일치한다.

### native annotation API 형상 — 검증 완료
- vendor code.js (line 2554~2650) setAnnotation(params) 는 이미 NATIVE Dev-Mode API 를 쓴다: node 를 getNodeByIdAsync 로 resolve → "annotations" in node 가드 → node.annotations = [{ labelMarkdown, categoryId? }]. 이것이 SPEC-FIGMA-018 native path 다.
- Figma Plugin API 문서로 확인: node.annotations 는 label/labelMarkdown/properties/categoryId 를 갖는 Annotation 배열을 받으며 FrameNode/TextNode 등에서 지원된다. 출처: https://developers.figma.com/docs/plugins/api/Annotation/ , https://developers.figma.com/docs/plugins/api/figma-annotations/ (checked_at 2026-06-10).

## Technology Stack Decision

| Mode | Selected stack | Resolved versions | Source refs | Checked at | Rejected alternatives |
|------|----------------|-------------------|-------------|------------|-----------------------|
| brownfield | esbuild (build-time devDependency; 정본 dispatch+renderers 를 IIFE global 로 bundle) | esbuild@0.28.0 | https://www.npmjs.com/package/esbuild , https://github.com/evanw/esbuild/releases | 2026-06-10 | (1) tsc --outFile AMD/System 번들링 — multi-module + bare-specifier(@autopus/redact-patterns) 해석이 어색하고 IIFE global 을 못 만든다. (2) renderer 로직을 .mjs 문자열로 hand-port — REQ-03 single-source 위반, 단위 테스트와 즉시 divergence. |

- 기존 manifest major 유지: 신규 devDependencies 로만 추가하고 runtime dependencies(@anthropic-ai/sdk, @modelcontextprotocol/sdk, openai, ws) 는 건드리지 않는다. node >=22 는 esbuild 0.28.0 이 지원한다. esbuild 0.28.0 은 stable release 이며 prerelease 표식 없음.

## 설계 결정 — adapter contract (the crux)

dispatchPluginCommand(figma, cmd) 는 FigmaPluginLike (고수준 메서드 setAnnotation/createText/createAreaHandoff/...) 로 타입이 잡혀 있지만, dispatchSetPolicyCard 는 그 동일한 figma 를 createPolicyCardCanvas 에 넘기고, 이 렌더러는 RAW AreaHandoffRuntime surface (createFrame/createText/getNodeByIdAsync/currentPage/loadFontAsync) 를 요구한다. 따라서 플러그인은 두 interface 를 동시에 만족하는 하나의 adapter 객체를 만들어야 한다.

설계: [NEW] 모듈 vendor/.../cursor_mcp_plugin/autopus_plugin_adapter.ts 가 createAutopusPluginAdapter(figmaGlobal) 를 export 한다. 반환 객체는:
- RAW pass-through (AreaHandoffRuntime 충족): currentPage, getNodeByIdAsync, createFrame, createText, createRectangle, loadFontAsync 를 figma global 에서 그대로 위임한다. 이로써 supportsAreaHandoffRuntime(adapter) 가 true 가 되고 createPolicyCardCanvas 가 동작한다.
- 고수준 setAnnotation({nodeId, labelMarkdown, categoryId}) (FigmaPluginLike 충족): figma.getNodeByIdAsync(nodeId) 로 node 를 resolve 하고 NATIVE Dev-Mode API node.annotations = [{ labelMarkdown, ...(categoryId 있으면 categoryId) }] 를 적용한다(vendor code.js::setAnnotation 형상과 동일, SPEC-FIGMA-018 native path). "annotations" in node 가드 후 미지원 type 이면 throw → dispatch 가 {ok:false,error} 로 변환한다.
- 고수준 createText/createAreaHandoff 는 REQ-01/02 의 두 MUST op (set_native_annotation + set_policy_card) 에는 불필요하므로 이번 scope 의 adapter 에 포함하지 않는다. set_annotation (card 3-step / area_handoff) 라우팅은 REQ-03 single-source 의 귀결로 arm 을 추가하되, 해당 layout 이 createText/createAreaHandoff adapter 를 필요로 하면 dispatch 가 graceful no-op ({ok, node_ids:[]}) 을 반환한다. area_handoff RAW fallback 은 adapter 의 RAW surface 로 동작 가능하다(렌더러가 createLine 을 쓰지 않음).

adapter 는 [NEW] 소스 모듈(≤300 lines) 이며 .mjs 문자열 inline 이 아니다. esbuild 가 autopus_command_dispatch.ts 를 entry 로 받아 import 그래프(renderers + autopus_redact.ts + @autopus/redact-patterns) 를 IIFE (--format=iife --global-name=AutopusDispatch) 로 번들하고, build-figma-plugin.mjs 가 그 IIFE 문자열을 HEADER 와 vendor code.js 사이(또는 patch 직전) 에 주입한다. adapter 모듈은 dispatch 옆에 함께 번들되어 AutopusDispatch.createAutopusPluginAdapter 로 노출하거나, patch 가 직접 figma 로부터 adapter 를 구성한다(plan T2/T3 에서 확정).

### redaction 경계 보존
adapter 의 setAnnotation 은 dispatch 가 이미 redact 한 문자열을 받는다(dispatchPluginCommand 의 redactArgs + dispatchSetNativeAnnotation 의 추가 autopusRedact). adapter 는 raw user text 를 재도입하거나 redact 를 우회하지 않으며, node 변형 전에 추가 mutation 을 하지 않는다. 따라서 SPEC-FIGMA-007/018 redaction 경계가 그대로 유지된다.

## 보강 분석 — compound undo inverse-execution gap (Revision 1, code-verified)

REQ-04 의 "one undo restores BOTH surfaces" 는 forward 3 op(set_native_annotation/set_policy_card/set_annotation) 라우팅만으로는 닫히지 않는다. 코드로 확인한 사실:

- src/daemon/undo-tool.ts (line 75-79): bridgeInverseCommand 의 case "restore-annotation" 은 { op: "noop", args: {} } 를 반환한다. 따라서 라이브 플러그인 경로에서는 prior native annotation 이 절대 write-back 되지 않는다. 주석은 write-router 의 undoNativeAnnotation 을 통해 복원된다고 적혀 있으나, 그 경로의 명령은 번들된 플러그인 dispatch 로 도달하지 않는다.
- vendor/.../autopus_command_dispatch.ts 의 dispatchInverse (line ~319-340): delete_node / delete_comment / clear_plugin_data / restore_frame_name 만 처리한다. restore_annotation arm 이 없어 default 로 떨어지면 "unknown_inverse_op:restore_annotation" 을 반환한다.
- packages/write-router/src/adapters/native-annotation.ts (line 153) 의 undoNativeAnnotation 은 주입된 in-process client.setAnnotation 을 호출한다(daemon bridge 경로가 아님). 즉 라이브 undo 에는 관여하지 않는다.

CORRECTION (codex 표현 정정): card delete 절반은 node_id/nodeId 필드 mismatch 가 아니다. undo-tool.ts 의 compoundInverseCommands 는 [ {op:"delete_node", args:{node_id: card.node_id}}, ... ] 를 emit 하고 dispatchInverse 는 args.node_id 를 읽으므로 필드는 일치한다. card-delete 절반은 adapter 가 deleteNode({node_id}) 를 구현하기만 하면 닫힌다. 진짜 gap 은 native restore 절반이다.

descriptor 측은 이미 정확하다: src/daemon/apply-undo-descriptor.ts 의 hydrateUndoDescriptor 는 native-with-card 를 restore-annotation(native, prior snapshot 포함) + delete-node(card) 로 hydrate 하고, computePersistedDescriptor 는 prior 를 redact 한다. 따라서 부족한 것은 inverse-EXECUTION 경로뿐이다.

해결(하나의 cohesive SPEC 유지 — 동일 adapter, 동일 번들, "dispatcher 와 그 inverse 를 라이브 플러그인에 함께 배선"):
1. adapter(T2)에 deleteNode({node_id}) 와 prior snapshot 기반 annotation 복원 진입점 추가(forward setAnnotation 과 동일한 native node.annotations API 재사용; prior 없으면 빈 배열).
2. autopus_command_dispatch.ts 의 dispatchInverse 에 restore_annotation arm 추가(T6): args.prior 의 labelMarkdown 을 adapter 로 write-back.
3. undo-tool.ts 의 restore-annotation→noop(line 75-79)을 prior 를 실어 나르는 실제 inverse PluginCommand({op:"restore_annotation", args:{node_id, prior}})로 교체(T7). ordered pair(card delete 먼저, native restore 나중)는 유지.
4. inverse 라우팅 단위 테스트(T8) + 라이브 검증(S2).

## Semantic Invariant Inventory

| ID | source clause | invariant type | affected outputs | acceptance IDs |
|----|---------------|----------------|------------------|----------------|
| INV-001 | "BOTH surfaces appear (native annotation(s) on the resolved node(s) + a policy card with 4 auto-layout tables)" | paired/dual-surface 산출 | live: resolved node 의 node.annotations + Policy Card frame(states/edge_cases/data_requirements/area_annotations 4 table) | S1 |
| INV-002 | "one undo restores prior annotation state AND deletes the card node" | compound single-undo 가역성 (plan: T6/T7/T8; now satisfiable via inverse-execution 경로 — 아래 "## 보강 분석" 참조) | undo 후 resolved node.annotations = prior snapshot(없으면 빈 배열), card node 삭제됨 | S2, S7 |
| INV-003 | "adapter setAnnotation must preserve the redaction boundary; receives already-redacted strings; do not re-introduce raw user text" | redaction 경계(보안) | node.annotations[].labelMarkdown 에 figd_/xoxb-/bearer/absolute-path 없음 | S5 |
| INV-004 | "Vendor code.js stays VERBATIM so git subtree pull keeps working" | source 불변(verbatim) | dist/plugin/code.js 의 주입 전 vendor 영역이 committed vendor code.js 와 byte-identical | S6 |
| INV-005 | "route ... to AutopusDispatch.dispatchPluginCommand(adapter, {op, args})" + TOOL_NAME_MAP parity | op→dispatch 라우팅 parity | switch 가 set_native_annotation/set_policy_card/set_annotation arm 을 가지고 dispatcher 로 위임; 각 op 가 {ok, node_ids} 반환 | S3, S4 |
| INV-006 | "dist/plugin/code.js contains the bundled AutopusDispatch global and explicit arms for the 3 ops" | 빌드 산출물 통합 | dist/plugin/code.js 가 AutopusDispatch global 과 3 arm 을 포함 | S3 |
| INV-007 | "one undo ... write the prior native-annotation snapshot back ... AND delete the card node" (REQ-06) | inverse-execution 라우팅 parity | undo-tool 이 restore_annotation inverse 를 emit(현 noop 대체) AND dispatchInverse 가 restore_annotation arm 으로 prior 를 write-back; card delete 는 node_id 필드 일치로 이미 동작 | S2, S7 |

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| set_native_annotation 을 native Dev-Mode handler 로 라우팅 (REQ-01) | this SPEC | covered |
| set_policy_card 를 실제 auto-layout table 렌더러로 라우팅 (REQ-02) | this SPEC | covered |
| 정본 dispatcher 를 dist/plugin/code.js 에 single-source 로 통합 (REQ-03) | this SPEC | covered |
| native_annotation_with_card end-to-end 두 surface live 생성 (REQ-04) | this SPEC (live oracle S1) | covered |
| 단일 compound undo 가 card delete + native annotation prior 복원 (REQ-04/REQ-06) | this SPEC (S2 live + S7 unit; plan T6/T7/T8) | covered |
| compound undo descriptor hydration(native-with-card 가 prior snapshot carry) | src/daemon/apply-undo-descriptor.ts (기존) | done (prereq) |
| area-node 해석 시 area annotation 을 per-node 부착 (REQ-05) | this SPEC (dispatch 가 nodeId 별 set_native_annotation 을 받음; adapter 가 nodeId resolve) | covered |
| daemon apply→plugin bridge wiring, WRITE_TARGETS allow-list | SPEC-FIGMA-020 follow-up fix (commit ba9b3b0) | done (out of scope) |
| composite target 로직, schema v0.4.0, plan-emit | SPEC-FIGMA-020 | done (out of scope) |

## Reviewer Brief

리뷰는 두 지점에 집중한다.

1. inverse/undo EXECUTION 경로: src/daemon/undo-tool.ts 의 restore-annotation 분기가 더 이상 noop 이 아니라 prior snapshot 을 실은 실제 inverse 를 emit 하는가, vendor dispatch 의 dispatchInverse 에 restore_annotation arm 이 추가되어 prior 를 node.annotations 로 write-back 하는가, ordered pair(card delete 먼저, native restore 나중)가 유지되는가. (REQ-04/REQ-06, S2/S7)
2. dual-interface adapter: 단일 adapter 객체가 FigmaPluginLike(고수준 setAnnotation)와 AreaHandoffRuntime(RAW createFrame/getNodeByIdAsync/currentPage/...)를 동시에 만족하는가, forward setAnnotation 과 inverse 복원이 같은 native node.annotations API 를 재사용하는가, redaction 경계(이미 redact 된 문자열만 수신)를 유지하는가. (REQ-01/HC-4, S4/S5)

부차 확인: vendor code.js verbatim(S6), 번들 산출물의 3 forward arm(S3), esbuild devDep 추가가 runtime deps 를 건드리지 않음.

## Outcome Lock

Locked user-visible outcome: 라이브 플러그인에서 native_annotation_with_card 를 apply 하면 두 surface(resolved node 의 native Dev-Mode annotation + 4-table policy card)가 실제로 렌더되고, 단일 undo 가 두 surface 를 모두 reverse 한다(card node 삭제 + node.annotations 가 prior snapshot 으로 복원; 없었으면 빈 배열).

정확한 closing 조건: acceptance S1 + S2 가 라이브 플러그인에서 통과하고, build/unit oracle S3/S4/S6 (및 inverse 단위 oracle S7)가 통과한다. 이 조건이 모두 충족되기 전에는 SPEC 을 completed 로 표시하지 않는다.

## Completion Debt

이 SPEC 과 함께 닫혀야 하는데 아직 deferred 인 항목과 그 owner.

- (없음) 완전한 기능 결과(두 surface forward + 단일 undo reverse)를 닫는 데 필요한 모든 작업은 REQ-01..06 의 1 차 scope 안에 있다. inverse/undo 실행은 더 이상 future work 가 아니라 REQ-06 으로 편입되었다(T6/T7/T8). 별도 sibling SPEC 으로 미루지 않는다.
- 전제 조건(이미 done, 이 SPEC 의 debt 아님): daemon apply→plugin bridge + WRITE_TARGETS allow-list = SPEC-FIGMA-020 follow-up(commit ba9b3b0); undo descriptor hydration/redaction = src/daemon/apply-undo-descriptor.ts.

## Evolution Ideas

필수가 아닌 선택적 향후 개선(이 SPEC 의 완료 조건과 무관).

- restore_annotation inverse 에 properties 배열까지 복원(현재 snapshot 은 labelMarkdown/categoryId 중심의 minimized 형태).
- policy card 삭제 시 생성된 모든 하위 table/row/cell 노드의 명시적 cascade 검증(현재는 card frame 삭제로 children 이 함께 제거되는 Figma 기본 동작에 의존).
- inverse 단위 테스트를 write-router 의 in-process undoNativeAnnotation 과 cross-check 하여 두 경로의 복원 결과 parity 를 자동 비교.

## Self-Verify Summary
- Q-CORR-01 | status: PASS | attempt: 1 | files: research.md, spec.md | reason: 인용한 기존 경로/함수(build-figma-plugin.mjs AUTOPUS_PATCH, dispatchPluginCommand line 342, createPolicyCardCanvas, vendor setAnnotation line 2554, mcp-stdio-entry line 385, figma-plugin-client line 209)를 모두 직접 읽어 확인함.
- Q-CORR-02 | status: PASS | attempt: 1 | files: research.md, plan.md | reason: 신규 adapter 모듈을 [NEW] autopus_plugin_adapter.ts 로 표기하고 정합성 검증 대상에서 제외함. 나머지 참조는 기존 파일.
- Q-CORR-03 | status: PASS | attempt: 1 | files: acceptance.md, spec.md | reason: acceptance 는 bare Given/When/Then 을 쓰고, REQ 는 WHEN/THE SYSTEM SHALL EARS, Priority 는 별도 meta line.
- Q-COMP-01 | status: PASS | attempt: 1 | files: spec.md, plan.md, acceptance.md, research.md | reason: 4 개 파일이 목적/계획/검증/근거로 상호 보완하며 빈 문서 없음.
- Q-COMP-02 | status: PASS | attempt: 3 | files: spec.md, acceptance.md, plan.md | reason: REQ-01..06 이 plan T1~T8 과 acceptance S1~S7 에 추적되고 spec.md 의 ## Traceability Matrix 가 REQ→task→scenario 를 1 행씩 명시함. Rev1 에서 REQ-06(inverse undo)을 추가하고 매트릭스를 신설함.
- Q-COMP-03 | status: PASS | attempt: 1 | files: spec.md | reason: 각 REQ 에 EARS type/trigger/observable 결과(command_result, node_ids, undo 상태)를 명시함.
- Q-COMP-04 | status: PASS | attempt: 2 | files: spec.md, research.md | reason: Rev1 에서 inverse-execution gap 을 REQ-06 1 차 scope 로 편입하고 ## Outcome Lock 으로 locked outcome 과 closing 조건(S1+S2 live + S3/S4/S6/S7)을 명시함. 더 이상 undo 를 future work 로 미루지 않음.
- Q-COMP-05 | status: PASS | attempt: 3 | files: research.md, spec.md, plan.md, acceptance.md | reason: INV-001..007 이 REQ/plan task/oracle acceptance 에 모두 매핑됨. Rev1 에서 INV-002 를 plan T6/T7/T8 로 추적되도록 갱신하고 INV-007(inverse-execution parity)을 추가; S2 는 prior snapshot 동일성(없으면 빈 배열), S7 은 ordered inverse 의 concrete 기대를 검증.
- Q-FEAS-01 | status: PASS | attempt: 2 | files: spec.md, plan.md, research.md | reason: Rev1 에서 scope 가 forward arm + inverse-execution(undo-tool.ts restore-annotation 분기 교체 + dispatch restore_annotation arm)까지 실제 런타임 경로로 확장됨을 code-verified 근거(## 보강 분석)와 함께 명시함. 문서-only 약속 없음.
- Q-FEAS-02 | status: PASS | attempt: 1 | files: plan.md, research.md | reason: adapter 는 vendor 의 local autopus_* 추가물 영역에 두고, verbatim 규칙은 upstream code.js 에만 적용. esbuild 는 devDep 로 root package.json 에 추가. generated dist/plugin/code.js 를 source 로 오인하지 않음.
- Q-FEAS-03 | status: PASS | attempt: 2 | files: acceptance.md | reason: 빌드+단위(vitest, S4/S7 inverse 포함)+verbatim byte 비교+live oracle(S1/S2) 모두 현 저장소에서 실행 가능. Rev1 에서 inverse 단위 oracle S7 추가.
- Q-STYLE-01 | status: PASS | attempt: 1 | files: spec.md | reason: REQ description 에 should/might/could 등 모호어 없음; Priority 는 별도 meta line.
- Q-STYLE-02 | status: PASS | attempt: 1 | files: spec.md | reason: Priority 는 Must/Should 만 사용, EARS type 과 분리.
- Q-STYLE-03 | status: PASS | attempt: 1 | files: acceptance.md | reason: 문장 완결, acceptance 는 bare Given/When/Then/And.
- Q-SEC-01 | status: PASS | attempt: 1 | files: spec.md, research.md, acceptance.md | reason: source-clause 를 untrusted evidence 로 취급(secret/절대경로 미복사). adapter setAnnotation 의 redaction 경계 보존을 INV-003/S5 로 명시. 외부 입력(daemon 이 보내는 args)은 dispatch redact 를 통과.
- Q-SEC-02 | status: PASS | attempt: 1 | files: spec.md, research.md | reason: channel secret 등 민감값을 SPEC 에 옮기지 않음. adapter 는 절대경로/토큰을 노출하지 않고 redacted 문자열만 다룸.
- Q-SEC-03 | status: N/A | attempt: 1 | files: research.md | reason: 이 SPEC 은 별도 로그/retained artifact 포맷을 신설하지 않음. 기존 audit 경로(SPEC-FIGMA-020)는 변경하지 않음.
- Q-COMP-06 | status: PASS | attempt: 1 | files: spec.md | reason: ## Traceability Matrix 를 spec.md 에 추가하여 REQ-01..06 각각을 plan task 와 acceptance scenario 로 1 행씩 매핑함.
- Q-COMP-07 | status: PASS | attempt: 1 | files: research.md | reason: ## Completion Debt 와 ## Evolution Ideas 를 분리 신설함. 필수 undo/inverse 작업은 debt 가 아니라 REQ-06 1 차 scope 임을 Completion Debt 에 명시하고, Evolution Ideas 에는 선택적 향후 개선만 둠.
- Q-COH-01 | status: PASS | attempt: 1 | files: spec.md, plan.md, research.md | reason: forward 와 inverse 가 동일 adapter·동일 번들·동일 native node.annotations API 를 공유하므로 "dispatcher 와 그 inverse 를 라이브 플러그인에 배선"이라는 하나의 변경 서사로 수렴함.
- Q-COH-02 | status: PASS | attempt: 2 | files: spec.md, plan.md | reason: Rev1 에서 이전에 hand-wave 되던 undo 실행을 REQ-06/T6/T7/T8 로 명시적으로 편입함. 같은 iteration 안에서 암묵 해결로 남기지 않음.

## Revision 1 closure

| F-ID | category | how closed | file:line |
|------|----------|-----------|-----------|
| F-001 (codex) inverse-execution gap | correctness/completeness/feasibility/cohesion | REQ-06 신설(compound undo 가 card delete + native prior 복원); plan T6(dispatch restore_annotation arm)/T7(undo-tool restore-annotation→실제 inverse)/T8(inverse 단위 테스트); S2 concrete 기대 + S7 신설; INV-002 를 T6/T7/T8 로 추적 + INV-007 추가; code-verified 분석 기록 | spec.md REQ-06 / plan.md T6-T8 / acceptance.md S2,S7 / research.md ## 보강 분석 |
| F-001 correction (card delete 는 mismatch 아님) | correctness | research.md 에 정정 기록: compoundInverseCommands 가 {node_id: card.node_id} emit, dispatchInverse 가 args.node_id 읽음 → 필드 일치; card-delete 는 adapter deleteNode 구현만으로 닫힘 | research.md ## 보강 분석 (CORRECTION 단락) |
| Q-COMP-06 traceability matrix 누락 | completeness | spec.md 에 ## Traceability Matrix(REQ→task→scenario) 추가 | spec.md ## Traceability Matrix |
| Q-COMP-06 reviewer brief 누락 | completeness | research.md 에 ## Reviewer Brief(inverse/undo 경로 + dual-interface adapter 집중) 추가 | research.md ## Reviewer Brief |
| Q-COMP-07 debt/ideas 미분리 | completeness | research.md 에 ## Completion Debt 와 ## Evolution Ideas 분리 신설 | research.md ## Completion Debt, ## Evolution Ideas |
| Q-COMP-04 outcome lock 누락 | completeness | research.md 에 ## Outcome Lock(locked outcome + closing 조건 S1+S2 live, S3/S4/S6/S7) 추가 | research.md ## Outcome Lock |
