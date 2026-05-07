# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added — SPEC-FIGMA-007 (2026-05-07)

Autopus MCP Daemon **write path** — sonnylazuardi plugin fork에 dryRun → Approve →
apply → 1-step undo 게이트 추가. SPEC-FIGMA-006 read-only wedge 위에 additive
plan-emit 브랜치로 구성, SPEC-FIGMA-004 6-route executor contract 보존
(NFR-04 byte-equal). BS-003 OSS Adoption Update Decision 1+2 closure — chat UI
없이 plugin status panel만이 confirmation 표면.

- **write-router `mode:"plan-emit"` option** (`packages/write-router/src/index.ts`
  +5-line guard, `packages/write-router/src/plan-emit/` 신규 7개 파일)
  — Figma mutation 없이 직렬화된 `PluginCommand[]` + `manifest_entry_hash` +
  `undo_descriptor_template` 반환. 6 write target (annotation_card /
  descriptions_page / comment / plugin_data / frame_name / none) 별 helper.
  default(executor) 모드 byte-equal 보존 (REQ-01, NFR-04).

- **Daemon write tools** (신규 `src/daemon/{dryrun-tool,apply-tool,undo-tool,
  pending-writes,write-audit,write-mcp-resources,daemon-undo-registry,
  plugin-port,client-handshake,probe-runner}.ts`)
  — `autopus.dryRunWrite` / `autopus.applyWrite` / `autopus.undoWrite` 3 MCP
  tool. `pending_id` 기반 60s TTL 스냅샷 (`expires_at` GC). `autopus://
  pending_writes` + `autopus://applied_writes` 리소스 발행 (REQ-02, REQ-15).

- **Drift guard + apply atomicity** (`src/daemon/apply-tool.ts`,
  `src/daemon/write-audit.ts` `appendAuditDriftAbort` 9-key writer)
  — plugin webcrypto port `autopus_source_hash.ts`로 Approve 시점 source_hash
  재계산 → daemon에서 `source_hash_dryrun` 와 byte-equal 비교. mismatch 시
  `APPLY_DRIFT_ABORT` 거부 + 9-key audit row 발행. dryRun 미경유 apply는
  `MISSING_DRYRUN_GATE`로 차단 (REQ-04~05, REQ-12, REQ-19, INV-008/009).

- **Idempotent re-apply + 1-step undo** — 기존 `computeManifestEntryHash`
  재사용 (NFR-07 dual hash 금지). `IdempotencyTracker` 히트 시
  `IDEMPOTENT_SKIP` 7-key audit. `UndoDescriptor` 5-variant (`delete-node` /
  `delete-comment` / `clear-plugin-data` / `restore-frame-name` / `noop`)
  inverse `PluginCommand[]`로 직렬화 후 plugin dispatch. undo 후 source_hash
  byte-equal pre-dryRun (REQ-07~08).

- **Audit retention guard — DEBUG raw redaction** (`src/daemon/
  audit-retention-guard.ts` 145 lines, `src/daemon/redact-extended.ts` 73
  lines, `src/redact-patterns.ts` 38 lines, single source of truth)
  — frozen `src/audit-emitter.ts` (NFR-04) 의 DEBUG=true raw 파일 영속화
  경로를 wrapper로 우회: `prompt_text` / `response_text`를 figd_ + xoxb- +
  bearer + absolute-path 패턴으로 redact한 뒤 `.audit/<batch_id>/raw/*.json`에
  기록. frozen 파일 미수정. 3-port redact 패턴 parity 검증
  (`tests/unit/redact-patterns-parity.test.ts`) 으로 drift detection
  (REQ-10/13/21, NFR-03).

- **Plugin status panel + Approve/Undo button** (`vendor/cursor-talk-to-
  figma-mcp/src/cursor_mcp_plugin/autopus_status_panel.{html,ts}`,
  `autopus_command_dispatch.ts`, `autopus_redact.ts`,
  `autopus_source_hash.ts`)
  — chat UI 0개 (BS-003 Decision 2). `[Approve]` 버튼이 유일한
  `apply_request` emission site (REQ-20). 6 sonnylazuardi 도구 매핑 +
  미매핑 시 autopus 전용 dispatcher switch (REQ-09).

- **Phase 0 telemetry 확장** (`src/daemon/telemetry.ts` +75 lines)
  — `dryrun_count`, `approve_count`, `undo_count`, `apply_drift_abort_count`
  4개 monotonic counter 추가 (REQ-11, INV-002 확장).

- **Plugin disconnect 복구 + pending expiry** (REQ-14, REQ-15)
  — 부분 완료 후 disconnect 시 `IdempotencyTracker` 미기록 →
  `APPLY_PARTIAL_DISCONNECT` audit + 재연결 시 inverse 롤백. 60s TTL 만료
  pending은 `PENDING_EXPIRED`로 거부.

