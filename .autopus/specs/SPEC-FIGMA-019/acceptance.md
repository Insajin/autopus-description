# SPEC-FIGMA-019 수락 기준 (Acceptance Criteria)

> Status: draft

Gherkin uses bare Given/When/Then/And steps. MUST scenarios carry concrete expected outputs (oracle acceptance), not structural-only checks. All secrets in expected output are SYNTHETIC.

## 시나리오 (Scenarios)

### S1: Router/HTTP 경로의 캡처된 prior가 register/return 이전에 redact된다 (Must, oracle) [REQ-03, REQ-04, REQ-05, REQ-07]
Given a WriteRouter constructed in executor mode with the SPEC-FIGMA-019 full-surface redactRestoreDescriptor injected
And a mock figma client whose scan returns a node with id "90:1" and whose getAnnotations for "90:1" returns a single prior annotation with labelMarkdown "reviewer Bearer abc123def4567890 see /Users/reviewer/notes.txt"
And a native_annotation manifest entry with frame_id "90:0" that resolves to node "90:1"
When WriteRouter.apply runs and produces a WriteResult and registers the undo descriptor
Then the returned undo_descriptor type is "restore-annotation" with node_id "90:1"
And the returned undo_descriptor prior single snapshot labelMarkdown does not contain the substring "Bearer abc123def4567890"
And it does not contain the substring "/Users/reviewer/notes.txt"
And each removed secret is replaced by the redactor placeholder "***"
And the redacted labelMarkdown still contains the non-secret text "reviewer" and "see"
And the prior snapshot retains only the minimized restore fields labelMarkdown and optional categoryId and optional properties
And the undo descriptor registered in the UndoRegistry equals the redacted descriptor that was returned

### S2: figd_/xoxb- redaction 동작이 보존된다 (Must, non-regression) [REQ-08]
Given the write-router redactor after the SPEC-FIGMA-019 pattern relocation
When redactObject runs on the object { a: "token figd_ABCDEFGHIJKLMNOP01 x", b: "slack xoxb-ABCDEFGH99 y" }
Then the result field a does not contain the substring "figd_ABCDEFGHIJKLMNOP01"
And the result field b does not contain the substring "xoxb-ABCDEFGH99"
And each removed token is replaced by the existing placeholder "<REDACTED>"
And a plain string with no token is returned unchanged

### S3: write-router full-surface redactor가 Bearer + 절대경로를 스크럽한다 (Must, oracle) [REQ-02, REQ-07]
Given the SPEC-FIGMA-019 write-router redactExtendedObject
When it runs on the string "ping Bearer ZZZ1234567890ABCDEF then /home/svc/key and C:\Users\svc\token.txt"
Then the result does not contain the substring "Bearer ZZZ1234567890ABCDEF"
And the result does not contain the substring "/home/svc/"
And the result does not contain the substring "C:\Users\svc"
And each removed secret is replaced by the placeholder "***"
And running redactExtendedObject on a figd_ABCDEFGHIJKLMNOP01 token also replaces it with "***" so the four classes are covered by one pass

### S4: review-ui HTTP 응답 본문이 unredacted prior를 담지 않는다 (Must) [REQ-05]
Given the review-ui POST /api/apply route whose getRouter injects the SPEC-FIGMA-019 redactRestoreDescriptor
And a hypothetical reachable native_annotation apply whose captured prior labelMarkdown is "key Bearer ZZZ1234567890ABCDEF here"
When the route serializes the WriteResult as the HTTP JSON response body
Then the response body string does not contain the substring "Bearer ZZZ1234567890ABCDEF"
And the response body undo_descriptor prior labelMarkdown contains the placeholder "***" in place of the token
And the route still returns HTTP 200 with the applied status when the apply succeeds

### S5: 데몬 S13 경로와 AC-S14 패리티가 비회귀로 보존된다 (Must, non-regression) [REQ-01, REQ-06, REQ-08, REQ-09]
Given the SPEC-FIGMA-018 daemon redaction path redactAndMinimizePrior and its S13 test
And the SPEC-FIGMA-007 AC-S14 parity oracles after the pattern relocation
When the full test suite runs with the SPEC-FIGMA-019 changes applied
Then the SPEC-FIGMA-018 S13 daemon redaction test passes with no change to its expected output
And the redact-patterns parity test passes with FIGD_PATTERN_SOURCE "figd_[A-Za-z0-9_-]{16,}" and XOXB_PATTERN_SOURCE "xoxb-[A-Za-z0-9_-]{8,}" and BEARER_PATTERN_SOURCE "[Bb]earer [A-Za-z0-9._\-]{16,}" and ABSOLUTE_PATH_PATTERNS_SOURCE equal to the three-element list "/Users/", "/home/", "C:\Users\\"
And the write-router redactor port is asserted to single-source those constants rather than carry an inline regex literal
And the WriteRouter constructed without a redactRestoreDescriptor returns the undo descriptor unchanged so existing callers are unaffected

### S6: redact된 minimized prior로 undo가 구조적으로 복원된다 (Must) [REQ-04]
Given a restore-annotation descriptor whose prior single snapshot labelMarkdown is the redacted value "reviewer *** see ***"
And a mock figma client that records setAnnotation calls
When undoNativeAnnotation runs with that descriptor through the router undo path
Then exactly one setAnnotation call is issued for the descriptor node_id
And the written labelMarkdown equals the redacted "reviewer *** see ***"
And no original secret substring is re-introduced by the restore

## Requirement to Scenario Coverage

| REQ | Scenarios |
|-----|-----------|
| REQ-01 | S5 (parity preserved across relocation) |
| REQ-02 | S3 |
| REQ-03 | S1 |
| REQ-04 | S1, S6 |
| REQ-05 | S1, S4 |
| REQ-06 | S5 (no-injection identity path) |
| REQ-07 | S1, S3 |
| REQ-08 | S2, S5 |
| REQ-09 | S5 |
