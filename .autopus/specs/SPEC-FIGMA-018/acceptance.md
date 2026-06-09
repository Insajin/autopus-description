# SPEC-FIGMA-018 수락 기준 (Acceptance Criteria)

> Status: draft

Gherkin uses bare Given/When/Then/And steps. MUST scenarios carry concrete expected outputs (oracle acceptance), not structural-only checks. Korean strings in expected output are quoted from the manifest composition path as evidence.

## 시나리오 (Scenarios)

### S1: Multi-area entry produces exactly one native annotation per resolved node (Must) [REQ-02, REQ-04]
Given a manifest entry with write_target native_annotation and frame_id "10:0"
And the frame node index contains nodes named "검색 바" with id "10:1" and "결과 리스트" with id "10:2"
And area_annotations has area_id "1" title "검색" target_area "검색 바" description "입력한 조건으로 목록을 갱신한다"
And area_annotations has area_id "2" title "결과" target_area "결과 리스트" description "검색 결과를 표시한다"
When applyNativeAnnotation runs
Then exactly two native annotations are produced
And the annotation on node "10:1" has labelMarkdown containing "검색" and "입력한 조건으로 목록을 갱신한다"
And the annotation on node "10:2" has labelMarkdown containing "결과" and "검색 결과를 표시한다"
And no free-floating TEXT card node is created
And fallback_used is false for both resolutions

### S2: No-area entry produces a single frame-level annotation (Must) [REQ-03]
Given a manifest entry with write_target native_annotation and frame_id "20:0"
And area_annotations is empty or absent
And intent is "사용자 인증 게이트" and user_value is "PM 진입" and success_criteria is "5초"
When applyNativeAnnotation runs
Then exactly one native annotation is produced
And it is attached to the frame node "20:0"
And its labelMarkdown contains "사용자 인증 게이트" and "PM 진입" and "5초"

### S3: Unresolved area falls back to the frame node (Must) [REQ-04]
Given a manifest entry with write_target native_annotation and frame_id "30:0"
And the frame node index contains only nodes named "헤더" with id "30:1"
And one area_annotation has target_area "존재하지 않는 영역" and placement_hint "없음"
When applyNativeAnnotation runs
Then the annotation is attached to the frame node "30:0"
And the resolution result for that area has fallback_used equal to true
And the resolution result confidence is "fallback"

### S4: Secret-bearing labelMarkdown is redacted before the wire (Must) [REQ-05]
Given a native_annotation plan command whose labelMarkdown is "token figd_ABC123SECRETXYZ inline"
When the command is serialized for transmission through the daemon redaction boundary
Then the transmitted wire payload does not contain the substring "figd_ABC123SECRETXYZ"
And the transmitted wire payload contains the redaction placeholder in place of the token
And no mutation is sent with the raw token present

### S5: Disconnected bridge rejects apply with zero mutation (Must) [REQ-07]
Given a native_annotation entry ready to apply
And the plugin bridge is disconnected
When apply is attempted
Then the apply is rejected through the existing plugin-consent error path
And no native annotation set call is issued
And node.annotations on every target node is unchanged

### S6: Undo restores the prior annotation state (Must) [REQ-06]
Given a target node "40:1" whose prior node.annotations is an empty array
And applyNativeAnnotation has set one annotation on "40:1"
And the returned undo descriptor has type "restore-annotation" with node_id "40:1" and prior equal to the empty array
When undoNativeAnnotation runs with that descriptor
Then node.annotations on "40:1" is restored to the empty array
And the annotation written by apply is no longer present

### S7: Undo restores a clobbered pre-existing manual annotation (Must) [REQ-06, PM-5]
Given a target node "50:1" whose prior node.annotations is a single annotation with labelMarkdown "manual reviewer note"
And applyNativeAnnotation overwrites it with a generated annotation
And the returned undo descriptor prior captures the manual annotation with labelMarkdown "manual reviewer note"
When undoNativeAnnotation runs with that descriptor
Then node.annotations on "50:1" contains exactly one annotation
And that annotation has labelMarkdown "manual reviewer note"
And the generated annotation is no longer present

