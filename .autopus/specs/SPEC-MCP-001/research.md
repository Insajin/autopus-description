# SPEC-MCP-001 리서치

MCP 서버 런타임이 프레임 디스크립션 워크플로우를 모든 MCP 클라이언트에 전달하도록 instructions 를 강화하고 prompts capability 를 추가하기 위한 코드베이스 분석과 설계 결정.

## 기존 코드 분석

### stdio 진입점 — src/daemon/mcp-stdio-entry.ts
- `SERVER_NAME = "autopus-mcp-stdio"`, `SERVER_VERSION = "0.2.0"` (line 74-77).
- `DEFAULT_INSTRUCTIONS` (line 78-79): 현재 한 줄 — "Read+write MCP wire surface for the Autopus daemon (6 resources, 9 baseline tools, optional figma_/validate/generate extras)." 워크플로우 순서 안내 없음.
- `figmaChannelInstruction(channel)` (line 87-94): 채널 시크릿을 instructions 에 노출하는 함수. C-1 주석(line 81-86)이 stdio pipe 를 신뢰 채널로 간주하는 근거를 설명. 이 경로는 유지하되 prompts 로 확장하지 않는다.
- `createMcpStdioServer` (line 167-268): instructions 조립(line 170-178) = DEFAULT_INSTRUCTIONS + figmaChannelInstruction(존재 시) + language 안내(descriptionLanguage getter 존재 시). `new Server({name,version},{ instructions, capabilities: { resources: {}, tools: {} } })` (line 179-185). 여기 capabilities 에 `prompts: {}` 를 추가하고, line 240-256 의 registerResourceHandlers/registerToolHandlers 호출부 옆에 registerPromptHandlers 를 추가한다.
- `input.descriptionLanguage?: () => string` (line 156): live language getter. prompts handler 의 language line 이 이 getter 를 재사용한다(HC-4).

### http 진입점 — src/daemon/mcp-http-session-manager.ts
- `SERVER_NAME = "autopus-mcp-http"`, `SERVER_VERSION = "0.1.0"` (line 21-22).
- `DEFAULT_INSTRUCTIONS` (line 23-24): stdio 와 divergent 한 별도 한 줄 — "Read+write HTTP MCP wire surface for the Autopus daemon (6 resources, 9 tools)." 이 중복/불일치를 renderWorkflowInstructions 단일 산출로 교체(REQ-03).
- `createHttpSession` (line 149-194): `new Server(...,{ instructions: DEFAULT_INSTRUCTIONS, capabilities: { resources: {}, tools: {} } })` (line 154-160). capabilities 에 prompts 추가 + registerPromptHandlers 호출. http 세션은 live language getter 가 없다(language line 생략, REQ-07 getter-gated).

### 핸들러 등록부 — src/daemon/mcp-stdio-handlers.ts
- 현재 `setRequestHandler` 4종만 등록: ListResources/ReadResource(registerResourceHandlers, line 153-185), ListTools/CallTool(registerToolHandlers, line 187-314). ListPrompts/GetPrompt 없음.
- 파일 길이 314줄 — file-size 한계(300) 초과(314>300). 따라서 prompts 핸들러는 이 파일에 추가하지 않고 [NEW] mcp-stdio-prompt-handlers.ts 로 분리한다(HC-1).
- INV-W2(redaction chokepoint, line 175-180/282-286)와 INV-W4(READ_ONLY_TOOLS 4툴 baseline, line 58-80)는 prompts 추가로 변경되지 않아야 한다(REQ-09/HC-2).
- ListTools 순서(line 245-260): reads → extraReads → briefReads → p2Reads → vendorReads → writes → ... → channelTool → langTool. prompts 는 이 배열에 끼어들지 않는다(별도 request type).

