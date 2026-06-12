---
name: figma-desc-review
description: v4 Figma 디스크립션을 프레임별로 다시 검토해 모자란 부분을 찾고, 부족하면 재시도(보강·재적용)하는 자율 리뷰 하네스. 메인 세션이 MCP I/O와 오케스트레이션·수정을 담당하고, figma-desc-reviewer 에이전트가 프레임별 분석을 병렬 수행한다. 검토→부족분 확정→재적용→재검토를 부족분 0이 될 때까지(최대 3회) 반복한다.
triggers:
  - figma desc review
  - 디스크립션 리뷰
  - 디스크립션 검증
  - 프레임 검토
  - figma 리뷰 하네스
category: quality
level1_metadata: "v4 디스크립션 검토→재시도 하네스: 메인=MCP+오케스트레이션+수정, figma-desc-reviewer=분석, 부족분 0까지 반복(최대 3회), 미확정은 사용자에게 즉시 질문"
---

# Figma Description Review Harness (v4)

작성된 v4 디스크립션(요소별 네이티브 annotation + 정책 카드)을 **전체 프레임 다시 검토 → 모자란 부분 탐지 → 재시도(보강·재적용) → 재검토**를 자동으로 도는 하네스. 작성 규약은 [[figma-annotation-handoff]], 검증 기준은 `figma-desc-reviewer` 에이전트 루브릭(R1~R7).

## 역할 분담 (중요 — MCP 제약)
- **메인 세션**: Figma MCP I/O(디자인 읽기·적용 상태 조회·재적용), 오케스트레이션, ManifestEntry 보강·재적용, 사용자 질문. **서브에이전트는 MCP를 못 쓰므로 모든 Figma 호출은 메인이 한다.**
- **figma-desc-reviewer 에이전트**: 메인이 주입한 프레임 번들을 받아 **분석만** 수행(읽기 전용). 프레임별로 **병렬** spawn.

## 입력
- 검토 대상: writeback-log-v4의 완료 프레임 표(frame_id·write_id·카드·요소), 또는 보드에서 적용된 annotation/카드 스캔.
- 정본: `figma-writeback-log-v4.md`(확정 정책), 정의 보드(분류체계 1307:134619, Context Zone 상세 1307:134631 등), 변경 이력 노트.
- 작성 규약: figma-annotation-handoff 스킬.

## 루프 (부족분 0까지, 최대 3회)

### Step 1 — 대상 확정
완료 프레임 목록을 만든다(write_id·card·target_node 포함). `.autopus/dryrun-entry.json`은 단일 프레임 override라, 프레임별 ManifestEntry는 로그/런 기록에서 확보하거나 재구성한다.

### Step 2 — Gather (메인 + MCP, 프레임당)
1. `get_metadata(frame)` + `get_screenshot(frame)` → 실제 구조·라벨·컬럼·문구·상태(디자인 정본).
2. 각 target_node에 `get_annotations(node)` → 적용된 네이티브 annotation 텍스트.
3. 정책 카드: `get_metadata`/`get_screenshot(cardId)` → 4테이블 셀 내용·잘림 여부.
4. 해당 프레임 ManifestEntry(JSON).
토큰 절약: 스크린샷은 URL+요지 설명으로 번들에 넣는다(이미지 원본 첨부 최소화).

### Step 3 — Review (figma-desc-reviewer 병렬)
프레임마다 `figma-desc-reviewer`를 spawn하고 Step 2 번들 + 정본 정책 + 루브릭을 주입한다. 각 에이전트는 `{verdict: PASS|GAPS, gaps[], questions_for_user[]}`를 반환. 여러 프레임이면 한 메시지에서 병렬 실행.

### Step 4 — 미확정 확정 (사용자 질문)
모든 reviewer의 `questions_for_user`를 모아 **중복 제거 후 한 번에** 사용자에게 질문(AskUserQuestion, 선택지 제시). 답을 확정값으로 사용한다. 사용자가 보류한 것만 open_questions로 남긴다. (figma-annotation-handoff의 "미확정 즉시 질문→확정 작성" 원칙)

### Step 5 — Fix (메인 + MCP)
GAPS 프레임만: reviewer 지시 + 사용자 확정값으로 ManifestEntry를 보강 → 기존 write `undo(write_id)` → `.autopus/dryrun-entry.json` 갱신 → `dryRun→approve→apply` → 새 write_id·card 기록.

### Step 6 — Re-review
보강한 프레임만 Step 2~3 재수행. PASS면 종료. GAPS 남으면 Step 4~5 반복(최대 3회). 3회 후에도 남으면 해당 항목을 writeback-log의 Open Issues로 명시하고 사용자에게 보고.

### Step 7 — 마감
`figma-writeback-log-v4.md`에 리뷰 라운드 결과(프레임별 PASS/보강 내역·새 write_id·확정된 질문)를 추가하고 최종 요약 보고.

## 종료 조건
- 전 프레임 PASS, 또는 남은 GAP이 전부 사용자 보류(open_questions)로 정당화됨.

## 자가 점검 (하네스 자체)
1. 모든 대상 프레임이 Step 2에서 실제 디자인과 적용 상태를 함께 수집했는가(번들 완전성)?
2. reviewer에 MCP를 시키지 않았는가(메인만 MCP)?
3. questions_for_user를 추측으로 메우지 않고 사용자에게 물었는가?
4. Fix 시 기존 write를 undo 후 재적용했는가(중복 카드 방지)?
5. 반복 상한(3회)과 잔여 Open Issues를 보고했는가?

## 안티패턴
- reviewer 에이전트에게 Figma/MCP 호출 위임(불가·실패).
- 디자인 미확인 상태로 "모자람 없음" 단정(반드시 Step 2 실제 수집 후 판정).
- 미확정을 추측으로 단정해 PASS 처리.
- gap 보강 시 기존 카드 미삭제로 중복 누적.

## 호출
`/figma-desc-review [all | frame_id ...]` — 대상 미지정 시 writeback-log-v4의 전 프레임.
참고: [[figma-annotation-handoff]] · [[v4-annotation-pipeline]] · 에이전트 `figma-desc-reviewer`.
