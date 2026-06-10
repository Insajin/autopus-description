# SPEC-FIGMA-021 구현 계획

## 태스크 목록

- [ ] T1: esbuild@0.28.0 을 root package.json devDependencies 에 추가하고 lockfile 갱신. runtime dependencies 는 불변. (REQ-03 전제)
- [ ] T2: [NEW] autopus_plugin_adapter.ts 작성 — createAutopusPluginAdapter(figmaGlobal) 가 RAW figma surface(AreaHandoffRuntime: currentPage/getNodeByIdAsync/createFrame/createText/createRectangle/loadFontAsync) 를 pass-through 하고, 고수준 setAnnotation({nodeId, labelMarkdown, categoryId}) 가 figma.getNodeByIdAsync(nodeId) 로 node 를 resolve 한 뒤 NATIVE node.annotations = [{ labelMarkdown, categoryId? }] 를 적용. "annotations" in node 가드, 미지원 type throw. 동일 adapter 가 deleteNode({node_id}) (RAW figma.getNodeByIdAsync 후 node.remove()) 와, prior snapshot 을 받는 annotation 복원 진입점(forward setAnnotation 과 동일한 native node.annotations API 재사용; prior 없으면 node.annotations=[]) 도 제공한다. (REQ-01, REQ-05, REQ-06, HC-4, HC-5)
- [ ] T3: scripts/build-figma-plugin.mjs 변경 — esbuild 로 autopus_command_dispatch.ts(+import 그래프 = renderers + autopus_redact.ts + @autopus/redact-patterns) 를 IIFE(--format=iife --global-name=AutopusDispatch) 로 번들하고, 그 문자열을 HEADER 와 vendor code.js 사이에 주입. AUTOPUS_PATCH switch 에 set_native_annotation/set_policy_card/set_annotation 3 arm 추가, 각 arm 이 AutopusDispatch.dispatchPluginCommand(adapter, { op: command, args: params }) 를 await 하고 그 {ok, node_ids} 를 return. adapter 는 figma global 에서 T2 함수로 구성. vendor code.js 주입 영역은 verbatim 유지. (REQ-01, REQ-02, REQ-03, HC-1, HC-2)
- [ ] T4: [NEW] tests/unit/autopus-plugin-adapter.test.ts 작성 — stub figma(unit test 의 RAW canvas runtime + setAnnotation mock 모양 미러링)로 createAutopusPluginAdapter 를 만들고 dispatchPluginCommand 가 set_native_annotation/set_policy_card/set_annotation 각각을 라우팅하여 {ok, node_ids} 를 반환하는지, native annotation 이 node.annotations 에 기록되는지, policy card 가 4 table node 를 생성하는지, redacted label 만 node 에 도달하는지 검증. (REQ-01, REQ-02, REQ-05, HC-4)
- [ ] T6: vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.ts 에 dispatchInverse restore_annotation arm 추가 — args.prior(또는 labelMarkdown) 를 받아 adapter 의 restore 진입점으로 위임한다. prior snapshot 이 있으면 그 labelMarkdown 을 write-back, 없으면 빈 배열로 clear. node_id 는 args.node_id 로 읽어 기존 inverse-op 필드 규약(node_id)과 일치시킨다. (REQ-06)
- [ ] T7: src/daemon/undo-tool.ts 의 bridgeInverseCommand restore-annotation 분기(현재 line 75-79 의 {op:"noop", args:{}})를 {op:"restore_annotation", args:{node_id, prior}} 로 교체한다. prior 는 hydrate/redact 된 descriptor 의 minimized AnnotationSnapshot[] 이다. compoundInverseCommands 의 ordered pair(card delete-node 먼저, native restore_annotation 나중)는 그대로 유지하고, flat restore-annotation 도 같은 실제 inverse 를 내보내도록 한다. (REQ-04, REQ-06)
- [ ] T8: [NEW] tests/unit/autopus-undo-inverse.test.ts 작성 — stub figma 로, native-with-card descriptor 의 compound undo 가 (1) card node_id 로 deleteNode 를 호출하고 (2) restore_annotation 이 prior snapshot 의 labelMarkdown 을 node.annotations 로 write-back(없으면 빈 배열) 하는지, 두 inverse 가 ordered(card 먼저, native 나중)인지 검증. (REQ-06)
- [ ] T5: 라이브 검증 — npm run build 후 dist/plugin 을 Figma 에 import, 채널 secret 으로 Connect, dryRun(1307:143792, native_annotation_with_card) → approve → apply → 두 surface 확인 → 단일 undo 로 card 삭제 + native annotation prior 복원 확인. forward("Unknown command") 및 undo(noop 무동작) pre-fix 시그니처 부재 확인. (REQ-04, REQ-06)

