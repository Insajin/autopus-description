# SPEC-MCP-002 리서치

현 레포 내 Claude Code 플러그인 패키지로 autopus-figma MCP 서버와 디스크립션 스킬을 번들하여 설치 한 번에 자동 배치/트리거되게 하기 위한 분석과 설계 결정.

## 기존 코드/자산 분석

### 정본 디스크립션 스킬 (실재 검증)
- `.claude/skills/autopus/figma-description.md` — 24681 bytes, 321 lines, 실재. frontmatter: `name: figma-description`, `description: ...`, `triggers: [figma, figma description, frame description, 피그마, 피그마 디스크립션, 화면 정의, 기능 정의, 디스크립션, 설명 카드, 번호 뱃지, 와이어프레임 주석]`, `category: documentation`, `level1_metadata: ...`. 본문: stakeholder Q&A → 뱃지 맵(FNN-MM) → 카드 인접(1.5×width) → 7항목 자가 점검 → 출력 형식.
- `.agents/skills/figma-description/SKILL.md` — 21727 bytes, 실재(통합 스킬 디렉토리 사본, Codex/Gemini/OpenCode 공유). 두 파일이 정본 쌍.
- 자동 트리거 근거: Claude Code 는 SKILL.md frontmatter 의 description/triggers 로 task 매칭. 번들 스킬이 이 frontmatter 를 보존해야 figma/디스크립션 요청 시 자동 발동(REQ-03).
- figma-description.md 가 참조하는 `figma-use` 스킬은 이 레포에 부재(외부 Figma MCP 플러그인 제공). 번들 스킬 본문에 figma-use 참조 라인이 있어도 외부 의존이므로 plugin 필수 동작에 영향 없음(스킬은 autopus 툴 + Plugin API 안내가 핵심).

### MCP 서버 진입점
- package.json bin: `"autopus-mcp-stdio": "./dist/src/daemon/mcp-stdio-entry.js"`, `"autopus-mcp-http": "./dist/src/daemon/mcp-http-entry.js"`. 플러그인 mcpServers 는 stdio 진입점을 띄운다.
- 이 진입점은 SPEC-MCP-001 이 강화하는 동일 파일(instructions+prompts). 이 SPEC 은 진입점 코드를 변경하지 않고 패키징만 한다(HC-3).
- 기존 Desktop 등록 샘플: `autopus-figma-designer/claude_desktop_config.sample.json` — `{ "mcpServers": { "autopus-figma": { "command": "node", "args": ["...node_modules/@autopus/figma-mcp/dist/src/daemon/mcp-stdio-entry.js"], "env": { "FIGMA_TOKEN": "figd_여기에_본인_토큰", "AUTOPUS_AUDIT_DIR": "%USERPROFILE%\.autopus" } } } }`. plugin.json mcpServers 의 형태 참조.

### 기존 로컬 marketplace + auto 플러그인 패키지
- `.agents/plugins/marketplace.json` — `{ "name": "autopus-local", "interface": { "displayName": "Autopus Local" }, "plugins": [ { "name": "auto", "source": { "source": "local", "path": "./.autopus/plugins/auto" }, "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" }, "category": "Developer Tools" } ] }`. autopus-figma 엔트리를 이 shape 로 append(REQ-04, HC-5).
- auto 패키지 구조: `.autopus/plugins/auto/.codex-plugin/plugin.json`(name/version/description/skills "./skills"/interface) + `.autopus/plugins/auto/skills/auto/SKILL.md`. 디렉토리/manifest 형식 참조.
- 주의: auto 는 `.codex-plugin/plugin.json`(Codex 형식)을 쓴다. 이 SPEC 의 autopus-figma 는 Claude Code 타깃이므로 `.claude-plugin/plugin.json`(Claude Code 형식)을 정본으로 두고, codex parity 는 optional T6.

