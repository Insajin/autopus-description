# SPEC-FIGMA-019 리서치

> Status: draft

## 기존 코드 분석 (verified against current HEAD)

### 두 번째 누출 경로 (확인된 사실)

- `packages/write-router/src/adapters/native-annotation.ts`
  - `minimizePrior` (line 96-102): `labelMarkdown`/optional `categoryId`/optional `properties`만 보존. 비밀 스크럽 없음.
  - `@AX:WARN`/`@AX:REASON` (line 114-115): "minimizePrior strips non-restore fields but does NOT scrub secrets ... only redacted downstream at the daemon."
  - capture (line 130-131): `prior = minimizePrior(...)` → `{ type: "restore-annotation", node_id, prior }` push.
- `packages/write-router/src/index.ts`
  - `WriteRouter.apply` executor 분기 (line 79-162). `applied = await adapter.apply(entry, { figma: this.figma })` (line 109).
  - `undoRegistry.register({ ..., descriptor: applied.undo_descriptor, ... })` (line 134-141) — verbatim 등록.
  - `return { status: "applied", ..., undo_descriptor: applied.undo_descriptor, ... }` (line 155-161) — HTTP 반환.
  - `fallbackToPluginBridge` (line 199-235): `result.undo_descriptor`를 동일하게 등록/반환 — 같은 seam 필요.
  - `WriteRouterOptions` (line 37-46): 현재 `redactRestoreDescriptor` 없음 → 주입 지점.
- `apps/review-ui/src/app/api/apply/route.ts`
  - `getRouter()` (line 14-22): `new WriteRouter({ auditLogPath, pmIdentity })` — `figma` 미연결, redactor 미주입.
  - `KNOWN_WRITE_TARGETS` (line 24-31): `native_annotation` 부재 → `validateEntryShape` (line 51-58)에서 HTTP 400 `INVALID_ENTRY_SHAPE`.
  - `const result = await getRouter().apply(validated.entry)` (line 86) → 단일 인자 오버로드 → executor mode. `Response.json(result, ...)` (line 87) — `undo_descriptor` 포함 직렬화.

### redactor 격차 (확인된 사실)

- `packages/write-router/src/redactor.ts` (현재 23줄): `TOKEN_REGEX = /(figd_[A-Za-z0-9_-]{16,}|xoxb-[A-Za-z0-9_-]{8,})/g` (line 1), placeholder `<REDACTED>` (line 2). `redactTokens`/`redactObject`/`redact` export. Bearer/abs-path 미포함.
- `src/daemon/redact-extended.ts`: `redactExtended`/`redactExtendedObject`가 figd_/xoxb-/Bearer/abs-path 4종 처리 (line 36-67). placeholder `REDACTED = "***"`. `EXTENDED_REDACT_PATTERNS` (line 69-74)로 4종 RegExp 노출.
- `src/daemon/redact-prior-annotation.ts`: `redactAndMinimizePrior` (line 53-61)가 `prior.map(redactAndMinimizeSnapshot)`로 minimize + `redactExtendedObject` 적용. 입력 불변. SPEC-FIGMA-018 S13의 데몬 측 오라클 대상.

### AC-S14 패리티 메커니즘 (확인된 사실)

- `src/redact-patterns.ts`: 단일 진실원. `FIGD_PATTERN_SOURCE`="figd_[A-Za-z0-9_-]{16,}" (line 16), `XOXB_PATTERN_SOURCE`="xoxb-[A-Za-z0-9_-]{8,}" (line 21), `BEARER_PATTERN_SOURCE`="[Bb]earer [A-Za-z0-9._\-]{16,}" (line 26), `ABSOLUTE_PATH_PATTERNS_SOURCE`=["/Users/","/home/","C:\Users\\"] (line 32-36), `REDACTED`="***" (line 38).
  - 헤더 docstring (line 7-12): "FROZEN INVARIANTS (NFR-04) — `XOXB_PATTERN_SOURCE` MUST byte-equal the figd_/xoxb- regex literal embedded in `packages/write-router/src/redactor.ts` (currently inline)."
- `tests/unit/redact-patterns-parity.test.ts`: `redactor.ts`를 **텍스트로 읽어**(`readSource`) 인라인 리터럴 `/(figd_...|xoxb-...)/g`를 정규식 매칭하고 `FIGD/XOXB_PATTERN_SOURCE`와 byte-equal 비교 (line 71-83 부근). 즉 현재 write-router 포트는 import가 아니라 **인라인 리터럴 + 텍스트 어서션**으로 패리티를 유지한다.
- `tests/integration/figma-007/AC-S14.test.ts`: 플러그인 포트(`autopus_redact.ts`)는 인라인 figd_/xoxb-/bearer 리터럴이 0이고 상수만 import해야 함을 어서션 (line 47-70). 데몬 포트는 `redact-extended.ts`가 소스 상수를 re-export함을 확인 (line 26-45). 즉 플러그인·데몬은 이미 단일 소싱, write-router만 인라인.