- **30-frame sequential approve oracle** (`tests/integration/figma-007/
  AC-S{1..14}.test.ts`, `AC-S12.fixtures.ts`, `__helpers/
  mock-plugin-bridge.ts`) — 30 distinct frame: dryRun → Approve → apply
  60-record audit chain (`prompt_sha256` 64-hex, 0 break), 0 drift abort,
  0 idempotency violation. 첫/마지막 record `prompt_sha256` literal hash
  oracle (REQ-18, AC-S12).

- **Web `/api/apply` & `/api/undo` 보존** (REQ-16) — 두 route 파일 byte-diff
  0. daemon write path 와 web bulk dashboard path는 process-local
  `IdempotencyTracker` 인스턴스 분리 (SPEC-FIGMA-004 NFR-01).

**파이프라인 결과**: 신규 21 tasks (T1..T21) closure, 신규 파일 90+ (src/daemon/
25개, plan-emit/ 8개, tests 37개, plugin 5개), 6/6 write target 매핑, 14/14 AC
oracle PASS, multi-provider review verdict PASS (claude/gemini 34/34 PASS,
0 FAIL). frozen contract regression 0 (write-router idempotency / undo-registry /
audit-log / source-hash / audit-emitter / token-redactor / web routes).

**Sibling SPEC handoff**: SPEC-FIGMA-008 (MCP transport matrix · cloudflared
tunnel) 은 본 SPEC daemon WebSocket bridge에 transport hardening을 부착
가능하나 directly dependent 아님 — 두 SPEC 독립 ship.

### Added — SPEC-FIGMA-008 Phase A (2026-05-07, partial)

MCP transport matrix wedge — Phase A 한정 (T1 + T8 / 17). 전체 SPEC closure 아님 (SPEC status `approved` 유지). Phase B+ 후속 진행 대상은 tunnel adapter, bearer/TTL session, 1-click revoke, probe runner, threat model + opsec runbook.

- **`src/daemon/capability-profile-registry.ts` (신규, 90 lines)** — 3-profile registry (`claude-code-local` / `codex-windows-stdio` / `claude-cowork-remote`). SPEC-FIGMA-006 INV-007 baseline 위에 additive. `Object.freeze` 기반 immutability + `readonly` 타입 + nested freeze로 capability arrays 보호. `default_capabilities_locked: true` 게이트 (REQ-01, REQ-02, NFR-02).
  - AC-T1 oracle (canonical 3-profile order) + AC-T12 oracle (FIGMA-006 baseline byte-equal `["resources.read","tools.call"]` / `["resources.read","tools.call","fallback.polling"]`) 단위 테스트로 검증.
  - `matchProfile()`은 unknown transport에서 `null` 반환 (fail-closed 기본값).

- **`src/token-redactor.ts` (additive +9 lines)** — `TUNNEL_URL_PATTERN` + `redactTunnelUrl` export 추가 (REQ-08, NFR-03). 기존 `redact` / `TOKEN_PATTERN` (figd_ surface)와 독립적; 합성은 caller 책임.
  - regex `/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?::\d+)?(?:\/[^"'\s]*)?/g` — `[^"'\s]*` 경로 클래스로 JSON 직렬화 컨텍스트의 닫는 `"` / `'` 소비 방지 (AC-T9 oracle: parseable JSON 보존). 선택적 `:port` 그룹으로 비표준 포트 URL의 path 잔류 차단.
  - 회귀 테스트: JSON-embedded URL은 parseable 출력, port-bearing URL `:8443/secret/path` 완전 제거.

- **단위 테스트 (신규)** — `tests/unit/daemon-capability-registry.test.ts` (12 tests), `tests/unit/token-redactor-tunnel-url.test.ts` (8 active + 1 skip). registry 100% lines / 92.85% branches / 100% funcs, redactTunnelUrl 100% 신규 함수 커버리지.

**파이프라인 결과**: subagent dispatch 8회 (tester→executor→validator→executor→annotator→reviewer→security-auditor→reviewer), Gate 2 RALF iter 1/5 (tsc null-assertion 수정), Phase 4 RALF iter 1/3 (regex 보안 수정으로 reviewer HIGH+MEDIUM 2건 closure).

**Phase B follow-up (security-auditor F1, LOW)**: `redactTunnelUrl`이 `https://user:pass@host` userinfo prefix 우회 가능 — Phase A에서 production caller 없어 영향 없으나, Phase B integration 시점에 regex `(?:[^@\s/]+@)?` 추가 필요.

### Added — SPEC-FIGMA-006 (2026-05-07)

Autopus MCP Daemon (read-only wedge) — sonnylazuardi backend adopt + Phase 0
dogfood telemetry. Plugin selection-change → daemon → MCP resource 발행 경로를
기존 `runReadPipeline` / `runBatch` / `wrapUntrustedFigmaText` /
`emitAuditRecord` 호출만으로 구성하는 parallel branch. 30-frame Phase 0
도그푸딩 측정용 4-counter telemetry 발행. Write 경로(PluginCommand emit /
dryRun/approve/apply / undo)는 sibling SPEC-FIGMA-007로 분기.