### 노출 툴 인벤토리 (워크플로우 ordered step 의 근거)
- read baseline(READ_ONLY_TOOLS, mcp-stdio-handlers.ts:58-80): get_active_selection, get_pending_descriptions, get_audit_events, get_stale_frames.
- write 경로(SPEC-FIGMA-011, mcp-stdio-write-handlers.ts): plan_emit, dryRun, approve, apply, undo. 쓰기 툴 실제 이름은 mcp-stdio-write-handlers.ts:68-88 의 WRITE_TOOLS 에서 plan_emit(:68)/dryRun(:73)/approve(:78)/apply(:83)/undo(:88) 로 확인되며 dryRun 은 camelCase 다(주석 :61 도 동일 frozen 순서 명시). 노출 네임스페이스는 mcp__autopus-figma__dryRun. 따라서 가이던스/acceptance 의 dryRun 표기는 정확하다(dry_run 아님).
- 조건부 read: get_figma_channel(figmaChannel wiring 시), get_description_language(descriptionLanguage getter wiring 시).
- 워크플로우 순서: get_active_selection/get_stale_frames(대상 선정) → dryRun(미리보기) → approve(승인 게이트) → apply(쓰기) → undo(되돌리기). get_pending_descriptions/get_audit_events 는 관측, get_description_language 는 언어 확인.

### 디스크립션 워크플로우 정본 — .claude/skills/autopus/figma-description.md
- 실재 확인: `.claude/skills/autopus/figma-description.md` (24681 bytes, 321 lines) 와 통합 사본 `.agents/skills/figma-description/SKILL.md` (21727 bytes) 양쪽 존재.
- 이 스킬은 화면/기능 정의 작성 절차(stakeholder Q&A → 뱃지 맵 → 카드 인접 배치 → 6/7항목 자가 점검)를 정의한다. FRAME_DESCRIPTION_WORKFLOW 상수는 이 지식을 MCP 툴 호출 순서 레이어로 압축 인용한다(본문 전체 복제가 아니라 운영 순서 요약).
- 주의: figma-description.md 가 참조하는 `figma-use` 스킬은 이 레포에 없다(외부 Figma MCP 플러그인이 제공). 따라서 FRAME_DESCRIPTION_WORKFLOW 는 figma-use 에 의존하지 않는 autopus 툴 순서만 기술한다.

### 디스크립션 본문 문체 — src/prompts/node-only.ts
- buildNodeOnlyPrompt + NODE_ONLY_HANDOFF_RULES(line 97-114)가 LLM 호출 시점에 본문 문체(Korean 기본, 구조화 필드, dev-key 금지 등)를 이미 강제한다.
- 결론: 이 SPEC 의 instructions/prompts 는 문체를 재정의하지 않고 "언제 어떤 툴을" 만 안내한다(MEMORY: voice 는 prompt-level node-only.ts 가 담당).

### MCP SDK 형식 — @modelcontextprotocol/sdk
- package.json 선언: `"@modelcontextprotocol/sdk": "^1.13.1"` (dependencies). 실제 설치 버전: node_modules/@modelcontextprotocol/sdk/package.json `"version": "1.29.0"` (checked_at 2026-06-10). latest 단정 금지 — 1.29.0 으로 고정 인용.
- `ListPromptsRequestSchema` (types.d.ts:1818, method literal "prompts/list"), `GetPromptRequestSchema` (types.d.ts:1896, method literal "prompts/get", params.name: string + optional arguments record).
- `ListPromptsResultSchema` (types.d.ts:1839): prompts 배열, 각 항목 { name, description?, title?, arguments?, ... }.
- `GetPromptResult` 의 messages: `PromptMessageSchema` (types.d.ts:2127) 배열. PromptMessage = { role: "user"|"assistant", content: TextContent|... }. `TextContentSchema` (types.d.ts:1918): { type: "text", text: string }.
- 등록 패턴: 기존 핸들러처럼 `server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [...] }))` 와 `server.setRequestHandler(GetPromptRequestSchema, async (req) => ({ messages: [...] }))`. capabilities 에 `prompts: {}` 를 선언해야 SDK 가 advertise 한다.

## 설계 결정