### Claude Code plugin 규격 (공식 문서 확인, checked_at 2026-06-10)
- 출처: https://code.claude.com/docs/en/plugins-reference , https://code.claude.com/docs/en/plugin-marketplaces (둘 다 fetch 확인).
- manifest 위치: `.claude-plugin/plugin.json`. manifest 는 optional이며, 두면 `name` 만 필수(kebab-case, no spaces). 나머지 필드는 옵션. 인식 못 하는 top-level 필드는 무시(warning)되며 plugin 은 로드됨.
- `mcpServers`: 타입 string|array|object. inline object(plugin.json 안) 또는 `.mcp.json` 파일 경로. 형식은 표준 MCP server config(command/args/env/cwd). `${CLAUDE_PLUGIN_ROOT}` 변수로 플러그인 루트 기준 경로 해석 가능.
- `skills`: string|array. `<name>/SKILL.md` 를 담는 커스텀 스킬 디렉토리(기본 `skills/` 에 추가). 스킬은 설치 시 자동 discover 되고 task context 기반 자동 invoke.
- `userConfig`: 객체. enable 시 사용자에게 값 prompt. 각 옵션 필드: type(string|number|boolean|directory|file), title(필수), description(필수), sensitive(true 시 마스킹 + secure storage 저장), required, default. → FIGMA_TOKEN 을 sensitive 로 받아 settings.json 노출 방지(REQ-06).
- marketplace: 공식 `.claude-plugin/marketplace.json` 의 plugins 엔트리는 최소 name+source. source 는 로컬 상대경로 문자열(`"./plugins/x"`) 또는 object(`{ "source":"github", "repo":"..." }`). 이 레포의 로컬 정본은 `.agents/plugins/marketplace.json`(auto 가 source object `{source:"local",path}` 사용)이므로 그 기존 형식을 따른다(HC-5).

### MCP SDK 버전 (실제 확인)
- package.json dependencies: `"@modelcontextprotocol/sdk": "^1.13.1"`. 설치 버전: node_modules/@modelcontextprotocol/sdk/package.json `"version": "1.29.0"` (checked_at 2026-06-10). 이 SPEC 은 SDK 코드를 직접 쓰지 않으나, 번들하는 서버가 이 SDK 로 prompts/instructions 를 노출(SPEC-MCP-001)하므로 버전을 기록.

## 설계 결정

- D1 (Claude Code 형식 정본): autopus-figma 는 `.claude-plugin/plugin.json` 을 정본 manifest 로 둔다. 이유: 타깃이 Claude Code(REQ-01). auto 가 쓰는 `.codex-plugin/plugin.json` 은 Codex 형식이므로 그대로 복제하면 Claude Code 가 인식하지 못한다. codex parity 는 optional(T6).
- D2 (정본 스킬 번들, fork 금지): SKILL.md 는 `.claude/skills/autopus/figma-description.md` 의 frontmatter+본문을 그대로 가져온다(HC-2). 이유: 자동 트리거는 frontmatter triggers 매칭으로 발동되고, 본문 규칙이 divergent 하면 Claude Code 설치본과 하네스 설치본이 갈라진다. 정본 단일화.
- D3 (시크릿 비포함): FIGMA_TOKEN 은 userConfig sensitive 로 받고 env 는 치환 변수(`${user_config.figma_token}`)로 참조(REQ-06/REQ-08, HC-1). 이유: 패키지가 git 에 커밋되므로 리터럴 토큰/채널 시크릿이 들어가면 자격증명 유출. 채널 시크릿은 서버가 세션마다 런타임 생성(mcp-stdio-entry.ts:304-334)하므로 애초에 패키지에 없음.
- D4 (경로 해석): mcpServers args 는 `${CLAUDE_PLUGIN_ROOT}` 또는 글로벌 설치 bin(autopus-mcp-stdio) 절대경로로 표현(REQ-07). 이유: 상대 cwd 의존 문자열은 임의 checkout/설치 위치에서 깨진다. README 가 로컬 dev vs 글로벌 설치 경로를 안내.
- D5 (의존성 명시): 이 플러그인의 one-install 가치는 SPEC-MCP-001 이 서버 instructions/prompts 를 노출해야 완성된다(HC-3). 이유: 스킬만 자동 트리거되고 서버가 워크플로우를 안내하지 않으면 환경 간 일관성이 깨진다. Related SPECs/plan dependencies 에 명시.