- **`autopus-daemon` CLI** (`src/daemon/cli.ts` → `dist/src/daemon/cli.js`)
  - `start --transport=stdio|http --port=<n>` / `stop` / `status` 3 서브커맨드
  - PID 파일 lifecycle, stale PID 감지 시 `daemon_recovered_from_crash` audit row 발행
  - `start` 시 per-session token 생성 (regex `/^[A-Za-z0-9_-]{32,}$/`) 후 stdout 1회 출력
  - `status` 출력: `pid`, `transport`, `port`, `uptime_ms`, `connected_clients`, `last_selection_event_at`
- **WebSocket bridge** (`src/daemon/bridge.ts`)
  - `127.0.0.1` only bind — 외부 인터페이스 노출 차단 (REQ-14/NFR-03)
  - per-session token strict equality 게이트, mismatch 시 close code 4401
  - 모든 outbound frame `redact()` 통과 — `figd_*` 토큰 누출 0건 보증 (INV-006)
- **Selection FIFO + 200ms debounce/coalesce** (`src/daemon/selection-queue.ts`)
  - 동일 frame_id 200ms 내 trailing 이벤트 단일 accept로 coalesce
  - 다른 frame_id 간 emission order 100% 보존 (INV-001)
- **Read/Generation 재사용 (no reimplement)**
  - `runReadPipeline` (`src/read-pipeline.ts`) — 입출력 스키마 변경 없이 호출만
  - `runBatch` (`src/batch-executor.ts`) + `wrapUntrustedFigmaText`
    (`src/prompts/untrusted-fence.ts`) — daemon이 받은 모든 plugin 페이로드는 fence 통과
  - `computeSourceHash` (`src/source-hash.ts`) — 동일 frame 입력 byte-equal 재계산
- **4 MCP resources** (`src/daemon/mcp-resources.ts`)
  - `autopus://active_selection` — 현재 active selection 단일 entry
  - `autopus://pending_descriptions` — 최근 30 entry ring (PENDING_LIMIT)
  - `autopus://audit_events` — JSONL stream (`EmittedAudit` 16-key shape 보존)
  - `autopus://stale_frames` — `source_hash` 재계산이 가장 최근 발행과 다른 frame ids (INV-004)
  - 모든 read는 idempotent + state 무변경
- **Phase 0 telemetry** (`src/daemon/telemetry.ts`,
  `apps/review-ui/src/app/api/telemetry-summary/route.ts`)
  - 4 monotonic counter 발행: `selection_to_chat_ms`, `generation_ms`,
    `ai_requery_count`, `dwell_ms`
  - `.autopus/telemetry/phase0.jsonl` (gitignored) append-only — 7-key
    JSONL byte-stable shape. 키 추가 시 `/api/telemetry-summary` 스키마 bump 필요
  - `Math.max` 기반 INV-002 monotonic guard
  - Web UI는 bulk metrics dashboard로 demote, single-frame 검수는 plugin으로
    이관 (REQ-11). `/api/load|apply|undo|feedback` 변경 없음
- **Capability negotiation** (`src/daemon/capability-profile.ts`)
  - 클라이언트 transport class 자동 감지: `stdio` / `http` / `tunnel` 3 profiles
  - `client_profile_attached` audit row + `capabilities[]` 발행
  - tunnel은 `["resources.read","tools.call","fallback.polling"]` (degraded mode)
- **Untrusted MCP input sanitization** (`src/daemon/untrusted-mcp-input.ts`,
  `src/daemon/mcp-tools.ts`)
  - 모든 MCP tool string arg는 `wrapUntrustedFigmaText` 통과 후에만
    provider prompt 어셈블리 진입
  - HTML-escape 보존 — `</UNTRUSTED_DESIGN_TEXT>` 리터럴이 constructed_prompt에
    절대 등장 금지 (AC-S8 oracle)
  - `redact` 통과 후에만 audit emit
- **Audit chain** (`src/daemon/audit-writer.ts`)
  - `mode="node-only"` / `mode="vision"` 라우팅 결정에 따른 record 발행
  - record N+1의 `prompt_sha256`은 prompt text 변경 시 record N과 byte-distinct
    (INV-003 chain continuity)
  - `EmittedAudit` 16-key shape 무변경 (NFR-04)
- **sonnylazuardi vendor pinning** (`vendor/cursor-talk-to-figma-mcp/`,
  `vendor/cursor-talk-to-figma-mcp/AUTOPUS_PIN.md`)
  - 단일 commit hash 고정 file copy. **npm dependency 아님**
  - upstream MIT LICENSE 보존
  - `tsconfig.json` `exclude: ["vendor/**"]` 추가
  - 300줄 file-size-limit out-of-scope (NFR-06)
  - monthly manual rebase 런북 + security audit checklist 포함
- **Plugin UI scope (vendored copy 한정)**
  - status strip (connected/disconnected/source_hash chip) + placeholder
    approve/undo panel만 렌더 — chat UI 금지 (BS-003 Decision 2)
  - `community publish` 메타데이터 변경 없음 — distribution은 organization
    private only

