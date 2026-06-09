# SPEC-FIGMA-019 구현 계획

> Status: draft

## 태스크 목록

- [ ] T1: `[NEW] packages/redact-patterns/` 워크스페이스 패키지 생성. `package.json`(name `@autopus/redact-patterns`, `private: true`, `type: module`, `main`/`exports` → `./src/index.ts`), `tsconfig.json`(`packages/escalation/tsconfig.json` 형태 복제, `include: ["src/**/*.ts"]`), `src/index.ts`로 `FIGD_PATTERN_SOURCE`/`XOXB_PATTERN_SOURCE`/`BEARER_PATTERN_SOURCE`/`ABSOLUTE_PATH_PATTERNS_SOURCE`/`REDACTED`를 이동(byte-identical 문자열). 루트 `package.json`의 `workspaces`는 이미 `packages/*`를 포함하므로 추가 등록 불필요. (REQ-01)
- [ ] T2: `src/redact-patterns.ts`를 `@autopus/redact-patterns` re-export 모듈로 전환. 기존 export 식별자(`FIGD_PATTERN_SOURCE` 등)와 값은 그대로 유지하여 현재 importer(`src/daemon/redact-extended.ts`, `vendor/.../autopus_redact.ts`, `tests/unit/redact-patterns-parity.test.ts`, `tests/integration/figma-007/AC-S14.test.ts`, `tests/integration/figma-007/AC-S7.test.ts`, `tests/unit/daemon-audit-retention-guard.test.ts`)가 import 경로 변경 없이 계속 동작하게 한다. (REQ-01, REQ-08)
- [ ] T3: `packages/write-router/src/redactor.ts`에 full-surface redactor 추가. `@autopus/redact-patterns`에서 네 패턴 소스를 import해 `BEARER_RE`/`ABSOLUTE_PATH_REGEXES`를 `redact-extended.ts`와 동일 방식으로 구성하고, `redactExtendedTokens(string)`/`redactExtendedObject(unknown)`를 export한다. 기존 `redactTokens`/`redactObject`/`redact`는 그대로 두되, 인라인 `TOKEN_REGEX` 리터럴 대신 `FIGD_PATTERN_SOURCE`/`XOXB_PATTERN_SOURCE`에서 재구성하여 인라인 드리프트 표면을 제거한다. 300줄 한도 준수. (REQ-02, REQ-07, REQ-08)
- [ ] T4: `[NEW] packages/write-router/src/redact-restore-descriptor.ts` 생성. `redactRestoreDescriptor(descriptor)`가 `restore-annotation` 디스크립터의 `prior` 배열 각 스냅샷에 대해 (a) 복원 필드(`labelMarkdown`, optional `categoryId`, optional `properties`)만 보존하고 (b) 각 텍스트 필드를 `redactExtendedObject`로 스크럽한다. 입력 불변(새 디스크립터 반환). `noop`/비-`restore-annotation` 디스크립터는 원본을 그대로 반환(REQ-06 no-op 의미). `src/daemon/redact-prior-annotation.ts`의 minimize+redact 의미를 패키지 경계 안에서 재현하되 코드 공유는 패턴 소스 단일화로만 한다. (REQ-03, REQ-04, REQ-07)
- [ ] T5: `packages/write-router/src/index.ts` 수정. `WriteRouterOptions`에 `redactRestoreDescriptor?: (d: UndoDescriptor) => UndoDescriptor` 추가, 생성자에서 보관. `apply`의 성공 경로에서 `applied.undo_descriptor`를 `undoRegistry.register`(line 134-141) 및 `WriteResult.undo_descriptor` 반환(line 155-161) **이전에** 주입된 redactor로 통과시킨다(미주입 시 identity). `fallbackToPluginBridge`의 `result.undo_descriptor`(line 205-213, 231)에도 동일 적용. (REQ-03, REQ-06)
- [ ] T6: `apps/review-ui/src/app/api/apply/route.ts`의 `getRouter()`(line 14-22)에서 `WriteRouter` 생성 시 `redactRestoreDescriptor`로 T4의 기본 redactor를 주입한다. import는 `@autopus/write-router/redact-restore-descriptor`(T7에서 추가하는 export) 경유. review-ui는 `@autopus/write-router`만 의존하므로 데몬 `src/` 직접 import는 발생하지 않는다. (REQ-05)
- [ ] T7: 패키지 매니페스트/패리티 오라클 갱신. `packages/write-router/package.json`에 `dependencies: { "@autopus/redact-patterns": "*" }`와 `exports`의 `"./redact-restore-descriptor"`, `"./redactor"`(기존) 항목 정리. `tests/unit/redact-patterns-parity.test.ts`와 `tests/integration/figma-007/AC-S14.test.ts`의 import 경로를 `@autopus/redact-patterns`로 갱신하고, write-router 포트가 인라인 리터럴이 아니라 공유 상수를 단일 소싱하는지(figd_/xoxb-/bearer/abs-path 4종) 검증하도록 어서션을 확장한다. (REQ-08, REQ-09)