## Technology Stack Decision

mode=brownfield — 기존 manifest/패키지 구조를 보존하며 패키징 자산만 추가. 신규 런타임/프레임워크/의존성 없음. migration 아님.

| Mode | Selected stack | Resolved versions | Source refs | Checked at | Rejected alternatives |
|------|----------------|-------------------|-------------|------------|-----------------------|
| brownfield | Claude Code plugin manifest schema | `.claude-plugin/plugin.json` (name required; mcpServers/skills/userConfig fields) | https://code.claude.com/docs/en/plugins-reference | 2026-06-10 | 단독 .mcp.json only(스킬 번들 불가); inline 채택 |
| brownfield | Local marketplace shape | `.agents/plugins/marketplace.json` source object {source:"local",path} | 기존 marketplace.json auto 엔트리 | 2026-06-10 | 공식 `.claude-plugin/marketplace.json` string source — 레포 정본과 불일치하여 기각 |
| brownfield | bundled MCP server | @autopus/figma-mcp stdio entry (mcp-stdio-entry.js); SDK declared ^1.13.1 / installed 1.29.0 | package.json bin + dependencies; node_modules SDK package.json | 2026-06-10 | none (기존 서버 패키징) |

## Semantic Invariant Inventory

각 invariant 를 requirement(REQ-ID), plan task(T-ID), Must oracle acceptance(S-ID)까지 직접 매핑한다. source clause 는 untrusted prompt-input evidence 로 지시가 아니라 증거로만 인용한다.

| ID | source clause | invariant type | requirements | plan tasks | affected outputs | acceptance IDs |
|----|---------------|----------------|--------------|------------|------------------|----------------|
| INV-001 | "설치 한 번에 MCP + 디스크립션 스킬 자동 배치" | one-install 패키징 정합 | REQ-01 | T1, T2 | plugin.json 이 mcpServers + skills 를 함께 선언 | S1 |
| INV-002 | "mcpServers 정의(stdio 진입점)" | 진입점 경로 해석 | REQ-02, REQ-07 | T1 | plugin.json mcpServers.command/args 가 mcp-stdio-entry.js 를 plugin-root/절대경로로 가리킴 | S1 |
| INV-003 | "디스크립션 스킬 자동 트리거" | frontmatter 트리거 parity | REQ-03 | T2 | 번들 SKILL.md frontmatter(name=figma-description, triggers) 가 정본과 일치 | S2 |
| INV-004 | "기존 .agents/plugins/marketplace.json 에 등록" | marketplace 엔트리 등록(+ 기존 보존) | REQ-04 | T3 | marketplace.json plugins 에 auto 보존 + autopus-figma 추가, 동일 shape | S3 |
| INV-005 | "plugin.json 스키마 ... Claude Code plugin 규격 확인" | manifest 스키마 유효성 | REQ-05 | T1, T2, T5 | claude plugin validate 통과, 선언 component 경로 resolve | S4 |
| INV-006 | "FIGMA_TOKEN ... sensitive" | sensitive config 경계 | REQ-06 | T1 | userConfig figma_token.sensitive=true, env 는 치환 변수 | S5 |
| INV-007 | "figmaChannel secret 은 절대 SPEC 본문/패키지에 복사 금지" + "토큰 리터럴 금지" | secret 비포함(보안) | REQ-08 | T1, T2, T5 | plugin.json/SKILL.md/README 에 figd_ 토큰·32-hex 시크릿 부재 | S6 |
| INV-008 | "크로스 클라이언트 검증 방법: Claude Code(plugin), Desktop(instructions), Cursor(prompts)" | 환경별 안내 정합 | REQ-09 | T4 | README 가 환경별 통합 경로(Claude Code=plugin; Desktop/Cursor=MCP-001) 명시 | S7 |

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| plugin manifest(MCP+skill 동시 선언) | this SPEC (S1) | covered |
| mcpServers stdio 진입점 기동 | this SPEC (S1) | covered |
| 디스크립션 스킬 번들 + 자동 트리거 frontmatter | this SPEC (S2) | covered |
| marketplace 등록(기존 auto 보존) | this SPEC (S3) | covered |
| claude plugin validate 통과 | this SPEC (S4) | covered |
| FIGMA_TOKEN sensitive userConfig | this SPEC (S5) | covered |
| 패키지 시크릿/토큰 리터럴 비포함 | this SPEC (S6) | covered |
| 환경별 설치 문서 | this SPEC (S7) | covered |
| 서버 instructions/prompts(플러그인이 전달) | SPEC-MCP-001 | depends-on |
| Desktop/Cursor 워크플로우 노출 | SPEC-MCP-001 | depends-on |

