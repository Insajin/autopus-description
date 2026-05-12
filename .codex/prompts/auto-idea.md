---
description: "아이디어 브레인스토밍 — 아이디어를 구조화하고 ICE 스코어링으로 평가합니다"
---

# auto-idea — 아이디어 브레인스토밍

## Autopus Branding

When handling this workflow, start the response with the canonical banner from `templates/shared/branding-formats.md.tmpl`:

```text
🐙 Autopus ─────────────────────────
```

End the completed response with `🐙`.


**프로젝트**: auto-discription | **모드**: full

## 사용법

아이디어 설명을 인자로 받아 구조화 및 평가합니다.

## Codex Notes

- 기본 운영 원칙은 `spawn_agent(...)` 기반 subagent-first 입니다.
- 메인 세션은 orchestra 실행, 최종 합성, BS 저장을 담당합니다.
- 탐색성 보조 작업만 선택적으로 서브에이전트에 위임합니다.
- Step 2에서 `product-discovery`, `double-diamond`, `brainstorming` 스킬을 참고해 Intent Clarification Q&A를 먼저 수행합니다.
- Step 3에서는 orchestra CLI를 반드시 먼저 호출해야 하며, 실패한 경우에만 fallback을 허용합니다.
- ICE 스코어링은 orchestra 출력 결과를 기반으로 수행해야 합니다.

## 5단계 파이프라인

### Step 1: 입력 파싱

입력에서 아이디어 설명과 플래그를 추출합니다.

### Step 2: Intent Clarification Q&A + What/Why/Who/When 구조화

오케스트라를 호출하기 전에 사용자의 의도를 먼저 구체화합니다.

- 확인 축: Problem, Target Users, Desired Outcome, Success Signal, Constraints, Scope Boundary
- 프로젝트 문서와 코드에서 추론 가능한 답은 먼저 채웁니다.
- 여전히 불명확하면 한 번에 최대 3개의 고영향 질문만 사용자에게 묻습니다.
- `--auto` 또는 사용자의 즉시 진행 요청이 있으면 멈추지 않고 가정을 명시해 진행합니다.
- 질문은 유도하지 말고 문제, 사용자, 성공 기준, 제외 범위를 확인하는 데 집중합니다.

Step 3으로 넘어가기 전에 아래 Intent Brief를 작성합니다:

```markdown
## Intent Brief
- Problem: {핵심 문제}
- Target users: {대상 사용자}
- Desired outcome: {바뀌어야 하는 결과}
- Success signal: {측정/확인 신호}
- Constraints: {제약}
- Scope boundary: {하지 않을 것}
- Open assumptions: {미확인 가정과 confidence}
- Debate focus: {검증할 질문 2-4개}
```

- **What**: 무엇을 만드는가?
- **Why**: 왜 필요한가?
- **Who**: 누구를 위한 것인가?
- **When**: 언제 필요한가?

### Step 3: 다관점 브레인스토밍

PM/Designer/Engineer 3가지 관점에서 아이디어를 발산합니다.
Step 2의 Intent Brief를 브레인스토밍 입력에 포함하고, 토론자가 솔루션을 내기 전에 문제 정의와 미확인 가정을 먼저 검증하도록 합니다.

### Step 4: ICE 스코어링

| 항목 | 설명 | 범위 |
|------|------|------|
| Impact | 영향력 | 1-10 |
| Confidence | 확신도 | 1-10 |
| Ease | 실행 용이성 | 1-10 |

`Score = (Impact × Confidence × Ease) / 100`

### Step 5: BS 파일 저장

`.autopus/brainstorms/BS-{ID}.md`에 결과를 저장합니다.
Clarification Q&A, Intent Brief, 미해결 가정, debate focus를 BS 파일에 함께 기록합니다.

## 후속 작업

완료 후 `auto-plan`으로 SPEC 변환을 권장합니다.