### 현재 importer (relocation blast radius — 확인된 사실)

`src/redact-patterns.ts`를 import하는 위치: `src/daemon/redact-extended.ts:20`, `src/daemon/tests/apply-tool-native-annotation-redaction.test.ts:17`, `tests/integration/figma-007/AC-S14.test.ts:18`, `tests/integration/figma-007/AC-S7.test.ts:14`, `tests/unit/daemon-audit-retention-guard.test.ts:22`, `tests/unit/redact-patterns-parity.test.ts:17`, `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_redact.ts:14`. → re-export 셰임으로 전부 무변경 유지 가능.

## 모듈 경계 증거 (read from actual manifests / tsconfigs)

| 경계 사실 | 출처 | 함의 |
|-----------|------|------|
| `apps/review-ui`는 `@autopus/write-router`에만 의존 | `apps/review-ui/package.json` `dependencies` (write-router, next, react만), `apps/review-ui/tsconfig.json` `paths`(`@autopus/write-router` → `../../packages/write-router/src/index.ts`만) | review-ui는 `src/daemon/*`로 가는 합법 경로가 없다 → Option A의 "review-ui가 데몬 redactor 주입" 하위경로 불가 |
| write-router는 자족 패키지, `src/` 미import | `packages/write-router/package.json`(외부 의존 없음), `packages/write-router/tsconfig.json` `include: ["src/**/*.ts"]`, grep 결과 `packages/`에서 `src/` import 0건 | write-router → 데몬 `src/` import는 레이어 역전; 금지 |
| 데몬 `src/`는 write-router로 **하향** import 존재 | `src/daemon/redact-prior-annotation.ts:16` (`from "../../packages/write-router/src/types.js"`) | 합법 방향은 데몬→write-router. 역방향은 불가 |
| 루트 `tsconfig.json`은 `packages/**` exclude, `paths`로 `@autopus/write-router` 매핑 | `tsconfig.json` line 21-25, 33-40 | 데몬/테스트는 `@autopus/*` 별칭으로 패키지 참조; 신규 `@autopus/redact-patterns`도 동일 패턴으로 참조 가능 |
| `packages/escalation`이 소형 `@autopus/*` 패키지 선례 | `packages/escalation/package.json`(name `@autopus/escalation`, exports `./slack`) | 신규 `@autopus/redact-patterns` 패키지는 idiomatic; 루트 `workspaces: ["packages/*"]`가 자동 포함 |

핵심 결론: **write-router(및 그것만 보는 review-ui)는 데몬 redactor를 합법적으로 import할 수 없다.** 따라서 full-surface 능력을 패키지 경계 안으로 들이는 유일한 깨끗한 방법은 패턴 소스 문자열을 양쪽이 import 가능한 중립 위치(`packages/`)로 단일화하는 것이다.

## 설계 결정

**결정: Option D (패턴 소스를 공유 `@autopus/redact-patterns` 패키지로 relocate + write-router redactor 강화) + Option A (WriteRouter에 `redactRestoreDescriptor` 주입 seam). Confidence: High.**

### 후보 평가

- **Option A 단독 (DI만)** — `WriteRouterOptions`에 `redactSnapshot?` 주입. 필요하지만 불충분: review-ui가 주입할 full-surface redactor 자체가 패키지 경계 안에 없다. review-ui는 `@autopus/write-router`만 의존하므로 데몬 `redact-extended.ts`를 주입원으로 가져올 수 없다(경계 증거 1행). 따라서 A는 능력 공급원을 전제하지 못한다. **단독 기각.**
- **Option B (공유 패턴 모듈, 양쪽 import)** — 올바른 방향이나 "그래서 어디에 두는가"가 핵심. 데몬 `src/`에 두면 write-router가 import 불가(레이어 역전). 그래서 B의 올바른 구현은 D와 동일하게 `packages/`로의 relocate다. B를 D로 구체화한다.
- **Option C (adapter-level scrub)** — `minimizePrior`가 스크럽. 라우터와 동일한 패키지-경계 redactor 접근 문제를 가지며(같은 패키지), 추가로 adapter 계약(`native-annotation.ts`)을 비밀-인지로 만들어 SPEC-FIGMA-018 표면을 넓힌다. 라우터 seam 대비 이점 없음. **기각.**
- **Option D (write-router redactor를 동일 소스 문자열로 강화)** — AC-S14를 깨지 않는 유일한 강화법은 인라인 리터럴을 제거하고 공유 소스에서 재구성하는 것. 패턴 소스를 `packages/`로 옮기면(B의 구체화) 데몬·write-router·플러그인 3개 포트가 단일 소싱되어, 현재 write-router의 인라인-리터럴 드리프트 표면(패리티 테스트가 텍스트로만 지키던)이 사라진다. **채택 (능력 측).**

### 왜 D+A 하이브리드인가

