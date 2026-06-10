# SPEC-FIGMA-020 수락 기준 (Acceptance Criteria)

> Status: draft

Scenario IDs are referenced by `spec.md` Traceability Matrix and `research.md` Semantic Invariant Inventory. Must scenarios carry concrete expected output (oracle acceptance), not structural-only checks. All Figma-origin text in these scenarios (captured prior annotations, frame text) is treated as untrusted prompt-input evidence; secrets in examples are synthetic and redacted.

## 시나리오 (Scenarios)

### S1: Structured policy renders as real tables with correct columns and rows (oracle, REQ-03, REQ-04)
Given a manifest entry with write_target native_annotation_with_card whose states are the two objects {state: loading, trigger: 제출 직후, result: 스피너 표시} and {state: error, trigger: 검증 실패, result: 인라인 오류}, whose edge_cases are the single object {case: 빈 결과, risk: 사용자 혼란, handling: 빈 상태 안내}, and whose data_requirements are the two items named 검색어 and 정렬옵션
When the card-table payload builder runs on that entry
Then it returns three tables: a states table with a header row state/trigger/result plus exactly 2 data rows, an edge_cases table with a header row case/risk/handling plus exactly 1 data row, and a data_requirements table with a header row name/purpose/required values plus exactly 2 data rows
And the first states data row cells equal [loading, 제출 직후, 스피너 표시] and the second states data row cells equal [error, 검증 실패, 인라인 오류]
And the edge_cases data row cells equal [빈 결과, 사용자 혼란, 빈 상태 안내]

### S2: v0.4.0 schema accepts both legacy-string and structured manifests (oracle, REQ-05, REQ-14, REQ-15, REQ-16)
Given the v0.4.0 schema with the states and edge_cases item union
When a manifest whose states is the legacy string array ["loading", "empty", "populated"] and whose write_target is native_annotation is validated
Then the validator exits 0 with RESULT pass=1 fail=0 total=1
And when a second manifest whose states is the structured array [{state: loading, trigger: 제출 직후, result: 스피너}] and whose write_target is native_annotation_with_card is validated, the validator exits 0 with RESULT pass=1 fail=0 total=1
And when a third manifest whose states item is the malformed object {trigger: x} (missing the required state field) is validated, the validator exits 1 and emits an error for that item

### S3: Legacy string state renders into column 1 with empty remaining columns (oracle, REQ-06)
Given a states value that is the legacy string "populated"
When the union normalizer and the table-payload builder run
Then the produced states table data row cells equal [populated, "", ""] so column 1 carries the string and columns 2 and 3 are empty
And the table renders without error alongside a structured edge_cases object in the same payload

### S4: Card-step failure keeps the native annotation and marks the card retryable (oracle, REQ-07)
Given a native_annotation_with_card apply whose native annotation op succeeds and whose subsequent card op is forced to fail at the bridge
When applyApprovedWrite dispatches the compound plugin commands
Then the node retains the native annotation written by the native op (the native annotation is present and not rolled back)
And no policy card node is created (the card surface is absent)
And the result surfaces the card op as retryable rather than reporting the native annotation as reverted

### S5: One compound undo reverses both surfaces (oracle, REQ-01, REQ-02, REQ-08)
Given a native_annotation_with_card apply that succeeds across both surfaces against a node whose prior annotations were empty, producing a card node with id card-node-1
When undo runs once with the single compound descriptor
Then the native node annotations are restored to the empty prior state (no annotation remains on the node)
And the card node card-node-1 is deleted
And exactly one undo invocation reverses both surfaces (no second undo call is required)

### S6: Composite emits the native op then exactly one distinct card op (oracle, REQ-02, REQ-13)
Given a native_annotation_with_card entry with no area_annotations
When plan-emit runs for that entry
Then the emitted plugin_commands begin with one set_native_annotation op and end with exactly one set_policy_card op
And the set_policy_card op literal is not equal to set_annotation and is not equal to set_native_annotation
And TARGET_TO_OP maps native_annotation_with_card to its primary op and TOOL_NAME_MAP contains a set_policy_card entry

### S7: Captured prior secrets are absent from both the persisted artifact and the HTTP response (oracle, REQ-09, REQ-10, REQ-11, REQ-18)
Given a node whose prior annotation labelMarkdown contains the synthetic secret xoxb-LEAKEDSECRET and the path /Users/x/notes.txt
When a native_annotation_with_card apply captures that prior and the apply succeeds on the daemon path
Then the persisted AppliedWrite undo_descriptor for the compound variant contains neither the substring xoxb-LEAKEDSECRET nor the substring /Users/x/notes.txt
And when the same apply runs through the review-ui HTTP route, the JSON response body undo_descriptor contains neither substring
And the composed labelMarkdown and card text both pass through redactWire before leaving the daemon so no secret reaches the wire

### S8: The annotation_card AC-S8 decomposition is byte-unchanged (oracle, REQ-12)
Given the existing annotation_card plan-emit path
When the composite target and its plan helper are added
Then planAnnotationCard still returns exactly three set_annotation commands with the steps create-node, set-text, attach-link in that order
And the source of packages/write-router/src/plan-emit/annotation-card-plan.ts is unchanged by this SPEC
And no command emitted by the composite target uses the op set_annotation
