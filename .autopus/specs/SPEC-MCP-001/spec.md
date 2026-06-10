# SPEC-MCP-001: Bundle the Frame-Description Workflow into the MCP Server (Instructions + Prompts Capability)

**Status**: completed
**Created**: 2026-06-10
**Domain**: MCP
**Module**: `.` (root) — `src/daemon/` MCP server runtime (stdio + http entry points)
**Mode**: brownfield

## 목적 (Purpose)

autopus-figma MCP 서버를 연결하면 현재는 툴 목록만 노출되고, "언제 어떤 순서로 프레임 디스크립션을 생성하라"는 절차 지식이 클라이언트에 전달되지 않는다. 그 결과 Claude Desktop, Cursor, Claude Code(CLI) 어디에서도 디스크립션 생성 워크플로우가 자동으로 발동되지 않는다.

현재 `DEFAULT_INSTRUCTIONS`는 한 줄짜리 메타 설명(`src/daemon/mcp-stdio-entry.ts:78`, `src/daemon/mcp-http-session-manager.ts:23`)으로, 노출된 10개 툴(get_pending_descriptions, dryRun, approve, apply, undo, get_description_language, get_active_selection, get_stale_frames, plan_emit, get_audit_events)의 사용 순서를 안내하지 않는다. MCP 서버는 `capabilities: { resources: {}, tools: {} }` 만 광고하고 prompts capability가 없어, `/mcp__autopus-figma__<prompt>` 슬래시 워크플로우도 노출되지 않는다.

이 SPEC은 MCP 서버 런타임 자체가 모든 MCP 클라이언트에 워크플로우 절차를 전달하도록, 두 전달 경로 — (A) 연결 즉시 자동 주입되는 instructions, (B) 명시적으로 호출하는 prompts capability — 를 추가한다. Claude Code 전용 플러그인 번들은 sibling SPEC-MCP-002가 담당한다.

## 워크플로우 source of truth

디스크립션 생성 절차의 정본 지식은 이미 저장소에 존재한다: `.claude/skills/autopus/figma-description.md` (321 lines) 와 그 통합 사본 `.agents/skills/figma-description/SKILL.md`. instructions/prompts에 들어갈 절차 텍스트는 이 지식을 압축한 단일 상수에서 파생하며, 별도 워크플로우 본문을 새로 창작하지 않는다. 디스크립션 본문 문체는 `src/prompts/node-only.ts`(buildNodeOnlyPrompt, NODE_ONLY_HANDOFF_RULES)가 LLM 호출 시점에 이미 강제하므로, 이 SPEC의 instructions/prompts는 툴 호출 순서와 절차 게이트를 안내하는 운영 가이드 레이어이며 문체 정의를 중복하지 않는다.

## 요구사항 (Requirements — EARS form, MoSCoW on a separate meta line)

REQ-01
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL define the frame-description workflow guidance as a single shared source-of-truth constant exported from one `[NEW] src/daemon/figma-workflow-guidance.ts` module, so the stdio entry, the http entry, and the prompts handler all render the same procedural text instead of duplicating divergent strings. The shared constant SHALL name only tools registered on BOTH the stdio and http transports; transport-conditional tools (notably `get_description_language`, registered only when a language getter is wired, which the http session does not have) SHALL NOT be named in the shared workflow body — language guidance is appended separately on the stdio instructions and in the prompts language line (REQ-07).

REQ-02
Priority: Must
Type: Event-driven
WHEN an MCP client completes the initialize handshake against the stdio server, THE SYSTEM SHALL surface server instructions that name the ordered description-generation workflow (selection or stale discovery, then dryRun, then approve, then apply, with undo as the reversal step) referencing the actual exposed tool names, in addition to the existing channel-secret and description-language guidance.

REQ-03
Priority: Must
Type: Event-driven
WHEN an MCP client completes the initialize handshake against the http session server, THE SYSTEM SHALL surface the same workflow-guidance text as the stdio server, so the two transports advertise consistent procedural instructions rather than the current two divergent one-line strings.

REQ-04
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL advertise a prompts capability in the server initialize response (capabilities.prompts) and register ListPrompts and GetPrompt request handlers, so MCP clients expose the workflow as an explicit `/mcp__autopus-figma__<prompt>` slash command.

REQ-05
Priority: Must
Type: Event-driven
WHEN a client sends a prompts/list request, THE SYSTEM SHALL return at least one prompt named `generate_frame_descriptions` whose description states it guides the dryRun then approve then apply frame-description workflow.

