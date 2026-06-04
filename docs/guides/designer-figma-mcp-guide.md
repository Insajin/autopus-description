# 디자이너용 가이드 — Claude Desktop으로 Figma 작업하기

> 대상: Figma 능숙, Claude Desktop / MCP는 처음인 디자이너
> 환경: **Claude Desktop (Windows)** + Figma 데스크탑 앱 + Autopus Figma 플러그인
> 첫 셋업 소요: 약 30분

---

## 0. 한눈에

Claude Desktop에 채팅으로 시키면 Claude가 **Figma 파일에 직접 작업**합니다. 디자인 시스템 토큰 등록, 컴포넌트 생성, 자동 레이아웃 조정, 플로우 다이어그램 — 손으로 하던 일을 자연어로 시킵니다.

| 하고 싶은 것 | 채팅 예시 |
|--------------|-----------|
| 디자인 시스템 토큰·컴포넌트 만들기 | "tailwind.config.js 보고 토큰/컴포넌트 라이브러리 만들어줘" |
| 기존 일부 수정·확장 | "Dashboard 페이지 우측 패널을 카드 그리드로 바꿔줘" |
| 플로우 다이어그램 / 와이어프레임 | "회원가입부터 결제까지 플로우를 FigJam에 그려줘" |
| 코드/설명으로 페이지·모달 생성 | "이 React 코드 보고 같은 화면 Figma에 만들어줘" |

> Claude Desktop의 **공식 Figma 플러그인은 읽기만** 됩니다. 따라서 위의 "쓰기" 작업은 별도로 조직 **Autopus Figma 플러그인** + **autopus-mcp** 서버로 처리합니다. 디자이너가 해야 할 셋업은 그 두 가지 + Claude Desktop 등록.

---

## 1. 사전 준비

### 1.1 설치

**경로 A — 원클릭 확장(.mcpb) · 비개발자 권장**
터미널·Node 설치·JSON 편집이 전혀 필요 없습니다.

1. Claude Desktop 설치: https://claude.ai/download
2. GitHub Releases에서 **`autopus-description.mcpb`** 다운로드: https://github.com/Insajin/autopus-description/releases/latest
3. Claude Desktop → **Settings → Extensions → (Advanced) Install Extension…** → 받은 `.mcpb` 선택(또는 더블클릭).
   - Node.js는 Claude Desktop에 내장돼 있어 따로 설치할 필요가 없습니다.
4. Figma 데스크탑 앱 설치: https://www.figma.com/downloads

**경로 B — 개발자용(npm)**

| 항목 | 방법 |
|------|------|
| Node.js 22+ | https://nodejs.org |
| autopus-mcp | `npm install -g @autopus/figma-mcp` 후 MCP 클라이언트에 등록 (또는 `.mcp.json`에 `npx -y @autopus/figma-mcp`) |

### 1.2 Figma 토큰

Figma 우상단 프로필 → Settings → Security → Personal access tokens → "Create new token". 권한은 **Read + File content + Plugin write** 다 켜기. `figd_...` 토큰을 복사해 안전한 곳에 보관.

### 1.3 Autopus Figma 플러그인 설치

#### 경로 A — Figma Organization marketplace (정식 publish 후)

1. Figma 데스크탑 → 좌상단 햄버거 → Resources → Plugins
2. 검색창에 "Autopus Figma"
3. Install (Organization private이므로 조직 계정에서만 보임)

#### 경로 B — Dev-mode import (publish 전, 또는 이 압축파일을 받은 경우)

이 압축파일(`autopus-figma-designer.zip`) 안에 plugin 파일들이 들어있습니다. 압축 풀린 폴더 위치를 기억해두고:

1. Figma 데스크탑에서 **임의의 파일을 엽니다** (빈 파일도 OK)
2. 좌상단 햄버거 → Plugins → Development → **Import plugin from manifest...**
3. 파일 선택 대화상자에서 압축 푼 폴더 안의 **`manifest.json`** 선택
4. 그 후 Plugins → Development → **Autopus Figma** 가 보입니다 → Run

