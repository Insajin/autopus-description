# SPEC-MCP-002 구현 계획

## 태스크 목록

- [x] T1: [NEW] `.autopus/plugins/autopus-figma/.claude-plugin/plugin.json` 작성 — Claude Code plugin manifest. 필드: `name: "autopus-figma"`(필수, kebab-case), `version`, `description`, `mcpServers`(inline object: `{ "autopus-figma": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/../../../dist/src/daemon/mcp-stdio-entry.js" 또는 설치된 절대경로], "env": { "FIGMA_TOKEN": "${user_config.figma_token}", "AUTOPUS_AUDIT_DIR": "..." } } }`), `skills: "./skills"`(기본 위치 명시), `userConfig: { figma_token: { type:"string", title, description, sensitive:true } }`. 리터럴 시크릿/토큰 값 없음. (REQ-01, REQ-02, REQ-06, REQ-07, REQ-08)
- [x] T2: [NEW] `.autopus/plugins/autopus-figma/skills/figma-description/SKILL.md` 작성 — `.claude/skills/autopus/figma-description.md` 의 정본 frontmatter(name: figma-description, description, triggers: figma/피그마/디스크립션/화면 정의/번호 뱃지 등)와 본문을 번들 스킬로 포함한다. 본문 내용은 정본 그대로(HC-2: divergent fork 금지). 시크릿/토큰 리터럴 없음. (REQ-03, REQ-08)
- [x] T3: `.agents/plugins/marketplace.json` 변경 — `plugins` 배열에 autopus-figma 엔트리를 append. 기존 auto 엔트리 shape 미러링: `{ "name": "autopus-figma", "source": { "source": "local", "path": "./.autopus/plugins/autopus-figma" }, "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" }, "category": "Developer Tools" }`. 기존 auto 엔트리는 보존. (REQ-04, HC-5)
- [x] T4: [NEW] `.autopus/plugins/autopus-figma/README.md` 작성 — 설치 절차(`claude plugin marketplace add ./` + `claude plugin install autopus-figma`), 환경별 안내(Claude Code = 이 플러그인 설치; Desktop/Cursor = SPEC-MCP-001 instructions/prompts + 수동 MCP config = `autopus-figma-designer/claude_desktop_config.sample.json` 참조), FIGMA_TOKEN 을 userConfig sensitive 로 입력하는 방법. (REQ-09)
- [x] T5: 검증 — (a) `claude plugin validate ./.autopus/plugins/autopus-figma` 실행하여 manifest 스키마 유효 + 선언된 component path(skills/figma-description/SKILL.md) 가 실재 파일로 resolve 됨을 확인(REQ-05). (b) plugin.json 과 SKILL.md 를 grep 하여 figd_ 토큰 패턴/32-hex 채널 시크릿/리터럴 FIGMA_TOKEN 값이 없음을 확인(REQ-08, HC-1). (c) marketplace.json 이 valid JSON 이고 auto·autopus-figma 두 엔트리를 모두 포함함을 확인.
- [x] T6: (optional, Should) [NEW] `.autopus/plugins/autopus-figma/.codex-plugin/plugin.json` — auto 의 `.codex-plugin/plugin.json` shape 미러링하여 cross-provider parity. Claude Code 동작에는 불필요하므로 REQ-09 문서로만 안내하고 필수 게이트에서 제외. (REQ-09 보조)

## 구현 전략