REQ-06
Priority: Must
Type: Event-driven
WHEN a client sends a prompts/get request for `generate_frame_descriptions`, THE SYSTEM SHALL return a messages array containing a user-role text message that embeds the ordered workflow steps and the actual tool names so the client can drive the workflow.

REQ-07
Priority: Should
Type: Event-driven
WHEN the prompts/get response is rendered and a live description-language getter is wired, THE SYSTEM SHALL state the active description language (the get_description_language value, default ko) in the prompt text so generated descriptions follow the user-selected language.

REQ-08
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL keep the per-session Figma channel secret out of the prompts/list and prompts/get payloads, so the workflow exposure path does not weaken the C-1 boundary that today surfaces the secret only in the trusted stdio initialize instructions.

REQ-09
Priority: Should
Type: Ubiquitous
THE SYSTEM SHALL keep the additive prompts surface from changing the existing resources and tools wire surface, so callers that wire none of the new code observe a byte-equal tools/resources list (the SPEC-FIGMA-009 INV-W4 baseline).

## Hard constraints

- HC-1 (file size): every NEW source file SHALL stay at or under 300 lines (target under 200). The workflow-guidance text lives in its own module; the prompts handler lives in a separate `[NEW] src/daemon/mcp-stdio-prompt-handlers.ts` so `mcp-stdio-handlers.ts` (314 lines) is not pushed over the limit.
- HC-2 (additive capability): adding `prompts` to `capabilities` and registering ListPrompts/GetPrompt SHALL NOT alter the existing ListTools/ListResources output. The redaction chokepoint (INV-W2) and the read-only tool baseline (INV-W4) stay intact.
- HC-3 (no secret leak): the channel secret (a per-session random value, never copied into this SPEC) SHALL NOT appear in prompt payloads. Only the stdio initialize instructions may carry it, exactly as today.
- HC-4 (language source): the prompt language line SHALL read from the existing live `descriptionLanguage()` getter, not a new hardcoded default, so it stays consistent with the get_description_language tool.
- HC-5 (shared-tool intersection): the shared workflow guidance constant SHALL reference only tools exposed on BOTH transports (get_active_selection, get_stale_frames, get_pending_descriptions, get_audit_events, plan_emit, dryRun, approve, apply, undo). `get_description_language` (stdio-only, language-getter-gated — absent from `mcp-http-session-manager.ts`) and the channel secret SHALL be appended OUTSIDE the shared body — on the stdio instructions and/or the prompts language line — so the http transport never advertises a tool it does not register.

## 생성/변경 파일 상세

- [NEW] `src/daemon/figma-workflow-guidance.ts` — exports `FRAME_DESCRIPTION_WORKFLOW` (the ordered-steps guidance string derived from the figma-description skill) plus a `renderWorkflowInstructions(opts)` helper that optionally appends the active language. Single source of truth for REQ-01. Under 200 lines.
- [NEW] `src/daemon/mcp-stdio-prompt-handlers.ts` — exports `registerPromptHandlers(server, ctx)` that wires `ListPromptsRequestSchema` and `GetPromptRequestSchema` (from `@modelcontextprotocol/sdk/types.js`). ListPrompts returns the `generate_frame_descriptions` descriptor; GetPrompt returns a messages payload built from `FRAME_DESCRIPTION_WORKFLOW` plus an optional language line, using a user-role text content block. No channel secret. Under 200 lines.
- `src/daemon/mcp-stdio-entry.ts` (변경) — replace the one-line `DEFAULT_INSTRUCTIONS` body with a call to `renderWorkflowInstructions`; add a `prompts` entry to the `capabilities` object (around line 183); call `registerPromptHandlers(server, { descriptionLanguage: input.descriptionLanguage })` alongside the existing handler registrations. Channel-secret and language append logic unchanged.
- `src/daemon/mcp-http-session-manager.ts` (변경) — replace its divergent one-line `DEFAULT_INSTRUCTIONS` (line 23) with the same `renderWorkflowInstructions` output; add a `prompts` entry to capabilities; call `registerPromptHandlers`. The http session has no live language getter, so the language line is omitted (REQ-07 is Should and getter-gated).
- [NEW] `tests/unit/mcp-prompts-surface.test.ts` — drives an in-memory client/server pair (mirroring existing tool-surface tests) to assert prompts/list returns `generate_frame_descriptions`, prompts/get returns a user-role message containing the ordered tool names, no channel secret leaks into either payload, and the tools/resources baseline is unchanged.