(Dev-mode plugin은 본인 계정에만 등록되고 다른 디자이너에게 자동 공유 안 됨 — 각자 같은 import 절차를 반복해야 합니다.)

---

## 2. Claude Desktop에 autopus-mcp 등록

### 2.1 설정 파일 위치

Windows에서 `claude_desktop_config.json` 경로:
```
%APPDATA%\Claude\claude_desktop_config.json
```

탐색기 주소창에 `%APPDATA%\Claude` 입력하면 폴더가 열립니다.

### 2.2 설정 추가

`claude_desktop_config.json` 파일을 메모장에서 열고 다음 블록을 추가:

> ⚠️ **Windows에서는 절대 경로 필수**: Claude Desktop이 npm global bin을 PATH에서 못 찾는 경우가 흔합니다. `command`를 `node` + `args`에 entry script의 **절대 경로**로 명시하세요.

```json
{
  "mcpServers": {
    "autopus-figma": {
      "command": "node",
      "args": [
        "C:\\Users\\본인이름\\AppData\\Roaming\\npm\\node_modules\\@autopus\\figma-mcp\\dist\\src\\daemon\\mcp-stdio-entry.js"
      ],
      "env": {
        "FIGMA_TOKEN": "figd_여기에_본인_토큰",
        "AUTOPUS_AUDIT_DIR": "%USERPROFILE%\\.autopus"
      }
    }
  }
}
```

이미 다른 `mcpServers` 블록이 있다면 그 안에 `"autopus-figma": {...}`만 추가하세요.

### 2.3 Claude Desktop 재시작

설정 파일 저장 후 Claude Desktop을 완전히 종료(작업 표시줄 트레이 아이콘 우클릭 → Quit)했다가 다시 실행합니다.

채팅창 아래의 도구 아이콘에 **autopus-figma**가 보이면 등록 성공입니다.

---

## 3. 매 작업 전 — 플러그인 띄우기

채팅에서 명령하기 전에 **반드시** 다음 절차를 진행하세요.

1. Figma 데스크탑에서 작업할 파일을 엽니다.
2. 우상단 햄버거 → Plugins → **Autopus Figma** → Run.
3. autopus-mcp 데몬이 시작될 때 **채널 시크릿**을 발급합니다(매 세션 랜덤). 시크릿은 데몬 stderr 로그와 `.autopus/figma-channel.txt` 파일에 표시됩니다. Claude에게 "figma 채널 시크릿 알려줘"라고 물어도 됩니다.
4. 플러그인 창의 입력란에 그 시크릿을 붙여넣고 **Connect**를 누릅니다.
5. 상단 dot이 **녹색 + "Connected · channel ok"** 로 바뀌면 준비 완료.

보안상 채널은 매 세션 랜덤 시크릿입니다(예전 고정 `autopus` 채널은 제거됨 — 보안 감사 C-1). 시크릿을 모르는 다른 로컬 프로세스는 plugin 채널에 접속할 수 없습니다.

작업 끝나면 플러그인 창을 닫아도 됩니다. 다음에 다시 시작할 때 같은 절차.

---

## 4. 4가지 워크플로우 — 예시 프롬프트

> 모든 prompt는 그대로 복사해서 채팅에 붙여넣어도 됩니다. `<...>` 부분만 본인 값으로.

### 4.1 디자인 시스템 토큰 / 컴포넌트 만들기

**prompt**:
```
지금 열린 Figma 파일에 다음 디자인 시스템을 만들어줘.
- 컬러 토큰: primary(50/100/.../900), neutral, success, warning, danger
- 간격 토큰: 2, 4, 8, 12, 16, 24, 32, 48
- 폰트: heading(24/20/16), body(14/12)
- 기본 컴포넌트: Button(variant: primary/secondary/ghost × size: sm/md/lg), Input, Card
- 모두 Figma Variables로 등록
```

내부적으로 호출되는 도구: `get_styles` → `create_frame` × N → `set_fill_color` × N → `create_text` × N → `create_component_instance`.