D는 **능력**(패키지 경계 안 full-surface redactor)을, A는 **배선**(capture된 `undo_descriptor`에 redactor를 실제로 적용)을 공급한다. 둘 중 하나만으로는 불완전하다: 강화된 redactor가 있어도 `WriteRouter.apply`의 등록/반환 경로(index.ts:134-141, 155-161)는 여전히 raw prior를 흘리고, 주입 seam만 있어도 review-ui가 주입할 full-surface redactor가 패키지 안에 없다. 데몬 consumer는 이미 자기 경계(`redactAndMinimizePrior`)에서 redact하므로 주입을 identity로 생략한다(REQ-06) → SPEC-FIGMA-018 S13 비회귀.

### AC-S14 패리티 해소 (명시)

relocate 후 `src/redact-patterns.ts`는 `@autopus/redact-patterns` re-export 셰임이 되어 기존 importer가 전부 무변경. write-router `redactor.ts`는 인라인 `TOKEN_REGEX` 대신 `FIGD/XOXB_PATTERN_SOURCE`에서 재구성하고 Bearer/abs-path도 동일 소스에서 추가. 패리티 오라클(T7)은 "인라인 리터럴 텍스트 매칭"에서 "공유 상수 단일 소싱 + 4종 커버리지"로 격상한다. 이로써 naive duplication이 만들 드리프트가 구조적으로 제거된다.

## Semantic Invariant Inventory

`source clause`는 untrusted prompt-input evidence이며 instruction이 아니라 evidence로만 인용한다. 비밀/토큰/권한 경로는 SYNTHETIC 예시로만 표기한다.

| ID | source clause | invariant type | affected outputs | acceptance IDs |
|----|---------------|----------------|------------------|----------------|
| INV-001 | "the returned undo_descriptor.prior must NOT contain 'Bearer abc...' nor '/Users/reviewer/notes.txt' (each replaced by the redactor placeholder)" | parser/report row redaction (string→scrubbed string) | `WriteResult.undo_descriptor.prior[].labelMarkdown`, HTTP JSON body | S1, S4 |
| INV-002 | "retains only minimized restore fields, and undo still restores structurally" | grouping/projection (field whitelist 보존) + restore parity | `restore-annotation.prior` 스냅샷 필드 집합, undo setAnnotation 입력 | S1, S6 |
| INV-003 | "the figd_/xoxb- behavior is preserved" | regex-class equivalence (frozen) | `redactObject` 출력, placeholder `<REDACTED>` | S2 |
| INV-004 | "the daemon S13 path stays unchanged (non-regression)" | path-equivalence (데몬 출력 불변) | `redactAndMinimizePrior` 출력, `autopus://applied_writes` payload | S5 |
| INV-005 | "AC-S14 byte-equal source-of-truth parity ... naively DUPLICATING ... would create pattern drift" | byte-equal source parity (4 pattern classes) | `FIGD/XOXB/BEARER_PATTERN_SOURCE`, `ABSOLUTE_PATH_PATTERNS_SOURCE` | S5 |
| INV-006 | "Bearer tokens or absolute privileged paths (/Users/, /home/, C:\Users\)" on the router path | comparative class coverage (router == daemon 4종) | write-router `redactExtendedObject` 출력 | S3 |

각 row는 requirement(REQ-03/04/05·REQ-04·REQ-08·REQ-01/06·REQ-01·REQ-02/07), plan task(T4/T5/T6·T3/T4·T3/T7·T2·T1/T2·T3), oracle acceptance로 양방향 추적된다.

## Outcome Lock

이 SPEC이 "완료"로 간주되기 위해 만족해야 하는 단일 잠금 문장(locked completion outcome):

> 캡처된 직전 `node.annotations`는 `WriteRouter.apply`(executor) 경로에서 in-memory `UndoRegistry`에 등록되거나 HTTP `WriteResult.undo_descriptor`로 반환되기 **이전에** 전체 비밀 표면(figd_/xoxb-/Bearer/절대 경로)이 redact되고 복원 필드(`labelMarkdown`, optional `categoryId`, optional `properties`)로 minimize되며, 이는 네 redact 패턴 클래스를 공유 `@autopus/redact-patterns` 패키지로 단일 소싱(AC-S14 패리티 보존)하고 `redactRestoreDescriptor` 주입 seam을 추가함으로써 달성되되, SPEC-FIGMA-018 데몬 S13 경로와 AC-S8 카드 불변식은 변경하지 않는다.

이 outcome은 SPEC-FIGMA-019가 **전적으로 소유**한다(잠금 outcome에 대한 sibling SPEC 의존성 없음). 인바운드 의존성(SPEC-FIGMA-018 `restore-annotation` 디스크립터·데몬 redaction, SPEC-FIGMA-007 AC-S14 패리티, SPEC-FIGMA-004 `WriteRouter` 표면)은 모두 이미 구현되어 있으며 이 outcome을 닫는 데 추가 작업이 필요하지 않다.

