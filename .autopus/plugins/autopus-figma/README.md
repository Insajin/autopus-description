# autopus-figma (Claude Code 플러그인)

Autopus Figma 디스크립션 워크플로를 Claude Code에 한 번에 설치하는 로컬 플러그인입니다.
이 플러그인 하나를 설치하면 **autopus-figma MCP 서버(stdio)**와 **figma-description 스킬**이 함께 연결됩니다.

## 설치 (Claude Code)

로컬 마켓플레이스를 등록한 뒤 플러그인을 설치합니다.

```
claude plugin marketplace add ./.agents/plugins
claude plugin install autopus-figma
```

- `claude plugin marketplace add`의 경로는 `.agents/plugins/marketplace.json`을 가리키는 위치여야 합니다.
  레포 루트에서 실행한다면 위 예시 그대로 `./.agents/plugins`를 사용합니다.
- 설치 후 enable 시점에 `figma_token` 입력을 요청받습니다(아래 FIGMA_TOKEN 설정 참고).

## 환경별 안내 (어디서 무엇을 쓰는가)

| 환경 | 이 플러그인 사용 여부 | 설정 방법 |
|------|----------------------|-----------|
| **Claude Code** | 사용 (권장) | 이 플러그인 한 번 설치 → MCP 서버 + 스킬 동시 연결 |
| **Claude Desktop / Cursor** | 사용하지 않음 | SPEC-MCP-001 서버 instructions/prompts + **수동 MCP 설정** |

- Claude Code는 이 플러그인이 정본 경로입니다.
- Claude Desktop과 Cursor는 이 플러그인을 쓰지 않습니다. 대신 SPEC-MCP-001이 제공하는
  서버 instructions/prompts에 의존하며, MCP 서버를 **수동으로** 등록해야 합니다.
  수동 설정 예시는 `autopus-figma-designer/claude_desktop_config.sample.json`을 참고하세요.

## FIGMA_TOKEN 설정

Figma API 토큰을 두 방법 중 하나로 제공합니다.

1. **Claude Code (이 플러그인)**: enable 시점에 `figma_token` userConfig 필드로 입력합니다.
   이 필드는 `sensitive: true`이므로 입력값이 마스킹되고 OS 보안 저장소(키체인 등)에 저장됩니다.
   `settings.json`이나 이 플러그인 manifest에는 토큰이 기록되지 않습니다.
2. **수동 MCP 설정 (Desktop / Cursor)**: MCP 서버 정의의 `env`에 직접 `FIGMA_TOKEN`을 넣습니다.

토큰 자리표시자는 항상 `<YOUR_FIGMA_TOKEN>` 형태로만 표기합니다.

```jsonc
{
  "mcpServers": {
    "autopus-figma": {
      "command": "node",
      "args": ["<절대경로>/dist/src/daemon/mcp-stdio-entry.js"],
      "env": { "FIGMA_TOKEN": "<YOUR_FIGMA_TOKEN>" }
    }
  }
}
```

## MCP 서버 경로 (중요 — 두 경우를 구분하세요, F-01)

이 플러그인의 기본 `args` 값은 다음과 같습니다.

```
${CLAUDE_PLUGIN_ROOT}/../../../dist/src/daemon/mcp-stdio-entry.js
```

- **레포 체크아웃 안에서 직접 실행하는 경우**: 위 상대 경로(`../../../dist`)는 이 레포의 빌드 산출물
  `dist/`를 가리킵니다. 따라서 먼저 `npm run build`로 `dist/`를 생성해야 합니다.
- **로컬 마켓플레이스로 설치한 경우**: Claude Code가 플러그인을 관리 위치
  (`~/.claude/plugins/...`)로 **복사**할 수 있습니다. 이때 `../../../dist` 상대 구간은
  더 이상 레포의 `dist/`를 가리키지 않습니다.

### 견고한/전역 설치를 위한 권장 방법

전역 설치 환경에서는 `args` 경로를 **설치된 패키지의 진입점 절대 경로**로 덮어쓰세요.
전역 설치 위치는 `npm root -g` 출력에 패키지 경로를 이어 붙여 얻습니다.

```
# npm root -g 결과 예: C:\Users\<you>\AppData\Roaming\npm\node_modules
<npm root -g 출력>/@autopus/figma-mcp/dist/src/daemon/mcp-stdio-entry.js
```

이 절대 경로를 `args`에 넣으면 플러그인이 어디로 복사되든 올바른 진입점을 가리킵니다.
체크아웃 내부 실행이면 기본 `${CLAUDE_PLUGIN_ROOT}` 상대 경로를, 전역 설치면 절대 경로를 선택하세요.

## 스킬 동기화 안내 (F-03)

번들된 `skills/figma-description/SKILL.md`는 정본 스킬
`.claude/skills/autopus/figma-description.md`의 **복사본**입니다.

- 현재 동기화는 **수동**입니다.
- 정본 스킬이 변경되면 이 번들로 **다시 복사**해 드리프트를 방지하세요(HC-2: fork가 아닌 canonical copy).
