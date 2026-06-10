# Review: SPEC-MCP-002

**Verdict**: PASS (degraded — 1/2 providers responded)
**Revision**: 1
**Date**: 2026-06-10 17:42:37

## Provider Health

| Provider | Status | Note |
| --- | --- | --- |
| claude | success | - |
| codex | timeout | timeout |

## Checklist Summary

| ID | Status | Provider | Reason |
| --- | --- | --- | --- |
| Q-CORR-01 | PASS | claude | figma-description.md(321줄/24681B), .agents 사본(21727B), marketplace.json shape, auto 플러그인 구조(.codex-plugin/plugin.json + skills/auto/SKILL.md), package.json bin(autopus-mcp-stdio→mcp-stdio-entry.js), f… |
| Q-CORR-02 | PASS | claude | 신규 산출물(.claude-plugin/plugin.json, skills/figma-description/SKILL.md, README.md, optional .codex-plugin/plugin.json)은 모두 [NEW] 표기되고, 변경 대상 marketplace.json만 실재 파일로 다룬다. |
| Q-CORR-03 | PASS | claude | acceptance는 bare Given/When/Then/And, REQ는 EARS+별도 Priority meta line. plugin.json/marketplace 필드 인용이 기존 파일·공식 규격과 일치. userConfig 치환 토큰 정확 형식은 minor 권고로 분리(블로킹 아님). |
| Q-CORR-04 | PASS | claude | 기존 path/symbol은 검증, 신규는 [NEW]로 표시. .claude-plugin(Claude Code 정본)과 auto의 .codex-plugin(Codex 형식)을 명확히 구분하고 generated dist vs source를 혼동하지 않음. |
| Q-COMP-01 | PASS | claude | spec/plan/acceptance/research 4파일이 목적·태스크·oracle·근거로 상호 보완하며 빈 문서 없음. |
| Q-COMP-02 | PASS | claude | Traceability Matrix가 REQ-01..09 ↔ T1..T6 ↔ S1..S7 양방향 매핑, 누락 REQ 없음. |
| Q-COMP-03 | PASS | claude | 각 REQ가 EARS type/조건/기대결과 명시. 관측 지점은 파싱된 manifest 필드/validate 출력/grep 결과(S1~S7). |
| Q-COMP-04 | PASS | claude | Outcome Lock이 Claude Code one-install+스킬 자동 트리거 slice를 고정하고 S1~S6 Must로 닫음. 서버 instructions/prompts와 Desktop/Cursor는 SPEC-MCP-001 의존으로 Completion Debt에 명시, 스캐폴드만으로 완성을 위장하지 않음. |
| Q-COMP-05 | PASS | claude | Semantic Invariant Inventory의 INV-001..008이 각각 REQ-ID+T-ID+Must oracle(S-ID)로 매핑. 패키징 SPEC에 맞는 concrete oracle(name='autopus-figma', sensitive=true, source.path, grep figd_ 부재)로 검증되어 구조-only 체크가 아님. |
| Q-COMP-06 | PASS | claude | spec.md에 Traceability Matrix, research.md에 Reviewer Brief(3개 focus + non-goals + 오판 정정 기록) 존재하여 review scope가 제약됨. |
| Q-COMP-07 | PASS | claude | Completion Debt(MCP-001 의존+번들 스킬 동기화)와 Evolution Ideas(codex parity, 원격 marketplace, 자동 동기화 빌드)가 분리됨. 선택 개선에 SPEC/acceptance ID를 자동 부여하지 않음. |
| Q-FEAS-01 | PASS | claude | 패키징(JSON/MD) 레이어로 정확히 분류, 신규 .ts 없음(HC-4). 서버 런타임 변경은 SPEC-MCP-001 소유로 분리. |
| Q-FEAS-02 | PASS | claude | 편집 대상(.autopus/plugins/autopus-figma/*, .agents/plugins/marketplace.json)이 실제 repo 구조와 일치. .claude-plugin manifest 위치가 Claude Code 규격과 일치. |
| Q-FEAS-03 | PASS | claude | claude plugin validate + JSON 파싱 + grep로 검증 가능하며 markdown/JSON-only 변경에 비례. 설치 후 상대경로 해석은 minor 권고로 분리. |
| Q-STYLE-01 | PASS | claude | REQ description에 should/might/could 등 모호어 없음, Priority는 별도 meta line. |
| Q-STYLE-02 | PASS | claude | Priority는 Must/Should만 사용하고 EARS type과 별개 축으로 유지. |
| Q-STYLE-03 | PASS | claude | 문장 완결, acceptance는 bare Given/When/Then/And, step keyword를 가리는 마크업 없음. |
| Q-SEC-01 | PASS | claude | FIGMA_TOKEN(자격증명)·채널 시크릿(세션) untrusted/sensitive 경계와 완화(userConfig sensitive, 런타임 생성 시크릿, 패키지 비포함, per-server approval) 명시. source clause를 evidence로만 인용. |
| Q-SEC-02 | PASS | claude | 토큰/채널 시크릿 리터럴을 패키지·SPEC에 복사하지 않음(HC-1). README는 placeholder만, S6 grep negative assertion. 절대경로는 ${CLAUDE_PLUGIN_ROOT}/설치경로로 처리해 privileged path 노출 회피. |
| Q-SEC-03 | PASS | claude | 새 영구 로그/아티팩트를 만들지 않음. 패키지 파일은 정적 config/docs, 서버 audit 경로 불변(MCP-001/기존 소유). |
| Q-COH-01 | PASS | claude | 하나의 cohesive story(Claude Code 플러그인 패키징: manifest+skill+marketplace 등록)로 수렴, 무관 concern 미혼입. |
| Q-COH-02 | PASS | claude | Outcome Lock에 필요한 서버측 작업은 Completion Debt(MCP-001 의존)로 남아 sync completion을 막고, Outcome Lock 밖 개선은 Evolution Ideas로만 남음. hand-wave 없음. |
| Q-COH-03 | PASS | claude | Sibling SPEC Decision이 분해 사유(구현 레이어 상이)를 명시하고 sibling은 정확히 2개(MCP-001+MCP-002), 각자 독립 구현 가능한 outcome slice와 acceptance 책임 보유. 재귀 sibling 없음. |

Total: 23 (PASS: 23, FAIL: 0, N/A: 0)

## Findings

| Provider | Severity | Description |
|----------|----------|-------------|
| claude | minor | T1의 예시 mcpServers args가 `${CLAUDE_PLUGIN_ROOT}/../../../dist/src/daemon/mcp-stdio-entry.js` 상대경로를 제시한다. 로컬 marketplace 설치 시 Claude Code가 플러그인 디렉토리를 관리 위치로 복사/심링크하면 `../../../dist`가 더 이상 레포 dist를 가리키지 못해 stdio 진입점 기동이 깨질 수 있다. plan/research가 '글로벌 bin이 가장 견고한 기본값'이라고 인지하고 있으나 T1의 기본 예시는 여전히 상대경로다. |
| claude | minor | S5가 `${user_config.figma_token}`를 Claude Code의 '공식 변수 형식'으로 단정하고 acceptance 통과 조건으로 고정한다. 이 정확한 치환 토큰 문법(접두/네임스페이스 형태)은 환경/버전에 따라 어긋날 수 있으며, 어긋나면 mcpServers env 치환이 실패해 FIGMA_TOKEN이 주입되지 않는다(Q-CORR-03 위험). |
| claude | suggestion | 번들 SKILL.md는 정본의 복사본이며 정본 갱신 시 drift 위험이 있다. 동기화 메커니즘(빌드 시 복사 vs 수동)이 T2 구현 결정으로 미뤄져 있다. |

## Provider Responses

### Response 1

All key existing references verified against the actual repo:
- `.claude/skills/autopus/figma-description.md` — 321 lines / 24681 bytes ✓ (SPEC's 322→321 correction confirmed)
- `.agents/skills/figma-description/SKILL.md` — 21727 bytes ✓
- `.agents/plugins/marketplace.json` — exact `source:{source:"local",path}` shape, single `auto` entry ✓
- `.autopus/plugins/auto/.codex-plugin/plugin.json` + `skills/auto/SKILL.md` ✓
- `package.json` bin `autopus-mcp-stdio → ./dist/src/daemon/mcp-stdio-entry.js` ✓
- Frontmatter `name: figma-description` + triggers (figma/피그마/디스크립션/화면 정의/번호 뱃지) ✓

```json
{
  "verdict": "PASS",
  "summary": "패키징 전용 brownfield SPEC으로 모든 기존 참조(figma-description.md 321줄/24681B, .agents 사본 21727B, marketplace.json source-object shape, auto 플러그인 구조, package.json bin, frontmatter triggers)가 실제 레포에서 직접 확인됨. 신규 항목은 모두 [NEW] 표기, REQ↔Task↔Scenario 추적성 완비, Outcome Lock/Completion Debt/Evolution Ideas/Reviewer Brief 분리, sibling 2개 한도 준수, 시크릿 비포함(HC-1) 및 sensitive userConfig 경계가 negative-assertion oracle(S6)로 강제됨. critical=0, security=0. 구현 시 확인해야 할 minor feasibility/correctness 항목 2건(설치 후 상대경로 해석, userConfig 치환 토큰 정확 형식)이 있으나 PASS를 막지 않음.",
  "findings": [
    {
      "severity": "minor",
      "category": "feasibility",
      "scope_ref": "REQ-07",
      "location": "plan.md T1 / acceptance.md S1",
      "description": "T1의 예시 mcpServers args가 `${CLAUDE_PLUGIN_ROOT}/../../../dist/src/daemon/mcp-stdio-entry.js` 상대경로를 제시한다. 로컬 marketplace 설치 시 Claude Code가 플러그인 디렉토리를 관리 위치로 복사/심링크하면 `../../../dist`가 더 이상 레포 dist를 가리키지 못해 stdio 진입점 기동이 깨질 수 있다. plan/research가 '글로벌 bin이 가장 견고한 기본값'이라고 인지하고 있으나 T1의 기본 예시는 여전히 상대경로다.",
      "suggestion": "T1에서 견고한 기본값(글로벌 설치 bin `autopus-mcp-stdio` 절대경로 또는 npx 호출)을 명시하고, S1 acceptance가 단순히 `${CLAUDE_PLUGIN_ROOT}|절대경로` 허용을 넘어 '설치 후 위치 비의존'을 만족하는 선택된 기본값을 검증하도록 좁힌다."
    },
    {
      "severity": "minor",
      "category": "correctness",
      "scope_ref": "REQ-06",
      "location": "acceptance.md S5 / research.md D3",
      "description": "S5가 `${user_config.figma_token}`를 Claude Code의 '공식 변수 형식'으로 단정하고 acceptance 통과 조건으로 고정한다. 이 정확한 치환 토큰 문법(접두/네임스페이스 형태)은 환경/버전에 따라 어긋날 수 있으며, 어긋나면 mcpServers env 치환이 실패해 FIGMA_TOKEN이 주입되지 않는다(Q-CORR-03 위험).",
      "suggestion": "T1 구현 직전 plugins-reference의 userConfig env 치환 문법을 재확인하고, 실제 공식 토큰 형식으로 S5를 확정한다. 형식이 다르면 spec/plan/acceptance를 함께 갱신한다."
    },
    {
      "severity": "suggestion",
      "category": "completeness",
      "scope_ref": "HC-2",
      "location": "research.md Completion Debt / plan.md T2",
      "description": "번들 SKILL.md는 정본의 복사본이며 정본 갱신 시 drift 위험이 있다. 동기화 메커니즘(빌드 시 복사 vs 수동)이 T2 구현 결정으로 미뤄져 있다.",
      "suggestion": "T2에서 동기화 방식을 명시적으로 선택하고 README에 기록한다. 가능하면 build 스텝 자동 복사로 수동 drift를 제거하면 HC-2 보장이 강해진다."
    }
  ],
  "checklist": [
    {"id": "Q-CORR-01", "status": "PASS", "reason": "figma-description.md(321줄/24681B), .agents 사본(21727B), marketplace.json shape, auto 플러그인 구조(.codex-plugin/plugin.json + skills/auto/SKILL.md), package.json bin(autopus-mcp-stdio→mcp-stdio-entry.js), frontmatter triggers를 모두 레포에서 직접 확인."},
    {"id": "Q-CORR-02", "status": "PASS", "reason": "신규 산출물(.claude-plugin/plugin.json, skills/figma-description/SKILL.md, README.md, optional .codex-plugin/plugin.json)은 모두 [NEW] 표기되고, 변경 대상 marketplace.json만 실재 파일로 다룬다."},
    {"id": "Q-CORR-03", "status": "PASS", "reason": "acceptance는 bare Given/When/Then/And, REQ는 EARS+별도 Priority meta line. plugin.json/marketplace 필드 인용이 기존 파일·공식 규격과 일치. userConfig 치환 토큰 정확 형식은 minor 권고로 분리(블로킹 아님)."},
    {"id": "Q-CORR-04", "status": "PASS", "reason": "기존 path/symbol은 검증, 신규는 [NEW]로 표시. .claude-plugin(Claude Code 정본)과 auto의 .codex-plugin(Codex 형식)을 명확히 구분하고 generated dist vs source를 혼동하지 않음."},
    {"id": "Q-COMP-01", "status": "PASS", "reason": "spec/plan/acceptance/research 4파일이 목적·태스크·oracle·근거로 상호 보완하며 빈 문서 없음."},
    {"id": "Q-COMP-02", "status": "PASS", "reason": "Traceability Matrix가 REQ-01..09 ↔ T1..T6 ↔ S1..S7 양방향 매핑, 누락 REQ 없음."},
    {"id": "Q-COMP-03", "status": "PASS", "reason": "각 REQ가 EARS type/조건/기대결과 명시. 관측 지점은 파싱된 manifest 필드/validate 출력/grep 결과(S1~S7)."},
    {"id": "Q-COMP-04", "status": "PASS", "reason": "Outcome Lock이 Claude Code one-install+스킬 자동 트리거 slice를 고정하고 S1~S6 Must로 닫음. 서버 instructions/prompts와 Desktop/Cursor는 SPEC-MCP-001 의존으로 Completion Debt에 명시, 스캐폴드만으로 완성을 위장하지 않음."},
    {"id": "Q-COMP-05", "status": "PASS", "reason": "Semantic Invariant Inventory의 INV-001..008이 각각 REQ-ID+T-ID+Must oracle(S-ID)로 매핑. 패키징 SPEC에 맞는 concrete oracle(name='autopus-figma', sensitive=true, source.path, grep figd_ 부재)로 검증되어 구조-only 체크가 아님."},
    {"id": "Q-COMP-06", "status": "PASS", "reason": "spec.md에 Traceability Matrix, research.md에 Reviewer Brief(3개 focus + non-goals + 오판 정정 기록) 존재하여 review scope가 제약됨."},
    {"id": "Q-COMP-07", "status": "PASS", "reason": "Completion Debt(MCP-001 의존+번들 스킬 동기화)와 Evolution Ideas(codex parity, 원격 marketplace, 자동 동기화 빌드)가 분리됨. 선택 개선에 SPEC/acceptance ID를 자동 부여하지 않음."},
    {"id": "Q-FEAS-01", "status": "PASS", "reason": "패키징(JSON/MD) 레이어로 정확히 분류, 신규 .ts 없음(HC-4). 서버 런타임 변경은 SPEC-MCP-001 소유로 분리."},
    {"id": "Q-FEAS-02", "status": "PASS", "reason": "편집 대상(.autopus/plugins/autopus-figma/*, .agents/plugins/marketplace.json)이 실제 repo 구조와 일치. .claude-plugin manifest 위치가 Claude Code 규격과 일치."},
    {"id": "Q-FEAS-03", "status": "PASS", "reason": "claude plugin validate + JSON 파싱 + grep로 검증 가능하며 markdown/JSON-only 변경에 비례. 설치 후 상대경로 해석은 minor 권고로 분리."},
    {"id": "Q-STYLE-01", "status": "PASS", "reason": "REQ description에 should/might/could 등 모호어 없음, Priority는 별도 meta line."},
    {"id": "Q-STYLE-02", "status": "PASS", "reason": "Priority는 Must/Should만 사용하고 EARS type과 별개 축으로 유지."},
    {"id": "Q-STYLE-03", "status": "PASS", "reason": "문장 완결, acceptance는 bare Given/When/Then/And, step keyword를 가리는 마크업 없음."},
    {"id": "Q-SEC-01", "status": "PASS", "reason": "FIGMA_TOKEN(자격증명)·채널 시크릿(세션) untrusted/sensitive 경계와 완화(userConfig sensitive, 런타임 생성 시크릿, 패키지 비포함, per-server approval) 명시. source clause를 evidence로만 인용."},
    {"id": "Q-SEC-02", "status": "PASS", "reason": "토큰/채널 시크릿 리터럴을 패키지·SPEC에 복사하지 않음(HC-1). README는 placeholder만, S6 grep negative assertion. 절대경로는 ${CLAUDE_PLUGIN_ROOT}/설치경로로 처리해 privileged path 노출 회피."},
    {"id": "Q-SEC-03", "status": "PASS", "reason": "새 영구 로그/아티팩트를 만들지 않음. 패키지 파일은 정적 config/docs, 서버 audit 경로 불변(MCP-001/기존 소유)."},
    {"id": "Q-COH-01", "status": "PASS", "reason": "하나의 cohesive story(Claude Code 플러그인 패키징: manifest+skill+marketplace 등록)로 수렴, 무관 concern 미혼입."},
    {"id": "Q-COH-02", "status": "PASS", "reason": "Outcome Lock에 필요한 서버측 작업은 Completion Debt(MCP-001 의존)로 남아 sync completion을 막고, Outcome Lock 밖 개선은 Evolution Ideas로만 남음. hand-wave 없음."},
    {"id": "Q-COH-03", "status": "PASS", "reason": "Sibling SPEC Decision이 분해 사유(구현 레이어 상이)를 명시하고 sibling은 정확히 2개(MCP-001+MCP-002), 각자 독립 구현 가능한 outcome slice와 acceptance 책임 보유. 재귀 sibling 없음."}
  ],
  "finding_statuses": [
    {"id": "F-01-relative-path-default", "status": "open", "reason": "T1 예시 상대경로가 설치 후 dist 위치와 어긋날 수 있어 견고한 기본값 명시 필요."},
    {"id": "F-02-userconfig-substitution-syntax", "status": "open", "reason": "${user_config.figma_token} 공식 치환 문법을 구현 직전 재확인 필요."},
    {"id": "F-03-skill-sync-mechanism", "status": "open", "reason": "정본→번들 SKILL.md 동기화 방식이 T2 결정으로 미정(suggestion)."}
  ]
}
```