## 구현 전략

- 접근: (A) BUNDLE — 정본 autopus_command_dispatch.ts 와 그 렌더러를 esbuild 로 단일 IIFE 로 번들하여 dist/plugin/code.js 에 주입한다. 단위 테스트가 검증하는 dispatcher 가 출하 dispatcher 와 동일해진다(REQ-03 single-source). 렌더 로직을 .mjs 문자열로 hand-port 하지 않는다.
- adapter 가 the crux: 하나의 객체가 FigmaPluginLike(고수준 setAnnotation)와 AreaHandoffRuntime(RAW createFrame/getNodeByIdAsync/...)를 동시에 만족해야 한다. dispatchSetPolicyCard 가 동일 figma 를 createPolicyCardCanvas(RAW 요구) 에 넘기고, dispatchSetNativeAnnotation 은 figma.setAnnotation(고수준)을 호출하기 때문이다.
- 와이어 정합성: handleCommand(command, params) → dispatchPluginCommand(adapter, { op: command, args: params }) → {ok, node_ids} → command-result.result → daemon. (research.md 와이어 경로 1~5 참조)
- 번들 해석: esbuild entry = autopus_command_dispatch.ts. import 그래프가 src/ 와 @autopus/redact-patterns(node_modules symlink)까지 이어지므로 bundle 옵션은 bare specifier 를 resolve 해야 한다(esbuild 기본 node resolution + workspace symlink 로 가능). 번들은 Figma 플러그인 런타임 대상이므로 platform=browser, target 은 Figma 가 지원하는 ES2017+ 수준.

## 의존성 / 실행 순서

- T1 → T3 (esbuild 가 있어야 빌드 스크립트가 번들 가능).
- T2 → T3 (adapter 가 있어야 switch arm 이 위임 가능).
- T3 → T4 (단위 테스트는 dispatch+adapter 라우팅을 검증; T2 완료로 충분하나 T3 의 주입 방식과 정합 확인 권장).
- T2 → T6 (dispatch restore_annotation arm 은 adapter 의 deleteNode/restore 진입점에 위임).
- T6 → T7 (undo-tool 이 내보내는 restore_annotation 을 dispatch 가 실행할 수 있어야 함; 와이어 op 이름 일치).
- T2+T6 → T8 (inverse 단위 테스트는 adapter+dispatch inverse 라우팅을 검증).
- T1+T2+T3+T4+T6+T7+T8 → T5 (라이브 검증은 forward+inverse 빌드 산출물 + 통과한 단위 테스트 전제).

## Feature Completion Scope

이 SPEC 하나가 사용자가 요청한 완전한 기능 결과를 닫는다: annotation + policy card 두 surface 가 라이브 플러그인에서 forward 실행되고(REQ-01..04), 단일 compound undo 가 inverse-execution 경로로 두 surface 를 모두 되돌린다(REQ-04/REQ-06 — card delete + native annotation prior 복원). forward 와 inverse 모두 동일한 adapter 와 동일한 번들된 dispatcher 를 통과하므로 하나의 cohesive change story 다(Q-COH). daemon 측 bridge/allow-list(SPEC-FIGMA-020 follow-up fix, commit ba9b3b0)와 undo descriptor hydration(src/daemon/apply-undo-descriptor.ts — native-with-card 가 prior snapshot 을 이미 carry)은 전제 조건으로 완료되어 있다. 남은 gap 은 inverse-EXECUTION(undo-tool 의 restore-annotation→noop 와 dispatch 의 restore_annotation arm 부재)뿐이며 T6/T7/T8 로 닫는다. 추가 sibling SPEC 은 필요하지 않다. Feature Coverage Map(spec.md/research.md)의 모든 covered slice 가 T1~T8 로 구현·검증된다.

## 제약 노트 (GC / verbatim)

- HC-1/HC-2: vendor code.js 는 verbatim. 번들은 빌드 시 주입만 하고 vendor code.js 에 커밋하지 않는다. acceptance S6 가 byte-identical 을 검증한다.
- HC-3: MCP tool 스키마 변경 금지. 이 SPEC 은 플러그인 런타임과 빌드 스크립트만 건드린다.
- HC-5: 신규 파일(autopus_plugin_adapter.ts, autopus-plugin-adapter.test.ts, autopus-undo-inverse.test.ts) 300 lines 이하. T6 가 건드리는 기존 372-line autopus_command_dispatch.ts 는 vendor-local 파일이므로 분할 대상 아님(arm 추가만).
- 병렬 worktree 실행 시 git -c gc.auto=0 사용(worktree-safety). 단, 이 SPEC 의 태스크는 대체로 순차 의존이므로 병렬 분기는 제한적.
