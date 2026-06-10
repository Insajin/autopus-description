# Review: SPEC-FIGMA-021

**Verdict**: PASS
**Revision**: 0
**Date**: 2026-06-10 13:49:16

## Provider Health

| Provider | Status | Note |
| --- | --- | --- |
| claude | success | - |
| codex | success | - |

## Checklist Summary

| ID | Status | Provider | Reason |
| --- | --- | --- | --- |
| Q-CORR-01 | PASS | claude | Existing references verified against code: undo-tool.ts:75-79 restore-annotation→noop, dispatchInverse arm set, forward dispatch ops, vendor setAnnotation native path all confirmed. |
| Q-CORR-02 | PASS | claude | New files (autopus_plugin_adapter.ts, two test files) are marked [NEW] and excluded from existing-reference validation. |
| Q-CORR-03 | PASS | claude | Acceptance uses bare Given/When/Then; REQs use WHEN/THE SYSTEM SHALL EARS with Priority on a separate meta line. |
| Q-CORR-04 | PASS | claude | Existing paths verified via Read; planned additions ([NEW] adapter/tests) separated; build-script source vs generated dist/plugin/code.js distinguished. |
| Q-COMP-01 | PASS | claude | spec/plan/acceptance/research each carry distinct purpose and complement; none empty. |
| Q-COMP-02 | PASS | claude | Traceability Matrix maps REQ-01..06 to plan tasks and acceptance scenarios row-by-row; no orphan REQ. |
| Q-COMP-03 | PASS | claude | Each REQ states EARS type, trigger, and observable result (command_result, node_ids, post-undo node.annotations state). |
| Q-COMP-04 | PASS | claude | Outcome Lock fixes the user-visible result and closing evidence (S1+S2 live, S3/S4/S6/S7); undo execution is in primary scope, not deferred. |
| Q-COMP-05 | PASS | claude | INV-001..007 mapped to REQ/task/Must acceptance; S2 oracle asserts node.annotations==prior (empty array if none) and S7 asserts ordered inverse — concrete oracles, not structural checks. |
| Q-COMP-06 | PASS | claude | spec.md has Traceability Matrix; research.md has Reviewer Brief focusing review on inverse/undo path and dual-interface adapter. |
| Q-COMP-07 | PASS | claude | Completion Debt (none — undo folded into REQ-06) and Evolution Ideas (optional properties-array restore, cascade verification) are separated; no SPEC/task IDs auto-promoted. |
| Q-FEAS-01 | PASS | claude | Scope is runtime code (undo-tool.ts, vendor dispatch, [NEW] adapter, build script) — code-verified, not a doc-only promise of behavior. |
| Q-FEAS-02 | PASS | claude | Adapter lives in vendor-local autopus_* additions; verbatim rule applies to upstream code.js only; esbuild added as devDependency without touching runtime deps. |
| Q-FEAS-03 | PASS | claude | Build + vitest unit (S4/S7) + git byte-identical verbatim check + live oracle (S1/S2) are all runnable in this repo. |
| Q-STYLE-01 | PASS | claude | REQ descriptions are assertive; no should/might/could; Priority on a separate meta line. |
| Q-STYLE-02 | PASS | claude | Priority uses Must/Should only, kept separate from EARS type. |
| Q-STYLE-03 | PASS | claude | Complete sentences; acceptance uses bare Given/When/Then/And steps. |
| Q-SEC-01 | PASS | claude | Redaction boundary preserved (HC-4/INV-003/S5): adapter receives already-redacted strings; daemon args pass through dispatch redactArgs. |
| Q-SEC-02 | PASS | claude | Channel secret and absolute paths are not copied into the SPEC; adapter handles only redacted strings. |
| Q-SEC-03 | N/A | claude | SPEC creates no new log or retained-artifact format; existing SPEC-FIGMA-020 audit path is unchanged. |
| Q-COH-01 | PASS | claude | Forward and inverse share one adapter, one bundle, and the same native node.annotations API — a single cohesive change story. |
| Q-COH-02 | PASS | claude | Previously hand-waved undo execution is folded into REQ-06/T6/T7/T8 within the same iteration; no Outcome-Lock work bypassed. |
| Q-COH-03 | PASS | claude | No sibling SPECs created; SPEC explicitly states no sibling is needed and the feature closes within REQ-01..06. |
| Q-CORR-01 | PASS | codex | 기존 참조는 제공된 코드 컨텍스트와 SPEC의 보강 분석 안에서 실제 경로/함수 기준으로 정합하게 다뤄진다. verify mode 범위에서 prior finding 관련 참조인 undo-tool restore-annotation noop, dispatchInverse restore_annotation 부재, vendor setAnnotation 경로가 수정… |
| Q-CORR-02 | PASS | codex | 신규 파일인 autopus_plugin_adapter.ts, autopus-plugin-adapter.test.ts, autopus-undo-inverse.test.ts가 [NEW]로 표시되어 planned addition과 existing reference가 구분된다. |
| Q-CORR-03 | PASS | codex | REQ는 Priority와 Type을 분리한 EARS 형식으로 작성되어 있고 acceptance는 bare Given/When/Then/And 형태를 유지한다. |
| Q-CORR-04 | PASS | codex | source of truth인 vendor code.js와 generated dist/plugin/code.js를 구분하고, 신규/변경 대상 및 vendor-local autopus_*.ts의 소유 경계를 명시한다. |
| Q-COMP-01 | PASS | codex | spec, plan, acceptance, research가 각각 목적/요구사항, 구현 태스크, 검증 시나리오, 코드 분석과 설계 근거를 담당하며 하나의 문서 세트를 형성한다. |
| Q-COMP-02 | PASS | codex | REQ-01..06이 T1..T8 및 S1..S7에 추적된다. prior finding의 undo 복원 요구도 REQ-06/T6/T7/T8/S2/S7로 포함되었다. |
| Q-COMP-03 | PASS | codex | 각 요구사항은 Type, trigger, THE SYSTEM SHALL 결과, 관측 지점(command_result, node_ids, node.annotations, card deletion)을 포함한다. |
| Q-COMP-04 | PASS | codex | Outcome Lock이 두 surface forward 생성과 단일 undo reverse를 완료 조건으로 고정하고, Primary SPEC의 Must 요구사항과 acceptance가 해당 결과를 닫는다. |
| Q-COMP-05 | PASS | codex | INV-001..007이 요구사항, plan task, acceptance scenario에 연결되어 있고, 특히 INV-002/INV-007이 undo inverse execution을 S2/S7에서 검증한다. |
| Q-COMP-06 | PASS | codex | Traceability Matrix와 Reviewer Brief가 추가되어 requirement, task, scenario, review focus가 명확하다. |
| Q-COMP-07 | PASS | codex | Completion Debt와 Evolution Ideas가 분리되어 있으며, 필수 undo/inverse 실행은 debt나 future work가 아니라 REQ-06 scope로 편입되어 있다. |
| Q-FEAS-01 | PASS | codex | SPEC가 단순 문서/스키마 변경이 아니라 실제 런타임 레이어인 build script, plugin dispatcher bundle, adapter, daemon undo bridge를 변경 대상으로 삼아 Outcome Lock과 구현층이 일치한다. |
| Q-FEAS-02 | PASS | codex | 변경 대상은 root package/build script, vendor-local autopus_*.ts, daemon undo tool, unit tests로 현재 모듈 경계와 HC-1/HC-2의 verbatim 규칙에 맞게 배치되어 있다. |
| Q-FEAS-03 | PASS | codex | build oracle, unit oracle, verbatim byte check, live oracle이 구분되어 있고 현재 저장소/라이브 플러그인 환경에서 수행 가능한 수준으로 제시된다. |
| Q-STYLE-01 | PASS | codex | REQ description은 Must/Should priority를 별도 메타로 분리하고 모호어 없이 관측 가능한 결과를 선언한다. |
| Q-STYLE-02 | PASS | codex | Priority는 Must/Should로 유지되고 EARS Type과 혼용되지 않는다. |
| Q-STYLE-03 | PASS | codex | acceptance 시나리오는 bare Given/When/Then/And 형식으로 읽히며 parser-friendly한 문장 구조를 유지한다. |
| Q-SEC-01 | PASS | codex | daemon에서 들어오는 args와 plugin runtime mutation 사이의 trust boundary를 redaction 경계로 다루고, dispatch redaction 후 adapter가 node mutation을 수행한다는 완화를 명시한다. |
| Q-SEC-02 | PASS | codex | 채널 secret 등 민감값을 SPEC 본문에 노출하지 않고, token/path redaction을 S5와 HC-4에서 검증한다. |
| Q-SEC-03 | PASS | codex | 새 영구 로그나 retained artifact 포맷을 요구하지 않으며, 기존 audit/log 경로 변경을 scope 밖으로 둔다. |
| Q-COH-01 | PASS | codex | forward dispatcher integration과 inverse dispatcher execution이 동일 adapter/번들/native annotation API를 공유하는 하나의 cohesive runtime dispatch 변경으로 수렴한다. |
| Q-COH-02 | PASS | codex | Outcome Lock에 필요한 undo 복원 작업이 REQ-06/T6/T7/T8/S2/S7에 포함되어 같은 iteration 안에서 암묵적으로 미뤄지지 않는다. |
| Q-COH-03 | PASS | codex | sibling SPEC를 만들지 않고 본 SPEC 안에서 필수 outcome slice를 닫는다. |