- D1 (단일 source-of-truth): 워크플로우 텍스트를 [NEW] figma-workflow-guidance.ts 한 곳에 두고 세 소비처가 import. 이유: REQ-01/REQ-03 의 3개 노출 경로 일관성 불변식을 컴파일 타임에 보장. 대안(각 entry 인라인 문자열)은 divergent 회귀를 재발시키므로 기각(현재 http 가 이미 divergent).
- D2 (핸들러 파일 분리): prompts 핸들러를 mcp-stdio-handlers.ts(315줄)에 합치지 않고 [NEW] mcp-stdio-prompt-handlers.ts 로 분리. 이유: file-size 300 한계(HC-1). 부수효과로 prompts surface 테스트가 독립적으로 가능.
- D3 (보안 경계 보존): prompts handler 에 figmaChannel 을 전달하지 않음. 이유: REQ-08/HC-3. 채널 시크릿은 신뢰된 stdio initialize instructions 에만 남고, 더 광범위하게 노출되는 prompts payload 에는 절대 싣지 않는다. negative assertion 으로 검증(S6).
- D4 (언어 getter 재사용): GetPrompt language line 은 기존 descriptionLanguage getter 를 재사용. 이유: HC-4 — get_description_language 툴과 단일 진실원 유지. http 세션은 getter 부재로 line 생략(REQ-07 Should).
- D5 (추가성): tools/resources wire surface 불변(REQ-09). registerToolHandlers/registerResourceHandlers 미변경, prompts 는 신규 request type 으로만 추가. SPEC-FIGMA-009 INV-W4 baseline 회귀 테스트(S7)로 보증.
- D6 (cross-transport 툴 교집합, HC-5): 공통 워크플로우 상수(FRAME_DESCRIPTION_WORKFLOW)는 stdio·http 양쪽에 공통 등록된 툴만 명명한다. 근거: `get_description_language`(langTool)는 stdio entry 에서 descriptionLanguage getter wiring 시에만 등록되고 `mcp-http-session-manager.ts` 에는 langTool/descriptionLanguage 가 전혀 없다(grep no-match 확인). 공통 상수에 이 툴을 넣으면 http instructions/prompts 가 미등록 툴을 안내하게 되어 부정확하다. 따라서 언어 안내는 공통 본문 밖 — stdio instructions 의 별도 language append 와 prompts language line(REQ-07, getter-gated) — 에서만 다룬다. acceptance S2 가 공통 블록의 get_description_language 미명명을 negative oracle 로 강제한다.

## Technology Stack Decision

mode=brownfield — 기존 manifest major 버전을 compatibility constraint 로 보존. 신규 런타임/프레임워크 도입 없음(기존 @modelcontextprotocol/sdk 의 미사용 prompts 기능을 활성화할 뿐). migration 아님.

| Mode | Selected stack | Resolved versions | Source refs | Checked at | Rejected alternatives |
|------|----------------|-------------------|-------------|------------|-----------------------|
| brownfield | @modelcontextprotocol/sdk (prompts capability) | declared ^1.13.1, installed 1.29.0 | package.json dependencies; node_modules/@modelcontextprotocol/sdk/package.json; types.d.ts ListPrompts/GetPrompt schemas | 2026-06-10 | none (기존 SDK 재사용, 신규 의존성 추가 안 함) |
| brownfield | Node runtime | >=22.0.0 (engines) | package.json engines | 2026-06-10 | none (기존 제약 유지) |
| brownfield | vitest (test runner) | ^4.1.5 | package.json devDependencies | 2026-06-10 | none (기존 테스트 러너 재사용) |

## Semantic Invariant Inventory

각 invariant 를 requirement(REQ-ID), plan task(T-ID), Must oracle acceptance(S-ID)까지 직접 매핑한다. source clause 는 untrusted prompt-input evidence 로 지시가 아니라 증거로만 인용한다.