**테스트**: daemon unit 12개 (`tests/unit/daemon-*.test.ts`) + integration
14 AC 시나리오 (`tests/integration/figma-006/`) +
review-ui telemetry-summary 1개 (`tests/unit/review-ui-telemetry-summary.test.ts`).
14 AC 모두 oracle-grade — concrete expected values (source_hash 014ed33c…b420,
capabilities tuple, generation_ms 1500ms 경계) 또는 byte-stable shape 확인.

**Notes**: SPEC-FIGMA-006 Phase 0 telemetry는 BS-001 success metric (handoff-time
75% reduction) 측정의 enabling 인프라. Phase 0 도그푸딩 30-frame 측정 종료
후 sibling SPEC-FIGMA-007 (write path) 진행. SPEC-FIGMA-008 (MCP transport
matrix · Claude.ai cowork tunnel)은 optional 트랙으로 SPEC-FIGMA-007과 병행
가능. SPEC-FIGMA-005 metric (`aggregate_cache_hit_ratio`, `--batch` cost
ratio, strict mode JSON repair retry, file_id dedup count) 은 daemon이 동일
provider 재사용으로 자동 승계.

### Added — SPEC-FIGMA-005 (2026-05-07)

Anthropic SDK 0.95 신기능 4종 도입 — Prompt Caching / Structured Outputs strict
/ Files API / Message Batches. 30-frame 도그푸딩 baseline 진입 전 비용·지연·
결정성 헤드룸을 확보합니다. 스키마(`schema/frame-description.schema.json`)와
`manifest_entry_hash` 입력 명세는 변경하지 않고 audit-only 필드만 추가합니다.

- **Prompt Caching cache_control 분리 모듈** (`src/providers/static-prefix.ts`)
  - `buildStaticPrefix(systemPrompt, schemaInstruction)` — cache_control
    영역에 정적 텍스트만 진입.
  - `lintStaticPrefix(text)` — frame-specific 토큰 (`screen_id`, `source_hash`,
    `display_id`, sha256 hex ≥16자, `<UNTRUSTED_DESIGN_TEXT` 누출,
    `frame_meta`) 0건 검증. AC-S9 vitest 하드 게이트.
- **Structured Outputs strict + AJV 2차 게이트** (`src/providers/anthropic-provider.ts`,
  `src/validators/strict-bridge.ts`)
  - `response_format: {type: "json_schema", json_schema: {strict: true, schema}}`
    옵션 분기. strict path는 `parseJsonBody` silent fallback 우회 →
    `_strictParseJsonBody`가 PROVIDER_SDK_BREAKING_CHANGE 직격.
  - `assertAjvValid(entry)` — `tools/validate-manifest` child-process 재호출.
    AJV 위반은 SCHEMA_AJV_VIOLATION + json_pointer 메타.
- **Files API file_id 재사용** (`src/providers/files-cache.ts`,
  `AnthropicClaudeAdapter.uploadScreenshot`)
  - `FileIdCache`: `screenshot_sha256 → {file_id, uploaded_at}` Map +
    `.audit/<batch_id>/file-id-map.json` 영속. `getDedupCount()`로
    `aggregate_files_api_dedup_count` 산출.
  - 동일 sha256 두 번째 Vision 호출은 base64 inline 대신
    `{type: "image", source: {type: "file", file_id}}` 블록 → image input
    tokens = 0 (AC-S3, AC-S4).
- **Message Batches `--batch` lane** (`src/providers/batch-lane.ts`,
  `src/batch-lane-runner.ts`)
  - `submitBatch / pollUntilComplete / fetchResults / alignByInputOrder /
    composeBatchRequest`. custom_id ↔ screen_id로 input 순서 복원.
  - `--batch` 모드 부분 실패 시 manifest는 successful frames만 input order로
    유지, `errors.jsonl` 별도 file에 failed frames (AC-S6).
  - CLI: `--batch` / `--realtime` (default) / `--escalate-model` flag 인식.
    REQ-30 enabler — anthropic 기본 `claude-sonnet-4-6`, 명시적 escalation
    시 `claude-opus-4-7`.
- **Audit JSONL row 8개 신규 필드** (`src/audit-emitter.ts`)
  - `cache_hit`, `cache_read_input_tokens`, `cache_creation_input_tokens`,
    `dynamic_input_tokens`, `file_id`, `batch_id_provider`, `strict_mode_used`,
    `provider_sdk_version` (전체 18-key set, AC-S8).
  - 모든 string 필드를 `src/token-redactor.ts` (figd_ 패턴, REQ-NFR-07)을
    통해 redact. SPEC-FIGMA-002 `audit-logger.ts` 6-key oracle 무관.
- **Token-counter cached/dynamic 분리** (`src/token-counter.ts`)
  - `splitInputTokens(usage) ⇒ {cache_read, cache_creation, dynamic, total}`.
    `enforceInputCap`는 합산을 8K cap에 비교 (REQ-NFR-01).