Total: 46 (PASS: 45, FAIL: 0, N/A: 1)

## Findings

| Provider | Severity | Description |
|----------|----------|-------------|
| codex | major | F-001: REQ-04/AC-002 requires one undo to restore the prior native annotation, but the current daemon undo bridge maps `restore-annotation` to `noop` and this SPEC does not add any plugin command or adapter method to write the prior annotation snapshot back. Routing only set_native_annotation/set_policy_card/set_annotation cannot satisfy the native restore half of the live oracle. |

## Provider Responses

### Response 1

I've verified the SPEC's revised code-level claims directly:

- `src/daemon/undo-tool.ts:75-79` — `restore-annotation` indeed maps to `{ op: "noop", args: {} }`, and `compoundInverseCommands` emits the ordered pair `[card delete-node, native restore-annotation]` where the native half currently noops. Matches the SPEC's analysis exactly.
- `autopus_command_dispatch.ts:319-340` — `dispatchInverse` handles only `delete_node`/`delete_comment`/`clear_plugin_data`/`restore_frame_name`; `default` returns `unknown_inverse_op:${op}`. No `restore_annotation` arm. Matches.
- The card-delete CORRECTION is accurate: `bridgeInverseCommand` emits `{node_id: d.card.node_id}` (line 86) and `dispatchInverse` reads `args.node_id` (line 326) — fields align.