- [ ] T8: 오라클 + 비회귀 테스트 작성. `[NEW] packages/write-router/tests/router-prior-redaction.test.ts`(S1, S6 — mock figma 클라이언트로 `WriteRouter.apply` executor 경로를 통과시켜 반환/등록된 `undo_descriptor.prior`가 placeholder로 스크럽됨을 검증, undo 구조 복원 확인), `[NEW] packages/write-router/tests/redactor-extended.test.ts`(S3 — full-surface redactor 단위 검증). 데몬 S13(`src/daemon/tests/apply-tool-native-annotation-redaction.test.ts`)과 AC-S8 카드 테스트는 변경 없이 통과해야 함(S5). (REQ-03, REQ-04, REQ-08)

## 구현 전략

### 선택한 설계 — Option D(패턴 단일 소싱) + Option A(주입 seam) 하이브리드

`research.md` `## 설계 결정`이 모듈 경계 증거와 함께 확정한 결정을 따른다. 핵심 분리:

- **CAPABILITY (Option D)**: write-router가 자체 패키지 경계 안에서 네 비밀 클래스를 모두 스크럽할 수 있어야 한다. 데몬 `src/daemon/redact-extended.ts`를 import하는 것은 레이어 역전이라 금지이므로, 패턴 소스 문자열을 `@autopus/redact-patterns` 공유 패키지로 이동하여 데몬·write-router·플러그인 포트가 동일 문자열을 단일 소싱한다. 이로써 AC-S14 byte-equal 패리티가 복제 없이 보존되고, write-router의 인라인 리터럴 드리프트 표면이 제거된다.
- **WIRING (Option A)**: 강화된 redactor만으로는 `undo_descriptor` capture 경로에 도달하지 않는다. `WriteRouter.apply`에 `redactRestoreDescriptor` 주입 seam을 추가하고, review-ui consumer가 full-surface redactor를 주입한다. 데몬 consumer는 이미 자기 경계에서 redact하므로 주입을 생략(identity)한다(REQ-06).

### 기존 코드 활용

- `src/daemon/redact-extended.ts`의 `BEARER_RE`/`ABSOLUTE_PATH_REGEXES` 구성 방식(line 23-34)을 write-router redactor에서 동일하게 재현한다(동일 소스 문자열 → 동일 RegExp).
- `src/daemon/redact-prior-annotation.ts`의 minimize+redact 의미(복원 필드만 보존 후 `redactExtendedObject`)를 T4가 패키지 경계 안에서 재현한다.
- `registry.ts`의 `dynamicAdapter` 디스패치와 `native-annotation.ts`의 adapter 계약은 변경하지 않는다(주입은 라우터 레벨).

### 비-중첩 파일 소유권 (병렬 실행 가능 경계)

| 태스크 | 소유 파일 | 비중첩 근거 |
|--------|-----------|-------------|
| T1 | `packages/redact-patterns/{package.json,tsconfig.json,src/index.ts}` (모두 신규) | 신규 디렉토리, 충돌 없음 |
| T2 | `src/redact-patterns.ts` | T1 완료 의존; 단일 파일 |
| T3 | `packages/write-router/src/redactor.ts` | 단일 파일; T1 의존 |
| T4 | `packages/write-router/src/redact-restore-descriptor.ts` (신규) | 신규 파일; T3 export 의존 |
| T5 | `packages/write-router/src/index.ts` | 단일 파일; T4 의존 |
| T6 | `apps/review-ui/src/app/api/apply/route.ts` | 단일 파일; T4·T7 의존 |
| T7 | `packages/write-router/package.json`, `tests/unit/redact-patterns-parity.test.ts`, `tests/integration/figma-007/AC-S14.test.ts` | T1·T3 의존 |
| T8 | `packages/write-router/tests/{router-prior-redaction,redactor-extended}.test.ts` (신규) | 신규 파일; T5 의존 |

실행 순서: T1 → T2 → T3 → (T4, T7 병렬 가능) → T5 → (T6, T8 병렬 가능). T2와 T3는 T1 이후 병렬 가능.

## Feature Completion Scope

이 SPEC은 라우터/HTTP 경로의 캡처 prior 비밀 누출을 완전히 닫는다. CAPABILITY와 WIRING을 모두 포함하므로 sibling SPEC 없이 요청 결과를 닫는다. 데몬 경로(SPEC-FIGMA-018 S13)는 비회귀로 보존하고, AC-S8 카드 불변식과 `annotation_card` 경로는 수정하지 않는다. 후속(향후 `native_annotation`을 review-ui `KNOWN_WRITE_TARGETS`에 추가하고 라이브 figma 클라이언트를 연결)은 별개 작업이며 이 SPEC의 redaction 게이트 위에서 안전하게 진행된다.

## 리스크와 완화

- **R1 — 패턴 이동이 기존 importer를 깨뜨림**: T2 re-export 셰임으로 모든 import 경로를 보존하여 churn 0. 패리티 테스트가 회귀를 즉시 검출.
- **R2 — write-router redactor 강화가 AC-S14 패리티를 깨뜨림**: 인라인 리터럴을 제거하고 공유 상수에서 재구성하므로 드리프트 표면 자체가 사라진다. T7이 패리티 오라클을 4종 단일 소싱 검증으로 확장.
- **R3 — 파일 300줄 한도**: `redactor.ts`는 full-surface 추가 후에도 한도 미만 유지(현재 23줄). restore-descriptor redactor는 신규 소형 파일로 분리.
- **R4 — 데몬 경로 회귀**: 라우터 주입은 데몬 consumer가 주입을 생략하면 no-op이므로 S13 동작 불변(REQ-06). T8이 S13 비회귀를 명시 검증.
