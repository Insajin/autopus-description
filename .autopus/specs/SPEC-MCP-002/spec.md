# SPEC-MCP-002: Claude Code Plugin Bundle for autopus-figma (MCP Server + Description Skill, One-Install Auto-Trigger)

**Status**: completed
**Created**: 2026-06-10
**Domain**: MCP
**Module**: `.` (root) — `.autopus/plugins/autopus-figma/` plugin package + `.agents/plugins/marketplace.json` registration
**Mode**: brownfield

## 목적 (Purpose)

Claude Code(CLI) 에서 autopus-figma 를 쓰려면 현재 사용자가 (1) MCP 서버를 수동 등록하고 (2) 디스크립션 작성 절차 스킬을 따로 배치해야 한다. 그 결과 설치 마찰이 크고, MCP 를 연결해도 "디스크립션을 생성하라"는 절차 스킬이 Claude Code 에 없으면 스킬이 자동 트리거되지 않는다.

이 SPEC 은 현 레포 안에 Claude Code 플러그인 패키지 `.autopus/plugins/autopus-figma/` 를 만들어, 설치 한 번에 (A) autopus-figma MCP 서버(stdio 진입점) 와 (B) figma 디스크립션 스킬이 함께 배치되게 한다. 스킬이 Claude Code 스킬 디렉토리에 들어가면 figma/디스크립션 관련 요청 시 자동 트리거된다. 이 플러그인이 번들하는 MCP 서버는 sibling SPEC-MCP-001 이 강화한 instructions/prompts 를 그대로 노출한다.

## 정본 자산 (실재 검증 완료)

- 디스크립션 스킬 정본: `.claude/skills/autopus/figma-description.md` (24681 bytes, 실재) 와 통합 사본 `.agents/skills/figma-description/SKILL.md` (21727 bytes, 실재). 이 스킬의 frontmatter(name: figma-description, triggers: figma/피그마/디스크립션/화면 정의/번호 뱃지 등)가 자동 트리거 매칭의 근거다. 플러그인은 이 스킬을 번들 스킬 디렉토리에 SKILL.md 로 포함한다(신규 창작 아님 — 정본 복사/링크).
- MCP 서버 진입점: `dist/src/daemon/mcp-stdio-entry.js` (package.json bin: `autopus-mcp-stdio`). 플러그인 mcpServers 가 이 진입점을 띄운다.
- 기존 등록 형식 참조: `.agents/plugins/marketplace.json` (auto 플러그인이 `{ source: "local", path: "./.autopus/plugins/auto" }` 형식으로 등록됨). auto 플러그인 패키지 구조: `.autopus/plugins/auto/.codex-plugin/plugin.json` + `.autopus/plugins/auto/skills/auto/SKILL.md`.

## 요구사항 (Requirements — EARS form, MoSCoW on a separate meta line)

REQ-01
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL provide a plugin manifest at `[NEW] .autopus/plugins/autopus-figma/.claude-plugin/plugin.json` whose `name` is "autopus-figma" and which declares the MCP server and the bundled description skill, so a single install wires both into Claude Code.

REQ-02
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL declare the autopus-figma MCP server in the plugin manifest mcpServers so that enabling the plugin starts the stdio entry point (dist/src/daemon/mcp-stdio-entry.js) without the user hand-editing any MCP config.

REQ-03
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL bundle the figma-description skill at `[NEW] .autopus/plugins/autopus-figma/skills/figma-description/SKILL.md` carrying the canonical skill frontmatter (name and triggers) so Claude Code auto-discovers and can auto-trigger it on figma/description requests.

REQ-04
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL register the autopus-figma plugin in `.agents/plugins/marketplace.json` as a local-source plugin entry (mirroring the existing auto plugin entry shape) so it appears in the local marketplace alongside auto.

REQ-05
Priority: Must
Type: Event-driven
WHEN `claude plugin validate` runs against the plugin directory, THE SYSTEM SHALL pass validation (manifest schema valid, name present, declared component paths resolve to existing files).