Revision 1 closes F-001: REQ-06 + T6 (dispatch `restore_annotation` arm) + T7 (undo-tool noop→real inverse carrying prior) + T8/S7 (inverse routing oracle) + S2 (concrete prior-snapshot/empty-array expectation) now supply the plugin command and adapter method that write the prior annotation snapshot back.

```json
{
  "verdict": "PASS",
  "summary": "Revision 1 resolves prior finding F-001. The native-restore half of the compound undo — previously unaddressed — is now a first-class requirement (REQ-06) with implementation ownership in plan T6 (dispatch restore_annotation arm), T7 (undo-tool restore-annotation noop replaced by a real inverse PluginCommand {op:'restore_annotation', args:{node_id, prior}}), and verification via S7 unit oracle plus S2 live oracle with concrete expectations (node.annotations equals prior snapshot; empty array when no prior). I code-verified the SPEC's claims: undo-tool.ts:75-79 currently noops restore-annotation and emits the ordered [card, native] pair, and dispatchInverse lacks a restore_annotation arm (default → unknown_inverse_op). The CORRECTION that card-delete is a field-match (not a mismatch) is also accurate (node_id is read on both sides). INV-007 + Traceability Matrix + Outcome Lock close the gap. No critical or security issues; zero open major findings.",
  "findings": [],
  "checklist": [
    {"id": "Q-CORR-01", "status": "PASS", "reason": "Existing references verified against code: undo-tool.ts:75-79 restore-annotation→noop, dispatchInverse arm set, forward dispatch ops, vendor setAnnotation native path all confirmed."},
    {"id": "Q-CORR-02", "status": "PASS", "reason": "New files (autopus_plugin_adapter.ts, two test files) are marked [NEW] and excluded from existing-reference validation."},
    {"id": "Q-CORR-03", "status": "PASS", "reason": "Acceptance uses bare Given/When/Then; REQs use WHEN/THE SYSTEM SHALL EARS with Priority on a separate meta line."},
    {"id": "Q-CORR-04", "status": "PASS", "reason": "Existing paths verified via Read; planned additions ([NEW] adapter/tests) separated; build-script source vs generated dist/plugin/code.js distinguished."},
    {"id": "Q-COMP-01", "status": "PASS", "reason": "spec/plan/acceptance/research each carry distinct purpose and complement; none empty."},
    {"id": "Q-COMP-02", "status": "PASS", "reason": "Traceability Matrix maps REQ-01..06 to plan tasks and acceptance scenarios row-by-row; no orphan REQ."},
    {"id": "Q-COMP-03", "status": "PASS", "reason": "Each REQ states EARS type, trigger, and observable result (command_result, node_ids, post-undo node.annotations state)."},
    {"id": "Q-COMP-04", "status": "PASS", "reason": "Outcome Lock fixes the user-visible result and closing evidence (S1+S2 live, S3/S4/S6/S7); undo execution is in primary scope, not deferred."},
    {"id": "Q-COMP-05", "status": "PASS", "reason": "INV-001..007 mapped to REQ/task/Must acceptance; S2 oracle asserts node.annotations==prior (empty array if none) and S7 asserts ordered inverse — concrete oracles, not structural checks."},
    {"id": "Q-COMP-06", "status": "PASS", "reason": "spec.md has Traceability Matrix; research.md has Reviewer Brief focusing review on inverse/undo path and dual-interface adapter."},
    {"id": "Q-COMP-07", "status": "PASS", "reason": "Completion Debt (none — undo folded into REQ-06) and Evolution Ideas (optional properties-array restore, cascade verification) are separated; no SPEC/task IDs auto-promoted."},
    {"id": "Q-FEAS-01", "status": "PASS", "reason": "Scope is runtime code (undo-tool.ts, vendor dispatch, [NEW] adapter, build script) — code-verified, not a doc-only promise of behavior."},
    {"id": "Q-FEAS-02", "status": "PASS", "reason": "Adapter lives in vendor-local autopus_* additions; verbatim rule applies to upstream code.js only; esbuild added as devDependency without touching runtime deps."},
    {"id": "Q-FEAS-03", "status": "PASS", "reason": "Build + vitest unit (S4/S7) + git byte-identical verbatim check + live oracle (S1/S2) are all runnable in this repo."},
    {"id": "Q-STYLE-01", "status": "PASS", "reason": "REQ descriptions are assertive; no should/might/could; Priority on a separate meta line."},
    {"id": "Q-STYLE-02", "status": "PASS", "reason": "Priority uses Must/Should only, kept separate from EARS type."},
    {"id": "Q-STYLE-03", "status": "PASS", "reason": "Complete sentences; acceptance uses bare Given/When/Then/And steps."},
    {"id": "Q-SEC-01", "status": "PASS", "reason": "Redaction boundary preserved (HC-4/INV-003/S5): adapter receives already-redacted strings; daemon args pass through dispatch redactArgs."},
    {"id": "Q-SEC-02", "status": "PASS", "reason": "Channel secret and absolute paths are not copied into the SPEC; adapter handles only redacted strings."},
    {"id": "Q-SEC-03", "status": "N/A", "reason": "SPEC creates no new log or retained-artifact format; existing SPEC-FIGMA-020 audit path is unchanged."},
    {"id": "Q-COH-01", "status": "PASS", "reason": "Forward and inverse share one adapter, one bundle, and the same native node.annotations API — a single cohesive change story."},
    {"id": "Q-COH-02", "status": "PASS", "reason": "Previously hand-waved undo execution is folded into REQ-06/T6/T7/T8 within the same iteration; no Outcome-Lock work bypassed."},
    {"id": "Q-COH-03", "status": "PASS", "reason": "No sibling SPECs created; SPEC explicitly states no sibling is needed and the feature closes within REQ-01..06."}
  ],
  "finding_statuses": [
    {"id": "F-001", "status": "resolved", "reason": "REQ-06 adds the compound-undo requirement (delete card AND write prior native-annotation snapshot back; clear to empty array when no prior). Plan T6 adds the dispatch restore_annotation arm, T7 replaces undo-tool.ts:75-79 noop with a real inverse PluginCommand carrying the prior snapshot, and T8/S7 add inverse-routing oracle coverage. The adapter (T2) supplies both deleteNode({node_id}) and a prior-snapshot restore entry point reusing the native node.annotations API. This directly provides the plugin command and adapter method the prior finding said were missing. Code-verified that the current noop/unknown_inverse_op state matches the SPEC's analysis."}
  ]
}
```