- **Aggregate summary stdout** (`src/audit-emitter.ts::computeAggregateSummary`,
  `formatAggregateSummary`)
  - `RESULT pass=N fail=M` 다음 줄에 `aggregate_cache_hit_ratio`,
    `aggregate_cached_input_tokens`, `aggregate_dynamic_input_tokens`,
    `aggregate_files_api_dedup_count`, `provider_sdk_version` 출력 (REQ-22).
- **결정성 보존 (REQ-07, REQ-NFR-03)**: `file_id`, `batch_id_provider`,
  `cache_id`, `request_id`, `provider_sdk_version`, response timestamp는
  audit JSONL row에만 진입. write-router의 `computeManifestEntryHash`는
  ManifestEntry만 입력으로 받으므로 transient id가 자연스럽게 배제됨.
- **9개 신규 source 파일 + 9개 신규 test 파일**
  - source: `src/providers/static-prefix.ts`, `src/providers/files-cache.ts`,
    `src/providers/batch-lane.ts`, `src/providers/anthropic-replay.ts`,
    `src/providers/anthropic-errors.ts`, `src/batch-lane-runner.ts`,
    `src/validators/strict-bridge.ts`.
  - tests: `tests/unit/static-prefix-lint.test.ts` (AC-S9),
    `files-cache.test.ts` (AC-S3, AC-S4),
    `audit-emitter-figma005.test.ts` (AC-S8),
    `fence-isolation.test.ts` (AC-S10),
    `anthropic-provider-strict-cache.test.ts` (REQ-01/02/04 + AC-S12),
    `batch-lane.test.ts` (AC-S5/S6 ordering),
    `cli-figma005-flags.test.ts` (REQ-30),
    `token-counter-figma005.test.ts` (REQ-20/NFR-01),
    `strict-bridge.test.ts` (REQ-03).
- **테스트 커버리지**: 504 → 561 tests / 67 → 76 files. 회귀 0.
- **모든 신규/수정 파일 ≤ 300 라인** (`.claude/rules/autopus/file-size-limit.md`).
  `anthropic-provider.ts`는 `anthropic-replay.ts` + `anthropic-errors.ts`로
  분할하여 271 라인으로 축소.

#### Notes (Phase 0 도그푸딩 인계)

본 SPEC는 BS-001 success metric (handoff 75% 절감) 실측을 위한 30-frame Phase
0 도그푸딩의 enabler입니다. Phase 0 측정 시 다음 metric을 audit JSONL에서
읽어내어 합의 임계값과 비교합니다 — `aggregate_cache_hit_ratio ≥ 0.5`,
`--batch` 모드 cost ≤ 0.5 × `--realtime` (±2% tolerance), `strict_mode_used`
frame의 JSON repair retry 0건, 동일 `screenshot_sha256` 재처리 시 image
input tokens 0. Phase 0 결과를 토대로 SPEC-FIGMA-006 (Citations × Review UI)
와 SPEC-FIGMA-007 (Extended Thinking + 4축 PM-risk score) 진행 여부를 결정
합니다.

### Added — SPEC-FIGMA-004 (2026-05-07)

Review & Write-back — PM 웹 UI dashboard + non-invasive Figma write 라우터
+ Plugin Bridge fallback + 4-페르소나 view 렌더러 + 감사 추적. BS-001
4-SPEC 분해의 마지막 슬라이스로, PM이 Figma Plugin 미설치 환경
(Slack/Notion/ChatGPT 가정)에서 description manifest를 검수·수정·승인·
broadcast할 수 있는 사용자-체감 지점을 닫음.

- **Review UI 대시보드** (`apps/review-ui/`)
  - Next.js 15 + TypeScript app router. Frame 목록 + per-frame editor
    (`FrameRow`, `FrameEditor`) + 4-페르소나 view 렌더러 (`PersonaView`)
    + stale 배지 + digest 모드 (`StaleBadge`) + token-cost telemetry
    strip (`TokenStrip`).
  - API routes: `/api/load` (manifest 로더 + FIGMA-001 `validate-manifest`
    child-process 호출), `/api/apply`, `/api/undo`, `/api/feedback`.
  - `assertSafeManifestPath()` confines manifest paths to `MANIFEST_ROOT`
    (default `cwd`) — path traversal rejected with `INVALID_MANIFEST_PATH`.
  - `/api/apply` validates `body.entry` shape server-side (frame_id +
    write_target enum) — direct curl bypass closed.
- **Write-target 라우팅 엔진** (`packages/write-router/`)
  - 6-route adapter dispatch: `annotation_card`, `descriptions_page`,
    `comment`, `plugin_data`, `frame_name` (opt-in gated, REQ-05),
    `none` (no-op).
  - `manifest_entry_hash` (SHA-256 over canonical PM-facing fields +
    write_target) idempotency dedup → `IDEMPOTENT_SKIP` on duplicate
    (REQ-07, REQ-NFR-01).
  - Per-write undo registry — single-step `undo last write` reverses
    annotation_card / descriptions_page / comment / plugin_data /
    frame_name (REQ-08, REQ-NFR-02).
  - Plugin Bridge fallback + error classifier — auto-route on MCP
    permission/seat/plan-tier errors with `FALLBACK_VIA_PLUGIN_BRIDGE`
    audit trail and UI banner (REQ-06, INV-006).
  - JSON Lines audit log with the exact 5-key set
    `{frame_id, write_target, timestamp_iso, pm_identity_or_unknown,
    manifest_entry_hash}` (REQ-11, INV-009).
  - Token redaction: `(figd_[A-Za-z0-9_-]{16,}|xoxb-[A-Za-z0-9_-]{8,})`
    → `<REDACTED>` across audit log, UI, error messages (REQ-13).