완료 증거 구조: 아래 `## Feature Coverage Map`이 이 outcome을 slice로 분해하고, `## Completion Debt` / `## Evolution Ideas`가 이 SPEC에 의도적으로 포함되지 않은 항목을 기록한다.

## Feature Coverage Map

| Outcome slice | Covered by | Status |
|---------------|------------|--------|
| 라우터/HTTP 경로 capture prior redaction | this SPEC (T4, T5) | covered |
| 패키지 경계 내 full-surface redactor 능력 | this SPEC (T1, T2, T3) | covered |
| review-ui consumer 주입 | this SPEC (T6) | covered |
| AC-S14 패리티 보존 + 오라클 격상 | this SPEC (T2, T7) | covered |
| 데몬 경로 redaction | SPEC-FIGMA-018 (`redactAndMinimizePrior`) | done (non-regression here) |
| `native_annotation`을 review-ui allowlist에 추가 + 라이브 figma 클라이언트 연결 | future work (이 SPEC 범위 밖) | deferred (이 SPEC의 redaction 게이트 위에서 안전) |

deferred slice는 완전한 기능에 필수가 아니다: 이 SPEC은 "라우터/HTTP 경로의 누출을 닫는다"는 요청 결과를 닫으며, allowlist 확장은 별개 기능 결정이다. 게이트가 먼저 redaction으로 보호되므로 향후 확장이 곧바로 누출로 이어지지 않는다.

## Reviewer Brief

이 SPEC의 범위: 라우터/HTTP retained-artifact 경로(`WriteRouter` in-memory `UndoRegistry` 등록 + `WriteResult.undo_descriptor` HTTP 반환)에서 캡처된 직전 annotation을 redact + minimize한다. 데몬 경로는 SPEC-FIGMA-018이 이미 닫았으므로 이 SPEC은 비회귀로만 다룬다. 카드 경로(AC-S8)는 재설계하지 않는다.

리뷰어가 먼저 확인할 항목 (순서대로):

1. Q-SEC focus: `WriteRouter.apply`가 `restore-annotation` `undo_descriptor`를 주입된 `redactRestoreDescriptor`로 통과시키되, `undoRegistry.register`(`packages/write-router/src/index.ts:134-141`) **이전에** 그리고 `WriteResult` 반환(`index.ts:155-161`) **이전에** 적용하는지 확인한다. `fallbackToPluginBridge` 경로(`index.ts:205-213`의 register, `231`의 반환)에도 동일 redaction이 적용되는지 함께 확인한다.
2. AC-S14 패리티: 패턴 소스 문자열을 `@autopus/redact-patterns`로 옮긴 뒤 `src/redact-patterns.ts`가 byte-identical re-export 셰임으로 남아 기존 7개 importer(`src/daemon/redact-extended.ts`, `vendor/.../autopus_redact.ts`, `tests/integration/figma-007/AC-S14.test.ts`, `tests/integration/figma-007/AC-S7.test.ts`, `tests/unit/redact-patterns-parity.test.ts`, `tests/unit/daemon-audit-retention-guard.test.ts`, `src/daemon/tests/apply-tool-native-annotation-redaction.test.ts`)와 2개 패리티 오라클(`redact-patterns-parity.test.ts` 단위, `AC-S14.test.ts` 통합)이 계속 통과하는지 확인한다. 단일 소싱은 중복을 만들지 않고 패리티를 강화한다.
3. Layering: review-ui가 오직 `@autopus/write-router`를 통해서만 redactor를 주입하고(데몬 `src/` import 없음), write-router의 full-surface redactor가 인라인 리터럴이 아니라 공유 소스 문자열에서 RegExp를 재구성하는지 확인한다.
4. 비회귀: SPEC-FIGMA-018 데몬 S13 경로(`redactAndMinimizePrior`)와 AC-S8 카드 3-step 분해가 손대지 않은 상태인지 확인한다.
5. Oracle quality: S1/S3 prior-redaction 시나리오가 구체 합성 Bearer/절대 경로 입력(`Bearer abc123def456`, `/Users/reviewer/notes.txt`, `Bearer ZZZ1234567890ABCDEF`, `/home/svc/key`, `C:\Users\svc\token.txt`)과 placeholder 부재/치환(`***`) 기대 출력을 담고 있는지 확인한다.
6. Out of review scope: 아래 `## Completion Debt` / `## Evolution Ideas`를 참조 — `native_annotation`의 review-ui allowlist 추가·라이브 figma 클라이언트 연결, 두 placeholder 통합은 이 SPEC의 잠금 outcome에 포함되지 않는다.

## Completion Debt

이 SPEC이 닫거나 의식적으로 경계 짓는 완료 관련 항목. 아래 `## Evolution Ideas`의 투기적 아이디어와는 구분된다.