### Response 2

{"checklist":[{"id":"Q-CORR-01","reason":"기존 참조는 제공된 코드 컨텍스트와 SPEC의 보강 분석 안에서 실제 경로/함수 기준으로 정합하게 다뤄진다. verify mode 범위에서 prior finding 관련 참조인 undo-tool restore-annotation noop, dispatchInverse restore_annotation 부재, vendor setAnnotation 경로가 수정 계획에 반영되었다.","status":"PASS"},{"id":"Q-CORR-02","reason":"신규 파일인 autopus_plugin_adapter.ts, autopus-plugin-adapter.test.ts, autopus-undo-inverse.test.ts가 [NEW]로 표시되어 planned addition과 existing reference가 구분된다.","status":"PASS"},{"id":"Q-CORR-03","reason":"REQ는 Priority와 Type을 분리한 EARS 형식으로 작성되어 있고 acceptance는 bare Given/When/Then/And 형태를 유지한다.","status":"PASS"},{"id":"Q-CORR-04","reason":"source of truth인 vendor code.js와 generated dist/plugin/code.js를 구분하고, 신규/변경 대상 및 vendor-local autopus_*.ts의 소유 경계를 명시한다.","status":"PASS"},{"id":"Q-COMP-01","reason":"spec, plan, acceptance, research가 각각 목적/요구사항, 구현 태스크, 검증 시나리오, 코드 분석과 설계 근거를 담당하며 하나의 문서 세트를 형성한다.","status":"PASS"},{"id":"Q-COMP-02","reason":"REQ-01..06이 T1..T8 및 S1..S7에 추적된다. prior finding의 undo 복원 요구도 REQ-06/T6/T7/T8/S2/S7로 포함되었다.","status":"PASS"},{"id":"Q-COMP-03","reason":"각 요구사항은 Type, trigger, THE SYSTEM SHALL 결과, 관측 지점(command_result, node_ids, node.annotations, card deletion)을 포함한다.","status":"PASS"},{"id":"Q-COMP-04","reason":"Outcome Lock이 두 surface forward 생성과 단일 undo reverse를 완료 조건으로 고정하고, Primary SPEC의 Must 요구사항과 acceptance가 해당 결과를 닫는다.","status":"PASS"},{"id":"Q-COMP-05","reason":"INV-001..007이 요구사항, plan task, acceptance scenario에 연결되어 있고, 특히 INV-002/INV-007이 undo inverse execution을 S2/S7에서 검증한다.","status":"PASS"},{"id":"Q-COMP-06","reason":"Traceability Matrix와 Reviewer Brief가 추가되어 requirement, task, scenario, review focus가 명확하다.","status":"PASS"},{"id":"Q-COMP-07","reason":"Completion Debt와 Evolution Ideas가 분리되어 있으며, 필수 undo/inverse 실행은 debt나 future work가 아니라 REQ-06 scope로 편입되어 있다.","status":"PASS"},{"id":"Q-FEAS-01","reason":"SPEC가 단순 문서/스키마 변경이 아니라 실제 런타임 레이어인 build script, plugin dispatcher bundle, adapter, daemon undo bridge를 변경 대상으로 삼아 Outcome Lock과 구현층이 일치한다.","status":"PASS"},{"id":"Q-FEAS-02","reason":"변경 대상은 root package/build script, vendor-local autopus_*.ts, daemon undo tool, unit tests로 현재 모듈 경계와 HC-1/HC-2의 verbatim 규칙에 맞게 배치되어 있다.","status":"PASS"},{"id":"Q-FEAS-03","reason":"build oracle, unit oracle, verbatim byte check, live oracle이 구분되어 있고 현재 저장소/라이브 플러그인 환경에서 수행 가능한 수준으로 제시된다.","status":"PASS"},{"id":"Q-STYLE-01","reason":"REQ description은 Must/Should priority를 별도 메타로 분리하고 모호어 없이 관측 가능한 결과를 선언한다.","status":"PASS"},{"id":"Q-STYLE-02","reason":"Priority는 Must/Should로 유지되고 EARS Type과 혼용되지 않는다.","status":"PASS"},{"id":"Q-STYLE-03","reason":"acceptance 시나리오는 bare Given/When/Then/And 형식으로 읽히며 parser-friendly한 문장 구조를 유지한다.","status":"PASS"},{"id":"Q-SEC-01","reason":"daemon에서 들어오는 args와 plugin runtime mutation 사이의 trust boundary를 redaction 경계로 다루고, dispatch redaction 후 adapter가 node mutation을 수행한다는 완화를 명시한다.","status":"PASS"},{"id":"Q-SEC-02","reason":"채널 secret 등 민감값을 SPEC 본문에 노출하지 않고, token/path redaction을 S5와 HC-4에서 검증한다.","status":"PASS"},{"id":"Q-SEC-03","reason":"새 영구 로그나 retained artifact 포맷을 요구하지 않으며, 기존 audit/log 경로 변경을 scope 밖으로 둔다.","status":"PASS"},{"id":"Q-COH-01","reason":"forward dispatcher integration과 inverse dispatcher execution이 동일 adapter/번들/native annotation API를 공유하는 하나의 cohesive runtime dispatch 변경으로 수렴한다.","status":"PASS"},{"id":"Q-COH-02","reason":"Outcome Lock에 필요한 undo 복원 작업이 REQ-06/T6/T7/T8/S2/S7에 포함되어 같은 iteration 안에서 암묵적으로 미뤄지지 않는다.","status":"PASS"},{"id":"Q-COH-03","reason":"sibling SPEC를 만들지 않고 본 SPEC 안에서 필수 outcome slice를 닫는다.","status":"PASS"}],"finding_statuses":[{"id":"F-001","reason":"resolved: SPEC가 REQ-06을 추가해 compound undo의 native restore half를 명시했고, plan T6는 dispatchInverse restore_annotation arm, T7은 undo-tool restore-annotation→noop을 실제 {op:'restore_annotation', args:{node_id, prior}} inverse로 교체, T8/S7은 inverse routing unit oracle을 추가한다. 따라서 기존 지적처럼 forward routing만으로 undo를 만족시키는 상태가 아니다.","status":"resolved"}],"findings":[],"summary":"Prior finding F-001은 해결되었다. 수정된 SPEC는 live forward 두 surface 생성과 단일 undo의 card delete + native annotation prior restore를 모두 1차 scope, plan, acceptance, invariant에 연결한다. 새 critical/security regression은 확인되지 않았다.","verdict":"PASS"}