## Out of scope

- Claude Code plugin bundle, marketplace registration, plugin-shipped skills — owned by sibling SPEC-MCP-002.
- Changing the description body voice / `node-only.ts` prompt content (per MEMORY: voice is a prompt-level concern handled there; this SPEC only adds the operational workflow layer).
- MCP tool schema changes (the 10-tool surface is unchanged; only prompts are added).
- claude.ai web client (explicitly out-of-scope per the confirmed design decision).

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| Single source-of-truth workflow constant (REQ-01) | this SPEC | covered |
| stdio instructions name the ordered workflow (REQ-02) | this SPEC (S1) | covered |
| http instructions match stdio (REQ-03) | this SPEC (S2) | covered |
| prompts capability advertised + handlers registered (REQ-04) | this SPEC (S3) | covered |
| prompts/list returns generate_frame_descriptions (REQ-05) | this SPEC (S3) | covered |
| prompts/get returns ordered-workflow user message (REQ-06) | this SPEC (S4) | covered |
| active language stated in prompt text (REQ-07) | this SPEC (S5) | covered |
| channel secret excluded from prompt payloads (REQ-08) | this SPEC (S6) | covered |
| tools/resources baseline unchanged (REQ-09) | this SPEC (S7) | covered |
| Claude Code plugin auto-trigger via bundled skill | SPEC-MCP-002 | planned |
| Desktop/Cursor end-user install instructions | SPEC-MCP-002 (docs) | planned |

## Traceability Matrix

| REQ | Priority | Plan task(s) | Acceptance scenario(s) |
|-----|----------|--------------|------------------------|
| REQ-01 single source-of-truth constant | Must | T1 | S1, S2, S3 |
| REQ-02 stdio workflow instructions | Must | T1, T2 | S1 |
| REQ-03 http workflow instructions | Must | T1, T4 | S2 |
| REQ-04 prompts capability + handlers | Must | T2, T3, T4 | S3 |
| REQ-05 prompts/list descriptor | Must | T3 | S3 |
| REQ-06 prompts/get ordered message | Must | T3 | S4 |
| REQ-07 active language line | Should | T2, T3 | S5 |
| REQ-08 no secret in prompt payloads | Must | T3, T5 | S6 |
| REQ-09 tools/resources baseline unchanged | Should | T2, T4, T5 | S7 |

## Sibling SPEC Decision

이 요청은 단일 SPEC 이 아니라 sibling 세트(SPEC-MCP-001 + SPEC-MCP-002)로 분해했다. 분해 사유: 구현 레이어가 상이하다 — 이 SPEC 은 MCP 서버 런타임 TypeScript 변경(src/daemon/*, vitest 테스트)이고, SPEC-MCP-002 는 패키징 자산(.claude-plugin/plugin.json, SKILL.md, marketplace.json) 으로 신규 .ts 소스가 없다. 테스트 방식(vitest in-memory client/server vs claude plugin validate), module ownership, 변경 위험도가 다르다. 예외 사유로 분리하되 의존 순서를 고정한다: SPEC-MCP-002 는 이 SPEC 에 의존한다(plugin 이 번들하는 MCP 서버가 이 SPEC 의 instructions/prompts 를 노출). Desktop·Cursor 는 이 SPEC 단독으로 닫히고, Claude Code 의 스킬 자동 트리거 강화만 SPEC-MCP-002 가 닫는다.

## Related SPECs

- SPEC-MCP-002 — Claude Code plugin bundle (`.claude-plugin/` + `.autopus/plugins/autopus-figma/` + marketplace registration). Depends on this SPEC: the plugin bundles the same MCP server, so the instructions/prompts shipped here are what the plugin delivers to Claude Code.
- SPEC-FIGMA-009 — stdio MCP wire surface, INV-W2 (redaction chokepoint), INV-W4 (read-only tool baseline), client_profile_attached single-emit.
- SPEC-FIGMA-011 — write-path tools (plan_emit/dryRun/approve/apply/undo, names confirmed at mcp-stdio-write-handlers.ts:68-88) that the workflow orders.
- SPEC-FIGMA-014/015/016/017 — optional tool surfaces appended to ListTools; this SPEC must not perturb their ordering.
- SPEC-FIGMA-003 — node-only description prompt (`src/prompts/node-only.ts`), the body-voice source of truth this SPEC defers to.
