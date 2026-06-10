# SPEC-MCP-001 수락 기준

표기: 모든 시나리오는 bare Given/When/Then/And 형식. S1~S2 는 instructions oracle, S3~S5 는 prompts payload oracle, S6 은 security oracle, S7 은 baseline-invariance oracle. S1~S7 모두 Must(S5 는 Should REQ-07 검증이나 oracle 형태는 Must 수준 구체값). 모든 oracle 은 in-memory client/server pair 또는 생성된 instructions 문자열에 대해 실행 가능하며, 라이브 Figma 플러그인 연결을 요구하지 않는다.

## 시나리오

### S1: stdio instructions 가 ordered 워크플로우와 실제 툴 이름을 포함한다 (Must, instructions oracle — REQ-01/REQ-02, INV-001/INV-002)
Given createMcpStdioServer 가 descriptionLanguage getter 와 figmaChannel 시크릿(테스트용 임의 32-hex 값, SPEC 본문 미복사)을 함께 wiring 하여 구성된다.
And 생성된 Server 의 initialize instructions 문자열을 캡처한다.
When 그 instructions 문자열을 검사한다.
Then 문자열은 dryRun, approve, apply, undo 네 툴 이름을 모두 포함한다.
And 문자열은 이 네 단계가 dryRun 다음 approve 다음 apply 순서임을 나타내는 ordered 표현을 포함한다(예: 화살표/번호/순서 단어).
And 문자열은 selection 또는 stale 탐색 진입 단계(get_active_selection 또는 get_stale_frames)를 포함한다.
And 문자열은 기존 channel-secret 안내와 description-language 안내를 여전히 포함한다(회귀 없음).

### S2: http instructions 가 stdio 와 동일한 워크플로우 텍스트를 노출한다 (Must, instructions oracle — REQ-03, INV-001)
Given createHttpSession 으로 http 세션 Server 를 구성한다.
And createMcpStdioServer 로 stdio Server 를 구성한다.
When 두 Server 의 initialize instructions 에서 워크플로우 guidance 블록(renderWorkflowInstructions 의 공통 산출 부분)을 추출한다.
Then 두 워크플로우 guidance 블록의 텍스트가 정확히 일치한다(동일 source-of-truth 상수에서 파생).
And http instructions 는 더 이상 "9 tools" 한 줄짜리 divergent 문자열이 아니다.
And 두 instructions 모두 dryRun/approve/apply/undo 툴 이름을 포함한다.
And 공통 워크플로우 guidance 블록은 get_description_language 를 노출 툴로 명명하지 않는다(http 세션 미등록 — 공통 상수는 양쪽 transport 공통 툴만 명명, HC-5).
And stdio instructions 에는 별도 language 라인(get_description_language getter 기반)이 존재하지만, 이 라인은 공통 워크플로우 블록 밖에 있어 http 추출 블록과의 일치 검증에 포함되지 않는다.

### S3: prompts/list 가 generate_frame_descriptions 디스크립터를 반환한다 (Must, prompts payload oracle — REQ-04/REQ-05, INV-003)
Given prompts 핸들러가 등록된 stdio Server 에 in-memory MCP Client 가 연결되어 initialize 를 완료한다.
And initialize 응답의 serverCapabilities 를 캡처한다.
When Client 가 prompts/list 요청(client.listPrompts())을 보낸다.
Then serverCapabilities.prompts 가 존재한다(undefined 가 아니다).
And 반환된 prompts 배열은 name 이 정확히 "generate_frame_descriptions" 인 항목을 1개 이상 포함한다.
And 그 항목의 description 문자열은 dryRun, approve, apply 를 언급한다.

### S4: prompts/get 이 ordered 워크플로우 user 메시지를 반환한다 (Must, prompts payload oracle — REQ-06, INV-003/INV-004)
Given prompts 핸들러가 등록된 stdio Server 에 in-memory MCP Client 가 연결된다.
When Client 가 prompts/get 요청 client.getPrompt({ name: "generate_frame_descriptions" }) 을 보낸다.
Then 응답 messages 배열의 length 가 1 이상이다.
And messages[0].role 은 "user" 이다.
And messages[0].content.type 은 "text" 이다.
And messages[0].content.text 는 dryRun, approve, apply, undo 네 툴 이름을 모두 포함한다.
And 그 text 는 ordered 표현으로 dryRun 이 approve 보다, approve 가 apply 보다 먼저 나오는 순서를 유지한다(text.indexOf("dryRun") < text.indexOf("approve") < text.indexOf("apply")).

### S5: prompts/get text 가 활성 디스크립션 언어를 명시한다 (Must oracle for Should REQ-07 — REQ-07, INV-005)
Given descriptionLanguage getter 가 "ko" 를 반환하도록 stdio Server 를 구성한다.
And prompts 핸들러가 그 getter 를 ctx 로 받는다.
When Client 가 client.getPrompt({ name: "generate_frame_descriptions" }) 을 보낸다.
Then messages[0].content.text 는 활성 언어로 "ko"(또는 그 표기)를 명시하는 라인을 포함한다.
When getter 의 반환값을 "en" 으로 바꾸고 동일 요청을 다시 보낸다.
Then 새 응답 text 는 "en" 을 명시하는 라인을 포함하고 이전의 "ko"-only 라인과 달라진다(live getter 반영).

### S6: 채널 시크릿이 prompts 페이로드에 노출되지 않는다 (Must, security oracle — REQ-08, INV-006)
Given figmaChannel 시크릿(테스트용 임의 32-hex 값, SPEC 본문에 복사 금지)을 wiring 한 stdio Server 에 Client 가 연결된다.
And 그 시크릿 값을 테스트 변수 SECRET 으로 보관한다.
When Client 가 prompts/list 와 prompts/get 을 각각 호출하고 두 응답 전체를 JSON.stringify 한다.
Then prompts/list 응답 문자열에 SECRET 부분문자열이 포함되지 않는다.
And prompts/get 응답 문자열에 SECRET 부분문자열이 포함되지 않는다.
And 동일 세션의 initialize instructions 에는 SECRET 이 포함된다(기존 C-1 동작은 stdio instructions 에서만 유지됨을 대조 확인).

### S7: tools/resources baseline 이 prompts 추가로 변하지 않는다 (Must, baseline-invariance oracle — REQ-09, INV-007)
Given prompts 핸들러를 등록하지 않은 baseline stdio Server(또는 SPEC-FIGMA-009 고정 baseline)의 listTools/listResources 결과를 기준값으로 캡처한다.
And prompts 핸들러를 등록한 동일 옵션의 stdio Server 를 구성한다.
When 두 Server 각각에 Client 를 연결하여 client.listTools() 와 client.listResources() 를 호출한다.
Then prompts 등록 서버의 listTools 결과(tools 배열의 name 순서와 각 inputSchema)가 baseline 과 정확히 일치한다.
And prompts 등록 서버의 listResources 결과(resources 배열의 uri/name 순서)가 baseline 과 정확히 일치한다.
And 두 서버의 차이는 오직 prompts capability/handlers 의 존재뿐이다.