- **Slack 디자이너 escalation** (`packages/escalation/`)
  - DM 어댑터 with `redactTokens()` applied to `draftText` and
    `intentMismatchReason` (defense-in-depth beyond REQ-13 surfaces).
  - REQ-20 Should priority; disabled with tooltip when workspace
    integration absent.
- **30-frame 통합 테스트 suite** (`tests/integration/figma-004/`)
  - 12 per-AC integration files (36 oracle-grade assertions) covering
    AC-S1..S12. Mock Figma write API spy + JSON Lines audit byte
    comparison + persona-render-fixture verbatim re-use from
    SPEC-FIGMA-001 AC-S6 oracle.
- **Final coverage**: 492 tests across 66 files; 96.56% lines, 90.27%
  branches, 96.58% functions. 85% line / 80% branch floor enforced via
  vitest threshold gate.

### Notes — SPEC-FIGMA-004

- Stack: TypeScript + Next.js 15 + Node.js 20 ESM, vitest.
  Workspace path aliases configured for `@autopus/write-router` and
  `apps/review-ui` cross-references.
- `frame_name` adapter DEFAULT DISABLED — `--allow-frame-name` opt-in
  required; rejection emits `FRAME_NAME_OPT_IN_REQUIRED` and exits
  non-zero / shows UI banner (REQ-05, X4 mitigation).
- Audit `pm_identity_or_unknown` defaults to literal `"unknown"`; PM
  authentication is v0.2 deferred (PRD § 11 Q1, Q2).
- **Phase 4 defense-in-depth follow-ups** (commit 8564897): path
  traversal guard on `/api/load`, write_target enum membership check on
  `/api/apply`, Slack DM body redaction.
- **Deferred follow-ups**: rate-limiting on API routes (auditor LOW-3),
  live `next dev` smoke test, real-world `MANIFEST_ROOT` mis-config
  validation, Slack workspace end-to-end — all pinned to Phase 0
  dogfood (30-frame end-to-end measurement of BS-001 75% handoff-time
  reduction success metric).
- BS-001 outcome closure: Phase 0 도그푸딩이 v0.1 → v1.0 lock 의사결정의
  실측 입력을 제공하며, **후속 sibling SPEC 없음**.

### Added — SPEC-FIGMA-003 (2026-05-06)

Description Generation Loop — LLM-based pipeline that turns SPEC-FIGMA-002
frame meta + screenshots into SPEC-FIGMA-001 schema-compliant description
manifests with adaptive Vision/Node routing, token budget enforcement, and
prompt-injection resistance.

- **Provider abstraction** (`src/providers/`, `src/types/llm-provider.d.ts`)
  - `LLMProvider` interface with `generateNodeOnly` / `generateVision` contracts.
  - `AnthropicClaudeAdapter` — Anthropic SDK adapter with rate-limit header
    parsing.
  - `MockLLMProvider` — deterministic mock (input SHA-256 → seed → schema-valid
    response) for CI determinism (REQ-NFR-02).
- **Adaptive routing** (`src/routing.ts`, `src/calibration.ts`)
  - Node-only first pass; Vision retry only when `confidence < 0.7`
    (BS-001 토론자 B R2 합의). Higher-confidence result wins.
  - Temperature-scaling calibration hook (REQ-22).
- **Token budget enforcement** (`src/token-counter.ts`, `src/batch-runtime.ts`)
  - Per-frame `input_tokens ≤ 8000` AND `output_tokens ≤ 2000` hard caps.
  - Fail-fast on violation: `TOKEN_BUDGET_EXCEEDED` / `OUTPUT_BUDGET_EXCEEDED`
    error codes; no silent truncation (REQ-05/06, NFR-01).
- **Anti-hallucination** (`src/validators/anti-hallucination.ts`)
  - `[CANNOT_INFER]` sentinel detection → empty string + `confidence ≤ 0.5`.
  - Post-hoc schema validation blocks invalid entries from manifest output.
- **Prompt injection resistance** (`src/prompts/untrusted-fence.ts`,
  `src/validators/post-hoc-injection-detector.ts`)
  - Figma frame text wrapped in `<UNTRUSTED_DESIGN_TEXT>...</...>` fences
    with system-prompt declaration that fenced content is data, not
    instructions.
  - Post-hoc detector flags `__INJECTED__` markers / `confidence == 1.0`
    suspicious combinations and downgrades entry to `pending_review`.
