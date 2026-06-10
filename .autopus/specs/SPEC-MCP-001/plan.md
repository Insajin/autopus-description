# SPEC-MCP-001 구현 계획

## 태스크 목록

- [ ] T1: [NEW] `src/daemon/figma-workflow-guidance.ts` 작성 — `.claude/skills/autopus/figma-description.md` 의 절차 지식을 압축한 단일 source-of-truth 상수 `FRAME_DESCRIPTION_WORKFLOW` 와 `renderWorkflowInstructions(opts?: { descriptionLanguage?: () => string })` 헬퍼를 export 한다. 워크플로우 텍스트는 양쪽 transport 공통 등록 툴(get_active_selection, get_stale_frames, dryRun, approve, apply, undo, get_pending_descriptions, plan_emit, get_audit_events)만 ordered step 으로 나열한다. `get_description_language` 는 stdio 전용(language getter wiring 시에만 등록, http 세션은 미등록 — mcp-http-session-manager.ts grep no-match 확인)이므로 공통 워크플로우 본문에 넣지 않고, stdio instructions 의 별도 language 라인과 prompts language line(REQ-07)에서만 다룬다(HTTP 가 미노출 툴을 안내하는 것을 회피, HC-5). 채널 시크릿은 절대 포함하지 않는다. 300줄 이하(목표 200 이하). (REQ-01)
- [ ] T2: `src/daemon/mcp-stdio-entry.ts` 변경 — (a) DEFAULT_INSTRUCTIONS body 를 `renderWorkflowInstructions()` 산출물로 교체(기존 channel/language append 로직은 유지: instructions 조립 순서는 workflow guidance → channel secret(존재 시) → language(getter 존재 시)). (b) `new Server(...)` 의 `capabilities` 객체(line ~183)에 `prompts: {}` 추가. (c) 기존 registerResourceHandlers/registerToolHandlers 호출부 옆에 `registerPromptHandlers(server, { descriptionLanguage: input.descriptionLanguage })` 추가. (REQ-02, REQ-04, REQ-07)
- [ ] T3: [NEW] `src/daemon/mcp-stdio-prompt-handlers.ts` 작성 — `registerPromptHandlers(server, ctx)` 를 export 한다. `@modelcontextprotocol/sdk/types.js` 에서 `ListPromptsRequestSchema`, `GetPromptRequestSchema` 를 import 하여 `server.setRequestHandler` 로 등록. ListPrompts → `{ prompts: [{ name: "generate_frame_descriptions", description: "..." }] }`. GetPrompt → name 매칭 후 `{ messages: [{ role: "user", content: { type: "text", text } }] }` 반환. text 는 `FRAME_DESCRIPTION_WORKFLOW` 에 language line(getter 존재 시 `ctx.descriptionLanguage()`)을 덧붙여 구성. 알 수 없는 prompt name 은 SDK 표준 에러로 거절. 채널 시크릿 비포함. 300줄 이하. (REQ-04, REQ-05, REQ-06, REQ-07, REQ-08)
- [ ] T4: `src/daemon/mcp-http-session-manager.ts` 변경 — (a) line 23 의 divergent DEFAULT_INSTRUCTIONS 를 동일 `renderWorkflowInstructions()`(language getter 인자 없이) 산출물로 교체. (b) createHttpSession 의 `capabilities` 객체(line ~158)에 `prompts: {}` 추가. (c) `registerPromptHandlers(server, {})` 추가(http 세션은 live language getter 없음 → language line 생략, REQ-07 은 getter-gated Should). (REQ-03, REQ-04)
- [ ] T5: [NEW] `tests/unit/mcp-prompts-surface.test.ts` 작성 — in-memory client/server pair(기존 tool-surface 단위 테스트의 InMemoryTransport 패턴 미러링)로 다음을 검증한다: (1) `client.listPrompts()` 가 `generate_frame_descriptions` 를 반환, (2) `client.getPrompt({name})` 가 user-role text 메시지를 반환하고 그 text 가 ordered 툴 이름(dryRun/approve/apply/undo)을 포함, (3) figmaChannel 을 wiring 한 서버에서도 listPrompts/getPrompt 페이로드에 채널 시크릿 문자열이 등장하지 않음, (4) prompts 핸들러 등록 전/후로 `client.listTools()`·`client.listResources()` 결과가 byte-equal(baseline 불변). (REQ-05, REQ-06, REQ-08, REQ-09)