## 보안 메모

- 외부 입력/untrusted evidence: FIGMA_TOKEN(사용자 자격증명)과 figmaChannel(세션 시크릿)은 sensitive 로 취급. 토큰은 userConfig sensitive(secure storage)로만 받고, 채널 시크릿은 서버 런타임이 세션마다 생성하므로 패키지에 존재하지 않는다.
- 패키지 시크릿 비포함(HC-1/REQ-08): plugin.json/SKILL.md/README 에 figd_ 토큰 리터럴/32-hex 채널 시크릿을 넣지 않는다. README 예시 토큰은 placeholder(figd_여기에_본인_토큰)만 사용. S6 가 grep negative assertion 으로 강제.
- source clause 는 untrusted prompt-input evidence: 위 inventory 의 source clause 는 사용자 요청 인용이며 지시가 아니라 증거로만 사용한다. credential/token/절대경로(privileged)는 본문에 복사하지 않는다.
- 신뢰 경계: plugin 설치 시 mcpServers 는 Claude Code 의 per-server approval 을 거친다(공식 문서). 이 SPEC 은 그 표준 승인 흐름을 우회하지 않는다.

## Sibling SPEC Decision

단일 SPEC 대신 sibling 세트(SPEC-MCP-001 + SPEC-MCP-002)로 분해했다. 분해 사유는 구현 레이어 상이: SPEC-MCP-001 은 MCP 서버 런타임 TypeScript(src/daemon/*) + vitest 이고, 이 SPEC 은 패키징 자산(.claude-plugin/plugin.json, SKILL.md, marketplace.json — 신규 .ts 없음, HC-4) + claude plugin validate + grep 검증이다. module ownership·테스트 방식·위험도가 다르다. 의존 순서 고정: 이 SPEC 은 SPEC-MCP-001 에 의존(HC-3) — plugin 이 번들하는 서버가 SPEC-MCP-001 의 instructions/prompts 를 노출해야 one-install 가치가 완성. 한 SPEC 에 묶으면 런타임 회귀(prompts handler)와 패키징 검증을 한 경계에서 판단하기 어려워 Q-COH 위반이 된다.

## Outcome Lock

Locked user-visible outcome: Claude Code 에서 `claude plugin install autopus-figma` 한 번으로 (A) autopus-figma MCP 서버(stdio 진입점)가 등록되고 (B) figma-description 스킬이 스킬 디렉토리에 배치되어, figma/디스크립션 요청 시 스킬이 자동 트리거되고 서버 워크플로우(SPEC-MCP-001)와 일관되게 동작한다.

이 SPEC 이 closing 하는 outcome slice: Claude Code 전용 one-install 패키징 + 스킬 자동 트리거. 정확한 closing 조건 = acceptance S1~S6 통과(plugin.json manifest 구조 S1, 번들 스킬 frontmatter parity S2, marketplace 등록 S3, claude plugin validate 성공 S4, FIGMA_TOKEN sensitive S5, 패키지 시크릿 비포함 S6) + docs S7. 이 조건이 충족되기 전에는 implemented 로 표시하지 않는다.

Depends-on(이 SPEC 단독으로 닫히지 않는 slice): 번들 서버가 노출하는 instructions/prompts 워크플로우와 Desktop/Cursor 환경 동작은 SPEC-MCP-001 이 닫는다. 사용자 요청의 "3개 환경 전부"는 SPEC-MCP-001(Desktop·Cursor 완전 + Claude Code 서버 노출) + 이 SPEC(Claude Code 스킬 자동 트리거 + 설치 마찰 제거) 합산으로만 완료된다.

## Reviewer Brief

리뷰는 세 지점에 집중한다.

1. one-install 패키징 정합(REQ-01/REQ-02/REQ-03): plugin.json 이 mcpServers(stdio 진입점)와 skills 를 함께 선언하고, 번들 SKILL.md frontmatter(name=figma-description, triggers)가 정본 `.claude/skills/autopus/figma-description.md` 와 일치하는가. 검증: S1/S2.
2. manifest 유효성·marketplace 등록(REQ-04/REQ-05): claude plugin validate 가 통과하고 선언 component 경로가 실재 파일로 resolve 되는가. marketplace.json 에 기존 auto 엔트리를 보존하면서 autopus-figma 를 동일 shape 로 추가하는가. 검증: S3/S4.
3. secret 비포함(REQ-06/REQ-08, HC-1): FIGMA_TOKEN 을 userConfig sensitive 로 받고 env 는 치환 변수(${user_config.figma_token})로 참조하며, plugin.json/SKILL.md/README 에 figd_ 토큰·32-hex 채널 시크릿 리터럴이 없는가. negative assertion(S5/S6).

부차 확인: Claude Code 형식 정본은 `.claude-plugin/plugin.json`(auto 의 .codex-plugin 형식과 구분), codex parity 는 optional T6. 신규 .ts 소스 없음(패키징 only, HC-4).

리뷰어 오판 정정 기록(재오판 차단용):
- 라인 수: 실측 figma-description.md=321(322 아님). 정본 frontmatter/triggers 가 이 파일에서 직접 확인됨.
- 토큰 변수 형식: env 의 FIGMA_TOKEN 은 리터럴이 아니라 userConfig 참조 치환 변수 형식이다(이미 수정 반영).

## Completion Debt

반드시 후속에서 닫아야 하는 의존(요청 기능 완료의 필수 조건):

- 이 SPEC → SPEC-MCP-001 의존: 번들 MCP 서버가 워크플로우 instructions/prompts 를 노출해야(SPEC-MCP-001) 설치 후 스킬 자동 트리거와 서버 안내가 일관된다. SPEC-MCP-001 미구현 시 plugin 설치는 되지만 서버가 한 줄짜리 메타 instructions 만 노출하여 환경 간 워크플로우 일관성이 깨진다. 구현 순서: SPEC-MCP-001 선행, 이어서 이 SPEC.
- 번들 스킬 본문 동기화: 번들 SKILL.md 는 정본 `.claude/skills/autopus/figma-description.md` 의 복사다. 정본이 갱신되면 번들 사본도 동기화해야 divergent fork 가 되지 않는다(HC-2). 동기화 메커니즘(빌드 시 복사 vs 수동)은 T2 구현에서 결정하고 README 에 명시.

## Evolution Ideas

선택적 향후 개선(요청 기능 완료에 필수 아님, 별도 판단 대상):

- codex parity(T6): `.codex-plugin/plugin.json` 을 추가해 Codex/Gemini/OpenCode 에서도 동일 플러그인 패키지를 인식하게 하는 cross-provider 확장. Claude Code 동작에는 불필요.
- 원격 marketplace 배포: 현재는 in-repo 로컬 marketplace 만 타깃. 추후 git host 기반 공개 marketplace 로 배포해 외부 사용자 설치를 단순화.
- 번들 스킬 자동 동기화 빌드 스텝: 정본→번들 SKILL.md 복사를 build 스크립트에 통합해 수동 drift 를 제거.

## Self-Verify Summary

- Q-CORR-01 | status: PASS | attempt: 1 | files: spec.md, research.md | reason: figma-description.md 실재(24681B, frontmatter Read 확인), .agents/skills/figma-description/SKILL.md 실재(21727B), marketplace.json auto 엔트리 shape, auto 패키지 구조(.codex-plugin/plugin.json + skills/auto/SKILL.md), package.json bin(autopus-mcp-stdio), claude_desktop_config.sample.json, Claude Code plugin 규격(WebFetch) 모두 직접 확인.
- Q-CORR-02 | status: PASS | attempt: 1 | files: spec.md, plan.md | reason: 신규 항목(.claude-plugin/plugin.json, skills/figma-description/SKILL.md, README.md, optional .codex-plugin/plugin.json)은 모두 [NEW] 표기. 변경 대상(marketplace.json)은 실재 파일.
- Q-CORR-03 | status: PASS | attempt: 1 | files: acceptance.md | reason: acceptance 는 bare Given/When/Then/And. EARS REQ 는 WHEN/THE SYSTEM SHALL + 별도 Priority meta line. plugin.json/marketplace 필드 인용이 공식 규격 및 기존 파일과 일치.
- Q-COMP-01 | status: PASS | attempt: 1 | files: spec.md, plan.md, acceptance.md, research.md | reason: 4파일이 목적/태스크/oracle/근거로 상호 보완. 빈 문서 없음.
- Q-COMP-02 | status: PASS | attempt: 1 | files: spec.md, acceptance.md | reason: Traceability Matrix 가 REQ-01..09 ↔ T1..T6 ↔ S1..S7 양방향 매핑. 누락 REQ 없음.
- Q-COMP-03 | status: PASS | attempt: 1 | files: spec.md, acceptance.md | reason: 각 REQ 가 EARS type/조건/기대결과 명시. 관측 지점은 파싱된 manifest 필드/validate 출력/grep 결과(S1~S7).
- Q-COMP-04 | status: PASS | attempt: 1 | files: spec.md, plan.md | reason: 사용자 요청(3개 환경) 중 Claude Code one-install+자동 트리거 slice 를 이 SPEC 이 닫고, Desktop/Cursor 및 서버측 노출은 SPEC-MCP-001 에 의존. Feature Completion Scope/Related SPECs 에 분담 명시.
- Q-COMP-05 | status: PASS | attempt: 2 | files: spec.md, plan.md, acceptance.md, research.md | reason: REVISE 후 Semantic Invariant Inventory 에 requirements/plan tasks 컬럼을 추가하여 INV-001..008 각 row 가 REQ-ID + T-ID + Must oracle(S-ID)로 직접 매핑됨. manifest 필드 값(name/sensitive/source), validate 통과, grep 시크릿 부재 등 concrete oracle. 구조-only 가 아니라 실제 값/명령 결과 검증.
- Q-FEAS-01 | status: PASS | attempt: 1 | files: spec.md, plan.md | reason: 패키징(JSON/MD) 작업으로 정확히 분류. 신규 .ts 소스 없음. 서버 런타임 변경은 SPEC-MCP-001 소유로 분리.
- Q-FEAS-02 | status: PASS | attempt: 1 | files: spec.md | reason: 편집 대상(.autopus/plugins/autopus-figma/*, .agents/plugins/marketplace.json)이 실제 repo 구조와 일치. plugin manifest 정본 위치(.claude-plugin/)가 Claude Code 규격과 일치.
- Q-FEAS-03 | status: PASS | attempt: 1 | files: acceptance.md, plan.md | reason: 검증이 claude plugin validate + JSON 파싱 + grep 으로 실행 가능. markdown/JSON-only 변경에 비례하는 경량 검증.
- Q-STYLE-01 | status: PASS | attempt: 1 | files: spec.md | reason: REQ description 에 should/might/could 등 모호어 없음. Priority 는 별도 meta line.
- Q-STYLE-02 | status: PASS | attempt: 1 | files: spec.md | reason: Priority 는 Must/Should 만 사용, EARS type 과 별개 축.
- Q-STYLE-03 | status: PASS | attempt: 1 | files: spec.md, acceptance.md | reason: 문장 완결, acceptance 는 bare Given/When/Then/And. step keyword 가리는 마크업 없음.
- Q-SEC-01 | status: PASS | attempt: 1 | files: research.md, spec.md | reason: untrusted/sensitive 입력(FIGMA_TOKEN, 채널 시크릿) 경계와 완화(userConfig sensitive, 런타임 생성 시크릿, 패키지 비포함) 명시. plugin 설치 시 per-server approval 신뢰 경계 언급. source clause 를 evidence 로만 취급.
- Q-SEC-02 | status: PASS | attempt: 1 | files: spec.md, research.md, acceptance.md | reason: 토큰/시크릿 리터럴을 패키지·SPEC 에 복사하지 않음(HC-1/REQ-08). README placeholder 만 사용. S6 grep negative assertion. 절대경로는 mcpServers args 에서 ${CLAUDE_PLUGIN_ROOT}/설치경로로 다루며 privileged path 노출 회피.
- Q-SEC-03 | status: PASS | attempt: 1 | files: spec.md | reason: 새 영구 로그/아티팩트를 만들지 않음. 패키지 파일은 정적 config/docs. 서버 audit 경로 불변(MCP-001/기존 소유).
- Q-COH-01 | status: PASS | attempt: 1 | files: spec.md | reason: 하나의 cohesive story(Claude Code 플러그인 패키징: manifest+skill+marketplace 등록). 무관 concern 미혼입.
- Q-COH-02 | status: PASS | attempt: 1 | files: spec.md, plan.md | reason: 서버 런타임(다른 레이어)은 SPEC-MCP-001 로 분리. hand-wave 없음. Desktop/Cursor 노출도 MCP-001 의존으로 명시.
- Q-COH-03 | status: PASS | attempt: 1 | files: plan.md | reason: 두 SPEC 분해, 각자 독립 구현 가능. 이 SPEC 은 T1~T5 로 실제 설치 가능한 패키지를 산출(스캐폴드 아님). 실행 순서/handoff(MCP-001 의존) 명시.
- Q-COMP-04 | status: PASS | attempt: 2 | files: research.md, spec.md, plan.md | reason: 요청 기능 완료를 Outcome Lock 으로 게이팅(이 SPEC closing slice = Claude Code one-install + 스킬 자동 트리거; depends-on slice = 서버 instructions/prompts + Desktop/Cursor = SPEC-MCP-001). Completion Debt 가 이 SPEC→MCP-001 의존과 번들 스킬 동기화를 후속 필수로 고정. Evolution Ideas 로 codex parity 등 선택 개선을 분리.
- Q-COMP-06 | status: PASS | attempt: 2 | files: spec.md, research.md | reason: spec.md 의 `## Traceability Matrix` 표가 실재함을 재확인(REQ-01..09 ↔ T1..T6 ↔ S1..S7). research 의 추적성 단언이 실재 표를 가리켜 단언-실재 정합. 추가로 `## Sibling SPEC Decision` 을 spec.md 에도 삽입.
- Q-COMP-07 | status: PASS | attempt: 2 | files: research.md | reason: 신버전 헤딩(## Sibling SPEC Decision, ## Outcome Lock, ## Reviewer Brief, ## Completion Debt, ## Evolution Ideas)을 모두 추가. 이 SPEC 은 prompt-state SPEC 이 아니므로 Prompt Layer Manifest 는 N/A(서버 prompt 상태는 SPEC-MCP-001 소유). Completion Debt(필수 후속)와 Evolution Ideas(선택)를 별도 헤딩으로 분리.

## REVISE 처리 요약 (이번 라운드)

- 라인 수: figma-description.md 321 로 정정(322 오기). 정본 frontmatter/triggers 직접 확인.
- 토큰 변수 형식: env FIGMA_TOKEN 은 ${user_config.figma_token} 치환 변수(리터럴 아님)로 plan/acceptance/research 일관 반영. spec.md 는 서술형(리터럴 없음).
- Traceability Matrix: spec.md 에 이미 실재(Q-COMP-06 closure). spec.md 에 ## Sibling SPEC Decision 삽입.
- 신버전 섹션 5종 + Inventory REQ/T 컬럼 추가. Self-Verify 를 Q-COMP-06/07 포함 신항목으로 갱신.