| Item | Status | Owner / closure |
|------|--------|-----------------|
| 라우터/HTTP 경로의 캡처 prior 노출(in-memory `UndoRegistry` + HTTP `undo_descriptor`) | closed-by-this-SPEC | T4(restore-descriptor redactor) + T5(`apply` seam 주입) + T6(review-ui 주입) / S1, S4 |
| placeholder 분기: `***`(공유 `REDACTED`, full-surface/데몬 경로) vs `<REDACTED>`(frozen figd_/xoxb- 경로) | bounded / intentional | 두 placeholder는 서로 다른 source-of-truth에 묶여 의도적으로 분리 유지; S1/S3은 `***`, S2는 `<REDACTED>`로 어서션 |
| `native_annotation`의 review-ui `KNOWN_WRITE_TARGETS` allowlist + 라이브 figma 클라이언트 배선 | deferred | 이 SPEC 범위 밖. 이 SPEC은 경로가 아직 도달 불가(잠복 결함)임에도 방어적으로 redaction 게이트를 미리 둔다. 도달성 활성화는 `## Evolution Ideas` 참조 |
| write-router 인라인 `TOKEN_REGEX` 리터럴 드리프트 표면 | closed-by-this-SPEC | T3가 인라인 리터럴을 공유 상수 재구성으로 대체; T7 패리티 오라클을 4종 단일 소싱 검증으로 격상 |

### Phase 4 리뷰 후속 (Post-Review Hardening)

리뷰/보안 감사가 제기한 비차단 Low 항목 3건 — 전부 머지 전 해소.

| Item | Status | Owner / closure |
|------|--------|-----------------|
| AC-S10/NFR-04 비회귀 상호작용 미예측 (분석 갭) | closed | 초기 research는 AC-S14만 명시하고, REQ-05의 `apply/route.ts` 주입이 SPEC-FIGMA-007 AC-S10 byte-freeze와 충돌함을 예측하지 못했다. 해소: AC-S10의 byte-equal freeze를 `undo/route.ts`로 축소(SPEC-019가 건드리지 않음)하고, `apply/route.ts`는 행위 계약(5-key WriteResult shape + IDEMPOTENT_SKIP + delete-node descriptor)으로 보존. `tests/integration/figma-007/AC-S10.test.ts` 갱신, 인라인 근거 주석 명시 |
| `redactRestoreDescriptor`의 `as string` 캐스트 방어 갭 (defense-in-depth) | closed | `redact-restore-descriptor.ts`: untrusted prior의 `labelMarkdown`/`categoryId`를 `redactExtendedTokens(String(...))`로 강제 문자열화 후 스크럽 — non-string이 `redactExtendedObject` 비-문자열 분기로 미-redaction 통과하던 갭 제거. 유효 문자열엔 동작 무변경(`String("foo")==="foo"`) |
| fallback 경로의 `restore-annotation` redaction 미테스트 (테스트 갭) | closed | `router-prior-redaction.test.ts`에 end-to-end 테스트 추가: `setPluginBridgeTransport`로 `restore-annotation`+합성 비밀을 반환하는 transport 주입, 403 분류로 `fallbackToPluginBridge` 진입, 반환·등록 descriptor가 `***`로 스크럽됨을 검증. `afterEach`로 transport 리셋(AC-S7 비회귀 보존) |

## Evolution Ideas

이 SPEC의 잠금 outcome에 필수가 아닌 투기적 후속 작업. 각 항목은 추진 시 별도 SPEC이 된다.

- `native_annotation`을 review-ui `KNOWN_WRITE_TARGETS` allowlist에 추가하고 라이브 figma 클라이언트를 `getRouter()`에 배선: 이 경로를 실제로 도달 가능하게 만드는 변경. 현재는 두 게이트(allowlist 부재, figma 미연결)가 막고 있어 잠복 상태이며, 이 SPEC의 redaction이 그 위에 먼저 놓여 활성화가 곧바로 누출로 이어지지 않게 한다.
- 두 placeholder(`***` vs `<REDACTED>`)를 단일 source-of-truth로 통합: 현재는 frozen figd_/xoxb- 경로와 full-surface 경로가 서로 다른 placeholder에 묶여 있다. 통합은 frozen 불변식과 기존 오라클을 함께 갱신해야 하므로 독립 SPEC로 분리한다.
- `redactRestoreDescriptor`를 다른 undo-descriptor 변형으로 확장: 향후 새 write target이 untrusted 직전 상태를 캡처하면 동일 주입 seam을 다른 `UndoDescriptor` 변형에도 적용. 현재 `restore-annotation` 외 변형은 untrusted prior를 담지 않으므로 deferred.

## Technology Stack Decision