## 구현 전략

- source-of-truth 단일화: 워크플로우 텍스트가 stdio entry, http entry, prompts handler 세 곳에서 동일해야 한다(REQ-01/REQ-03). 이를 위해 텍스트는 T1 의 한 상수에만 존재하고, 나머지는 모두 `renderWorkflowInstructions` / `FRAME_DESCRIPTION_WORKFLOW` 를 import 한다. 문자열을 어느 entry 파일에도 인라인 복제하지 않는다.
- 추가성(additivity): prompts capability 는 기존 tools/resources wire surface 를 건드리지 않는다(REQ-09, HC-2). `registerToolHandlers`/`registerResourceHandlers` 는 변경하지 않고, `registerPromptHandlers` 는 새 `setRequestHandler` 만 추가한다. SPEC-FIGMA-009 INV-W4 baseline(read-only 4툴 + optional 블록 순서)은 그대로 유지된다.
- 보안 경계(REQ-08, HC-3): 채널 시크릿은 현재 stdio instructions 에만 노출된다(mcp-stdio-entry.ts:87-94 figmaChannelInstruction). prompts handler 는 figmaChannel 을 ctx 로 받지 않으며, GetPrompt text 는 워크플로우 + language line 만으로 구성한다. 단위 테스트가 시크릿 비노출을 negative assertion 으로 검증한다.
- 언어 연동(REQ-07, HC-4): GetPrompt 의 language line 은 `ctx.descriptionLanguage?.()` 로 live 값을 읽는다(기본 ko). http 세션은 getter 가 없으므로 language line 을 생략한다. 새 하드코딩 기본값을 만들지 않는다.
- SDK 형식: 설치된 @modelcontextprotocol/sdk 1.29.0 의 `ListPromptsRequestSchema`/`GetPromptRequestSchema`/`GetPromptResult`(messages: PromptMessage[]) 형식을 따른다. PromptMessage 는 `{ role: "user"|"assistant", content: TextContent|... }` 이며 content.type 은 "text"。

## 의존성 / 실행 순서

- T1 → T2 (entry 가 renderWorkflowInstructions 를 import).
- T1 → T3 (prompts handler 가 FRAME_DESCRIPTION_WORKFLOW 를 import).
- T1 → T4 (http entry 가 renderWorkflowInstructions 를 import).
- T3 → T2 (stdio entry 가 registerPromptHandlers 를 호출하려면 export 가 존재해야 함).
- T3 → T4 (http entry 도 registerPromptHandlers 호출).
- T2+T3+T4 → T5 (단위 테스트는 등록된 prompts surface + 불변 baseline 을 검증).

## sibling 의존성 (Feature Completion Scope)

이 SPEC 은 사용자가 요청한 "3개 환경 워크플로우 자동 노출" 중 **서버측 전달 경로 두 개**(연결 즉시 instructions = Desktop/Cursor/Claude Code 공통 자동 주입, prompts 슬래시 = 모든 MCP 클라이언트 호환)를 닫는다. 세 번째 경로인 **Claude Code 전용 plugin 번들**(설치 한 번에 MCP + 디스크립션 스킬 자동 배치 → 스킬 자동 트리거)은 sibling **SPEC-MCP-002** 가 담당한다. SPEC-MCP-002 는 이 SPEC 이 강화한 instructions/prompts 를 그대로 활용한다(plugin 이 번들하는 mcpServers 가 동일 stdio entry 를 띄움). 두 SPEC 이 합쳐져야 "3개 환경 전부" 라는 완전한 기능 결과가 닫힌다. 이 SPEC 단독으로 Desktop·Cursor 환경은 완전히 동작하며(스킬 번들 없이도 instructions+prompts 로 워크플로우 인지 가능), Claude Code 의 스킬 자동 트리거 강화만 SPEC-MCP-002 에 위임된다.

## 제약 노트

- HC-1: 신규 파일(figma-workflow-guidance.ts, mcp-stdio-prompt-handlers.ts, mcp-prompts-surface.test.ts) 300줄 이하. mcp-stdio-handlers.ts(315줄)는 건드리지 않아 한계 초과를 유발하지 않는다(prompts handler 는 별도 파일).
- HC-2/HC-3/HC-4: 위 구현 전략의 추가성·보안·언어 항목 참조.
- 언어 정책: 코드 주석·커밋은 영어, 본 계획 문서는 한국어(language-policy).