### 4.2 기존 디자인 일부 수정 / 확장

**prompt**:
```
지금 열린 Figma 파일의 "Dashboard" 페이지에서 우측 사이드패널을
카드 그리드(3열, gap 16, padding 24, auto-layout vertical, sizing FILL)로
바꿔줘. 텍스트 컨텐츠는 그대로.
```

내부 도구: `get_selection` → `get_node_info` → `set_layout_mode` → `set_padding` → `set_item_spacing` → `set_layout_sizing`.

### 4.3 플로우 다이어그램 / 와이어프레임

**prompt**:
```
회원가입부터 첫 결제 완료까지 사용자 플로우를 그려줘.
- 사각형 노드: 화면(로그인, 본인인증, 정보입력, 결제수단, 완료)
- 마름모: 분기(이메일 인증 실패, 카드 실패, 쿠폰 적용)
- 화살표로 연결
- 위에서 아래로 흐름
- 현재 열린 Figma 파일에 그려줘
```

내부 도구: `create_frame` × N → `create_text` × N → `set_default_connector` → `create_connections`.

### 4.4 코드 / 설명으로 페이지·모달 만들기

**prompt**:
```
"상품 상세 모달"을 만들어줘.
- 좌측: 이미지 갤러리(메인 1장 + 썸네일 4장 가로 스택)
- 우측: 상품명(heading), 가격(heading), 옵션 셀렉터 2개(Input), 수량 +/-, 장바구니 버튼(primary), 위시리스트 아이콘
- 하단: 탭 3개(상세 / 리뷰 / 문의)
- desktop 1440 폭, 가운데 정렬, 모달 background overlay
- 디자인 시스템: 이미 만들어진 "Acme DS" 라이브러리 사용
```

내부 도구: `create_frame` × N → `create_component_instance` (DS 컴포넌트 사용) → `set_layout_mode` → `set_padding` → `create_text` → `set_fill_color`.

---

## 5. 작업 중 알아두면 좋은 것

### 5.1 확인 단계에서 멈춤

큰 변경(파일 통째 생성, 라이브러리 publish 등)은 Claude가 한 번 확인을 받습니다. **응답하지 않으면 시작 안 합니다** — "응 진행해" 또는 "잠깐, 우측만 먼저" 같이 명확히 답해주세요.

### 5.2 Undo는 평소대로

Claude가 가한 모든 변경은 Figma의 Ctrl+Z로 되돌릴 수 있습니다.

### 5.3 한 번에 하나씩

여러 작업을 한 prompt에 묶으면 결과 품질이 떨어집니다. 큰 작업은 단계별로:

❌ "토큰 만들고 그걸로 대시보드 만들고 플로우도 그려줘"
✅ 셋을 별도 채팅 세션 또는 메시지로

### 5.4 연결 끊김

두 가지 경우로 나뉩니다:

| 상황 | 조치 |
|------|------|
| Plugin 창이 **열려있는 채로** 연결만 끊긴 경우 (dot이 빨강) | 그대로 두면 **2초 안에 자동 재연결**. WebSocket reconnect 루프가 돌고 있음 |
| Plugin **창 자체가 닫혔거나** Claude Desktop이 재시작된 경우 | 자동 복구 안 됨. Figma → Plugins → Autopus Figma → **Run** 다시 |

### 5.5 도구가 안 보일 때

채팅 도구 목록에 `create_frame` 같은 게 안 보이면:
1. Claude Desktop 완전 종료 후 재시작 (트레이 Quit)
2. `claude_desktop_config.json` 문법 오류 확인 (콤마/괄호)
3. PowerShell에서 `autopus-mcp-stdio --version` 가 실행되는지 확인 — 안 되면 `npm install -g @autopus/figma-mcp` 재실행

---

## 6. description 워크플로우 참여 (선택)

PM이 manifest를 만들고 디자이너가 "이 화면 의도/예외 케이스 검토" 역할로 참여하는 경우만 해당. 디자인만 한다면 건너뛰어도 됩니다.