| Mode | Selected stack | Resolved versions | Source refs | Checked at | Rejected alternatives |
|------|----------------|-------------------|-------------|------------|-----------------------|
| brownfield | TypeScript (monorepo 기존) | `typescript` ^6.0.3 (기존 devDependency) | `packages/write-router/package.json`, `apps/review-ui/package.json` | 2026-06-09 | 신규 런타임/프레임워크 없음 (additive 변경) |
| brownfield | Node ESM workspace | `node` >=22.0.0 (기존 engines) | 루트 `package.json` engines, `packages/escalation/package.json` | 2026-06-09 | 별도 빌드 도구 도입 안 함 |
| brownfield | vitest (기존 테스트 러너) | `vitest` ^4.1.5 (기존 devDependency) | 루트 `package.json` devDependencies, `vitest.config.ts` | 2026-06-09 | 신규 테스트 프레임워크 없음 |

brownfield 규칙에 따라 기존 manifest major 버전을 compatibility constraint로 보존한다. 신규 `@autopus/redact-patterns` 패키지는 기존 워크스페이스 컨벤션(`packages/escalation` 형태)을 그대로 따르며 외부 의존성을 추가하지 않는다. 새 라이브러리/프레임워크를 도입하지 않으므로 추가 version evidence 수집 대상 없음.

## 보안 / 신뢰 경계

- 캡처되는 직전 `node.annotations`는 author-uncontrolled Figma annotation = untrusted 외부 입력. 두 retained-artifact 경로(데몬 영속/서빙, 라우터 in-memory/HTTP) 중 데몬은 SPEC-FIGMA-018이 닫았고 이 SPEC이 라우터/HTTP를 닫는다.
- 모든 비밀 예시는 SYNTHETIC. 실제 토큰/credential/privileged 절대 경로를 문서에 노출하지 않는다(`Bearer abc123def456`, `/Users/reviewer/notes.txt` 등은 합성 placeholder 입력 예시).
- placeholder 구분: 데몬·신규 full-surface 경로는 `***`(공유 `REDACTED`), 기존 frozen figd_/xoxb- 경로는 `<REDACTED>`. 두 placeholder는 서로 다른 source-of-truth에 묶여 있으므로 의도적으로 분리 유지(S1/S3은 `***`, S2는 `<REDACTED>`).
- 로그/아티팩트: 이 SPEC은 새 영구 아티팩트를 만들지 않는다. in-memory `UndoRegistry`와 HTTP 응답 본문에서 비밀을 제거하는 것이 목적이며, redaction은 등록/반환 이전에 적용되어 retained 표면에 raw 비밀이 남지 않는다.

## 검토한 대안 (요약)

- 라우터가 아니라 review-ui route에서 응답 후처리로 redact: 경계가 늦고(이미 `UndoRegistry`에 raw 등록됨) in-memory 누출이 남는다. 기각 — capture 직후 seam이 더 이르다.
- 데몬 `redact-extended.ts`를 `packages/`로 통째 이동: redact-prior와 wire/tunnel 의존(`redactTunnelUrl`)까지 끌려와 데몬 결합이 과도. 패턴 소스 문자열만 단일화하는 것이 최소 표면. 기각.

## Self-Verify Summary

Applied `content/rules/spec-quality.md` across spec.md, plan.md, acceptance.md, research.md. Status legend: PASS / FAIL / N/A. Every non-`[NEW]` anchor was re-verified by Read/Grep against current HEAD before scoring.