- 패키징 only: 이 SPEC 은 신규 .ts 소스를 추가하지 않는다(HC-4). plugin.json/SKILL.md/README.md/marketplace.json 만 다룬다. MCP 서버 런타임 행동은 SPEC-MCP-001 이 소유(HC-3).
- 정본 스킬 번들(HC-2): SKILL.md 는 `.claude/skills/autopus/figma-description.md` 의 frontmatter+본문을 그대로 가져온다. 별도 문체/규칙을 창작하지 않는다. 자동 트리거는 frontmatter triggers(figma/피그마/디스크립션 등) 매칭으로 발동되므로, frontmatter 보존이 REQ-03 의 핵심.
- mcpServers 경로 해석(REQ-07): Claude Code plugin 규격은 `${CLAUDE_PLUGIN_ROOT}` 변수를 지원한다(WebFetch 확인). 단 이 플러그인은 레포 내 dist/ 산출물을 가리켜야 하므로, (i) npm 글로벌 설치(@autopus/figma-mcp) 의 절대경로 또는 (ii) 레포 dist 의 상대경로 중 README 가 안내하는 방식을 args 에 둔다. 가장 견고한 기본값은 글로벌 bin(autopus-mcp-stdio)을 npx/직접 호출하는 형태이며, 로컬 개발 시 README 가 절대경로 override 를 안내한다.
- 보안(REQ-06/REQ-08, HC-1): FIGMA_TOKEN 은 manifest 에 리터럴로 넣지 않고 userConfig figma_token(sensitive:true)로 받아 env 치환(`${user_config.figma_token}`)한다. sensitive 필드는 settings.json 대신 secure storage 에 저장됨(WebFetch 확인). 채널 시크릿은 런타임(서버)이 세션마다 생성하므로 패키지에 존재하지 않는다.
- marketplace 등록(REQ-04, HC-5): 기존 `.agents/plugins/marketplace.json` 의 auto 엔트리와 동일 shape 로 append. 이 파일은 autopus-local marketplace 의 정본이며, source 는 `{ source:"local", path }` object 형식(auto 가 사용하는 형식)을 따른다. (참고: Claude Code 공식 marketplace.json 은 `.claude-plugin/marketplace.json` 에 `"source": "./path"` 문자열 형식도 허용하나, 이 레포의 로컬 marketplace 정본은 `.agents/plugins/marketplace.json` 이므로 그 기존 형식을 따른다.)

## 의존성 / 실행 순서

- T2 → T1 (plugin.json 의 skills 경로가 SKILL.md 를 가리키므로 스킬 파일이 먼저 있으면 validate 가 통과).
- T1 → T3 (marketplace 가 가리키는 plugin 디렉토리에 manifest 가 있어야 의미).
- T1+T2 → T5 (validate 는 manifest + 선언된 component 파일 실재를 검사).
- T3 → T5 (marketplace JSON 유효성/엔트리 포함 검증).
- T4 는 T1~T3 와 독립(문서), T5 전 완료 권장.
- T6 는 optional, 필수 경로 밖.

## sibling 의존성 (Feature Completion Scope)

이 SPEC 은 "3개 환경 전부" 중 **Claude Code 전용 one-install + 스킬 자동 트리거** slice 를 닫는다. 그러나 사용자가 체감하는 완전한 가치(설치 후 디스크립션 워크플로우가 자동 인지·발동)는 **SPEC-MCP-001 이 먼저/함께 lands** 해야 완성된다 — 이 플러그인이 번들하는 MCP 서버가 워크플로우 instructions/prompts 를 노출해야(MCP-001) 스킬 트리거와 서버 안내가 일관되기 때문이다. 따라서 이 SPEC 은 SPEC-MCP-001 에 의존한다(Related SPECs/Hard constraints HC-3 명시).

분담 요약:
- SPEC-MCP-001: Desktop + Cursor + Claude Code 공통의 서버측 워크플로우 노출(instructions + prompts). Desktop/Cursor 는 MCP-001 만으로 완전 동작.
- SPEC-MCP-002(this): Claude Code 의 설치 마찰 제거 + 스킬 자동 트리거(번들 스킬을 스킬 디렉토리에 배치).
- 두 SPEC 합산 = 사용자 요청의 완전한 기능 결과(3개 환경 자동 사용).

## 제약 노트

- HC-1/HC-4: 패키지에 시크릿 리터럴 없음, 신규 .ts 소스 없음. JSON/MD 는 file-size 한계 제외.
- HC-2/HC-3: 정본 스킬 번들, 서버 런타임 미변경(MCP-001 소유).
- HC-5: marketplace 엔트리 shape 는 auto 와 동일.
- 언어 정책: 커밋·코드 주석은 영어, 본 계획 문서는 한국어(language-policy). README 는 사용자 대상이므로 한국어 안내 + 명령은 원문.