REQ-06
Priority: Should
Type: Ubiquitous
THE SYSTEM SHALL accept the Figma token as a plugin userConfig field marked sensitive, so the FIGMA_TOKEN is stored in secure storage rather than committed into settings or the manifest.

REQ-07
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL keep the MCP server command path resolvable via `${CLAUDE_PLUGIN_ROOT}` or an absolute/installed path, so the declared mcpServers command works regardless of the user checkout location.

REQ-08
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL keep no Figma channel secret and no Figma token literal value inside the plugin manifest or the bundled skill, so packaging does not embed per-session or per-user secrets.

REQ-09
Priority: Should
Type: Ubiquitous
THE SYSTEM SHALL document the install path (claude plugin marketplace add + claude plugin install autopus-figma) and the relationship to Desktop/Cursor (which rely on SPEC-MCP-001 instructions/prompts, not this plugin) in a plugin README, so users pick the correct integration per environment.

## Hard constraints

- HC-1 (no secret in package): the plugin manifest and bundled skill SHALL NOT contain a real FIGMA_TOKEN value or any Figma channel secret. The token is supplied at enable time via userConfig (sensitive) or the user's own MCP env (REQ-06/REQ-08).
- HC-2 (skill is canonical, not a fork): the bundled SKILL.md SHALL carry the same name and triggers as `.claude/skills/autopus/figma-description.md`, so the plugin ships the canonical description workflow rather than a divergent copy. Body content may be the canonical skill text.
- HC-3 (depends on MCP-001 server behavior): the bundled MCP server is the same stdio entry that SPEC-MCP-001 enhances. This SPEC does NOT modify server runtime code; it packages it. The instructions/prompts the plugin delivers come from SPEC-MCP-001.
- HC-4 (file-size): markdown and JSON packaging files are config/docs and exempt from the 300-line source limit; no new source code (.ts) is introduced by this SPEC.
- HC-5 (marketplace shape parity): the marketplace.json entry SHALL follow the same object shape the existing auto entry uses (name, source{source:"local",path}, policy, category) so the local marketplace loader treats both uniformly.

## 생성/변경 파일 상세

- [NEW] `.autopus/plugins/autopus-figma/.claude-plugin/plugin.json` — Claude Code plugin manifest. Fields: name "autopus-figma", version, description, mcpServers (inline object: autopus-figma → command node, args [path to mcp-stdio-entry.js], env), skills ("./skills" default location), userConfig (figma_token sensitive). No literal secret.
- [NEW] `.autopus/plugins/autopus-figma/skills/figma-description/SKILL.md` — the bundled description skill carrying the canonical frontmatter (name: figma-description; triggers: figma, 피그마, 디스크립션, 화면 정의, 번호 뱃지, ...) and the canonical body from `.claude/skills/autopus/figma-description.md`.
- [NEW] `.autopus/plugins/autopus-figma/README.md` — install instructions (marketplace add + install), per-environment guidance (Claude Code = this plugin; Desktop/Cursor = SPEC-MCP-001 instructions/prompts + manual MCP config), and FIGMA_TOKEN setup via userConfig.
- `.agents/plugins/marketplace.json` (변경) — append an autopus-figma plugin entry to the `plugins` array, mirroring the existing auto entry shape (source local path "./.autopus/plugins/autopus-figma").
- [NEW] `.autopus/plugins/autopus-figma/.codex-plugin/plugin.json` (optional, Should) — codex-format manifest mirroring auto's `.codex-plugin/plugin.json`, only if cross-provider parity is desired; gated by REQ-09 documentation rather than required for Claude Code.

## Out of scope