| Q | status | attempt | files | reason |
|---|--------|---------|-------|--------|
| Q-CORR-01 | PASS | 3 | spec.md | Re-verified all code anchors by Read/Grep: index.ts apply register 134-141 / return 155-161 / fallback 205-213,231, redactor.ts inline TOKEN_REGEX:1 + `<REDACTED>`:2, route.ts getRouter 14-22 / KNOWN_WRITE_TARGETS 24-31 / apply+serialize 86-87, redact-patterns.ts FIGD/XOXB/BEARER/ABS/REDACTED 16-38, redact-extended.ts 4-class 36-67, redact-prior-annotation.ts redactAndMinimizePrior 53-61, native-annotation.ts minimizePrior 96-102 + @AX:WARN 114-115, the 7 redact-patterns importers, both parity tests are all real. The spec.md:8 Module header nickname was corrected from `@autopus/figma-read` to the real root package name `@autopus/figma-mcp`; no stale label remains and no `## Open Issues` block exists. |
| Q-CORR-02 | PASS | 1 | spec.md, plan.md | New artifacts marked `[NEW]`: `packages/redact-patterns/{package.json,tsconfig.json,src/index.ts}`, `packages/write-router/src/redact-restore-descriptor.ts`, the two new test files; none used as existing-reference evidence. The `src/redact-patterns.ts` re-export shim is correctly marked `existing` (it already exists; only its body changes). |
| Q-CORR-03 | PASS | 1 | spec.md, acceptance.md | EARS forms valid (Ubiquitous REQ-01/02/08, Event-driven REQ-03/04/05/09, State-driven REQ-06, Unwanted-behavior REQ-07); Priority on a separate meta line, never in description text. Gherkin uses bare Given/And/When/Then. Asserted placeholders match the real parsers: frozen figd_/xoxb- path emits `<REDACTED>` (redactor.ts:2), full-surface/daemon path emits `***` (redact-patterns.ts:38); S1/S3/S4 use `***`, S2 uses `<REDACTED>`, consistent with the two source-of-truth placeholders. |
| Q-COMP-01 | PASS | 1 | all four | spec.md (9 REQ + trust-boundary model + traceability), plan.md (8 tasks + non-overlapping ownership + order), acceptance.md (6 oracle/non-regression scenarios), research.md (verified anchors + module-boundary evidence + Option D+A decision + invariants) are each distinct and complementary. |
| Q-COMP-02 | PASS | 1 | spec.md, plan.md, acceptance.md | spec.md `## Traceability Matrix` maps every REQ-01..09 to plan task(s) and scenario(s); plan.md ownership table and acceptance.md `## Requirement to Scenario Coverage` agree. No REQ disappears; REQ-06 (no-op identity) and REQ-09 (oracle upgrade) both route to S5. |
| Q-COMP-03 | PASS | 1 | spec.md, acceptance.md | Each REQ states EARS type, trigger, expected result, and a named observation point (`undo_descriptor.prior[].labelMarkdown`, HTTP JSON body, `redactObject`/`redactExtendedObject` output, parity-test constants, `UndoRegistry` registered descriptor). |
| Q-COMP-04 | PASS | 3 | research.md, spec.md, plan.md | Closed review finding: added the named `## Outcome Lock` section (research.md) with a single locked completion-outcome sentence (redact + minimize the captured prior on the `WriteRouter.apply` path before `UndoRegistry` register / HTTP `undo_descriptor` return, via shared `@autopus/redact-patterns` single-sourcing + `redactRestoreDescriptor` seam, daemon S13 and AC-S8 unchanged) and a completion-evidence pointer to the `## Feature Coverage Map`. The outcome is fully owned by this SPEC (no sibling dependency); the Coverage Map decomposes it and the allowlist+live-figma extension is marked deferred (safe because the redaction gate precedes it), not hand-waved. |
| Q-COMP-05 | PASS | 2 | research.md, spec.md, plan.md, acceptance.md | `## Semantic Invariant Inventory` has 6 invariants, each traced to REQ + plan task + a Must oracle scenario. The prior-redaction oracles S1 and S3 carry concrete inputs (`Bearer abc123def456`, `/Users/reviewer/notes.txt`, `/home/svc/key`, `C:\Users\svc\token.txt`) and concrete expected outputs (absent secret substrings + `***` placeholder + preserved non-secret `reviewer`/`see`). S2 fixes byte-exact `figd_ABCDEFGHIJKLMNOP01`/`xoxb-ABCDEFGH99` and `<REDACTED>`. No Must scenario is structural-only. |
| Q-COMP-06 | PASS | 2 | research.md, spec.md | Closed review finding F-001: added the named `## Reviewer Brief` section (research.md) with intended scope (router/HTTP retained-artifact path; daemon path already closed by SPEC-FIGMA-018), explicit non-goals (out-of-review-scope pointer to Completion Debt / Evolution Ideas), self-verified evidence (the cited index.ts:134-141/155-161/205-213/231 anchors, the 7 importers, the 2 parity oracles), and an ORDERED reviewer-focus list (Q-SEC seam-ordering, AC-S14 parity shim, layering, non-regression, oracle quality). spec.md already carries the complementary `## Traceability Matrix`; Q-COMP-06 now has BOTH the matrix (spec.md) and the Reviewer Brief (research.md). |
| Q-COMP-07 | PASS | 2 | research.md | Closed review finding: `## Completion Debt` (closed-by-this-SPEC router/HTTP exposure via T4+T5+T6; bounded/intentional `***`-vs-`<REDACTED>` placeholder divergence; deferred `native_annotation` allowlist + live-figma wiring; closed inline-`TOKEN_REGEX` drift surface) is now explicitly separated from `## Evolution Ideas` (allowlist+live-figma reachability, placeholder unification, `redactRestoreDescriptor` extension to other undo variants). Deferred future work is no longer only in the Feature Coverage Map. |
| Q-FEAS-01 | PASS | 1 | spec.md, plan.md | Scope split is honest: this is runtime TS code (new shared package + write-router redactor/router + review-ui wiring + tests), correctly distinguished from the daemon source-of-truth that stays non-regression. The latent-defect-not-live-vuln framing (two gates: KNOWN_WRITE_TARGETS lacks `native_annotation`, getRouter has no figma client) is verified against route.ts:24-31 and 14-22. |
| Q-FEAS-02 | PASS | 1 | plan.md, research.md | New `@autopus/redact-patterns` fits the real `workspaces` glob `packages/*` (package.json:29-33) and mirrors the `@autopus/escalation` precedent (private/type:module/exports). Module boundaries hold: review-ui depends only on `@autopus/write-router` (review-ui/package.json:13-18, no daemon `src/` path), and write-router introduces no daemon `src/` import; the shared package is the neutral seam both can import. Verified no layer inversion. |
| Q-FEAS-03 | PASS | 1 | plan.md, acceptance.md | Verification is runnable on the existing vitest runner (^4.1.5): new `packages/write-router/tests/*` oracles plus the relocated parity tests; S5 names the SPEC-FIGMA-018 S13 daemon test and AC-S14 parity as the non-regression run. No nonexistent command invoked. |
| Q-STYLE-01 | PASS | 1 | spec.md | Requirement descriptions are assertive `THE SYSTEM SHALL`; ambiguous words appear only as MoSCoW Priority labels on separate meta lines (Must/Should), never in requirement text. |
| Q-STYLE-02 | PASS | 1 | spec.md | Priority (Must/Should) and EARS Type are separate meta lines; no P0/P1/Could aliases. |
| Q-STYLE-03 | PASS | 1 | spec.md, acceptance.md | Sentences complete; Gherkin steps are bare keywords without bullet/bold markup. |
| Q-SEC-01 | PASS | 2 | spec.md, research.md, acceptance.md | Two trust boundaries are explicit and distinct: (a) the captured prior `node.annotations` snapshot is author-uncontrolled untrusted external input, closed on the daemon path by SPEC-FIGMA-018 and on the router/HTTP path by this SPEC; (b) the `source clause` quotes in the invariant table are untrusted prompt-input evidence, cited as evidence not instructions. The relocation does NOT weaken AC-S14: single-sourcing the four pattern strings removes the inline-literal drift surface the parity test only guarded textually, so it strengthens the boundary. |
| Q-SEC-02 | PASS | 1 | acceptance.md, research.md, spec.md | All secrets are SYNTHETIC placeholders (`Bearer abc123def456`, `Bearer ZZZ1234567890ABCDEF`, `/Users/reviewer/notes.txt`, `/home/svc/key`, `C:\Users\svc\token.txt`, `figd_ABCDEFGHIJKLMNOP01`, `xoxb-ABCDEFGH99`); no real token/credential/privileged path is committed. Absolute paths appear only as the redactor own frozen prefix list and as synthetic inputs asserted to be scrubbed. |
| Q-SEC-03 | PASS | 1 | spec.md, research.md, acceptance.md | The retained artifacts (in-memory `UndoRegistry` entry + HTTP `undo_descriptor` response body) are scrubbed BEFORE register/return, so no raw secret persists in a retained surface. No new permanent/diff-noisy artifact is introduced; the descriptor keeps its existing shape. Redaction-before-registration is the explicit ordering requirement (REQ-03). |
| Q-COH-01 | PASS | 1 | spec.md | One cohesive change story: close the router/HTTP capture-prior leak by single-sourcing the four redact patterns and wiring a full-surface redactor into the apply seam. Bounded to write-router + review-ui + the new shared package. |
| Q-COH-02 | PASS | 1 | spec.md, research.md | Follow-on work (add `native_annotation` to `KNOWN_WRITE_TARGETS`, connect a live figma client) is split out as deferred future work in `## Feature Completion Scope` and the Coverage Map, not implied as solved here. |
| Q-COH-03 | PASS | 1 | plan.md | 8 tasks with non-overlapping file ownership and a stated execution order (T1 to T2 to T3 to (T4,T7) to T5 to (T6,T8)); each is independently implementable and none is a hollow scaffold. |