| ID | source clause | invariant type | requirements | plan tasks | affected outputs | acceptance IDs |
|----|---------------|----------------|--------------|------------|------------------|----------------|
| INV-001 | "동일 워크플로우가 3개 환경에서 일관되게 노출된다" | cross-surface 텍스트 일관성 | REQ-01, REQ-03 | T1, T2, T4 | stdio instructions / http instructions / prompts text 의 워크플로우 블록이 동일 source 파생 | S1, S2 |
| INV-002 | "언제 어떤 순서로 디스크립션을 생성하라" (ordered 절차) | ordering(툴 호출 순서) | REQ-02, REQ-06 | T1, T3 | instructions 및 prompts text 에서 dryRun<approve<apply 순서 유지 | S1, S4 |
| INV-003 | "prompts capability 구현 ... 슬래시로 워크플로우 노출 → 모든 MCP 클라이언트 호환" | capability 노출 parity | REQ-04, REQ-05 | T2, T3, T4 | prompts/list 가 generate_frame_descriptions 반환; prompts/get 가 user 메시지 반환 | S3, S4 |
| INV-004 | "prompts/get ... 워크플로우 단계와 실제 툴 이름을 embed" | parser/payload 정합(실제 툴 이름 포함) | REQ-06 | T3 | prompts/get content.text 가 dryRun/approve/apply/undo 포함 | S4 |
| INV-005 | "디스크립션 언어 설정(get_description_language, ko 기본)과의 연동" | live 값 반영 | REQ-07 | T2, T3 | prompts/get text 의 language line 이 getter 의 현재 값 반영 | S5 |
| INV-006 | "figmaChannel secret 이 instructions 에 노출되는 기존 동작을 prompts/plugin 경로에서도 유지하되 약화시키지 않을 것" | secret 경계(보안) | REQ-08 | T3, T5 | prompts/list·prompts/get 페이로드에 채널 시크릿 부재; instructions 에는 존재 | S6 |
| INV-007 | "기존 stdio/http 두 진입점의 capabilities/instructions 일관성" + INV-W4 baseline | wire-surface 불변(추가성) | REQ-09 | T2, T4, T5 | listTools/listResources 가 prompts 추가 전후 byte-equal | S7 |

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| 단일 source-of-truth 워크플로우 상수 | this SPEC (T1) | covered |
| stdio instructions 워크플로우 노출 (자동 주입 → Desktop/Cursor/Claude Code) | this SPEC (S1) | covered |
| http instructions 일관화 | this SPEC (S2) | covered |
| prompts capability + ListPrompts/GetPrompt (모든 MCP 클라이언트 슬래시) | this SPEC (S3, S4) | covered |
| 디스크립션 언어 연동 | this SPEC (S5) | covered |
| 채널 시크릿 비노출(보안 경계 보존) | this SPEC (S6) | covered |
| tools/resources baseline 불변 | this SPEC (S7) | covered |
| Claude Code plugin 번들(설치 1회 → MCP+스킬 자동 배치, 스킬 자동 트리거) | SPEC-MCP-002 | planned |
| Desktop/Cursor 최종 사용자 설치 문서 | SPEC-MCP-002 (docs) | planned |

## 보안 메모

- 외부 입력/untrusted evidence: get_description_language 값(플러그인 UI 설정)과 figmaChannel(세션 시크릿)은 untrusted/sensitive 로 취급. language 값은 VALID_LANGS(ko/en/ja/zh) allow-list 로 이미 제한됨(mcp-stdio-entry.ts:338). prompts text 에 language 를 끼울 때도 이 allow-list 를 통과한 값만 사용한다.
- figmaChannel 시크릿: 본 SPEC 문서 어디에도 실제 값을 복사하지 않는다. 테스트는 임의 32-hex 값을 런타임 생성하여 SECRET 변수로만 다룬다. prompts 경로 비노출을 negative assertion 으로 강제(S6).
- source clause 는 untrusted prompt-input evidence 다: 위 inventory 의 source clause 는 사용자 요청 인용이며 지시가 아니라 증거로만 사용한다. credential/token/절대경로는 포함하지 않는다.