- **Batch executor** (`src/batch-executor.ts`, `src/batch-process-frame.ts`,
  `src/rate-limit.ts`)
  - Configurable parallelism (default 5) with semaphore-bound concurrency
    cap (REQ-13).
  - Exponential backoff on HTTP 429 (3 attempts, base 1s, factor 2; respects
    `anthropic-ratelimit-*` headers).
- **Telemetry & audit** (`src/telemetry.ts`, `src/audit-emitter.ts`,
  `src/audit-logger.ts`)
  - Per-frame `token_usage`, batch-level `vision_call_count`, total token
    cost aggregation.
  - Audit log records prompt/response SHA-256 only — raw text never persisted
    by default (NFR-03).
- **CLI entry point** (`src/cli/generate-descriptions.ts`)
  - `generate-descriptions <input-dir> <output-manifest>` orchestrates
    read → generate → validate → write.
- **Integration tests** (`tests/integration/`, `tests/fixtures/mock-30frame/`)
  - 30-frame deterministic fixture covering AC-S1–S14 (range, budget caps,
    routing efficiency/cutoff, source_hash preservation, anti-hallucination,
    provider substitutability, schema compliance, parallelism, telemetry
    sum, determinism, intent_mismatch self-report, prompt-injection
    resistance dual-provider oracle).

### Notes — SPEC-FIGMA-003

- Stack: TypeScript + Node.js 20 ESM, `@anthropic-ai/sdk`, vitest.
- Korean output policy enforced (REQ-NFR-04) for PM-facing free-text fields
  (`intent`, `user_value`, `success_criteria`, `states`, `edge_cases`).
- Determinism guarantee scoped to `MockLLMProvider` only — Anthropic
  `temperature=0` is ~95–99% deterministic, not byte-identical (§ 9
  Constraints).
- **Deferred follow-up**: AND-of-3 marker conjunction in
  `post-hoc-injection-detector.ts` is best-effort; tightening to
  ≥2-of-N over expanded marker set tracked as follow-up SPEC. PM review
  remains the authoritative gate.

### Added — SPEC-FIGMA-002 (2026-05-06)

Figma MCP Read Path — vendor-neutral read-only adapter and pipeline that
extracts top-level frame meta + 2x screenshot bytes + prototype graph from
Figma files and emits a SPEC-FIGMA-001 schema-compliant *partial* manifest
with deterministic `source_hash` per frame. Read slice of the 4-SPEC
decomposition; description generation and write-back are owned by sibling
SPEC-FIGMA-003/004.

- **Vendor-neutral adapter contract** (`src/types/figma-read-adapter.d.ts`,
  `src/read-adapter.ts`)
  - `FigmaReadAdapter` interface declaring exactly four read methods:
    `listTopLevelFrames`, `getFrameMeta`, `exportFrameImage`,
    `getPrototypeGraph` (REQ-09 substitutability invariant).
  - Reference implementations:
    - `src/adapters/use-figma-adapter.ts` — official `use_figma` MCP client
      adapter; HTTP method literal pinned to `"GET"` at compile time
      (REQ-10 read-only invariant).
    - `src/adapters/figma-developer-mcp-adapter.ts` — `figma-developer-mcp
      ≥0.6.3` alternate adapter; tool-name allowlist confined to read-flavored
      operations (CVE-2025-53967 mitigation).
- **Canonical source_hash** (`src/source-hash.ts`)
  - Deterministic JSON serializer (lexicographic key sort, no whitespace,
    bare integer numerics) → SHA-256 over
    `{image_bytes_sha256, node_tree_summary}`.
  - Output is 64-char lowercase hex matching FIGMA-001 REQ-06 pattern;
    locked by AC-S1/S2 oracles (`014ed33c…b420`, byte-flip variant
    `4d37393b…7b11`).
- **Token redaction** (`src/token-redactor.ts`, `src/audit-logger.ts`)
  - `figd_[A-Za-z0-9_-]{16,}` regex redaction wrapper applied to stdout,
    stderr, audit log lines, and emitted manifest content (REQ-11 / INV-005
    zero-occurrence invariant).
  - Memory-only token handling — never persisted to disk.
- **Rate limit & backoff** (`src/rate-limit.ts`)
  - Exponential backoff `3s → 6s → 12s` for HTTP 429 / 5xx, max 3 attempts,
    30s per-frame budget cap (REQ-07 / AC-S4).
  - Concurrency `2`, ≥1s spacing between consecutive request starts;
    overridable via `FIGMA_READ_CONCURRENCY` env var (REQ-20).
- **Audit logger** (`src/audit-logger.ts`)
  - JSON Lines output with exactly the key set
    `{frame_id, started_at, finished_at, retries, bytes_transferred, status}`;
    `status ∈ {ok, retry_exhausted, payload_oversize, skipped}`. Schema
    locked by AC-S8 sorted-set equality (REQ-22 / INV-008).