Result: 22 PASS, 0 N/A, 0 FAIL across 22 checklist items. No Open Issues.

Notes on retries:
- Q-CORR-01: re-verified every load-bearing anchor (lines, types, functions, the 7 importers, both parity tests, all four pattern sources, the daemon redactor, the route allowlist) as real. The spec.md:8 Module header nickname was corrected from `@autopus/figma-read` to the real root package name `@autopus/figma-mcp`, closing the only residual; spec.md carries no `## Open Issues` block.
- Q-COMP-04 / Q-COMP-05 / Q-SEC-01: hardened on a second pass to confirm the deferred allowlist slice is gated by the redaction (not hand-waved), that S1/S3 are concrete prior-redaction oracles with Bearer/abs-path placeholder expectations, and that the relocation strengthens rather than weakens AC-S14.
- Q-COMP-04 / Q-COMP-06 / Q-COMP-07 (multi-provider REVISE closure): added the named `## Outcome Lock`, `## Reviewer Brief`, `## Completion Debt`, and `## Evolution Ideas` sections to research.md (mirroring SPEC-FIGMA-018), placed between the Semantic Invariant Inventory and the Technology Stack Decision. No REQ/AC/plan task was altered; deferred future work was moved out of the Feature Coverage Map into the now-separated Completion Debt vs Evolution Ideas sections. Q-CORR-01 remains the single pre-existing residual (the spec.md:8 monorepo nickname Open Issue), untouched by this format-only closure.
