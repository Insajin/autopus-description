<div align="center">

<img src="docs/assets/hero-banner.png" alt="Autopus Description — AI 에이전트가 디자인을 읽고 설명을 작성합니다" width="100%" />

# 🐙 @autopus/figma-mcp

**Figma 프레임을 읽고, 감사 가능한 설명을 다시 써넣는다 — AI 클라이언트에서 바로.**

Autopus Figma **설명(description) 워크플로우**를 위한 [MCP](https://modelcontextprotocol.io) 서버입니다. AI 클라이언트(Claude Code, Codex CLI, Cursor)가 Figma 프레임을 읽고, 페르소나 태그가 붙은 설명을 생성하고, 프로젝트 브리프를 관리하고, 승인된 설명 산출물을 다시 Figma에 써넣을 수 있게 합니다 — 모든 쓰기는 플러그인의 명시적 동의를 거칩니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@autopus/figma-mcp.svg)](https://www.npmjs.com/package/@autopus/figma-mcp)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF.svg)](https://modelcontextprotocol.io)

[English](README.md) · **한국어** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

</div>

---

## 이게 뭔가요? (30초 요약)

디자이너는 화면을 설명하지만, 그 지식은 보통 채팅 스레드와 오래된 문서 속으로 사라집니다. 이 패키지는 각 Figma 프레임을 **구조화되고, 검토 가능하고, 버전 관리되는 설명**으로 바꿉니다 — *이 화면이 무엇을 위한 것인지, 어떻게 동작하는지, 예외 상황은 무엇인지*. 그리고 승인된 결과를 다시 Figma에 써넣어 파일이 항상 source of truth로 남도록 합니다.

> 🧭 **공식 Figma MCP의 동반 도구입니다.** 공식 [`figma`](https://www.figma.com/) MCP 서버는 **디자인 생성**(`use_figma`, `generate_figma_design`, `generate_figma_library`, `generate_diagram`)을 담당합니다. 이 패키지는 **설명 워크플로우** — *각 프레임이 무엇을 의미하는지*와 그 지식을 감사 가능한 방식으로 다시 Figma에 써넣는 일 — 을 담당합니다. 둘은 상호 보완적이므로 함께 설치하세요.

| 당신은… | 여기서 시작 |
|---------|-------------|
| 🎨 **디자이너** (노코드) | [디자이너용](#-디자이너용-노코드) → 이후 [전체 가이드](docs/guides/designer-figma-mcp-guide.ko.md) |
| 💻 **개발자** | [설치](#-설치-개발자) → [빠른 시작](#-빠른-시작) |
| 🧑‍💼 **PM / QA** | [설명 워크플로우](#-설명-워크플로우) |

## 🎬 실제 사용 흐름 (예시)

어떤 PM이 결제 앱의 **로그인** 화면을 문서화해서, 개발자와 QA가 이 화면이 정확히 어떻게 동작해야 하는지 알게 하려 한다고 합시다. 실제로 Claude Code(또는 Codex / Cursor)에 입력하는 방식 그대로, 전체 흐름은 이렇습니다:

**1. 프로젝트 브리프 시작**
> 💬 *"`checkout-app` 프로젝트 브리프 초기화해줘."*

Claude가 `init_project_brief { project_slug: "checkout-app" }`를 실행해 `.autopus/runs/checkout-app/project-brief.json`을 만듭니다. 대상 사용자, 목표, 톤 등을 — Figma 안이 아니라 — 대화로 함께 채웁니다.

**2. 프레임 지정**
> 💬 *"Figma 파일 `aBcD1234`의 프레임 목록 보여주고, Login 프레임 메타데이터 보여줘."*

Claude가 `figma_list_frames { file_id: "aBcD1234" }` → `figma_get_frame_meta`를 실행해 프레임의 구조, 스크린샷, 내비게이션, 소스 해시를 돌려줍니다.

**3. 설명 생성**
> 💬 *"Login 프레임 설명 생성해줘."*

Claude가 `generate_description { file_id: "aBcD1234", node_id: "12:345" }`를 실행해 *pending(대기 중)* 설명을 돌려줍니다 — 아직 Figma에는 아무것도 쓰지 않습니다:

```
Frame: Login
Purpose: 결제 전 재방문 사용자를 인증한다.
Behavior: 이메일 + 비밀번호; "비밀번호 찾기"는 재설정 플로우를 연다;
          잘못된 자격 증명은 입력 필드 아래에 인라인 에러를 표시한다.
Edge cases: 잠긴 계정, 만료된 세션, SSO 폴백.
Success: 사용자가 담긴 항목이 유지된 장바구니로 이동한다.
```

**4. PM 검토**
> 💬 *"pending `p-7f3a` 미리보기 보여줘."*

`preview_description { pending_id: "p-7f3a" }`가 검토용 마크다운을 렌더링합니다. PM이 필요하면 문구를 다듬습니다.

**5. 승인 & 써넣기**
> 💬 *"`p-7f3a` 승인하고 적용해줘."*

`approve` → `apply { pending_id: "p-7f3a", source_hash_recomputed: "..." }`. 이때 — 오직 이때만 — 설명이 **플러그인의 동의 게이트를 거쳐** Figma 파일에 써집니다. 디자이너는 그 설명이 프레임에 나타나는 걸 보게 됩니다.

**6. 마음이 바뀌었다면?**
> 💬 *"방금 쓴 거 되돌려줘."*

`undo { write_id: "w-91c2" }` — 단일 단계 롤백.

> 🔁 **파일 하나를 통째로 문서화하려면?** 3단계를 `submit_batch_lane { file_id, node_ids: [...] }`로 바꾸면 여러 프레임 설명을 한 번에 생성한 뒤 함께 검토·승인할 수 있습니다.

➡️ 서술 없이 도구 호출 순서만 보려면 아래 [설명 워크플로우](#-설명-워크플로우)를 참고하세요.

## 목차

- [🎬 실제 사용 흐름 (예시)](#-실제-사용-흐름-예시)
- [✨ 무엇을 얻나요](#-무엇을-얻나요)
- [🎨 디자이너용 (노코드)](#-디자이너용-노코드)
- [📦 설치 (개발자)](#-설치-개발자)
- [🚀 빠른 시작](#-빠른-시작)
- [🧰 MCP 도구 구성](#-mcp-도구-구성)
- [🔄 설명 워크플로우](#-설명-워크플로우)
- [🏗️ 아키텍처](#️-아키텍처)
- [🤝 동반 도구](#-동반-도구)
- [🛠️ 개발](#️-개발)
- [🔒 보안](#-보안)
- [📄 라이선스](#-라이선스)

## ✨ 무엇을 얻나요

- **프레임 인텔리전스** — 어떤 프레임에서든 메타데이터, 스크린샷, 내비게이션, 디자인 토큰, 소스 해시를 추출합니다.
- **설명 생성** — mock, Anthropic, OpenAI 프로바이더로 페르소나 태그가 붙은 설명을 생성합니다.
- **PM 검토 가능한 산출물** — 미리보기, 편집, 승인, 적용, 되돌리기를 전체 감사 추적과 함께 제공합니다.
- **스키마 기반 manifest** — JSON Schema와 결정론적 fixture로 검증합니다.
- **두 가지 전송 방식** — 장시간 실행 stdio 서버 또는 loopback HTTP/SSE.
- **설계 단계부터 보안** — 시크릿은 wire에서 마스킹되고, 쓰기는 플러그인의 명시적 동의로만 허용됩니다.

## 🎨 디자이너용 (노코드)

두 가지가 필요합니다 — Figma 플러그인 + 로컬 헬퍼(이 패키지):

1. **Figma 플러그인** — Figma Community에서 **Autopus Description**을 설치(Figma → Plugins → 검색)하거나, 승인 전이라면 dev-mode에서 `dist/plugin/manifest.json`을 import 합니다.
2. **로컬 헬퍼(원클릭)** — [최신 릴리스](https://github.com/Insajin/autopus-description/releases/latest)에서 `autopus-description.mcpb`를 받은 뒤 **Claude Desktop → Settings → Extensions → Install Extension**으로 설치합니다. Node / npm / JSON 편집이 전혀 필요 없습니다 — Node는 Claude Desktop에 내장돼 있습니다.
3. **연결** — Figma에서 플러그인을 실행하고, 헬퍼가 출력하는 채널 시크릿(Claude에게 *"figma 채널 시크릿 알려줘"*라고 물어보세요)을 붙여넣은 뒤 **Connect**를 누릅니다.

> ℹ️ **어떤 플러그인을 찾아야 하나요?** Figma 플러그인 목록에는 **Autopus Description**으로 표시됩니다 — `@autopus/figma-mcp`가 *아닙니다*(그건 npm / MCP 서버이지 Figma 플러그인이 아닙니다). 만약 **Cursor MCP Plugin**이 보이거나 manifest의 `allowedDomains`에 `google-analytics.com`이 있다면, 번들된 업스트림 `vendor/` manifest를 잘못 import한 것입니다 — 제거하고 `dist/plugin/manifest.json`을 import하세요.

📖 **전체 가이드:** [docs/guides/designer-figma-mcp-guide.ko.md](docs/guides/designer-figma-mcp-guide.ko.md)

## 📦 설치 (개발자)

```bash
npm install -g @autopus/figma-mcp
```

다섯 개의 CLI 바이너리가 설치됩니다:

| 바이너리 | 용도 |
|----------|------|
| `autopus-mcp-stdio` | Claude / Codex / Cursor용 장시간 실행 MCP 서버 (stdio 전송) |
| `autopus-mcp-http` | Loopback HTTP/SSE MCP 변형 |
| `autopus-daemon` | Figma 플러그인 브리지용 백그라운드 데몬 |
| `generate-descriptions` | CLI 배치 생성기 (Figma → 설명 manifest JSON) |
| `figma-read` | CLI 읽기 전용 Figma 스냅샷 도구 |

## 🚀 빠른 시작

### Claude Code

```bash
claude mcp add autopus-figma -- autopus-mcp-stdio
```

또는 `~/.config/claude/mcp_servers.json`에 추가:

```json
{
  "autopus-figma": {
    "command": "autopus-mcp-stdio",
    "env": {
      "FIGMA_TOKEN": "figd_...",
      "AUTOPUS_AUDIT_DIR": "~/.autopus"
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`에 추가:

```toml
[mcp_servers.autopus_figma]
command = "autopus-mcp-stdio"
args = []

[mcp_servers.autopus_figma.env]
FIGMA_TOKEN = "figd_..."
AUTOPUS_AUDIT_DIR = "/Users/<you>/.autopus"
```

> 💡 `FIGMA_TOKEN`은 본인의 Figma personal access token(`figd_...`)입니다. **Figma → Settings → Security → Personal access tokens**에서 발급하세요. 파일 접근 권한을 부여하므로 외부에 노출하지 마세요.

## 🧰 MCP 도구 구성

`autopus-mcp-stdio`는 4개 티어에 걸쳐 최대 **26개 도구**를 노출합니다. 추가 티어는 시작 시 해당 의존성이 연결됐을 때만 활성화됩니다.

| 티어 | SPEC | 도구 | 항상 켜짐? |
|------|------|------|:----------:|
| **Baseline read** | SPEC-FIGMA-006 / 009 | `get_active_selection`, `get_pending_descriptions`, `get_audit_events`, `get_stale_frames` | ✅ |
| **Baseline write** | SPEC-FIGMA-011 | `plan_emit`, `dryRun`, `approve`, `apply`, `undo` | writeExtension 연결 시 |
| **Figma read + validate** | SPEC-FIGMA-014 | `figma_list_frames`, `figma_get_frame_meta`, `figma_export_image`, `figma_get_prototype_graph`, `validate_manifest` | figmaAdapter 연결 시 |
| **Single-frame generation** | SPEC-FIGMA-014 | `generate_description` | descriptionGenerator 연결 시 |
| **Project brief** | SPEC-FIGMA-015 | `get_project_brief`, `validate_project_brief`, `init_project_brief`, `update_project_brief` | briefWorkspaceRoot 설정 시 |
| **Operational** | SPEC-FIGMA-016 | `get_batch_status`, `get_generation_mode`, `preview_description`, `get_daemon_status`, `submit_batch_lane`, `force_generation_mode` | p2Context 연결 시 |

📋 전체 ListTools 순서, 불변식, 연결 예시는 [`docs/runbooks/figma-014-mcp-expansion.md`](docs/runbooks/figma-014-mcp-expansion.md)를 참고하세요.

## 🔄 설명 워크플로우

```
브리프 초기화 → 브리프 작성 → 검증 → 프레임 점검 → 생성 → 미리보기 → 승인 → 적용 → 되돌리기
```

1. **`init_project_brief { project_slug: "myproj" }`** — `.autopus/runs/myproj/project-brief.json` 템플릿을 생성합니다.
2. 이해관계자(PM / 디자이너 / 개발자 / QA)와 대화하며 브리프를 작성합니다 — Figma 안이 아니라 대화에서.
3. **`validate_project_brief { brief_path }`** — 필수 필드가 모두 있는지 확인합니다.
4. **`figma_list_frames { file_id }`** 후 **`figma_get_frame_meta`** — 대상 프레임을 점검합니다.
5. **`submit_batch_lane { file_id, node_ids }`** (다중 프레임) 또는 **`generate_description { file_id, node_id }`** (단일).
6. **`preview_description { pending_id }`** — PM 검토용 마크다운 뷰.
7. **`approve { pending_id }`** → **`apply { pending_id, source_hash_recomputed }`** — 플러그인을 통해 Figma에 써넣습니다.
8. **`undo { write_id }`** — 단일 단계 롤백.

## 🏗️ 아키텍처

```
Claude Code / Codex CLI / Cursor
            │ MCP (stdio / http)
            ▼
   autopus-mcp-stdio  (이 패키지)        ← 정책 / 작성 경계
            │ WebSocket
            ▼
   Figma 플러그인  (autopus_*.ts, MIT vendored)   ← 동의 경계
            │
            ▼
        Figma 파일
```

MCP 서버는 **정책 / 작성 경계**입니다. Figma 플러그인은 **동의 경계** — 쓰기는 플러그인 승인(`approve` → `apply`) 이후에만 일어납니다. 터널 URL과 시크릿은 MCP wire에서 마스킹됩니다(`INV-W2`, `INV-TUNNEL-REDACT`).

## 🤝 동반 도구

- **공식 Figma MCP** — 디자인 생성(`use_figma`, `generate_figma_design`, `generate_figma_library`, `generate_diagram`). 디자이너 워크플로우용으로 별도 설치하세요.
- **`@autopus/validate-manifest`** — 설명 manifest 포맷용 JSON Schema 검증기(워크스페이스 패키지, 전이 의존성으로 함께 배포).

## 🛠️ 개발

```bash
npm install
npm run build       # TypeScript 컴파일 + bin 엔트리에 shebang 추가
npm test            # vitest 스위트
npm run lint        # tsc --noEmit
```

## 🔒 보안

- 모든 아웃바운드 MCP `text` 페이로드는 전송 전 `redact()`를 거칩니다(`INV-W2`).
- Figma 토큰은 환경에서 읽으며, 절대 로깅하지 않습니다.
- 프로젝트 브리프 경로는 `.autopus/runs/`로 제한됩니다(`INV-BRIEF-PATH`).
- 터널 URL은 `get_daemon_status`에서 마스킹됩니다(`INV-TUNNEL-REDACT`).
- Figma 읽기 도구는 HTTP GET만 보냅니다(`INV-FIGMA-READ`).

🔐 취약점은 이 저장소의 **GitHub Security Advisories**로 제보해주세요.

## 📄 라이선스

MIT — [LICENSE](LICENSE) 참고. `vendor/` 아래에 [sonnylazuardi/cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp)의 MIT 라이선스 코드를 포함합니다.
