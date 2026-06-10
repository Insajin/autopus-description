# Review: SPEC-MCP-001

**Verdict**: REVISE
**Revision**: 1
**Date**: 2026-06-10 17:19:32

## Provider Health

| Provider | Status | Note |
| --- | --- | --- |
| claude | success | - |
| codex | success | - |

## Checklist Summary

| ID | Status | Provider | Reason |
| --- | --- | --- | --- |
| Q-CORR-01 | PASS | claude | 인용 참조 직접 검증: mcp-stdio-handlers.ts=314줄, figma-description.md=321줄, write tool 이름/라인(plan_emit:68/dryRun:73/approve:78/apply:83/undo:88), SDK 1.29.0 ListPrompts:1818/GetPrompt:1896/TextContent:1918/Pr… |
| Q-CORR-02 | PASS | claude | figma-workflow-guidance.ts, mcp-stdio-prompt-handlers.ts, mcp-prompts-surface.test.ts 모두 [NEW] 표기되어 기존 참조 검증 대상에서 제외됨. |
| Q-CORR-03 | PASS | claude | REQ는 EARS(WHEN/THE SYSTEM SHALL)+별도 Priority meta line, acceptance는 bare Given/When/Then/And. SDK 핸들러 형식(messages/role:user/content.type:text)이 실제 PromptMessage/TextContent 스키마와 일치. |
| Q-CORR-04 | PASS | claude | existing path/symbol는 rg/wc로 확인, 신규 항목은 [NEW]로 분리. generated 아닌 source(src/daemon/*) 대상. 단 일부 문서의 314/315 라인수 표기 불일치는 minor 정정 대상(F-001). |
| Q-COMP-01 | PASS | claude | spec/plan/acceptance/research 4파일이 목적·태스크·oracle·근거로 상호 보완하며 빈 문서 없음. |
| Q-COMP-02 | PASS | claude | spec.md ## Traceability Matrix가 REQ-01..09 ↔ T1..T5 ↔ S1..S7을 연결. 누락 REQ 없음. |
| Q-COMP-03 | PASS | claude | 각 REQ에 EARS type/조건/기대결과 명시. 관측 지점은 instructions 문자열(S1/S2) 또는 prompts payload(S3~S7)로 구체적. |
| Q-COMP-04 | PASS | claude | research.md ## Outcome Lock이 사용자 가시 결과(connect 즉시 instructions + /mcp__autopus-figma__generate_frame_descriptions 슬래시)와 closing 조건(S1~S7 vitest 통과)을 고정. Desktop/Cursor는 이 SPEC 단독으로 닫히고 Claude Code 스킬… |
| Q-COMP-05 | PASS | claude | Semantic Invariant Inventory의 INV-001~007이 각각 REQ/T/Must S-ID로 매핑됨. ordering(indexOf dryRun<approve<apply), secret 부재(substring 부재), baseline(byte-equal) 등 concrete oracle 보유, structural-only 아님. |
| Q-COMP-06 | PASS | claude | spec.md ## Traceability Matrix + research.md ## Reviewer Brief 실재. Reviewer Brief가 3개 review focus(single source-of-truth, 추가성, secret 경계)와 부차 확인(file-size, dryRun camelCase) 제시. |
| Q-COMP-07 | PASS | claude | research.md가 ## Completion Debt(MCP-001↔002 상호 의존, Desktop/Cursor 설치 문서 — Outcome 완료 필수)와 ## Evolution Ideas(prompts 인자화 등 선택 개선)를 분리. Evolution Ideas에 SPEC/task/acceptance ID 자동 부여 없음. |
| Q-FEAS-01 | PASS | claude | 런타임 TS 코드 변경(src/daemon/*) + vitest 테스트로 정확히 분류. 문서-only로 동작을 약속하지 않음. |
| Q-FEAS-02 | PASS | claude | 편집 대상 경로(src/daemon/*, tests/*)가 실제 repo 구조·module ownership과 일치. generated surface 아님. 패키징 자산은 sibling SPEC-MCP-002로 분리. |
| Q-FEAS-03 | PASS | claude | 모든 oracle이 in-memory client/server 또는 문자열 검사로 실행 가능, 라이브 Figma 불요. InMemoryTransport 페어 헬퍼 실재. 헬퍼 출처 명시는 suggestion(F-003). |
| Q-STYLE-01 | PASS | claude | REQ description에 should/might/could 등 모호어 없음. Priority는 별도 meta line. |
| Q-STYLE-02 | PASS | claude | Priority는 Must/Should만 사용하고 EARS type과 별개 축으로 표기. |
| Q-STYLE-03 | PASS | claude | REQ/AC 문장 완결, acceptance는 bare Given/When/Then/And. step keyword 가리는 마크업 없음. |
| Q-SEC-01 | PASS | claude | untrusted 입력(description language 설정, figmaChannel 시크릿)의 경계·완화(VALID_LANGS allow-list, prompts 비노출) 명시. source clause를 지시가 아닌 evidence로만 취급. |
| Q-SEC-02 | PASS | claude | 채널 시크릿 실제 값을 SPEC에 복사하지 않음(HC-3). 테스트는 런타임 생성 32-hex SECRET 변수로만 다루고 S6 negative assertion으로 prompts 페이로드 비노출 검증. credential/절대경로 노출 없음. |
| Q-SEC-03 | PASS | claude | 신규 영구 로그/아티팩트 미생성. 기존 audit 경로 불변, prompts payload는 휘발성 응답. |
| Q-COH-01 | PASS | claude | 하나의 cohesive story(서버가 워크플로우를 instructions+prompts 두 경로로 노출)로 수렴, 무관 concern 미혼입. |
| Q-COH-02 | PASS | claude | Outcome Lock 필수 후속(MCP-002 의존)은 Completion Debt로 남아 sync completion을 막음. Outcome Lock 밖 개선은 Evolution Ideas로만 분리. |
| Q-COH-03 | PASS | claude | ## Sibling SPEC Decision이 허용 사유(구현 레이어 상이: 런타임 TS vs 패키징 자산) 명시. sibling 2개 이내(MCP-001+MCP-002), 각자 독립 구현 가능 outcome slice와 acceptance 책임 보유. 재귀 sibling 없음. |
| Q-CORR-01 | FAIL | codex | FAIL: 기존 경로와 심볼 대부분은 실재하지만, 현재 저장소 기준 라인 수 단언이 틀립니다. `.claude/skills/autopus/figma-description.md`는 257 lines, `.agents/skills/figma-description/SKILL.md`는 204 lines, `src/daemon/mcp-stdio-handlers.ts… |
| Q-CORR-02 | PASS | codex | 신규 파일 `figma-workflow-guidance.ts`, `mcp-stdio-prompt-handlers.ts`, `mcp-prompts-surface.test.ts`가 모두 `[NEW]`로 표시되어 planned addition과 기존 참조가 구분됩니다. |
| Q-CORR-03 | PASS | codex | EARS 요구사항, Priority 분리, bare Given/When/Then acceptance 형식은 파서 친화적이며, 설치된 MCP SDK 1.29.0의 `ListPromptsRequestSchema`/`GetPromptRequestSchema` 및 prompt message shape와도 맞습니다. |
| Q-CORR-04 | PASS | codex | 기존 코드 경로와 planned addition 표기는 대체로 분리되어 있고, generated/plugin surface는 sibling SPEC으로 분리되어 있습니다. 라인 수 및 조건부 툴 참조 문제는 Q-CORR-01/F-001/F-003에서 별도 지적합니다. |
| Q-COMP-01 | PASS | codex | `spec.md`, `plan.md`, `acceptance.md`, `research.md`가 목적, 구현 태스크, 검증 oracle, 근거를 각각 갖고 상호 보완합니다. |
| Q-COMP-02 | FAIL | codex | FAIL: REQ-06의 'actual tool names'와 T1/T4가 충돌합니다. T1은 `get_description_language`를 공통 workflow text에 포함하라고 하지만 T4의 HTTP 경로는 getter가 없어 해당 툴이 노출되지 않습니다. acceptance도 이 불일치를 잡지 못합니다. |
| Q-COMP-03 | PASS | codex | 각 REQ는 EARS type, trigger, 기대 결과를 갖고 있으며 관측 지점은 instructions 문자열 또는 prompts/list/get payload로 명확합니다. |
| Q-COMP-04 | PASS | codex | Outcome Lock은 서버측 instructions+prompts slice와 Claude Code plugin slice를 분리하고, sibling SPEC-MCP-002가 닫아야 할 completion debt를 명시합니다. |
| Q-COMP-05 | FAIL | codex | FAIL: Semantic invariant 중 'actual exposed tool names' 및 language getter 조건부 동작이 getter-absent HTTP/registerPromptHandlers({}) 경로의 oracle로 검증되지 않습니다. 이 때문에 존재하지 않는 `get_description_language` 안내가 HTTP… |
| Q-COMP-06 | PASS | codex | `spec.md`의 Traceability Matrix와 `research.md`의 Reviewer Brief/Semantic Invariant Inventory가 review scope와 주요 검증 초점을 제공합니다. |
| Q-COMP-07 | PASS | codex | `Completion Debt`와 `Evolution Ideas`가 분리되어 있으며, 필수 sibling 의존성과 선택 개선이 혼동되지 않습니다. |
| Q-FEAS-01 | PASS | codex | 런타임 TypeScript 변경과 vitest 테스트로 구현 레이어가 실제 소유 모듈(`src/daemon/*`, `tests/unit/*`)에 맞습니다. |
| Q-FEAS-02 | PASS | codex | 변경 대상 경로가 현재 저장소 구조에 존재하거나 `[NEW]`로 표시되어 있고, MCP 서버 runtime과 테스트 경계에 맞습니다. |
| Q-FEAS-03 | PASS | codex | 검증은 in-memory client/server 또는 생성 문자열 검사로 수행 가능하며 라이브 Figma 연결이 필요 없습니다. 누락된 oracle은 completeness 문제이지 실행 불가능성은 아닙니다. |
| Q-STYLE-01 | PASS | codex | REQ 본문은 모호어를 남발하지 않고 SHALL 중심으로 단정되어 있습니다. `Should`는 Priority meta line으로만 사용됩니다. |
| Q-STYLE-02 | PASS | codex | Priority는 Must/Should 축으로, EARS Type은 Ubiquitous/Event-driven 축으로 분리되어 있습니다. |
| Q-STYLE-03 | PASS | codex | acceptance step은 bare Given/When/Then/And 형식을 유지하고 문장도 읽을 수 있는 수준으로 완결되어 있습니다. |
| Q-SEC-01 | PASS | codex | language 설정과 figmaChannel secret을 untrusted/sensitive 입력으로 분류하고 allow-list 및 prompts 비노출 경계를 명시합니다. |
| Q-SEC-02 | PASS | codex | 실제 secret 값을 SPEC에 복사하지 않고, prompts payload에서 secret substring 부재를 negative assertion으로 검증하도록 되어 있습니다. |
| Q-SEC-03 | PASS | codex | 새 영구 로그나 retained artifact를 요구하지 않으며, 기존 audit 경로와 prompts의 휘발성 응답 특성을 구분합니다. |
| Q-COH-01 | PASS | codex | SPEC은 MCP server가 frame-description workflow를 instructions와 prompts로 노출하는 하나의 cohesive change story로 수렴합니다. |
| Q-COH-02 | PASS | codex | Outcome Lock에 필요한 서버측 작업은 이 SPEC에 포함되고, Claude Code plugin 자동 트리거는 Completion Debt 및 sibling SPEC으로 명시되어 숨겨지지 않습니다. |
| Q-COH-03 | PASS | codex | Sibling SPEC-MCP-002의 예외 사유, 의존 순서, 독립 outcome slice가 명확하며 recursive sibling으로 확장되지 않습니다. |

Total: 46 (PASS: 43, FAIL: 3, N/A: 0)

## Provider Responses

### Response 1

I've verified the SPEC's key claims against the actual codebase. All major technical references check out:

- `mcp-stdio-handlers.ts` = **314 lines** (>300, confirms HC-1 split rationale)
- `figma-description.md` = **321 lines** ✓
- Write tool names confirmed: `plan_emit`:68, `dryRun`:73 (camelCase ✓), `approve`:78, `apply`:83, `undo`:88
- SDK installed **1.29.0** (declared `^1.13.1`); `ListPromptsRequestSchema`:1818, `GetPromptRequestSchema`:1896, `TextContentSchema`:1918, `PromptMessageSchema`:2127 — all exactly as cited
- `InMemoryTransport` pair helper exists (figma-009/figma-011), tool-surface test exists

The live MCP instructions I received even confirm the C-1 behavior (channel secret surfaces in stdio instructions) the SPEC builds its REQ-08 boundary on.

```json
{
  "verdict": "PASS",
  "summary": "SPEC-MCP-001은 MCP 서버 런타임에 instructions 강화 + prompts capability를 추가하는 brownfield 변경으로, 단일 source-of-truth(REQ-01)·추가성/baseline 불변(REQ-09/HC-2)·secret 경계 보존(REQ-08/HC-3) 세 축이 명확하다. 코드베이스 직접 검증 결과 인용된 모든 핵심 참조가 실재한다: mcp-stdio-handlers.ts=314줄(>300, HC-1 분리 근거 유효), figma-description.md=321줄, dryRun은 camelCase(write-handlers:73), SDK 1.29.0의 ListPrompts/GetPrompt/PromptMessage 스키마가 인용 라인과 정확히 일치, InMemoryTransport 페어 헬퍼와 tool-surface 테스트 패턴 실재. 7개 acceptance(S1~S7) 모두 in-memory client/server 또는 문자열 검사로 실행 가능한 concrete oracle이며 INV-001~007에 추적된다. critical/security/major 0건. 발견된 항목은 문서 간 라인수 표기 불일치(314 vs 315)와 REQ-09 우선순위-수락기준 강도 불일치 등 minor 수준이라 PASS.",
  "findings": [
    {
      "severity": "minor",
      "category": "correctness",
      "scope_ref": "plan.md 제약 노트 / research.md D2",
      "location": "plan.md(제약 노트), research.md(## 설계 결정 D2)",
      "description": "mcp-stdio-handlers.ts의 라인 수가 문서마다 다르다. spec.md HC-1은 '314 lines', research.md 기존코드분석/리뷰어 오판 정정은 '314'로 올바르게 적었으나, plan.md 제약 노트와 research.md D2는 여전히 '315줄'로 표기한다. 실측 결과 314줄이 정확하다. 결론(>300이라 HC-1 분리 필요)은 두 값 모두에서 동일하므로 영향은 없지만, research 자체의 '재오판 차단' 정정 노트(=314)와 같은 문서 내 D2(=315)가 모순된다.",
      "suggestion": "plan.md 제약 노트와 research.md D2의 '315줄'을 실측값 '314줄'로 통일한다."
    },
    {
      "severity": "minor",
      "category": "completeness",
      "scope_ref": "REQ-09 / HC-2 / S7",
      "location": "spec.md(REQ-09, Traceability Matrix), acceptance.md(S7)",
      "description": "REQ-09는 Priority: Should로 표기되었으나, 그 불변식은 hard constraint HC-2('SHALL NOT alter the existing ListTools/ListResources output')와 Must 등급 acceptance S7(byte-equal baseline-invariance oracle)로 강제된다. '추가 surface가 기존 wire surface를 바꾸지 않는다'는 회귀 방지 불변식은 일반적으로 Must 성격이라, Should 우선순위 표기와 HC-2/S7의 강제 수준이 어긋난다. Feature Coverage Map은 '핵심 노출'을 Must로 취급하는 다른 REQ들과 달리 이 회귀 불변식만 Should로 둔 근거가 명시되지 않았다.",
      "suggestion": "REQ-09를 Must로 승격하여 HC-2/S7의 강제 수준과 일치시키거나, '노출 추가는 Should지만 baseline 불변은 HC-2/S7로 Must 강제'라는 의도를 REQ-09 인접에 한 줄로 명시한다."
    },
    {
      "severity": "suggestion",
      "category": "feasibility",
      "scope_ref": "plan.md T5 / tests/unit/mcp-prompts-surface.test.ts",
      "location": "plan.md(T5), research.md(기존 코드 분석)",
      "description": "T5는 '기존 tool-surface 단위 테스트의 InMemoryTransport 패턴 미러링'이라고 적었다. 실제 InMemoryTransport 페어 헬퍼는 tests/integration/figma-009/__helpers/in-memory-pair.ts(및 figma-011)에 있고, 가장 가까운 단위 surface 테스트는 tests/unit/daemon-mcp-stdio-tool-surface.test.ts다. 패턴은 실재하므로 실행 가능성에는 문제가 없으나, 새 tests/unit/ 파일이 integration 디렉토리의 헬퍼를 import할지 단위 테스트 내에서 InMemoryTransport.createLinkedPair를 직접 구성할지가 명시되지 않았다.",
      "suggestion": "T5에 헬퍼 출처(integration/__helpers의 createLinkedPair 패턴을 단위 테스트에서 직접 구성 또는 재사용)를 한 줄로 고정해 executor의 재탐색을 줄인다."
    }
  ],
  "checklist": [
    {"id": "Q-CORR-01", "status": "PASS", "reason": "인용 참조 직접 검증: mcp-stdio-handlers.ts=314줄, figma-description.md=321줄, write tool 이름/라인(plan_emit:68/dryRun:73/approve:78/apply:83/undo:88), SDK 1.29.0 ListPrompts:1818/GetPrompt:1896/TextContent:1918/PromptMessage:2127 모두 실재. READ_ONLY_TOOLS 4툴, DEFAULT_INSTRUCTIONS 위치도 코드와 일치."},
    {"id": "Q-CORR-02", "status": "PASS", "reason": "figma-workflow-guidance.ts, mcp-stdio-prompt-handlers.ts, mcp-prompts-surface.test.ts 모두 [NEW] 표기되어 기존 참조 검증 대상에서 제외됨."},
    {"id": "Q-CORR-03", "status": "PASS", "reason": "REQ는 EARS(WHEN/THE SYSTEM SHALL)+별도 Priority meta line, acceptance는 bare Given/When/Then/And. SDK 핸들러 형식(messages/role:user/content.type:text)이 실제 PromptMessage/TextContent 스키마와 일치."},
    {"id": "Q-CORR-04", "status": "PASS", "reason": "existing path/symbol는 rg/wc로 확인, 신규 항목은 [NEW]로 분리. generated 아닌 source(src/daemon/*) 대상. 단 일부 문서의 314/315 라인수 표기 불일치는 minor 정정 대상(F-001)."},
    {"id": "Q-COMP-01", "status": "PASS", "reason": "spec/plan/acceptance/research 4파일이 목적·태스크·oracle·근거로 상호 보완하며 빈 문서 없음."},
    {"id": "Q-COMP-02", "status": "PASS", "reason": "spec.md ## Traceability Matrix가 REQ-01..09 ↔ T1..T5 ↔ S1..S7을 연결. 누락 REQ 없음."},
    {"id": "Q-COMP-03", "status": "PASS", "reason": "각 REQ에 EARS type/조건/기대결과 명시. 관측 지점은 instructions 문자열(S1/S2) 또는 prompts payload(S3~S7)로 구체적."},
    {"id": "Q-COMP-04", "status": "PASS", "reason": "research.md ## Outcome Lock이 사용자 가시 결과(connect 즉시 instructions + /mcp__autopus-figma__generate_frame_descriptions 슬래시)와 closing 조건(S1~S7 vitest 통과)을 고정. Desktop/Cursor는 이 SPEC 단독으로 닫히고 Claude Code 스킬 자동 트리거만 sibling SPEC-MCP-002에 위임 — bounded sibling slice."},
    {"id": "Q-COMP-05", "status": "PASS", "reason": "Semantic Invariant Inventory의 INV-001~007이 각각 REQ/T/Must S-ID로 매핑됨. ordering(indexOf dryRun<approve<apply), secret 부재(substring 부재), baseline(byte-equal) 등 concrete oracle 보유, structural-only 아님."},
    {"id": "Q-COMP-06", "status": "PASS", "reason": "spec.md ## Traceability Matrix + research.md ## Reviewer Brief 실재. Reviewer Brief가 3개 review focus(single source-of-truth, 추가성, secret 경계)와 부차 확인(file-size, dryRun camelCase) 제시."},
    {"id": "Q-COMP-07", "status": "PASS", "reason": "research.md가 ## Completion Debt(MCP-001↔002 상호 의존, Desktop/Cursor 설치 문서 — Outcome 완료 필수)와 ## Evolution Ideas(prompts 인자화 등 선택 개선)를 분리. Evolution Ideas에 SPEC/task/acceptance ID 자동 부여 없음."},
    {"id": "Q-FEAS-01", "status": "PASS", "reason": "런타임 TS 코드 변경(src/daemon/*) + vitest 테스트로 정확히 분류. 문서-only로 동작을 약속하지 않음."},
    {"id": "Q-FEAS-02", "status": "PASS", "reason": "편집 대상 경로(src/daemon/*, tests/*)가 실제 repo 구조·module ownership과 일치. generated surface 아님. 패키징 자산은 sibling SPEC-MCP-002로 분리."},
    {"id": "Q-FEAS-03", "status": "PASS", "reason": "모든 oracle이 in-memory client/server 또는 문자열 검사로 실행 가능, 라이브 Figma 불요. InMemoryTransport 페어 헬퍼 실재. 헬퍼 출처 명시는 suggestion(F-003)."},
    {"id": "Q-STYLE-01", "status": "PASS", "reason": "REQ description에 should/might/could 등 모호어 없음. Priority는 별도 meta line."},
    {"id": "Q-STYLE-02", "status": "PASS", "reason": "Priority는 Must/Should만 사용하고 EARS type과 별개 축으로 표기."},
    {"id": "Q-STYLE-03", "status": "PASS", "reason": "REQ/AC 문장 완결, acceptance는 bare Given/When/Then/And. step keyword 가리는 마크업 없음."},
    {"id": "Q-SEC-01", "status": "PASS", "reason": "untrusted 입력(description language 설정, figmaChannel 시크릿)의 경계·완화(VALID_LANGS allow-list, prompts 비노출) 명시. source clause를 지시가 아닌 evidence로만 취급."},
    {"id": "Q-SEC-02", "status": "PASS", "reason": "채널 시크릿 실제 값을 SPEC에 복사하지 않음(HC-3). 테스트는 런타임 생성 32-hex SECRET 변수로만 다루고 S6 negative assertion으로 prompts 페이로드 비노출 검증. credential/절대경로 노출 없음."},
    {"id": "Q-SEC-03", "status": "PASS", "reason": "신규 영구 로그/아티팩트 미생성. 기존 audit 경로 불변, prompts payload는 휘발성 응답."},
    {"id": "Q-COH-01", "status": "PASS", "reason": "하나의 cohesive story(서버가 워크플로우를 instructions+prompts 두 경로로 노출)로 수렴, 무관 concern 미혼입."},
    {"id": "Q-COH-02", "status": "PASS", "reason": "Outcome Lock 필수 후속(MCP-002 의존)은 Completion Debt로 남아 sync completion을 막음. Outcome Lock 밖 개선은 Evolution Ideas로만 분리."},
    {"id": "Q-COH-03", "status": "PASS", "reason": "## Sibling SPEC Decision이 허용 사유(구현 레이어 상이: 런타임 TS vs 패키징 자산) 명시. sibling 2개 이내(MCP-001+MCP-002), 각자 독립 구현 가능 outcome slice와 acceptance 책임 보유. 재귀 sibling 없음."}
  ],
  "finding_statuses": [
    {"id": "F-001", "status": "open", "reason": "plan.md/research.md D2의 '315줄' 표기가 실측 314줄 및 research 정정 노트와 불일치."},
    {"id": "F-002", "status": "open", "reason": "REQ-09 Priority(Should)가 HC-2 hard constraint 및 Must 등급 S7 acceptance와 강도 불일치."},
    {"id": "F-003", "status": "open", "reason": "T5의 InMemoryTransport 헬퍼 출처(integration/__helpers vs 단위 테스트 직접 구성) 미명시."}
  ]
}
```


### Response 2

{"checklist":[{"id":"Q-CORR-01","reason":"FAIL: 기존 경로와 심볼 대부분은 실재하지만, 현재 저장소 기준 라인 수 단언이 틀립니다. `.claude/skills/autopus/figma-description.md`는 257 lines, `.agents/skills/figma-description/SKILL.md`는 204 lines, `src/daemon/mcp-stdio-handlers.ts`는 300 lines인데 SPEC/research/plan은 321/314/315를 반복합니다. 또한 `get_description_language`를 공통 workflow의 실제 노출 툴처럼 다루지만 HTTP 세션에는 해당 툴이 등록되지 않습니다.","status":"FAIL"},{"id":"Q-CORR-02","reason":"신규 파일 `figma-workflow-guidance.ts`, `mcp-stdio-prompt-handlers.ts`, `mcp-prompts-surface.test.ts`가 모두 `[NEW]`로 표시되어 planned addition과 기존 참조가 구분됩니다.","status":"PASS"},{"id":"Q-CORR-03","reason":"EARS 요구사항, Priority 분리, bare Given/When/Then acceptance 형식은 파서 친화적이며, 설치된 MCP SDK 1.29.0의 `ListPromptsRequestSchema`/`GetPromptRequestSchema` 및 prompt message shape와도 맞습니다.","status":"PASS"},{"id":"Q-CORR-04","reason":"기존 코드 경로와 planned addition 표기는 대체로 분리되어 있고, generated/plugin surface는 sibling SPEC으로 분리되어 있습니다. 라인 수 및 조건부 툴 참조 문제는 Q-CORR-01/F-001/F-003에서 별도 지적합니다.","status":"PASS"},{"id":"Q-COMP-01","reason":"`spec.md`, `plan.md`, `acceptance.md`, `research.md`가 목적, 구현 태스크, 검증 oracle, 근거를 각각 갖고 상호 보완합니다.","status":"PASS"},{"id":"Q-COMP-02","reason":"FAIL: REQ-06의 'actual tool names'와 T1/T4가 충돌합니다. T1은 `get_description_language`를 공통 workflow text에 포함하라고 하지만 T4의 HTTP 경로는 getter가 없어 해당 툴이 노출되지 않습니다. acceptance도 이 불일치를 잡지 못합니다.","status":"FAIL"},{"id":"Q-COMP-03","reason":"각 REQ는 EARS type, trigger, 기대 결과를 갖고 있으며 관측 지점은 instructions 문자열 또는 prompts/list|get payload로 명확합니다.","status":"PASS"},{"id":"Q-COMP-04","reason":"Outcome Lock은 서버측 instructions+prompts slice와 Claude Code plugin slice를 분리하고, sibling SPEC-MCP-002가 닫아야 할 completion debt를 명시합니다.","status":"PASS"},{"id":"Q-COMP-05","reason":"FAIL: Semantic invariant 중 'actual exposed tool names' 및 language getter 조건부 동작이 getter-absent HTTP/registerPromptHandlers({}) 경로의 oracle로 검증되지 않습니다. 이 때문에 존재하지 않는 `get_description_language` 안내가 HTTP prompt에 포함되어도 S1~S7이 통과할 수 있습니다.","status":"FAIL"},{"id":"Q-COMP-06","reason":"`spec.md`의 Traceability Matrix와 `research.md`의 Reviewer Brief/Semantic Invariant Inventory가 review scope와 주요 검증 초점을 제공합니다.","status":"PASS"},{"id":"Q-COMP-07","reason":"`Completion Debt`와 `Evolution Ideas`가 분리되어 있으며, 필수 sibling 의존성과 선택 개선이 혼동되지 않습니다.","status":"PASS"},{"id":"Q-FEAS-01","reason":"런타임 TypeScript 변경과 vitest 테스트로 구현 레이어가 실제 소유 모듈(`src/daemon/*`, `tests/unit/*`)에 맞습니다.","status":"PASS"},{"id":"Q-FEAS-02","reason":"변경 대상 경로가 현재 저장소 구조에 존재하거나 `[NEW]`로 표시되어 있고, MCP 서버 runtime과 테스트 경계에 맞습니다.","status":"PASS"},{"id":"Q-FEAS-03","reason":"검증은 in-memory client/server 또는 생성 문자열 검사로 수행 가능하며 라이브 Figma 연결이 필요 없습니다. 누락된 oracle은 completeness 문제이지 실행 불가능성은 아닙니다.","status":"PASS"},{"id":"Q-STYLE-01","reason":"REQ 본문은 모호어를 남발하지 않고 SHALL 중심으로 단정되어 있습니다. `Should`는 Priority meta line으로만 사용됩니다.","status":"PASS"},{"id":"Q-STYLE-02","reason":"Priority는 Must/Should 축으로, EARS Type은 Ubiquitous/Event-driven 축으로 분리되어 있습니다.","status":"PASS"},{"id":"Q-STYLE-03","reason":"acceptance step은 bare Given/When/Then/And 형식을 유지하고 문장도 읽을 수 있는 수준으로 완결되어 있습니다.","status":"PASS"},{"id":"Q-SEC-01","reason":"language 설정과 figmaChannel secret을 untrusted/sensitive 입력으로 분류하고 allow-list 및 prompts 비노출 경계를 명시합니다.","status":"PASS"},{"id":"Q-SEC-02","reason":"실제 secret 값을 SPEC에 복사하지 않고, prompts payload에서 secret substring 부재를 negative assertion으로 검증하도록 되어 있습니다.","status":"PASS"},{"id":"Q-SEC-03","reason":"새 영구 로그나 retained artifact를 요구하지 않으며, 기존 audit 경로와 prompts의 휘발성 응답 특성을 구분합니다.","status":"PASS"},{"id":"Q-COH-01","reason":"SPEC은 MCP server가 frame-description workflow를 instructions와 prompts로 노출하는 하나의 cohesive change story로 수렴합니다.","status":"PASS"},{"id":"Q-COH-02","reason":"Outcome Lock에 필요한 서버측 작업은 이 SPEC에 포함되고, Claude Code plugin 자동 트리거는 Completion Debt 및 sibling SPEC으로 명시되어 숨겨지지 않습니다.","status":"PASS"},{"id":"Q-COH-03","reason":"Sibling SPEC-MCP-002의 예외 사유, 의존 순서, 독립 outcome slice가 명확하며 recursive sibling으로 확장되지 않습니다.","status":"PASS"}],"finding_statuses":[{"id":"F-001","reason":"HTTP 세션에는 live descriptionLanguage getter가 없어 `get_description_language` tool이 등록되지 않는데, T1은 이를 공통 workflow text에 포함하라고 지시합니다.","status":"open"},{"id":"F-002","reason":"getter가 없는 HTTP/prompts 또는 `registerPromptHandlers(server, {})` 경로에서 language line 및 `get_description_language` 언급이 생략되는지 확인하는 oracle이 없습니다.","status":"open"},{"id":"F-003","reason":"현재 저장소 기준 라인 수와 SPEC/research/self-verify의 라인 수 단언이 다릅니다.","status":"open"},{"id":"F-004","reason":"prompt payload 검증 setup이 production-like write surface를 wire해야 한다는 점이 T5에 명시되지 않았습니다.","status":"open"}],"findings":[{"category":"correctness","description":"T1은 `FRAME_DESCRIPTION_WORKFLOW`가 `get_description_language`를 실제 툴 이름으로 포함하도록 지시하지만, T4는 HTTP 세션에 live language getter가 없어서 language line을 생략한다고 합니다. 현재 `createHttpSession`은 `registerToolHandlers(server, { writeToolContext })`만 호출하므로 `get_description_language` tool이 등록되지 않습니다. 이대로 구현하면 HTTP instructions/prompts가 존재하지 않는 tool을 안내할 수 있어 REQ-03/REQ-06의 'actual exposed tool names'와 충돌합니다.","location":".autopus/specs/SPEC-MCP-001/plan.md:T1; .autopus/specs/SPEC-MCP-001/plan.md:T4; src/daemon/mcp-http-session-manager.ts:createHttpSession","scope_ref":"F-001","severity":"major","suggestion":"`FRAME_DESCRIPTION_WORKFLOW`는 core workflow tool만 다루고 `get_description_language`는 `renderWorkflowInstructions({ descriptionLanguage })` 또는 prompt handler의 getter-present branch에서만 추가하도록 T1을 정정하세요. HTTP getter 없음 경로에서는 language line과 `get_description_language` 언급이 모두 빠진다고 명시하세요."},{"category":"completeness","description":"Acceptance는 getter가 있는 stdio prompt의 live language 반영(S5)은 검증하지만, getter가 없는 HTTP prompts/get 또는 `registerPromptHandlers(server, {})` 경로에서 language 안내와 `get_description_language` 언급이 생략되는지는 검증하지 않습니다. 이 누락 때문에 F-001처럼 공통 상수에 조건부 tool이 들어가도 S1~S7이 통과할 수 있습니다.","location":".autopus/specs/SPEC-MCP-001/acceptance.md:S2-S5","scope_ref":"F-002","severity":"major","suggestion":"S2 또는 별도 scenario에 HTTP/getter-absent prompt text 검사를 추가해 `get_description_language`와 active language line이 나타나지 않음을 확인하세요. 동시에 getter-present stdio path는 S5처럼 live value를 포함하도록 유지하면 HC-4가 양쪽에서 닫힙니다."},{"category":"correctness","description":"라인 수 참조가 현재 저장소와 다릅니다. 직접 확인한 현재 값은 `.claude/skills/autopus/figma-description.md` 257 lines, `.agents/skills/figma-description/SKILL.md` 204 lines, `src/daemon/mcp-stdio-handlers.ts` 300 lines입니다. SPEC/research/plan은 321/314/315를 반복하고, research.md는 '257/300 표기가 부정확'하다고 되어 있어 실제와 반대입니다.","location":".autopus/specs/SPEC-MCP-001/spec.md:workflow source of truth; .autopus/specs/SPEC-MCP-001/research.md:Reviewer Brief; .autopus/specs/SPEC-MCP-001/plan.md:HC-1","scope_ref":"F-003","severity":"minor","suggestion":"정확한 라인 수가 꼭 필요하지 않으면 제거하고, 필요하다면 현재 저장소 기준으로 갱신하세요. HC-1의 핵심은 `mcp-stdio-handlers.ts`가 이미 300줄 한계에 있어 새 prompt handler를 별도 파일로 둔다는 점으로 표현하면 충분합니다."},{"category":"completeness","description":"T5가 '기존 tool-surface 테스트의 in-memory pattern'을 mirror한다고만 되어 있어, executor가 기존처럼 `createMcpStdioServer({ mcp, registry, auditWriter })`만 사용하면 write tools가 없는 server에서 dryRun/approve/apply workflow prompt를 검증할 수 있습니다. production stdio/http entry는 writeExtension을 wire하지만, prompts test의 setup이 이를 명시하지 않아 실제 workflow 가능성과 prompt text의 정합성을 놓칠 수 있습니다.","location":".autopus/specs/SPEC-MCP-001/plan.md:T5; tests/unit/daemon-mcp-stdio-tool-surface.test.ts:beforeEach","scope_ref":"F-004","severity":"suggestion","suggestion":"T5 setup에 `DaemonWriteExtension`과 `writeResources`를 wire한 production-like server를 사용한다고 명시하세요. baseline invariance 비교가 필요하면 별도 raw Server/helper로 read-only baseline을 구성하되, prompt payload 검증은 write tools가 실제 listTools에 존재하는 server에서 수행하는 편이 안전합니다."}],"summary":"VERDICT: REVISE. 핵심 방향은 타당하지만, 공통 workflow guidance가 HTTP에서 노출되지 않는 `get_description_language` tool을 안내할 수 있는 요구/계획 충돌이 있고 이를 막는 acceptance oracle이 없습니다. 라인 수 self-verify도 현재 저장소와 맞지 않습니다.","verdict":"REVISE"}

