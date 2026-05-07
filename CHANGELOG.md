# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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