### S8: Idempotent re-apply produces no net change (Must) [REQ-08]
Given a native_annotation entry already applied to node "60:1" with a known labelMarkdown
And node.annotations on "60:1" already equals the set the entry would produce
When applyNativeAnnotation runs again with identical content
Then no native annotation set call is issued for "60:1"
And node.annotations on "60:1" is byte-for-byte unchanged
And the result is observably an idempotent skip

### S9: Oversized label is truncated while full narrative stays in card/page (Should) [REQ-10]
Given an area_annotation whose composed label length exceeds the configured label budget of 500 characters
When composeAreaLabel and truncateLabel run for that area
Then the produced labelMarkdown length is at most 500 characters
And the produced labelMarkdown ends with a continuation indicator "…"
And the annotation_card and descriptions_page targets remain available for the full narrative

### S10: Native op name stays distinct from the card op (Must) [REQ-01, REQ-02, naming-collision]
Given a native_annotation entry resolved to node "70:1"
When planNativeAnnotation emits plugin commands
Then every emitted command has op "set_native_annotation"
And no emitted command has op "set_annotation"
And TARGET_TO_OP maps native_annotation to "set_native_annotation"
And TOOL_NAME_MAP maps "set_native_annotation" to the vendor tool "set_annotation"
And the annotation_card 3-step decomposition still emits op "set_annotation" unchanged

### S11: Review UI surfaces the target with a Dev-Mode-only hint (Should) [REQ-09]
Given a manifest entry whose write_target is native_annotation
When FrameRow renders that entry
Then the rendered write_target value is "native_annotation"
And an adjacent hint indicates native annotations are visible only in Figma Dev Mode
And rows for other write_target values render without the hint

### S12: AC-S8 card decomposition is unchanged (Must, non-regression) [NFR-03, PM-6]
Given the existing annotation_card plan-emit and adapter modules
When the SPEC-FIGMA-018 changes are applied and the write-router test suite runs
Then planAnnotationCard still emits exactly three set_annotation commands in order create-node, set-text, attach-link
And the files annotation-card-plan.ts and adapters/annotation-card.ts are unmodified
And all pre-existing AC-S8 and annotation_card tests pass with no changes


### S13: Captured prior annotation snapshot is redacted and minimized before persist/serve (Must) [REQ-14, security, PM-5]
Given a target node "80:1" whose prior node.annotations is a single annotation
And that prior annotation labelMarkdown is "reviewer token xoxb-LEAKEDSECRET see /Users/reviewer/notes.txt"
And applyNativeAnnotation overwrites it with a generated annotation and captures the prior state into a restore-annotation undo descriptor
When the AppliedWrite for this write is recorded and the autopus://applied_writes resource payload is produced
Then the persisted AppliedWrite undo_descriptor prior does not contain the substring "xoxb-LEAKEDSECRET"
And the persisted prior does not contain the substring "/Users/reviewer/notes.txt"
And each removed secret is replaced by the daemon redactor placeholder
And the persisted prior retains only the minimized restore fields labelMarkdown and optional categoryId and properties
And running undoNativeAnnotation with that descriptor restores node.annotations to exactly the redacted minimized prior so structural restore succeeds and the secret is not re-introduced

## Requirement to Scenario Coverage

| REQ | Scenarios |
|-----|-----------|
| REQ-01 | S10 (and schema validation via T7) |
| REQ-02 | S1, S10 |
| REQ-03 | S2 |
| REQ-04 | S1, S3 |
| REQ-05 | S4 |
| REQ-06 | S6, S7 |
| REQ-07 | S5 |
| REQ-08 | S8 |
| REQ-09 | S11 |
| REQ-10 | S9 |
| REQ-11 | covered in adapter unit tests (categoryId omit-on-absent); no dedicated oracle scenario |
| REQ-12 | covered by S9 resolver candidate recording in unit test; multi-candidate path |
| REQ-13 | Nice; suggested-default persistence covered by a UI unit test, no oracle scenario |
| REQ-14 | S13 (captured-prior redaction in AppliedWrite + structural restore) |