채팅 예시:
```
오늘 PM이 publish한 description 중에 frame "Login" 관련된 것 보여줘
```

```
preview_description으로 pending_id "p-abc123" 보여주고 내가 검토 후 approve 할게
```

approve / undo / preview 등은 autopus-mcp의 기본 도구라 별도 셋업이 필요 없습니다.

---

## 7. 보안

- **Figma 토큰을 외부로 공유 금지.** 토큰은 모든 파일 접근 권한. 슬랙·이메일·캡쳐에 노출 X.
- **라이브러리 publish는 한 번 더 확인.** "publish해줘"라고 Claude에게 시키기 전에 결과 미리보기로 검토.
- **AI 결과는 검토 후 사용.** 토큰 바인딩, 자동 레이아웃은 가끔 어긋남.
- **외부 네트워크 호출 없음.** Plugin은 `ws://localhost:3055` (사용자 본인 PC의 autopus daemon)로만 통신합니다. manifest.json `networkAccess.allowedDomains` 에 localhost만 등록됨 — Google Analytics 같은 외부 도메인은 의도적으로 제거됨. 보안팀 review 시 이 파일 보여주시면 됩니다.

---

## 8. 자주 묻는 질문

**Q. Claude Desktop 말고 다른 도구에서도 됩니까?**
A. Codex CLI, Cursor 등도 MCP를 지원하면 가능. 다만 이 가이드는 Claude Desktop Windows 기준.

**Q. 토큰을 잘못 넣었습니다.**
A. `%APPDATA%\Claude\claude_desktop_config.json` 열고 `FIGMA_TOKEN` 값을 새 토큰으로 교체 후 Claude Desktop 재시작.

**Q. AI가 만든 디자인 누가 소유?**
A. Figma 계정 소유자(=본인). Claude는 대리 작업만.

**Q. 한국어로 시켰는데 영어 라벨이 나옵니다.**
A. "모든 텍스트는 한국어로"라고 prompt에 명시.

**Q. 라이브러리/외부 글꼴이 필요한 컴포넌트는?**
A. 사용 중인 Figma 파일에 해당 폰트가 이미 등록돼 있어야 합니다. 새 폰트는 Claude가 register 할 수 없으니 미리 데스크탑 앱에서 add.

---

## 9. 문제 해결

| 증상 | 조치 |
|------|------|
| Claude Desktop 도구 목록에 autopus-figma 없음 | `claude_desktop_config.json` 문법 오류 + Claude Desktop 완전 재시작 |
| `PLUGIN_NOT_CONNECTED` 응답 | Autopus Figma 플러그인 창을 닫고 다시 Run. 상단 dot이 녹색이 될 때까지 기다리기. 그래도 빨강이면 Claude Desktop을 트레이 Quit → 재시작 |
| "node_not_found" | Claude에게 `get_selection`이나 `get_document_info`를 먼저 시켜서 노드 ID 확인하게 함 |
| 폰트 로드 에러 | 데스크탑 Figma에서 해당 폰트를 미리 install/register |
| 색이 이상하게 들어감 | Figma는 RGBA 0-1 범위. "RGBA 0-1 기준으로 #3B82F6 → r:0.231, g:0.51, b:0.965 적용해줘" 처럼 단위 명시 |
| 자동 레이아웃 깨짐 | "set_layout_mode를 VERTICAL로 잡고 set_padding 모두 16, set_item_spacing 8" 같이 명시 |
| 한 번에 너무 많이 만들었음 | Ctrl+Z 한 번이면 마지막 변경만. 여러 단계 되돌리려면 여러 번 Ctrl+Z |

해결 안 되면 팀 채널 채널에 스크린샷+에러 메시지로 문의.

---

## 10. 더 알아보기

- Claude Desktop 공식 문서: https://docs.claude.com/desktop
- Autopus Figma 플러그인 publish 절차 (관리자용): `docs/runbooks/figma-org-publish.md`
- 본 가이드 출처/업데이트: 팀 채널 또는 PR