- MCP server runtime changes (instructions/prompts) — owned by SPEC-MCP-001 (this plugin packages that server).
- claude.ai web client (explicitly out-of-scope per confirmed design decision).
- Publishing to a public/remote marketplace (git host). This SPEC targets the in-repo local marketplace only.
- Modifying the description skill body content/voice (HC-2: bundle the canonical skill as-is; voice lives in node-only.ts per MEMORY).
- Building/altering the Figma plugin (vendor code.js, dist/plugin) — unrelated to client-side workflow exposure.

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| plugin manifest declares MCP + skill (REQ-01) | this SPEC | covered |
| mcpServers starts stdio entry on enable (REQ-02) | this SPEC (S1) | covered |
| description skill bundled with canonical frontmatter (REQ-03) | this SPEC (S2) | covered |
| marketplace.json registration (REQ-04) | this SPEC (S3) | covered |
| claude plugin validate passes (REQ-05) | this SPEC (S4) | covered |
| FIGMA_TOKEN via sensitive userConfig (REQ-06) | this SPEC (S5) | covered |
| command path resolvable via plugin root (REQ-07) | this SPEC (S1) | covered |
| no secret/token literal in package (REQ-08) | this SPEC (S6) | covered |
| install/per-environment docs (REQ-09) | this SPEC (S7) | covered |
| server instructions/prompts the plugin delivers | SPEC-MCP-001 | depends-on (done when MCP-001 lands) |
| Desktop/Cursor workflow exposure | SPEC-MCP-001 | depends-on |

## Traceability Matrix

| REQ | Priority | Plan task(s) | Acceptance scenario(s) |
|-----|----------|--------------|------------------------|
| REQ-01 plugin manifest declares MCP + skill | Must | T1 | S1, S4 |
| REQ-02 mcpServers starts stdio entry | Must | T1 | S1 |
| REQ-03 bundled skill canonical frontmatter | Must | T2 | S2 |
| REQ-04 marketplace.json registration | Must | T3 | S3 |
| REQ-05 claude plugin validate passes | Must | T1, T2, T4 | S4 |
| REQ-06 FIGMA_TOKEN sensitive userConfig | Should | T1 | S5 |
| REQ-07 command path resolvable | Must | T1 | S1 |
| REQ-08 no secret/token literal | Must | T1, T2, T5 | S6 |
| REQ-09 install/per-environment docs | Should | T4 | S7 |

## Sibling SPEC Decision

이 요청은 단일 SPEC 이 아니라 sibling 세트(SPEC-MCP-001 + SPEC-MCP-002)로 분해했다. 분해 사유: 구현 레이어가 상이하다 — SPEC-MCP-001 은 MCP 서버 런타임 TypeScript 변경(src/daemon/*, vitest 테스트)이고, 이 SPEC 은 패키징 자산(.claude-plugin/plugin.json, SKILL.md, marketplace.json) 으로 신규 .ts 소스가 없다(HC-4). 테스트 방식(claude plugin validate + JSON 파싱 + grep vs vitest in-memory client/server), module ownership, 변경 위험도가 다르다. 예외 사유로 분리하되 의존 순서를 고정한다: 이 SPEC 은 SPEC-MCP-001 에 의존한다(HC-3) — plugin 이 번들하는 MCP 서버가 SPEC-MCP-001 의 instructions/prompts 를 노출해야 one-install 가치가 완성된다. 두 SPEC 합산이 사용자 요청의 3개 환경 자동 사용을 닫는다.

## Related SPECs

- SPEC-MCP-001 — server-side instructions/prompts that this plugin's bundled MCP server delivers to Claude Code. This SPEC depends on MCP-001: the one-install value is full only once the server advertises the workflow (MCP-001) AND the skill auto-triggers (this SPEC). The two together close the "3개 환경 전부" outcome; Desktop/Cursor are closed by MCP-001 alone.
- SPEC-FIGMA-009/011 — the stdio MCP server (tools + write path) that is packaged here.
- SPEC-FIGMA-003 — node-only description prompt (body voice), referenced by the bundled skill but not modified.
