# SPEC-FIGMA-019: Redact the Captured Prior Annotation on the WriteRouter / Review-UI HTTP Apply Path

> Status: completed

**Status**: completed
**Created**: 2026-06-09
**Domain**: FIGMA
**Module**: `.` (root) — `@autopus/figma-mcp` monorepo (cross-package: `packages/write-router` + `apps/review-ui` + new shared redact-patterns package)
**Mode**: brownfield
**Depends on**: SPEC-FIGMA-018 (`native_annotation` target + daemon-side `redactAndMinimizePrior`), SPEC-FIGMA-007 (AC-S14 redact-pattern source-of-truth parity, `src/redact-patterns.ts`), SPEC-FIGMA-004 (`WriteRouter`, adapter registry, undo registry)

## 목적 (Purpose)

SPEC-FIGMA-018의 보안 감사(Low #2)는 캡처된 직전 `node.annotations` 스냅샷이 전체 비밀 표면으로 누출될 수 있는 **두 번째 apply 경로**를 발견했다. SPEC-FIGMA-018은 데몬 경로(`autopus://applied_writes` 리소스)를 `src/daemon/redact-prior-annotation.ts`의 `redactAndMinimizePrior`로 닫았다. 그러나 **review-ui HTTP apply 경로**는 같은 untrusted 스냅샷을 데몬 redactor 없이 노출한다.

구체 경로는 다음과 같다.

- `packages/write-router/src/adapters/native-annotation.ts:96-102`의 `minimizePrior`는 복원에 불필요한 필드만 제거하고 비밀은 스크럽하지 않는다(`@AX:WARN`/`@AX:REASON`, line 114-115). 캡처된 `prior`는 `restore-annotation` 디스크립터에 담겨(line 131) 그대로 흐른다.
- `packages/write-router/src/index.ts:134-141`의 `WriteRouter.apply`(executor mode)는 그 디스크립터를 `UndoRegistry`에 verbatim 등록하고, line 155-161에서 `WriteResult.undo_descriptor`로 HTTP 응답에 그대로 반환한다.
- `apps/review-ui/src/app/api/apply/route.ts:86-87`은 그 `result`(`undo_descriptor` 포함)를 HTTP JSON 응답으로 내보낸다.
- write-router 패키지 내부에서 사용 가능한 redactor(`packages/write-router/src/redactor.ts`의 `redactTokens`/`redactObject`)는 `figd_`와 `xoxb-`만 잡는다(`TOKEN_REGEX`, line 1). Bearer 토큰과 권한 경로(`/Users/`, `/home/`, `C:\Users\`)는 잡지 못한다.
- 반면 데몬의 `src/daemon/redact-extended.ts`의 `redactExtended`/`redactExtendedObject`는 네 클래스(figd_, xoxb-, Bearer, absolute-path)를 모두 잡는다.

따라서 직전 annotation의 `labelMarkdown`이 Bearer 토큰과 절대 경로를 담고 있으면 write-router/HTTP 경로에서 그대로 누출되는 반면, 데몬 경로는 둘 다 스크럽한다.

### 현재 도달성 게이트 — 잠복 결함이지 라이브 취약점이 아님 (정직하게 명시)

이 결함은 오늘 라이브로 악용되지 않는다. 두 개의 게이트가 막고 있다.

- `apps/review-ui/src/app/api/apply/route.ts:24-31`의 `KNOWN_WRITE_TARGETS` 집합은 `native_annotation`을 **포함하지 않는다**. 해당 target을 가진 entry는 `validateEntryShape`(line 51-58)에서 라우터에 도달하기 전에 HTTP 400 `INVALID_ENTRY_SHAPE`로 거부된다.
- `getRouter()`(line 14-22)는 `figma` 클라이언트 없이 `WriteRouter`를 생성하므로, 설령 도달하더라도 `asClient`(`native-annotation.ts:37-56`)가 캡처 이전에 `MCP_PERMISSION_ERROR`를 던진다.

그래서 오늘 비밀을 담는 경로는 단위 테스트에서만 실행된다. 이 SPEC은 방어적 심층(defense-in-depth)이자, 장차 `native_annotation`이 review-ui 허용 목록에 추가되고 라이브 figma 클라이언트가 연결될 때를 위한 사전 차단이다. 게이트 위에 redaction을 두어 게이트 해제가 곧바로 누출로 이어지지 않게 한다.

### Trust boundary: 캡처된 직전 annotation은 untrusted 외부 입력 (두 경로 폐쇄 모델)

캡처되는 직전 `node.annotations` 값은 작성자가 통제하지 않는(author-uncontrolled) Figma annotation으로, untrusted 외부 입력이다. 어떤 파일 협업자든 reviewer 노트, `xoxb-`/Bearer 토큰, 권한 절대 경로를 남겼을 수 있다. 이 스냅샷은 두 개의 retained-artifact 경로로 흐른다.

| 경로 | 폐쇄 SPEC | 폐쇄 수단 |
|------|-----------|-----------|
| 데몬 경로 — `AppliedWrite` 영속화 + `autopus://applied_writes` 서빙 | SPEC-FIGMA-018 (완료) | `redactAndMinimizePrior` (`src/daemon/redact-prior-annotation.ts`) 가 `redactExtendedObject` 호출 |
| 라우터/HTTP 경로 — `WriteRouter` in-memory `UndoRegistry` 등록 + `WriteResult.undo_descriptor` HTTP 반환 | **이 SPEC (SPEC-FIGMA-019)** | 패키지 경계 내 full-surface redactor를 `WriteRouter.apply`의 capture 직후 seam에 주입 |

이 SPEC은 두 번째 경로를 닫는다. 데몬 경로(SPEC-FIGMA-018 S13)는 변경하지 않으며, 비회귀로 보존한다.

### 설계 긴장 — AC-S14 패턴 패리티를 깨지 않으면서 패키지 경계를 지킨다

올바른 redactor(`redactExtended` 계열)는 데몬 레이어(`src/daemon/`)에 산다. write-router **패키지**(`packages/write-router/`)는 루트 데몬 `src/`에서 import하면 안 된다 — 레이어 역전(데몬이 write-router에 의존하지, 그 반대가 아님). 동시에 SPEC-FIGMA-007의 **AC-S14 "byte-equal source-of-truth parity"** 불변식이 존재한다: `src/redact-patterns.ts`가 단일 진실원이고, 그 헤더(line 7-12)는 `XOXB_PATTERN_SOURCE`가 `packages/write-router/src/redactor.ts`의 인라인 regex 리터럴과 byte-equal이어야 함을 명시한다. Bearer/abs-path 패턴을 `redactor.ts`에 **단순 복제**하면 이 패리티 불변식이 막으려는 바로 그 드리프트를 만든다. 이 긴장의 해소는 `research.md` `## 설계 결정`에서 모듈 경계 증거와 함께 결정한다(선택: Option D + Option A wiring seam).

## 요구사항 (Requirements — EARS form, MoSCoW on a separate meta line)

REQ-01
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL single-source the four redact pattern classes (figd_, xoxb-, Bearer, absolute-path) so that the write-router redactor and the daemon redactor derive their pattern strings from one shared module, preserving the SPEC-FIGMA-007 AC-S14 byte-equal parity invariant.

REQ-02
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL provide, inside the `packages/write-router` package boundary, a redact function that scrubs all four secret classes (figd_, xoxb-, Bearer token, absolute privileged path prefix) from a string and recurses through arrays and objects, without importing from the root daemon `src/` tree.

REQ-03
Priority: Must
Type: Event-driven
WHEN a `native_annotation` apply succeeds through `WriteRouter.apply` in executor mode, THE SYSTEM SHALL redact the captured `restore-annotation` prior snapshot through the full-surface redactor before the undo descriptor is registered in the `UndoRegistry` and before it is returned in the `WriteResult.undo_descriptor`.

REQ-04
Priority: Must
Type: Event-driven
WHEN the redacted `restore-annotation` descriptor is produced, THE SYSTEM SHALL retain only the minimized restore fields `labelMarkdown` and optional `categoryId` and `properties`, and undo with that descriptor SHALL restore the node structurally so that the redacted minimized prior is written back and the secret is not re-introduced.

REQ-05
Priority: Must
Type: Event-driven
WHEN `apps/review-ui/src/app/api/apply/route.ts` constructs its process-scoped `WriteRouter`, THE SYSTEM SHALL configure that router with the full-surface restore-descriptor redactor so that the HTTP `undo_descriptor` response body never carries an unredacted captured prior secret.

REQ-06
Priority: Should
Type: State-driven
WHILE a consumer such as the daemon already redacts the captured prior at its own boundary, THE SYSTEM SHALL allow the restore-descriptor redaction seam to be omitted or supplied as a no-op without changing the SPEC-FIGMA-018 daemon redaction behavior.

REQ-07
Priority: Must
Type: Unwanted-behavior
IF the captured prior `labelMarkdown` contains a Bearer token or an absolute privileged path prefix, THEN THE SYSTEM SHALL replace each such secret with the redactor placeholder on the router/HTTP path, matching the daemon-path behavior for the same input class.

REQ-08
Priority: Must
Type: Ubiquitous
THE SYSTEM SHALL preserve the existing `figd_` and `xoxb-` redaction behavior of `packages/write-router/src/redactor.ts` (`redactTokens`, `redactObject`, `redact`) and SHALL keep the AC-S14 parity test passing without weakening it.

REQ-09
Priority: Should
Type: Event-driven
WHEN the redact-pattern source strings are relocated to the shared module, THE SYSTEM SHALL update the AC-S14 parity oracle (`tests/unit/redact-patterns-parity.test.ts`) and the AC-S14 integration oracle so that the write-router redactor is asserted to single-source its pattern strings rather than carry an inline literal that can silently drift.

## 생성/변경 파일 상세 (Files Created / Changed)

| File | New? | Role |
|------|------|------|
| `[NEW] packages/redact-patterns/package.json` | new | `@autopus/redact-patterns` workspace package manifest (peer of `packages/escalation`, `packages/write-router`); exports the pattern source strings |
| `[NEW] packages/redact-patterns/tsconfig.json` | new | Package tsconfig mirroring the `packages/escalation` shape (`include: ["src/**/*.ts"]`) |
| `[NEW] packages/redact-patterns/src/index.ts` | new | Relocated single source of truth for `FIGD_PATTERN_SOURCE`, `XOXB_PATTERN_SOURCE`, `BEARER_PATTERN_SOURCE`, `ABSOLUTE_PATH_PATTERNS_SOURCE`, `REDACTED` (REQ-01) |
| `src/redact-patterns.ts` | existing | Re-export from `@autopus/redact-patterns` to preserve every current importer (daemon `redact-extended.ts`, vendor plugin port, tests) without churn (REQ-01) |
| `packages/write-router/src/redactor.ts` | existing | Import the four pattern sources from `@autopus/redact-patterns`; add `redactExtendedTokens` / `redactExtendedObject` (full surface) alongside the frozen `redactTokens`/`redactObject` (REQ-02, REQ-08) |
| `packages/write-router/src/index.ts` | existing | Add optional `redactRestoreDescriptor?` to `WriteRouterOptions`; apply it to `restore-annotation` descriptors in `apply` before `undoRegistry.register` and before returning `undo_descriptor` (REQ-03, REQ-04, REQ-06) |
| `[NEW] packages/write-router/src/redact-restore-descriptor.ts` | new | Default full-surface `restore-annotation` redactor (minimize-preserving) that `WriteRouter` and review-ui consumers inject (REQ-03, REQ-04, REQ-07) |
| `apps/review-ui/src/app/api/apply/route.ts` | existing | Pass the full-surface restore-descriptor redactor into the process-scoped `WriteRouter` constructor (REQ-05) |
| `packages/write-router/package.json` | existing | Add `@autopus/redact-patterns` to `dependencies`; add the new `./redact-restore-descriptor` export entry |
| `tests/unit/redact-patterns-parity.test.ts` | existing | Update import path to `@autopus/redact-patterns` and assert the write-router redactor single-sources (no inline figd_/xoxb- literal) (REQ-09) |
| `tests/integration/figma-007/AC-S14.test.ts` | existing | Extend parity to cover the write-router redactor port single-sourcing the four pattern classes (REQ-09) |
| `[NEW] packages/write-router/tests/router-prior-redaction.test.ts` | new | Oracle: router-path captured prior is redacted to placeholder before register/return; undo restores structurally (S1, S6) |
| `[NEW] packages/write-router/tests/redactor-extended.test.ts` | new | Unit: write-router full-surface redactor scrubs Bearer + abs-path while preserving figd_/xoxb- (S3) |

## Related SPECs

This is a single SPEC. The requested outcome — closing the router/HTTP secret-leak path for the captured prior annotation — closes entirely within this SPEC across the `packages/write-router` + `apps/review-ui` + new shared `@autopus/redact-patterns` boundary, sharing one acceptance story (see `acceptance.md`). No sibling SPEC is required.

Dependencies are inbound only: SPEC-FIGMA-018 (the `native_annotation` target, `restore-annotation` descriptor, daemon S13 redaction), SPEC-FIGMA-007 (the AC-S14 parity invariant this SPEC must preserve), SPEC-FIGMA-004 (the `WriteRouter` apply/undo/registry surface this SPEC extends). All three are already implemented.

## Feature Completion Scope

The full outcome closes within this SPEC. The redaction CAPABILITY (write-router full-surface redactor, single-sourced from the relocated shared patterns — Option D) and the WIRING (the `redactRestoreDescriptor` injection seam in `WriteRouter.apply` plus the review-ui injection — Option A) are both delivered here, because a strengthened redactor alone does not reach the `undo_descriptor` capture path, and a wiring seam alone has no full-surface redactor to call inside the package boundary. The daemon path (SPEC-FIGMA-018 S13) is held non-regression. The SPEC-FIGMA-018 AC-S8 card invariant and the `annotation_card` path are not modified.

## Traceability Matrix

Every requirement maps to at least one plan task and one acceptance scenario. Plan task IDs are defined in `plan.md`; scenario IDs in `acceptance.md`.

| REQ | Priority | Plan task(s) | Acceptance scenario(s) |
|-----|----------|--------------|------------------------|
| REQ-01 | Must | T1, T2 | S3 (parity preserved), S5 (non-regression) |
| REQ-02 | Must | T2, T3 | S3 |
| REQ-03 | Must | T4, T5 | S1 |
| REQ-04 | Must | T3, T4 | S1, S6 |
| REQ-05 | Must | T6 | S1, S4 |
| REQ-06 | Should | T4 | S5 |
| REQ-07 | Must | T3, T4 | S1 |
| REQ-08 | Must | T3, T7 | S2, S5 |
| REQ-09 | Should | T7 | S5 |