- **Read pipeline & manifest writer** (`src/read-pipeline.ts`,
  `src/manifest-writer.ts`, `src/manifest-merger.ts`)
  - Per-frame: meta → screenshot → SHA-256 → canonical hash → audit emit.
  - Partial manifest emitter sets only Read-owned fields and leaves
    generation-owned fields (`intent`, `user_value`, `success_criteria`,
    `states`, `edge_cases`, `confidence`, `intent_mismatch`,
    `write_target`) at schema default for FIGMA-003 to fill.
  - `token_usage = {input_tokens: 0, output_tokens: 0}` hardcoded — Read
    stage performs zero LLM calls (REQ-06).
- **HTTP spy** (`src/http-spy.ts`)
  - Runtime read-only enforcement; non-`GET` invocations recorded for
    AC-S10 zero-write oracle.
- **CLI** (`src/cli/`, `src/cli.ts`)
  - `figma-read <file_id>` entry point with `--dry-run` flag listing frames
    + estimated payload sizes without exporting screenshots (REQ-31).
- **Dependency security gate** (`scripts/check-dep-security.sh`,
  `.github/workflows/dep-security.yml`)
  - `npm audit --json` parser with CVE-2025-53967 / `severity: critical`
    fail-CI gate against `figma-developer-mcp` (REQ-08 / AC-S5).
- **Schema-compliance harness** (`src/validate-manifest.ts`)
  - Local invocation of FIGMA-001's `tools/validate-manifest`; AC-S7 exit
    code 0 oracle.
- **Test suite** (`tests/`, ~22 files)
  - Oracle tests: `source-hash.test.ts` (AC-S1/S2), `token-redactor.test.ts`
    (AC-S3), `rate-limit.test.ts` (AC-S4), `read-only-invariant.test.ts`
    (AC-S10), `substitutability.test.ts` (AC-S9), `idempotency.test.ts`
    (REQ-NFR-01), `audit-shape.test.ts` (AC-S8), `schema-compliance.test.ts`
    (AC-S7).
  - Coverage suite (`tests/coverage-*.test.ts`) raises per-module branch
    coverage to the 85% gate.
  - Deterministic 30-frame mock fixture (`fixtures/30-frame-mock/`) lets
    SPEC-FIGMA-003 consume the partial manifest without a live Figma file.

### Notes — SPEC-FIGMA-002

- Stack: TypeScript + Node.js 20 ESM, `undici` HTTP client, vitest.
- Greenfield package — no prior product source code; FIGMA-001's
  `tools/validate-manifest` is the only sibling dependency.
- `package.json` pins `figma-developer-mcp >=0.6.3` per REQ-08; CI gate
  fails on CVE-2025-53967 or any `severity: critical` advisory against the
  selected MCP client.
- No live Figma API calls in tests; fixtures are mock-based for
  determinism (REQ-NFR-01 byte-equal idempotency).
- Out of scope (deferred to siblings): description generation
  (FIGMA-003), PM preview UI / persona view / write-back (FIGMA-004),
  schema definition changes (FIGMA-001 additive-only minor bump),
  Branch governance, webhook auto-trigger, OS keychain integration.

### Added — SPEC-FIGMA-001 (2026-05-06)

Frame Description Schema v0.1 — schema-first MVP that establishes the
single source-of-truth contract for the Figma auto-description pipeline.
Sibling SPECs SPEC-FIGMA-002/003/004 consume this schema as their input
contract.

- **Schema artifacts** (`schema/`)
  - `frame-description.schema.json` — JSON Schema Draft 2020-12 defining
    the canonical 19 frame fields plus the `stale` derivation flag.
    Persona membership encoded inline via `[persona_tags: ...]` markers.
  - `description-manifest.schema.json` — manifest container with
    `schema_version`, `pilot_metadata`, and `frames` array.
  - `CHANGELOG.md` — semver history per REQ-08 / REQ-NFR-02 (additive-only
    minor versions).
- **Validator CLI** (`tools/validate-manifest/`, Node.js + AJV)
  - `src/index.ts` — load schema, validate manifest, emit JSON Lines
    errors and `RESULT pass=N fail=M total=K` summary.
  - `src/errors.ts` — AJV → `{code, json_pointer, message}` mapper for
    `DUPLICATE_SCREEN_ID`, `OUT_OF_RANGE`, `ENUM_VIOLATION`,
    `MISSING_REQUIRED`, `TYPE_MISMATCH`, `PATTERN_MISMATCH`.
  - `test/golden.test.ts` + `test/help.test.ts` — golden cases covering
    REQ-10 duplicate, REQ-06 out-of-range, REQ-09 enum violation, plus
    the persona render fixture for AC-S6.
- **Sample manifests** (`samples/`)
  - `dogfood-30frame.manifest.json` — 30 entries hand-crafted for Phase 0
    dogfood (≥ 1 stale, ≥ 1 confidence < 0.7), passes the validator.
  - `persona-render-fixture.json` — AC-S10 schema-introspection oracle.

### Notes

- Runtime stack: TypeScript + AJV (validator package only). Schema itself
  is vendor-neutral (REQ-NFR-07) — no AJV-specific keywords or
  Draft 2020-12 vendor extensions.
- Out of scope (deferred to siblings): Figma integration, `source_hash`
  computation, LLM/Vision routing, preview UI, write-back.
