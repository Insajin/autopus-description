# Review: SPEC-FIGMA-020

**Verdict**: PASS
**Revision**: 0
**Date**: 2026-06-10 09:40:17

## Provider Health

| Provider | Status | Note |
| --- | --- | --- |
| claude | success | - |
| codex | success | - |

## Checklist Summary

| ID | Status | Provider | Reason |
| --- | --- | --- | --- |
| Q-CORR-01 | PASS | claude | Non-[NEW] references (types.ts WriteTarget/UndoDescriptor, registry.ts TARGETS/dynamicAdapter, native-annotation.ts, native-label.ts, annotation-card-plan.ts, plan-emit/types.ts maps, autopus_command_… |
| Q-CORR-02 | PASS | claude | New modules and tests are consistently marked [NEW] (adapters/native-annotation-with-card.ts, card-table-payload.ts, structured-policy.ts, plan-emit/native-annotation-with-card-plan.ts, figma-020 test… |
| Q-CORR-03 | PASS | claude | EARS types valid (Ubiquitous/Event-driven/Unwanted-behavior/State-driven); MoSCoW on a separate meta line; acceptance scenarios use bare Given/When/Then/And. |
| Q-CORR-04 | PASS | claude | Existing vs planned references are cleanly separated; vendor renderer treated as a pinned additive integration layer; schema/ treated as source of truth, not a generated copy. |
| Q-COMP-01 | PASS | claude | Four files form one package: spec.md (REQ), plan.md (tasks+ownership), acceptance.md (oracle scenarios), research.md (evidence, decisions, invariants); each is distinct and complementary. |
| Q-COMP-02 | PASS | claude | All 18 REQ are traceable via spec.md Traceability Matrix and research.md Feature Coverage Map to plan tasks and acceptance scenarios; REQ-17 routed to unit with stated rationale. |
| Q-COMP-03 | PASS | claude | Each REQ has an EARS type, trigger, and expected result; observability points named (emitted op order, table node structure, compound undo descriptor, persisted AppliedWrite, HTTP body). |
| Q-COMP-04 | PASS | claude | research.md '## Outcome Lock' fixes user-visible outcome, mandatory behavior, explicit non-goals, and observable completion evidence (S1/S4/S5/S7); the Primary SPEC's REQ/plan/Must acceptance close it… |
| Q-COMP-05 | PASS | claude | Resolves F-001: '## Semantic Invariant Inventory' present with INV-01..INV-10 each traced to REQ + plan task + Must oracle; S1/S2/S4/S5/S7 carry concrete expected values (cell arrays, undo state, secr… |
| Q-COMP-06 | PASS | claude | spec.md '## Traceability Matrix' links each REQ to plan task and scenario; research.md '## Reviewer Brief' gives scope, non-goals, self-verified evidence, and ordered reviewer focus (partial-failure b… |
| Q-COMP-07 | PASS | claude | '## Completion Debt' (security recursion, native-authoritative partial-failure) and '## Evolution Ideas' (data_io union, geometry matching, per-cell rich text, etc.) are separated; Evolution Ideas rem… |
| Q-FEAS-01 | PASS | claude | Scope split is correct across write-router runtime, vendor plugin integration, schema, prompt, validator, daemon apply, and review-ui; native runtime is reused, not reimplemented. |
| Q-FEAS-02 | PASS | claude | Edit paths match real module ownership; vendor handled as a pinned additive layer; schema source of truth under schema/; package subpath exports for redact-restore-descriptor confirmed. |
| Q-FEAS-03 | PASS | claude | Verification is runnable via the existing Vitest suite plus the listed new oracle/integration tests; S8 names a concrete AC-S8 byte-unchanged check. |
| Q-STYLE-01 | PASS | claude | Requirement descriptions are assertive (THE SYSTEM SHALL); no ambiguous wording in REQ bodies; priority only on separate meta lines. |
| Q-STYLE-02 | PASS | claude | Priority (Must/Should) and EARS Type are separate meta lines; no P0/P1/Could aliases. |
| Q-STYLE-03 | PASS | claude | Complete sentences throughout; acceptance steps use bare Given/When/Then/And keywords. |
| Q-SEC-01 | PASS | claude | Trust boundaries explicit: authored text routed through redactWire (REQ-09) and untrusted captured prior through daemon redactAndMinimizePrior (REQ-10) and router/HTTP redactRestoreDescriptor (REQ-11)… |
| Q-SEC-02 | PASS | claude | Captured prior is minimized and scrubbed via redactExtendedObject/redactRestoreDescriptor; S7 uses synthetic xoxb-/absolute-path secrets only; no real credentials committed. |
| Q-SEC-03 | PASS | claude | Retained AppliedWrite and autopus://applied_writes artifacts are redacted at capture on both paths; the existing AppliedWrite shape is reused so no new diff-noisy or unstable artifact is introduced. |
| Q-COH-01 | PASS | claude | One cohesive change story: dual-surface delivery (concise native annotation + real-table policy card) in a single apply with one compound undo and native-authoritative partial-failure. |
| Q-COH-02 | PASS | claude | Outcome Lock-required work (partial-failure branch, redaction recursion) lives in the Primary SPEC or Completion Debt; Evolution Ideas stay optional and do not reserve auto follow-up SPECs. |
| Q-COH-03 | PASS | claude | '## Sibling-vs-single decision' justifies keeping the structured-schema migration in-SPEC against Q-COH-03; no sibling is created, avoiding a scaffold-only over-split with no observable behavior. |
| Q-CORR-01 | PASS | codex | 제공된 Existing Code Context와 research.md의 기존 참조가 서로 일치하며, 기존 경로와 심볼을 실제 구현 근거로 분리해 제시하고 있습니다. |
| Q-CORR-02 | PASS | codex | 신규 파일과 신규 테스트는 [NEW]로 표시되어 기존 참조 검증 대상과 구분됩니다. |
| Q-CORR-03 | PASS | codex | REQ는 EARS 형태와 별도 Priority/Type 메타를 유지하고, acceptance 시나리오는 bare Given/When/Then/And 형식을 사용합니다. |
| Q-CORR-04 | PASS | codex | 기존 구현 근거는 research.md의 검증 테이블에 모아두고, 계획된 모듈과 테스트는 [NEW]로 표시해 source-of-truth와 future surface를 구분합니다. |
| Q-COMP-01 | PASS | codex | spec.md, plan.md, acceptance.md, research.md가 각각 요구사항, 구현 태스크, oracle 시나리오, 근거/결정/불변식 역할을 나누어 완전한 패키지를 이룹니다. |
| Q-COMP-02 | PASS | codex | 18개 REQ가 Traceability Matrix를 통해 plan task와 acceptance scenario 또는 unit 검증에 연결되어 있습니다. |
| Q-COMP-03 | PASS | codex | 각 REQ가 EARS type, 조건, 기대 결과를 포함하고, 관측 지점은 emitted command order, table payload, undo descriptor, HTTP response, persisted artifact 등으로 구체화되어 있습니다. |
| Q-COMP-04 | PASS | codex | research.md의 Outcome Lock이 사용자 가시 결과, non-goal, completion evidence를 고정하고 Must acceptance가 이를 닫습니다. |
| Q-COMP-05 | PASS | codex | research.md에 Semantic Invariant Inventory가 추가되어 각 invariant가 REQ, plan task, Must oracle acceptance로 추적됩니다. |
| Q-COMP-06 | PASS | codex | spec.md의 Traceability Matrix와 research.md의 Reviewer Brief가 review scope, non-goal, 검증 초점을 제시합니다. semantic invariant 연결은 별도 inventory에서 보완되어 확인 가능합니다. |
| Q-COMP-07 | PASS | codex | Completion Debt와 Evolution Ideas가 분리되어 있으며, 필수 보안/부분 실패 debt는 REQ와 acceptance로 닫고 선택 개선은 advisory로만 남깁니다. |
| Q-FEAS-01 | PASS | codex | 범위가 write-router, daemon, vendor plugin, schema, prompt, validator, review-ui의 실제 구현 레이어에 맞게 나뉘어 있습니다. |
| Q-FEAS-02 | PASS | codex | 변경 대상 경로가 제공된 repo 구조와 모듈 소유권에 부합하며, validator는 schema/를 source of truth로 사용하는 것으로 설명되어 있습니다. |
| Q-FEAS-03 | PASS | codex | 검증은 기존 Vitest/AJV 기반 테스트와 구체적인 신규 oracle 테스트로 구성되어 현재 저장소에서 수행 가능한 수준입니다. |
| Q-STYLE-01 | PASS | codex | 요구사항 본문은 THE SYSTEM SHALL 중심의 단정형 문장으로 작성되어 모호어가 blocking 의미를 만들지 않습니다. |
| Q-STYLE-02 | PASS | codex | Priority는 Must/Should로, EARS Type은 별도 축으로 분리되어 있습니다. |
| Q-STYLE-03 | PASS | codex | REQ와 AC 문장이 완결되어 있고 Gherkin step keyword가 마크업 없이 읽히는 형식입니다. |
| Q-SEC-01 | PASS | codex | authored text, captured prior annotations, review-ui HTTP path, daemon wire boundary가 각각 trust boundary로 식별되고 완화가 REQ-09~REQ-11에 반영되어 있습니다. |
| Q-SEC-02 | PASS | codex | synthetic token과 privileged path 예시만 사용하며, redaction recursion과 minimized prior handling을 명시해 secret/path 노출을 방지합니다. |
| Q-SEC-03 | PASS | codex | AppliedWrite, autopus://applied_writes, HTTP undo_descriptor 같은 retained artifact의 secret leakage 위험과 redaction timing을 다룹니다. |
| Q-COH-01 | PASS | codex | SPEC은 native annotation과 real-table policy card를 한 번의 apply로 제공하는 단일 cohesive change story에 수렴합니다. |
| Q-COH-02 | PASS | codex | Outcome Lock에 필요한 runtime/platform work는 Primary SPEC에 포함되어 있고, optional polish는 Evolution Ideas로만 남습니다. |
| Q-COH-03 | PASS | codex | Sibling-vs-single decision이 과분할을 피하는 근거를 제시하며 sibling SPEC를 만들지 않는 경계가 명확합니다. |

Total: 46 (PASS: 46, FAIL: 0, N/A: 0)

## Findings

| Provider | Severity | Description |
|----------|----------|-------------|
| claude | major | research.md has no '## Semantic Invariant Inventory' section, yet acceptance.md states 'Scenario IDs are referenced by spec.md Traceability Matrix and research.md Semantic Invariant Inventory.' Q-COMP-05 requires each semantic invariant to be inventoried and traced to requirement+plan+Must oracle acceptance. The underlying oracles do exist (S1 cell arrays, S5 undo, S7 secret-absence), but the mandated inventory section and its mapping are absent. |

## Provider Responses

### Response 1

VERDICT: PASS

F-001 is resolved: `research.md` now contains a `## Semantic Invariant Inventory` section with ten invariants (INV-01…INV-10), each traced to source clause → type → affected outputs → REQ → plan task(s) → Must oracle, and the oracle note ties S1/S2/S4/S5/S7 to concrete expected values (cell arrays, undo state, secret-absence). This satisfies Q-COMP-05 and matches the forward reference in `acceptance.md`. No new critical/security regressions introduced by the fix.

```json
{
  "verdict": "PASS",
  "summary": "Prior finding F-001 is resolved: research.md now has a '## Semantic Invariant Inventory' section with 10 invariants (INV-01..INV-10), each mapped to a source clause, requirement, plan task, and a Must oracle scenario, with concrete expected outputs called out for S1/S2/S4/S5/S7. This closes the Q-COMP-05 gap and aligns with the acceptance.md forward reference. The additive composite design, dual-path captured-prior redaction recursion (D8), AC-S8 byte-unchanged non-regression, and v0.4.0 additive-minor schema union are all coherent and traceable. No critical or security regressions were introduced by the revision, so the SPEC passes (critical=0, security=0, major=0).",
  "findings": [],
  "checklist": [
    {"id": "Q-CORR-01", "status": "PASS", "reason": "Non-[NEW] references (types.ts WriteTarget/UndoDescriptor, registry.ts TARGETS/dynamicAdapter, native-annotation.ts, native-label.ts, annotation-card-plan.ts, plan-emit/types.ts maps, autopus_command_dispatch.ts TOOL_NAME_MAP, autopus_area_handoff_renderer.ts createAreaHandoffCanvas, apply-tool.ts, redact-prior-annotation.ts, redact-restore-descriptor.ts, route.ts KNOWN_WRITE_TARGETS, node-only.ts) all match the supplied code context."},
    {"id": "Q-CORR-02", "status": "PASS", "reason": "New modules and tests are consistently marked [NEW] (adapters/native-annotation-with-card.ts, card-table-payload.ts, structured-policy.ts, plan-emit/native-annotation-with-card-plan.ts, figma-020 test files) and are not used as existing-reference evidence."},
    {"id": "Q-CORR-03", "status": "PASS", "reason": "EARS types valid (Ubiquitous/Event-driven/Unwanted-behavior/State-driven); MoSCoW on a separate meta line; acceptance scenarios use bare Given/When/Then/And."},
    {"id": "Q-CORR-04", "status": "PASS", "reason": "Existing vs planned references are cleanly separated; vendor renderer treated as a pinned additive integration layer; schema/ treated as source of truth, not a generated copy."},
    {"id": "Q-COMP-01", "status": "PASS", "reason": "Four files form one package: spec.md (REQ), plan.md (tasks+ownership), acceptance.md (oracle scenarios), research.md (evidence, decisions, invariants); each is distinct and complementary."},
    {"id": "Q-COMP-02", "status": "PASS", "reason": "All 18 REQ are traceable via spec.md Traceability Matrix and research.md Feature Coverage Map to plan tasks and acceptance scenarios; REQ-17 routed to unit with stated rationale."},
    {"id": "Q-COMP-03", "status": "PASS", "reason": "Each REQ has an EARS type, trigger, and expected result; observability points named (emitted op order, table node structure, compound undo descriptor, persisted AppliedWrite, HTTP body)."},
    {"id": "Q-COMP-04", "status": "PASS", "reason": "research.md '## Outcome Lock' fixes user-visible outcome, mandatory behavior, explicit non-goals, and observable completion evidence (S1/S4/S5/S7); the Primary SPEC's REQ/plan/Must acceptance close it."},
    {"id": "Q-COMP-05", "status": "PASS", "reason": "Resolves F-001: '## Semantic Invariant Inventory' present with INV-01..INV-10 each traced to REQ + plan task + Must oracle; S1/S2/S4/S5/S7 carry concrete expected values (cell arrays, undo state, secret-absence), not structural-only checks."},
    {"id": "Q-COMP-06", "status": "PASS", "reason": "spec.md '## Traceability Matrix' links each REQ to plan task and scenario; research.md '## Reviewer Brief' gives scope, non-goals, self-verified evidence, and ordered reviewer focus (partial-failure branch, redaction recursion, AC-S8 non-regression, back-compat, oracle quality)."},
    {"id": "Q-COMP-07", "status": "PASS", "reason": "'## Completion Debt' (security recursion, native-authoritative partial-failure) and '## Evolution Ideas' (data_io union, geometry matching, per-cell rich text, etc.) are separated; Evolution Ideas remain advisory without auto-generated SPEC/task/acceptance IDs."},
    {"id": "Q-FEAS-01", "status": "PASS", "reason": "Scope split is correct across write-router runtime, vendor plugin integration, schema, prompt, validator, daemon apply, and review-ui; native runtime is reused, not reimplemented."},
    {"id": "Q-FEAS-02", "status": "PASS", "reason": "Edit paths match real module ownership; vendor handled as a pinned additive layer; schema source of truth under schema/; package subpath exports for redact-restore-descriptor confirmed."},
    {"id": "Q-FEAS-03", "status": "PASS", "reason": "Verification is runnable via the existing Vitest suite plus the listed new oracle/integration tests; S8 names a concrete AC-S8 byte-unchanged check."},
    {"id": "Q-STYLE-01", "status": "PASS", "reason": "Requirement descriptions are assertive (THE SYSTEM SHALL); no ambiguous wording in REQ bodies; priority only on separate meta lines."},
    {"id": "Q-STYLE-02", "status": "PASS", "reason": "Priority (Must/Should) and EARS Type are separate meta lines; no P0/P1/Could aliases."},
    {"id": "Q-STYLE-03", "status": "PASS", "reason": "Complete sentences throughout; acceptance steps use bare Given/When/Then/And keywords."},
    {"id": "Q-SEC-01", "status": "PASS", "reason": "Trust boundaries explicit: authored text routed through redactWire (REQ-09) and untrusted captured prior through daemon redactAndMinimizePrior (REQ-10) and router/HTTP redactRestoreDescriptor (REQ-11); D8 flags the compound-variant recursion gap; S7 is the oracle."},
    {"id": "Q-SEC-02", "status": "PASS", "reason": "Captured prior is minimized and scrubbed via redactExtendedObject/redactRestoreDescriptor; S7 uses synthetic xoxb-/absolute-path secrets only; no real credentials committed."},
    {"id": "Q-SEC-03", "status": "PASS", "reason": "Retained AppliedWrite and autopus://applied_writes artifacts are redacted at capture on both paths; the existing AppliedWrite shape is reused so no new diff-noisy or unstable artifact is introduced."},
    {"id": "Q-COH-01", "status": "PASS", "reason": "One cohesive change story: dual-surface delivery (concise native annotation + real-table policy card) in a single apply with one compound undo and native-authoritative partial-failure."},
    {"id": "Q-COH-02", "status": "PASS", "reason": "Outcome Lock-required work (partial-failure branch, redaction recursion) lives in the Primary SPEC or Completion Debt; Evolution Ideas stay optional and do not reserve auto follow-up SPECs."},
    {"id": "Q-COH-03", "status": "PASS", "reason": "'## Sibling-vs-single decision' justifies keeping the structured-schema migration in-SPEC against Q-COH-03; no sibling is created, avoiding a scaffold-only over-split with no observable behavior."}
  ],
  "finding_statuses": [
    {"id": "F-001", "status": "resolved", "reason": "research.md now contains '## Semantic Invariant Inventory' with INV-01..INV-10, each traced to a source clause, REQ, plan task(s), and a Must oracle scenario; the oracle note binds S1/S2/S4/S5/S7 to concrete expected values, satisfying Q-COMP-05 and matching the acceptance.md forward reference."}
  ]
}
```


### Response 2

{"checklist":[{"id":"Q-CORR-01","reason":"제공된 Existing Code Context와 research.md의 기존 참조가 서로 일치하며, 기존 경로와 심볼을 실제 구현 근거로 분리해 제시하고 있습니다.","status":"PASS"},{"id":"Q-CORR-02","reason":"신규 파일과 신규 테스트는 [NEW]로 표시되어 기존 참조 검증 대상과 구분됩니다.","status":"PASS"},{"id":"Q-CORR-03","reason":"REQ는 EARS 형태와 별도 Priority/Type 메타를 유지하고, acceptance 시나리오는 bare Given/When/Then/And 형식을 사용합니다.","status":"PASS"},{"id":"Q-CORR-04","reason":"기존 구현 근거는 research.md의 검증 테이블에 모아두고, 계획된 모듈과 테스트는 [NEW]로 표시해 source-of-truth와 future surface를 구분합니다.","status":"PASS"},{"id":"Q-COMP-01","reason":"spec.md, plan.md, acceptance.md, research.md가 각각 요구사항, 구현 태스크, oracle 시나리오, 근거/결정/불변식 역할을 나누어 완전한 패키지를 이룹니다.","status":"PASS"},{"id":"Q-COMP-02","reason":"18개 REQ가 Traceability Matrix를 통해 plan task와 acceptance scenario 또는 unit 검증에 연결되어 있습니다.","status":"PASS"},{"id":"Q-COMP-03","reason":"각 REQ가 EARS type, 조건, 기대 결과를 포함하고, 관측 지점은 emitted command order, table payload, undo descriptor, HTTP response, persisted artifact 등으로 구체화되어 있습니다.","status":"PASS"},{"id":"Q-COMP-04","reason":"research.md의 Outcome Lock이 사용자 가시 결과, non-goal, completion evidence를 고정하고 Must acceptance가 이를 닫습니다.","status":"PASS"},{"id":"Q-COMP-05","reason":"research.md에 Semantic Invariant Inventory가 추가되어 각 invariant가 REQ, plan task, Must oracle acceptance로 추적됩니다.","status":"PASS"},{"id":"Q-COMP-06","reason":"spec.md의 Traceability Matrix와 research.md의 Reviewer Brief가 review scope, non-goal, 검증 초점을 제시합니다. semantic invariant 연결은 별도 inventory에서 보완되어 확인 가능합니다.","status":"PASS"},{"id":"Q-COMP-07","reason":"Completion Debt와 Evolution Ideas가 분리되어 있으며, 필수 보안/부분 실패 debt는 REQ와 acceptance로 닫고 선택 개선은 advisory로만 남깁니다.","status":"PASS"},{"id":"Q-FEAS-01","reason":"범위가 write-router, daemon, vendor plugin, schema, prompt, validator, review-ui의 실제 구현 레이어에 맞게 나뉘어 있습니다.","status":"PASS"},{"id":"Q-FEAS-02","reason":"변경 대상 경로가 제공된 repo 구조와 모듈 소유권에 부합하며, validator는 schema/를 source of truth로 사용하는 것으로 설명되어 있습니다.","status":"PASS"},{"id":"Q-FEAS-03","reason":"검증은 기존 Vitest/AJV 기반 테스트와 구체적인 신규 oracle 테스트로 구성되어 현재 저장소에서 수행 가능한 수준입니다.","status":"PASS"},{"id":"Q-STYLE-01","reason":"요구사항 본문은 THE SYSTEM SHALL 중심의 단정형 문장으로 작성되어 모호어가 blocking 의미를 만들지 않습니다.","status":"PASS"},{"id":"Q-STYLE-02","reason":"Priority는 Must/Should로, EARS Type은 별도 축으로 분리되어 있습니다.","status":"PASS"},{"id":"Q-STYLE-03","reason":"REQ와 AC 문장이 완결되어 있고 Gherkin step keyword가 마크업 없이 읽히는 형식입니다.","status":"PASS"},{"id":"Q-SEC-01","reason":"authored text, captured prior annotations, review-ui HTTP path, daemon wire boundary가 각각 trust boundary로 식별되고 완화가 REQ-09~REQ-11에 반영되어 있습니다.","status":"PASS"},{"id":"Q-SEC-02","reason":"synthetic token과 privileged path 예시만 사용하며, redaction recursion과 minimized prior handling을 명시해 secret/path 노출을 방지합니다.","status":"PASS"},{"id":"Q-SEC-03","reason":"AppliedWrite, autopus://applied_writes, HTTP undo_descriptor 같은 retained artifact의 secret leakage 위험과 redaction timing을 다룹니다.","status":"PASS"},{"id":"Q-COH-01","reason":"SPEC은 native annotation과 real-table policy card를 한 번의 apply로 제공하는 단일 cohesive change story에 수렴합니다.","status":"PASS"},{"id":"Q-COH-02","reason":"Outcome Lock에 필요한 runtime/platform work는 Primary SPEC에 포함되어 있고, optional polish는 Evolution Ideas로만 남습니다.","status":"PASS"},{"id":"Q-COH-03","reason":"Sibling-vs-single decision이 과분할을 피하는 근거를 제시하며 sibling SPEC를 만들지 않는 경계가 명확합니다.","status":"PASS"}],"finding_statuses":[{"id":"F-001","reason":"research.md에 ## Semantic Invariant Inventory가 추가되었고, 10개 invariant가 각각 REQ, plan task, Must oracle scenario로 매핑되어 Q-COMP-05 요구를 충족합니다.","status":"resolved"}],"findings":[],"summary":"이전 주요 finding은 해결되었습니다. 체크리스트 전 항목이 현재 문서 세트에서 충족되며, 수정으로 인한 신규 critical/security 회귀는 보이지 않습니다.","verdict":"PASS"}

