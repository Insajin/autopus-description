# SPEC-MCP-002 수락 기준

표기: 모든 시나리오는 bare Given/When/Then/And 형식. S1~S2 는 manifest/skill 구조 oracle(파일 파싱·실재 값 검증), S3 은 marketplace 등록 oracle, S4 는 validate 명령 oracle, S5 는 sensitive userConfig oracle, S6 은 security oracle(시크릿 비포함), S7 은 docs oracle. S1~S6 Must, S7 Should. 모든 oracle 은 생성된 파일 내용 또는 claude plugin validate 출력으로 실행 가능하다.

## 시나리오

### S1: plugin.json 이 MCP 서버와 스킬을 선언하고 명령 경로가 해석된다 (Must, manifest oracle — REQ-01/REQ-02/REQ-07, INV-001/INV-002)
Given `.autopus/plugins/autopus-figma/.claude-plugin/plugin.json` 을 JSON 으로 파싱한다.
When manifest 객체를 검사한다.
Then `name` 필드가 정확히 "autopus-figma" 이다.
And `mcpServers` 가 존재하고 그 안에 autopus-figma 서버 항목이 있으며 `command` 가 "node" 이고 `args` 가 mcp-stdio-entry.js 로 끝나는 경로를 포함한다.
And 그 mcpServers args 경로는 `${CLAUDE_PLUGIN_ROOT}` 변수 또는 절대경로로 표현되어 임의 checkout 위치에서도 해석 가능하다(상대적 cwd 의존 문자열이 아니다).
And `skills` 가 "./skills" 를 가리키거나, 기본 skills 디렉토리에 SKILL.md 가 존재하여 스킬이 선언된다.

### S2: 번들 스킬이 정본 frontmatter 를 보유한다 (Must, skill oracle — REQ-03, INV-003)
Given `.autopus/plugins/autopus-figma/skills/figma-description/SKILL.md` 를 읽고 YAML frontmatter 를 파싱한다.
When frontmatter 를 `.claude/skills/autopus/figma-description.md` 의 frontmatter 와 비교한다.
Then SKILL.md frontmatter 의 `name` 이 "figma-description" 이다.
And SKILL.md frontmatter 의 `triggers` 배열이 정본의 핵심 트리거(figma, 피그마, 디스크립션, 화면 정의, 번호 뱃지)를 모두 포함한다.
And SKILL.md 본문이 비어 있지 않으며 디스크립션 작성 절차(예: 자가 점검 항목, 뱃지 맵)를 포함한다(스캐폴드가 아니다).

### S3: marketplace.json 이 autopus-figma 를 등록하고 auto 를 보존한다 (Must, marketplace oracle — REQ-04, INV-004)
Given `.agents/plugins/marketplace.json` 을 JSON 으로 파싱한다.
When `plugins` 배열을 검사한다.
Then 배열은 name 이 "auto" 인 기존 엔트리를 여전히 포함한다(회귀 없음).
And 배열은 name 이 "autopus-figma" 인 새 엔트리를 포함한다.
And autopus-figma 엔트리의 source 가 path "./.autopus/plugins/autopus-figma" 를 가리킨다(auto 엔트리와 동일 shape: source.source="local").
And 두 엔트리 모두 category 와 policy 필드를 가져 로컬 marketplace 로더가 동일하게 처리한다.

### S4: claude plugin validate 가 통과한다 (Must, validate oracle — REQ-05, INV-005)
Given 플러그인 디렉토리 `.autopus/plugins/autopus-figma` 가 manifest 와 번들 스킬을 갖추고 있다.
When `claude plugin validate ./.autopus/plugins/autopus-figma` 를 실행한다.
Then 명령이 성공 종료한다(검증 실패/스키마 에러 없음).
And 선언된 component 경로(skills/figma-description/SKILL.md)가 실재 파일로 resolve 되어 missing-component 에러가 보고되지 않는다.
And manifest 의 잘못된 타입(예: keywords 가 배열이 아님) 같은 load error 가 없다.

### S5: FIGMA_TOKEN 이 sensitive userConfig 로 선언된다 (Must oracle for Should REQ-06 — REQ-06, INV-006)
Given plugin.json 의 `userConfig` 객체를 파싱한다.
When figma 토큰 입력 필드(예: figma_token)를 검사한다.
Then 그 필드의 `type` 이 "string" 이다.
And 그 필드의 `sensitive` 가 true 로 설정되어 입력이 마스킹되고 secure storage 에 저장된다.
And mcpServers env 의 FIGMA_TOKEN 값이 그 userConfig 필드를 참조하는 치환 토큰(`${user_config.figma_token}`, 공식 변수 형식)이며 리터럴 토큰 값이 아니다.

### S6: 패키지에 시크릿/토큰 리터럴이 없다 (Must, security oracle — REQ-08, INV-007)
Given plugin.json 과 번들 SKILL.md 와 README.md 의 전체 텍스트를 읽는다.
When 세 파일 전체에서 시크릿 패턴을 검색한다.
Then figd_ 로 시작하는 Figma 토큰 리터럴이 어디에도 없다.
And 32자리 hex 채널 시크릿 패턴이 어디에도 없다.
And FIGMA_TOKEN 의 값 위치에 리터럴 토큰이 아니라 치환 변수만 존재한다.
And README 의 예시 토큰은 placeholder(예: figd_여기에_본인_토큰)로만 표기되어 실제 자격증명이 아니다.

### S7: 환경별 설치 문서가 존재한다 (Should, docs oracle — REQ-09, INV-008)
Given `.autopus/plugins/autopus-figma/README.md` 를 읽는다.
When 문서를 검사한다.
Then README 는 Claude Code 설치 명령(claude plugin marketplace add 와 claude plugin install autopus-figma)을 포함한다.
And README 는 Desktop/Cursor 는 이 플러그인이 아니라 SPEC-MCP-001 의 instructions/prompts + 수동 MCP config 로 동작함을 명시한다.
And README 는 FIGMA_TOKEN 을 sensitive userConfig 또는 MCP env 로 입력하는 방법을 안내하고 리터럴 토큰을 노출하지 않는다.
