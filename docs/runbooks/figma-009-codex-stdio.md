# SPEC-FIGMA-009 — Codex stdio runbook

> 본 runbook 은 SPEC-FIGMA-009 REQ-07 의 Codex CLI / Claude Code stdio MCP 클라이언트 등록 및 verify 절차를 다룹니다. 잠정 위치였던 `.autopus/specs/SPEC-FIGMA-009/research.md` Appendix A 의 동등 섹션을 본 파일로 승격합니다 (T8 final 결정).

## 목적

`autopus-mcp-stdio` (SPEC-FIGMA-009 신규 bin) 를 외부 MCP 클라이언트 (Codex CLI, Claude Code) 에 stdio transport 로 등록하고, `client_profile_attached` audit row 가 정상 emit 되는지 macOS 호스트에서 manual 검증한다. Windows desktop 정식 verify 는 `.autopus/probes/transport-matrix.jsonl` 의 `unverified` 행 append 로 잠정 처리한다 (SPEC §4 Out of Scope, 후속 SPEC 후보 SPEC-FIGMA-012).

## 사전 준비

1. repo 루트에서 production 빌드 산출물이 존재해야 한다.

   ```bash
   npm install
   npm run build   # dist/src/daemon/mcp-stdio-entry.js 생성
   ```

2. PATH 에 npm bin 노출 — 둘 중 하나 선택.

   ```bash
   # option A — global link (권장: dev 환경)
   npm link

   # option B — global install (권장: 고정 버전 운영)
   npm install -g .
   ```

   설치 확인:

   ```bash
   which autopus-mcp-stdio
   autopus-mcp-stdio --version 2>/dev/null || echo "ok (no version flag)"
   ```

## A.1 Codex CLI 등록 (`~/.codex/config.toml`)

`[mcp_servers.autopus_figma]` 블록을 사용자 home 의 `~/.codex/config.toml` 에 추가한다.

```toml
[mcp_servers.autopus_figma]
command = "autopus-mcp-stdio"
args = []

[mcp_servers.autopus_figma.env]
AUTOPUS_AUDIT_DIR = "/Users/<you>/Documents/github/auto-discription/.autopus"
```

필드 의미:

- `command` — PATH 에 등록된 npm bin 이름. `autopus-daemon` 과는 별개의 long-running stdio entry (SPEC-FIGMA-009 INV-W5 lifecycle 분리).
- `args` — 빈 배열. 추가 플래그 없음.
- `env.AUTOPUS_AUDIT_DIR` — `<auditDir>/audit.jsonl` 가 기록될 절대경로. 미설정 시 process cwd 의 `.autopus/` 사용.

`<you>` 부분은 실제 macOS 사용자 home 으로 교체. 토큰/시크릿 placeholder 는 절대 `config.toml` 에 직접 기록하지 않는다 (Q-SEC-02 — 해당 surface 에는 secret 미관여).

## A.2 Claude Code 등록

```bash
claude mcp add autopus-figma -- autopus-mcp-stdio
```

또는 `~/.config/claude/mcp_servers.json` 에 동등 entry 직접 작성 (Claude Code 설치 docs 참조).

## A.3 macOS verify 절차

1. 위 사전 준비 (`npm install && npm run build && npm link`) 가 완료된 상태인지 확인.
2. Codex CLI 또는 Claude Code 의 MCP server 목록을 reload 한다 (각 클라이언트 docs 참조).
3. 외부 client 의 resource 목록에 다음 4개 URI 가 등장하는지 확인.

   ```
   autopus://active_selection
   autopus://pending_descriptions
   autopus://audit_events
   autopus://stale_frames
   ```

4. `<auditDir>/audit.jsonl` 의 마지막 행을 확인.

   ```bash
   tail -1 "$AUTOPUS_AUDIT_DIR/audit.jsonl"
   ```

   예상 행 (key 순서는 `DaemonAuditWriter.emitEvent` 가 결정):

   ```json
   {"event":"client_profile_attached","client_id":"claude-code","transport":"stdio","capabilities":["resources.read","tools.call"],"profile_id":"claude-code-local","attached_at":"2026-05-07T..."}
   ```

   체크 포인트:
   - `event` == `client_profile_attached`
   - `client_id` 가 client 측 `clientInfo.name` substring 과 매치되는 profile (보통 `claude-code-local`)
   - `capabilities` 배열이 정확히 `["resources.read","tools.call"]` (SPEC-FIGMA-006 AC-S11 baseline byte-equal)
   - `figd_*` 토큰 매치 0개 (SPEC-FIGMA-006 INV-006 보존)

## A.4 `transport-matrix.jsonl` `unverified` 행 append (Windows)

Windows 호스트에서 정식 verify 가 완료되기 전까지 `.autopus/probes/transport-matrix.jsonl` 에 다음 형태의 1개 행을 append. 파일 부재 시 `mkdir -p .autopus/probes/` 후 생성한다.

```json
{"probe_target":"codex_windows_stdio","started_at":"<ISO-8601>","finished_at":"<ISO-8601>","status":"unverified","mcp_protocol_version":"1.13.1","capabilities_advertised":["resources.read","tools.call"],"error_text_redacted":""}
```

key set 은 SPEC-FIGMA-008 AC-T10 `codex-windows` 행 7-key 와 일치 (set equality, no `doc_excerpt`). `error_text_redacted` 는 빈 문자열 또는 `redact` + `redactTunnelUrl` 통과 후 결과만 기록한다 (figd_ 매치 0개, cloudflared URL 매치 0개). `status:"verified"` 승격은 §4 Out of Scope 후속 SPEC 에서 처리 (SPEC-FIGMA-012 가칭).

## 트러블슈팅

- **`command not found: autopus-mcp-stdio`** — `npm link` (or `npm install -g .`) 미실행. PATH 재확인.
- **`audit.jsonl` 에 `client_profile_attached` 행 없음** — `oninitialized` callback 미발화. client 측 `initialize` exchange 가 끊긴 경우 (transport 혹은 SDK 버전 불일치). client 로그 확인.
- **`capabilities` 배열 mismatch** — `CapabilityProfileRegistry.matchProfile` 의 substring match 가 다른 profile 로 falling. 의도한 profile 이 `claude-code-local` 인지 client name 으로 재확인.
- **`booted` JSON 라인이 stdout 에 등장** — `autopus-mcp-stdio` 가 아닌 `autopus-daemon start` 를 실수로 등록한 경우. config 의 `command` 재확인 (INV-W5 lifecycle 분리).

## 관련 문서

- SPEC: [.autopus/specs/SPEC-FIGMA-009/spec.md](../../.autopus/specs/SPEC-FIGMA-009/spec.md)
- 수락 기준: [.autopus/specs/SPEC-FIGMA-009/acceptance.md](../../.autopus/specs/SPEC-FIGMA-009/acceptance.md)
- 리서치 부록 (origin): [.autopus/specs/SPEC-FIGMA-009/research.md](../../.autopus/specs/SPEC-FIGMA-009/research.md) — Appendix A