## Sibling SPEC Decision

단일 SPEC 대신 sibling 세트(SPEC-MCP-001 + SPEC-MCP-002)로 분해했다. 분해 사유는 구현 레이어 상이: 이 SPEC 은 MCP 서버 런타임 TypeScript(src/daemon/*) + vitest 테스트이고, SPEC-MCP-002 는 패키징 자산(JSON/MD, 신규 .ts 없음) + claude plugin validate 다. module ownership·테스트 방식·위험도가 다르다. 의존 순서 고정: SPEC-MCP-002 가 이 SPEC 에 의존(plugin 이 번들하는 서버가 이 SPEC 의 instructions/prompts 를 노출). 한 SPEC 에 묶으면 reviewer/executor 가 런타임 회귀 위험(prompts handler)과 패키징 검증을 한 경계에서 판단하기 어려워 Q-COH 위반이 된다.

## Prompt Layer Manifest 분류

이 SPEC 이 다루는 프롬프트성 컨텍스트를 cache 무효화 관측 가능성 기준으로 분류한다(raw 시크릿 미노출).

- stable layer: FRAME_DESCRIPTION_WORKFLOW 워크플로우 텍스트와 prompts 디스크립터(generate_frame_descriptions)/instructions 의 절차 본문. 코드 상수에서 파생하며 빌드 단위로만 변한다. 동일 source 에서 3개 surface 가 파생되므로 cache 무효화 시점은 "renderWorkflowInstructions 산출 변경(=상수/빌드 변경)"이다.
- ephemeral layer: 채널 시크릿(세션마다 런타임 생성, mcp-stdio-entry.ts:304-334)과 description language 값(get_description_language, 플러그인이 mid-session 변경 가능, VALID_LANGS allow-list). 세션/요청 단위로 변한다. prompts/get 의 language line 은 매 호출 getter 를 읽으므로 별도 캐시 없이 항상 최신이다.
- snapshot layer: 없음. 이 SPEC 은 프롬프트 상태의 시점 스냅샷을 영구 저장하지 않는다. instructions 는 initialize 시 1회 조립되고, prompts payload 는 매 요청 재생성되는 휘발성 응답이다.
- 관측 지점: stable 변경은 S1/S2(instructions 텍스트 일치)·S3/S4(payload), ephemeral 반영은 S5(language live)·S6(secret 경계)로 관측된다.

## Outcome Lock

Locked user-visible outcome: autopus-figma MCP 서버를 연결하면(Claude Code/Desktop/Cursor 공통) 연결 즉시 instructions 로, 그리고 /mcp__autopus-figma__generate_frame_descriptions 슬래시 prompt 로 "selection/stale → dryRun → approve → apply → undo" 디스크립션 워크플로우가 노출되어, 클라이언트가 절차를 인지·발동할 수 있다.

이 SPEC 이 closing 하는 outcome slice: 서버측 두 전달 경로(instructions 자동 주입 + prompts capability). 정확한 closing 조건 = acceptance S1~S7 이 vitest 로 통과한다(instructions 텍스트 일관성 S1/S2, prompts payload S3/S4, language live S5, secret 비노출 S6, baseline 불변 S7). 이 조건이 충족되기 전에는 SPEC 을 implemented 로 표시하지 않는다.

Sibling 으로 닫히는 slice: Claude Code 의 "설치 1회 + 스킬 자동 트리거"는 SPEC-MCP-002 가 닫는다. 사용자 요청의 "3개 환경 전부 자동 사용"이라는 완전한 결과는 이 SPEC(Desktop·Cursor 완전 + Claude Code 서버 노출) + SPEC-MCP-002(Claude Code 스킬 자동 트리거) 합산으로만 완료된다.

## Reviewer Brief

리뷰는 세 지점에 집중한다.

1. 단일 source-of-truth(REQ-01): 워크플로우 텍스트가 [NEW] figma-workflow-guidance.ts 한 곳에만 존재하고 stdio entry/http entry/prompts handler 세 소비처가 import 하는가. entry 파일에 문자열 인라인 복제가 없는가(현재 http 가 divergent 한 한 줄을 갖고 있어 이를 제거하는 것이 핵심). 검증: S1/S2.
2. 추가성·baseline 불변(REQ-09, HC-2): prompts capability/handlers 추가가 ListTools/ListResources 출력을 바꾸지 않는가. registerToolHandlers/registerResourceHandlers 미변경, prompts 는 별도 setRequestHandler 로만 추가. SPEC-FIGMA-009 INV-W4 byte-equal baseline 회귀(S7).
3. secret 경계(REQ-08, HC-3): prompts handler 가 figmaChannel 을 ctx 로 받지 않고 prompts/list·prompts/get payload 에 채널 시크릿이 등장하지 않는가. 동일 세션 instructions 에는 기존대로 존재(대조). negative assertion(S6).

부차 확인: file-size — prompts handler 를 mcp-stdio-handlers.ts(314줄, 300 초과)에 합치지 않고 [NEW] mcp-stdio-prompt-handlers.ts 로 분리(HC-1). 툴 이름 정확성 — dryRun 은 camelCase(mcp-stdio-write-handlers.ts:73), dry_run 아님.

리뷰어 오판 정정 기록(재오판 차단용):
- F1(dryRun vs dry_run): 리뷰어 오판. mcp-stdio-write-handlers.ts:73 의 WRITE_TOOLS 가 name: "dryRun"(camelCase), 노출 네임스페이스 mcp__autopus-figma__dryRun. acceptance/가이던스의 dryRun 표기가 정확하며 변경하지 않는다.
- 라인 수: 실측 figma-description.md=321(322 아님), mcp-stdio-handlers.ts=314(315 아님). 314>300 이므로 HC-1 분리 근거 유효. 리뷰어의 257/300 표기도 부정확.

## Completion Debt

반드시 후속에서 닫아야 하는 의존(요청 기능 완료의 필수 조건):

- SPEC-MCP-001 ↔ SPEC-MCP-002 상호 의존: 이 SPEC 이 서버측 워크플로우 노출을 제공해야 SPEC-MCP-002 가 번들하는 MCP 서버가 Claude Code 에서 동일 워크플로우를 안내한다. 역으로 Claude Code 의 스킬 자동 트리거(설치 1회)는 SPEC-MCP-002 가 닫는다. 두 SPEC 중 하나만 구현되면 "3개 환경 전부" 결과가 미완. 구현 순서: 이 SPEC 선행(서버 런타임이 전제), 이어서 SPEC-MCP-002 패키징.
- Desktop/Cursor 최종 사용자 설치 문서: 이 SPEC 은 서버 동작을 닫지만 사용자 대상 설치 안내(수동 MCP config)는 SPEC-MCP-002 README 가 환경별로 제공한다. 그 문서가 없으면 Desktop/Cursor 사용자가 서버를 어떻게 붙이는지 알 수 없다.

## Evolution Ideas

선택적 향후 개선(요청 기능 완료에 필수 아님, 별도 판단 대상):

- prompts 인자화: generate_frame_descriptions 에 frame_id/scope arguments 를 추가해 클라이언트가 대상 프레임을 prompt 인자로 넘기게 하는 확장(현재는 무인자 가이드).
- 추가 prompt 노출: review/undo 전용 prompt 를 별도 슬래시로 노출하는 안. 현재는 단일 generate_frame_descriptions 로 충분.
- instructions 토큰 예산: 워크플로우 텍스트가 길어질 경우 instructions 와 prompts 간 상세도 차등(instructions 요약, prompts 상세) 조정.

## Self-Verify Summary

- Q-CORR-01 | status: PASS | attempt: 1 | files: spec.md, research.md | reason: mcp-stdio-entry.ts(78,87,156,170-185,240-256), mcp-http-session-manager.ts(23,154-160), mcp-stdio-handlers.ts(58-80, 길이 314), node-only.ts(97-114), figma-description.md 실재(24681B), SDK 1.29.0 ListPrompts/GetPrompt(types.d.ts:1818/1896/2127) 모두 직접 Read 로 확인.
- Q-CORR-02 | status: PASS | attempt: 1 | files: spec.md, plan.md | reason: 신규 항목(figma-workflow-guidance.ts, mcp-stdio-prompt-handlers.ts, mcp-prompts-surface.test.ts)은 모두 [NEW] 표기, 기존 참조 검증 대상에서 제외.
- Q-CORR-03 | status: PASS | attempt: 1 | files: acceptance.md | reason: acceptance 는 bare Given/When/Then/And. EARS REQ 는 WHEN/THE SYSTEM SHALL, Priority 는 별도 meta line. SDK 핸들러 형식(messages/role/content.type=text)이 실제 schema 와 일치.
- Q-COMP-01 | status: PASS | attempt: 1 | files: spec.md, plan.md, acceptance.md, research.md | reason: 4파일이 목적/태스크/oracle/근거로 상호 보완. 빈 문서 없음.
- Q-COMP-02 | status: PASS | attempt: 3 | files: spec.md, plan.md, acceptance.md | reason: REVISE-2 후 REQ-06 'actual tool names' ↔ T1/T4 충돌 해소. 공통 워크플로우 상수가 stdio·http 교집합 툴만 명명하도록 REQ-01/HC-5/D6 으로 제약하고, plan T1 툴 목록에서 get_description_language 제거, acceptance S2 에 http 블록의 get_description_language 미명명 oracle 추가. attempt 2 의 Traceability Matrix(REQ-01..09 ↔ T1..T5 ↔ S1..S7)는 유지.
- Q-COMP-03 | status: PASS | attempt: 1 | files: spec.md, acceptance.md | reason: 각 REQ 가 EARS type/조건/기대결과 명시. 관측 지점은 instructions 문자열 또는 prompts payload(S1~S7).
- Q-COMP-04 | status: PASS | attempt: 1 | files: spec.md, plan.md | reason: 사용자 요청(3개 환경)을 서버측(this SPEC) + plugin 번들(SPEC-MCP-002)로 분해. Feature Completion Scope/Related SPECs 에 의존성 명시.
- Q-COMP-05 | status: PASS | attempt: 3 | files: spec.md, plan.md, acceptance.md, research.md | reason: REVISE 후 Semantic Invariant Inventory 에 requirements/plan tasks 컬럼을 추가하여 INV-001..007 각 row 가 REQ-ID + T-ID + Must oracle(S-ID)로 직접 매핑됨. ordering(INV-002) indexOf 순서, secret 경계(INV-006) 부분문자열 부재, baseline(INV-007) byte-equal 로 concrete oracle. REVISE-2 에서 cross-transport 툴 교집합(D6/HC-5)을 acceptance S2 의 get_description_language 미명명 negative oracle 로 검증하여, getter-absent http 경로가 미등록 툴을 안내하는 결함을 oracle 로 차단.
- Q-FEAS-01 | status: PASS | attempt: 1 | files: spec.md, plan.md | reason: 런타임 TS 코드 변경(src/daemon/) + vitest 테스트. 문서-only 아님을 정확히 분류.
- Q-FEAS-02 | status: PASS | attempt: 1 | files: spec.md | reason: 편집 대상 경로(src/daemon/*, tests/unit/*)가 실제 repo 구조와 일치. generated 아님.
- Q-FEAS-03 | status: PASS | attempt: 1 | files: acceptance.md | reason: 모든 oracle 이 in-memory client/server 또는 문자열 검사로 실행 가능, 라이브 Figma 불요. vitest run 으로 검증 가능.
- Q-STYLE-01 | status: PASS | attempt: 1 | files: spec.md | reason: REQ description 에 should/might/could 등 모호어 없음. Priority 는 별도 meta line.
- Q-STYLE-02 | status: PASS | attempt: 1 | files: spec.md | reason: Priority 는 Must/Should 만 사용, EARS type 과 별개 축.
- Q-STYLE-03 | status: PASS | attempt: 1 | files: spec.md, acceptance.md | reason: 문장 완결, acceptance 는 bare Given/When/Then/And. step keyword 를 가리는 마크업 없음.
- Q-SEC-01 | status: PASS | attempt: 1 | files: research.md, spec.md | reason: untrusted 입력(language 설정, 채널 시크릿)의 경계와 완화(allow-list, prompts 비노출) 명시. source clause 를 evidence 로만 취급.
- Q-SEC-02 | status: PASS | attempt: 1 | files: spec.md, research.md, acceptance.md | reason: 채널 시크릿 실제 값을 SPEC 에 복사하지 않음(HC-3). 테스트는 런타임 생성 SECRET 변수로만 다룸. 절대경로/credential 노출 없음.
- Q-SEC-03 | status: PASS | attempt: 1 | files: spec.md | reason: 별도 영구 로그/아티팩트를 새로 만들지 않음. 기존 audit 경로 불변. prompts payload 는 휘발성 응답.
- Q-COH-01 | status: PASS | attempt: 1 | files: spec.md | reason: 하나의 cohesive story(서버가 워크플로우를 instructions+prompts 두 경로로 노출). 무관 concern 미혼입.
- Q-COH-02 | status: PASS | attempt: 1 | files: spec.md, plan.md | reason: Claude Code plugin 번들(다른 구현 레이어=패키징)을 SPEC-MCP-002 로 분리. hand-wave 없음.
- Q-COH-03 | status: PASS | attempt: 1 | files: plan.md | reason: 두 SPEC 분해, 각자 독립 구현 가능 크기. 이 SPEC 은 T1~T5 로 실동작(스캐폴드 아님), 실행 순서/handoff 명시.
- Q-COMP-04 | status: PASS | attempt: 2 | files: research.md, spec.md, plan.md | reason: 요청 기능의 완료를 Outcome Lock 으로 게이팅(이 SPEC closing slice = 서버측 instructions+prompts; sibling closing slice = Claude Code 스킬 자동 트리거). prompt-state 분류(Prompt Layer Manifest)로 stable/ephemeral/snapshot=none 을 cache 무효화 관점에서 명시. Completion Debt 가 MCP-001↔MCP-002 상호 의존을 후속 필수로 고정.
- Q-COMP-06 | status: PASS | attempt: 2 | files: spec.md, research.md | reason: REVISE 후 spec.md 에 `## Traceability Matrix` 표가 실재함을 재확인하고, research.md 의 추적성 단언이 그 실재 표를 가리키도록 정정. 문서 간 단언-실재 불일치 제거(이전 FAIL 원인).
- Q-COMP-07 | status: PASS | attempt: 2 | files: research.md | reason: 신버전 체크리스트가 요구하는 헤딩(## Sibling SPEC Decision, ## Outcome Lock, ## Reviewer Brief, ## Completion Debt, ## Evolution Ideas, ## Prompt Layer Manifest 분류)을 모두 추가. Completion Debt(필수 후속 의존)와 Evolution Ideas(선택 개선)를 별도 헤딩으로 분리하여 혼동 제거.

## REVISE 처리 요약 (이번 라운드)

- F1(dryRun): 리뷰어 오판으로 판정, dryRun 표기 유지 + research 에 camelCase 근거(:73) 추가로 재오판 차단.
- 라인 수: 321/314 로 정정(322/315 오기). 314>300 으로 HC-1 분리 근거 유효.
- S1 모순: acceptance S1 Given 에 figmaChannel wiring 추가하여 channel-secret 기대(Then)와 일관화.
- Traceability Matrix: spec.md 에 실제 표 추가(Q-COMP-06 closure).
- 신버전 섹션 6종 + Inventory REQ/T 컬럼 + Prompt Layer Manifest 추가. Self-Verify 를 Q-COMP-06/07 포함 신항목으로 갱신.
