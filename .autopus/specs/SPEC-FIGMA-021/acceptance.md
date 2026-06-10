# SPEC-FIGMA-021 수락 기준

표기: 모든 시나리오는 bare Given/When/Then/And 형식. S1~S2 는 라이브 oracle, S3/S4/S6/S7 은 라이브 플러그인 없이 실행 가능한 build/unit oracle, S5 는 redaction 경계 oracle. S1~S7 모두 Must.

## 시나리오

### S1: native_annotation_with_card apply 가 두 surface 를 생성한다 (Must, live oracle — REQ-01/REQ-02/REQ-04, INV-001)
Given 빌드된 dist/plugin 이 Figma 에 import 되어 세션 채널 secret 으로 Connect 되어 있다.
And 대상 프레임은 1307:143792 (F01_Report-Main_Closed, file 87bxy4Bx0LjjFNe36bmQM1) 이고 write_target 은 native_annotation_with_card 이다.
When dryRun(1307:143792, native_annotation_with_card) 후 approve, 이어서 apply 를 연결된 라이브 플러그인에 대해 실행한다.
Then resolved node(들)의 node.annotations 에 native annotation 이 1 개 이상 존재한다.
And Policy Card frame 이 새로 생성되고 그 안에 4 개의 auto-layout table(states, edge_cases, data_requirements, area_annotations)이 실제 frame/row/cell 노드로 렌더된다.
And apply 응답은 command_result 가 ok=true 이고 node_ids 에 card frame id 를 포함한다.
And "Unknown command: set_native_annotation" (MCP -32603) 이 발생하지 않는다.

### S2: 단일 compound undo 가 두 surface 를 되돌린다 (Must, live oracle — REQ-04/REQ-06, INV-002)
Given S1 의 apply 가 성공하여 native annotation 과 policy card 가 존재한다.
And apply 직전 resolved node 의 prior 주석 상태가 알려져 있다(예: 주석 없음 → 빈 배열).
When 단일 undo 를 1 회 실행한다.
Then policy card frame node 가 캔버스에서 삭제되어 더 이상 존재하지 않는다(getNodeByIdAsync(card_id) 가 null).
And resolved node 의 node.annotations 가 apply 직전 prior snapshot 과 정확히 같아진다; prior 가 없었으면 node.annotations 는 빈 배열([]) 이다.
And 두 surface 복원에 추가 undo 호출이 필요하지 않다(단일 호출로 ordered pair: card delete 먼저, native restore 나중 이 실행됨).
And undo 경로에서 "unknown_inverse_op:restore_annotation" 또는 noop 무동작(native annotation 미복원) 이 발생하지 않는다.

### S3: 빌드 산출물이 AutopusDispatch global 과 3 개 switch arm 을 포함한다 (Must, build oracle — REQ-03, INV-005/INV-006)
Given 작업 트리에 변경된 scripts/build-figma-plugin.mjs 와 [NEW] autopus_plugin_adapter.ts 가 있다.
When node scripts/build-figma-plugin.mjs 를 실행한다.
Then dist/plugin/code.js 에 번들된 AutopusDispatch global 식별자가 존재한다.
And AUTOPUS_PATCH switch 에 case 'set_native_annotation', case 'set_policy_card', case 'set_annotation' arm 이 각각 명시적으로 존재한다.
And 세 arm 모두 AutopusDispatch.dispatchPluginCommand 로 위임한다.

### S4: 단위 테스트가 adapter+dispatch 라우팅을 검증한다 (Must, unit oracle — REQ-01/REQ-02/REQ-05, INV-005)
Given stub figma(RAW canvas runtime + setAnnotation mock) 로 createAutopusPluginAdapter(figma) 를 구성한다.
When dispatchPluginCommand(adapter, { op: 'set_native_annotation', args: { nodeId: '80:1', labelMarkdown: '**검색**', categoryId: 'ready-for-dev' } }) 를 호출한다.
Then 반환값은 ok=true 이고 node_ids 는 ['80:1'] 이다.
And node 80:1 의 annotations 가 [{ labelMarkdown: '**검색**', categoryId: 'ready-for-dev' }] 로 설정된다.
When 이어서 dispatchPluginCommand(adapter, { op: 'set_policy_card', args: { frameId: '1:1', tables: [4 개 section table] } }) 를 호출한다.
Then 반환값은 ok=true 이고 node_ids 는 card frame id 를 포함하며 4 개 table 각각의 노드 id 를 포함한다(length >= 1 + 4 table 의 header/row/cell 노드 수).
And vitest 실행(npm test 또는 vitest run)이 이 테스트를 통과한다.

### S5: redaction 경계가 node 변형 전에 유지된다 (Must, security oracle — HC-4, INV-003)
Given stub figma 로 구성한 adapter 가 있다.
When dispatchPluginCommand(adapter, { op: 'set_native_annotation', args: { nodeId: '83:1', labelMarkdown: 'token xoxb-LEAKEDSECRET trailing' } }) 를 호출한다.
Then node 83:1 의 annotations[0].labelMarkdown 에 'xoxb-LEAKEDSECRET' 문자열이 포함되지 않는다.
And adapter 는 dispatch 가 redact 한 문자열만 node.annotations 에 기록하며 raw user text 를 재도입하지 않는다.

### S6: vendor code.js 가 byte-identical 로 유지되고 빌드가 성공한다 (Must, verbatim oracle — REQ-03/HC-1, INV-004)
Given committed vendor 파일 vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/code.js 가 있다.
When npm run build 를 실행한다.
Then 빌드가 성공 종료한다(exit 0).
And vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/code.js 가 git diff 상 변경되지 않는다(committed 파일과 byte-identical).
And dist/plugin/code.js 의 주입 전 vendor 영역(HEADER 와 AUTOPUS_PATCH 사이의 vendor 본문)이 vendor code.js 와 byte-identical 하다.

### S7: 단위 테스트가 compound undo inverse 라우팅을 검증한다 (Must, unit oracle — REQ-06, INV-002)
Given stub figma(RAW canvas runtime + node.annotations 를 보관하는 setAnnotation/getNodeByIdAsync + node.remove mock) 로 createAutopusPluginAdapter(figma) 를 구성한다.
And native-with-card 형태의 compound undo 가 ordered pair [ {op:'delete_node', args:{node_id: card_id}}, {op:'restore_annotation', args:{node_id: anno_id, prior: prior_snapshot}} ] 를 산출한다.
When 두 inverse 명령을 순서대로 dispatchPluginCommand(adapter, cmd) 로 실행한다.
Then 첫 명령은 ok=true 이고 card_id 노드에 대해 deleteNode 가 호출되어 그 노드가 제거된다.
And 둘째 명령은 ok=true 이고 anno_id 노드의 node.annotations 가 prior_snapshot 의 labelMarkdown 으로 복원된다; prior_snapshot 이 빈 배열이면 node.annotations 도 빈 배열([]) 이 된다.
And 어떤 명령도 "unknown_inverse_op:restore_annotation" 을 반환하지 않는다.
And vitest 실행(npm test 또는 vitest run)이 이 테스트를 통과한다.
