# Autopus Figma 플러그인 — Figma Organization Private Publish

> 대상: 조직 디자인/플랫폼 관리자
> 목적: Autopus Figma 플러그인을 회사 Figma Organization 안에서만 보이도록 private publish하여 디자이너들이 마켓플레이스 검색 한 번으로 install할 수 있게 한다.
> 전제: 회사 Figma Organization plan 활성, 본인 계정에 plugin publish 권한.

---

## 1. 빌드 산출물 확인

저장소 루트에서 빌드를 한 번 실행합니다.

```bash
npm install
npm run build
```

성공하면 다음 디렉터리가 생성됩니다:

```
dist/plugin/
├── manifest.json    ← name: "Autopus Figma"
├── code.js          ← 4121 lines (vendor) + autopus patch
├── ui.html          ← vendor UI
└── setcharacters.js ← vendor helper
```

`manifest.json`을 한 번 열어 `"name": "Autopus Figma"`로 되어 있는지 확인합니다. 이름은 publish 후 변경이 까다로우니 publish 직전 마지막으로 확인.

---

## 2. Figma 데스크탑에서 dev-mode 로컬 등록

Publish 전 동작 검증을 위해 먼저 dev-mode로 import하여 본인 계정에서 시험합니다.

1. Figma 데스크탑 앱 실행 → 임의의 파일 열기 (테스트용 빈 파일 권장).
2. 우상단 햄버거 → Plugins → Development → **Import plugin from manifest...**
3. `dist/plugin/manifest.json` 선택.
4. Plugins → Development → **Autopus Figma** → Run.
5. 플러그인 창에서 채널 입력 → Join. 콘솔에 connection 메시지가 보이면 OK.

테스트 시나리오:
- Claude Desktop 또는 Codex에서 `create_rectangle`로 사각형 하나 생성 시도 → 캔버스에 즉시 반영되는지 확인.
- `set_fill_color` → 색 변경 확인.
- description 명령 중 `set_frame_name` 시도 → frame 이름 변경 확인 (autopus patch 동작 검증).

이상 없으면 다음 단계.

---

## 3. Figma Organization private publish

> Figma의 plugin publish UI는 자주 업데이트됩니다. 아래는 2026-05 기준. 메뉴 위치가 달라졌으면 Figma의 공식 도움말(Plugins → Publishing) 참고.

1. Figma 데스크탑 앱에서 임의의 파일 열기.
2. Plugins → Development → **Autopus Figma** 옆 점3개(...) → **Publish new release**.
3. 폼 작성:
   - **Name**: `Autopus Figma`
   - **Tagline**: `Description workflow + AI-assisted design creation for Autopus.`
   - **Description**: 조직 사용 안내(예: "조직 디자이너가 Claude Desktop / Codex CLI 통해 Figma 디자인 생성·수정. 사용 가이드: 팀 채널")
   - **Icon**: 조직 로고 사용 (512×512 PNG 권장)
   - **Cover image**: 1920×960 권장 (선택)
   - **Categories**: Design Systems, Productivity
4. **Publishing options**:
   - **Make publicly available** 체크 해제 — 이게 핵심. Public 체크하면 누구나 install 가능.
   - **Organization only** 옵션이 보이면 선택. 보이지 않으면 "Save as draft"로 두고 Figma support에 Org private publish 권한 활성화 요청.
5. **Submit** → Figma 자동 검수(usually 수 분 - 수 시간) → publish 완료.

---

## 4. 디자이너에게 안내

Publish 완료 후, 디자이너는 다음 절차로 install:

1. Figma 데스크탑 → 우상단 햄버거 → Resources → Plugins.
2. 검색창에 "Autopus Figma" → Install (Org 사용자에게만 노출됨).
3. 디자이너용 가이드: `docs/guides/designer-figma-mcp-guide.md` 1-3장 참고.

팀 채널 또는 공지 채널에 publish 완료 + 가이드 링크 함께 안내.

---

## 5. 업데이트 절차

Plugin 코드(vendor 또는 autopus patch) 변경 시:

1. `npm run build` 재실행 → `dist/plugin/` 갱신.
2. Figma 데스크탑에서 Plugins → Development → Autopus Figma → **Manage in Figma** → **Publish new release**.
3. **Version notes**에 변경사항 명시(예: "vendor 1.2.0 동기화 + create_text 폰트 fallback 처리").
4. 검수 통과 후 디자이너 데스크탑 앱은 다음 plugin 실행 시 자동 업데이트.

`vendor/cursor-talk-to-figma-mcp/`를 `git subtree pull`로 업스트림 동기화한 경우에도 동일 절차 — `npm run build`가 새 vendor code.js를 기반으로 patch를 자동 다시 만들어줍니다 (SPEC-FIGMA-017 REQ-07 freshness path).

---

## 6. 폐기 / 회수

문제 발생 시 즉시 회수:

1. Plugins → Manage in Figma → **Unpublish** → "Yes, unpublish".
2. 조직 채널에 즉시 공지.
3. 디자이너는 install된 plugin을 Uninstall하면 새 명령 차단(이미 진행 중 작업은 영향 없음).

---

## 7. 자주 발생하는 publish 실패

| 증상 | 원인 / 조치 |
|------|-----------|
| "Manifest invalid" | `dist/plugin/manifest.json` JSON 문법 오류. `npm run build` 재실행. |
| "Plugin name already taken" | 다른 사람이 같은 이름으로 publish. 이름을 `Autopus Figma (Internal)` 같이 변경. |
| "Network access not permitted" | manifest의 `networkAccess.allowedDomains` 누락. `ws://localhost:3055` 포함 확인. |
| "Organization-only option missing" | Figma Org plan이 plugin private publish를 지원하지 않거나, 본인 계정이 Org admin이 아님. Figma support에 문의. |
| 디자이너가 검색해도 안 보임 | Publish가 draft 상태로 남았거나 검수 대기 중. Plugins → Manage in Figma → "Published" 상태 확인. |

---

## 8. 체크리스트 — 최종 publish 직전

- [ ] `npm run build` 성공
- [ ] `dist/plugin/manifest.json`의 name: `Autopus Figma`
- [ ] 본인 계정 dev-mode로 import 후 `create_rectangle` 시험 → 동작
- [ ] `set_frame_name`(autopus patch 명령) 시험 → 동작
- [ ] networkAccess 화이트리스트에 `ws://localhost:3055` 포함
- [ ] Icon / Cover / Description 작성 완료
- [ ] "Make publicly available" 체크 해제
- [ ] Organization only 옵션 활성화 확인
- [ ] 팀 채널에 publish 공지 초안 준비
