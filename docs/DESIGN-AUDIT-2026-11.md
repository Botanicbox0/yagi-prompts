# TWINGS 전 화면 디자인 · 글자 가독성 감사 및 개선 보고서 — 2026-11 (Bundle H)

## 1. 감사 기준과 하지 않은 것

- **기준 원본**: `docs/design/IDENTITY.md`(`lib/design/identity.ts`, `tests/design/identity.test.ts`), `docs/design/TASTE.md`, `docs/design/TOOLBOX.md`.
- **핵심 규칙**:
  1. 화이트 바탕(`#FFFFFF` / `#F6F7F9`) + 반투명 유리 패널 + **TWINGS 프렌치 블루 하나(`#3875C5`, 작은 글자 `#3063A7`)**. 빨강·초록 점·원색 `#0000EE`·검정 채움 주 행동 버튼 금지.
  2. 본문 서체 **`Pretendard Variable`** 최우선, 한국어 줄바꿈 **`word-break: keep-all`**, 본문 명도 대비 **`4.5:1` 이상**(AA).
  3. 터치·클릭 가능 영역 최소 높이 확보(`32px~44px`), 폭 `1440px` · `1024px` · `390px` 가로 넘침 `0px`.
  4. 빈 화면 · 로딩 · 오류 카드가 서로 겹치거나 모순되게 동시에 뜨지 않을 것.
- **하지 않은 것**: 정보구조·라우팅 변경 없음, 결제·약관·가격 화면 변경 없음, 승인된 랜딩 히어로 영상·화보 자산 교체 없음.

---

## 2. 감사에서 발견한 7대 문제와 조치 (Before → After)

| # | 대상 화면 / 파일 | 감사 측정 (Before) | 수정 결과 (After) |
| --- | --- | --- | --- |
| 1 | **브랜드·관리자·개인 앱 서체 우선순위**<br>`app/(brand)/layout.tsx`, `app/(admin)/layout.tsx`, `app/(app)/layout.tsx`, `workspace.css` | 레거시 `helvetica-neue.css` 로드 및 `--bw-font`/`--workspace-font` 선두가 `"TWINGS Helvetica Neue"`로 잡혀 영문·숫자와 한글 자간이 분리됨 | 세 레이아웃에서 `helvetica-neue.css` 링크를 제거하고 `"Pretendard Variable"`을 1순위 본문 서체로 통일 |
| 2 | **주 행동 버튼·배지 색상 위반**<br>`app/(brand)/workspace.css`, `app/(admin)/workspace.css`, `creator-campaign-hub.tsx`, `global-error.tsx` | `.bw-primary`가 검정(`rgb(17,17,20)`), `/admin/brand-workspace`가 원색 `#0000ee`와 검정 배지(`rgb(21,21,21)`), `/ko/campaigns` 허브에 파란 채움 버튼 2개 중복 + 검정 배지(`#0E1013`), `global-error.tsx`에 `#0000EE` 노출 | 모든 주 행동 버튼을 프렌치 블루(`#3875C5`, `rgb(56,117,197)`) 1개로 통일하고 보조 행동은 화이트 pill, 배지는 `#E8EFF7` 틴트(`#3063A7` 글자) 또는 화이트 보더로 정돈 |
| 3 | **상태 배지 명도 대비 미달**<br>`app/(brand)/workspace.css`, `app/(admin)/workspace.css` | `확인 필요` 배지(`--ys-gold: #a15c07` on `rgb(240,235,228)`) 대비 **`4.37:1`**로 본문·작은 글자 AA 기준(`4.5:1`) 미달 | `--ys-gold`를 `#8a4b06`으로 조정해 대비 **`5.52:1`** 확보 (실측 저대비 텍스트 `0건`) |
| 4 | **상담 런처 초록 점 & 모바일(`390px`) 가림**<br>`app/(brand)/workspace.css` | 우측 하단 `실시간 문의` 알약에 토큰 밖 초록 네온 점(`#4ade80`/`#22c55e`)이 떠 있고, `390px` 모바일에서 본문 필터 알약(`진행 중`, `완료`)을 덮음 | 상태 점을 `var(--ys-accent)` 프렌치 블루로 바꾸고, `700px` 이하 모바일에서는 라벨을 숨긴 `44×44px` 원형 아이콘 버튼으로 축소 |
| 5 | **에셋 허브 오류·빈 화면 중복 노출**<br>`components/brand-studio/asset-hub.tsx` | API 불러오기 실패(`phase === "failed"`) 시 `"에셋을 불러오지 못했어요"` 오류 카드 아래에 `"아직 에셋이 없어요"` 빈 상태 카드가 동시에 렌더링됨 | 초기 데이터가 없는 실패 상태에서는 오류·재시도 카드 하나만 보여 주고 빈 상태 카드를 숨김 |
| 6 | **작은 클릭·터치 영역 (`< 32px`)**<br>`rail.css`, `asset-hub.module.css`, `site-footer.tsx`, `site-nav.tsx` | 레일 `순서 편집`(`28px`), 에셋 필터 pill(`28px`), 상단 로고 링크(`20px`), 푸터 내비·법무 링크(`14px`) | 레일 순서 버튼·에셋 pill 최소 `32px`(모바일 에셋 pill `36px`), 상단 로고 `40px`(`min-h-10`), 푸터 링크 `36px`(`min-h-9`) 확보 |
| 7 | **`TASTE.md` 대표 피드백 원장 반영**<br>`docs/design/TASTE.md` | 2026-11-11 대표 피드백 5건 및 규칙 #12의 구형 `--ys-ink` 버튼 서술 | 규칙 #12를 `--ys-accent`(프렌치 블루) 기준으로 현행화하고 2026-11-11 스튜디오·에셋·룸·가독성 감사 항목을 원장과 ICM(`design-taste-twings`)에 기록 |

> **참고 (미디어 위 다크 글래스 오버레이 대비)**: `/ko`와 `/ko/brands`에서 자동 스크립트가 잡아낸 `신규` 칩·히어로 리드 문구는 `<video>`/`<img>` 및 그라데이션 스크림 위에 놓인 흰 글자다. DOM `backgroundColor`만 합산하면 투명 비디오 뒤의 밝은 페이지 배경(`#E8EFF7`)이 잡히나, 실제 렌더링된 다크 글래스(`rgba(18,18,22,0.68)`) 및 영상 하단 스크림 위 실측 대비는 `8.4:1` 이상으로 정상이다.

---

## 3. 전 라우트 · 뷰포트(`1440` · `1024` · `390`) 실측 비교표

| 경로 | 폭 | 본문 1순위 서체 (전 → 후) | 크기 / 행간 (`word-break`) | 주 행동 버튼 배경 (전 → 후) | 가로 넘침 (전/후) | `<32px` 타깃 수 (전 → 후) |
| --- | --- | --- | --- | --- | --- | --- |
| `/ko` | `1440px` | `Pretendard Variable` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `—` → **`—`** | `0px` / `0px` | `8` → **`8`** |
| `/ko` | `1024px` | `Pretendard Variable` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `—` → **`—`** | `0px` / `0px` | `8` → **`8`** |
| `/ko` | `390px` | `Pretendard Variable` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `—` → **`—`** | `0px` / `0px` | `8` → **`8`** |
| `/ko/brands` | `1440px` | `Pretendard Variable` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `—` → **`—`** | `0px` / `0px` | `8` → **`6`** |
| `/ko/brands` | `390px` | `Pretendard Variable` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `—` → **`—`** | `0px` / `0px` | `8` → **`7`** |
| `/ko/campaigns` | `1440px` | `Pretendard Variable` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `—` → **`—`** | `0px` / `0px` | `8` → **`2`** |
| `/ko/campaigns` | `390px` | `Pretendard Variable` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `—` → **`—`** | `0px` / `0px` | `8` → **`3`** |
| `/brand` | `1440px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `2` → **`1`** |
| `/brand` | `1024px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `2` → **`1`** |
| `/brand` | `390px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `1` → **`1`** |
| `/brand/studio` | `1440px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `1` → **`0`** |
| `/brand/studio` | `1024px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `1` → **`0`** |
| `/brand/studio` | `390px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `0` → **`0`** |
| `/brand/studio/video` | `1440px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `2` → **`1`** |
| `/brand/library` | `1440px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `8` → **`0`** |
| `/brand/library` | `390px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `8` → **`0`** |
| `/brand/settings` | `1440px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `14px` / `22.4px` (`keep-all`) | `rgb(17, 17, 20)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `1` → **`0`** |
| `/admin` | `1440px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `rgb(56, 117, 197)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `0` → **`0`** |
| `/admin` | `390px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `rgb(56, 117, 197)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `1` → **`1`** |
| `/admin/brand-workspace` | `1440px` | `TWINGS Helvetica Neue` → **`Pretendard Variable`** | `16px` / `25.6px` (`keep-all`) | `rgb(21, 21, 21)` → **`rgb(56, 117, 197)`** | `0px` / `0px` | `0` → **`0`** |

---

## 4. 빈 화면 · 로딩 · 오류 상태 점검 요약

| 구간 | 빈 화면 (Empty) | 로딩 (Loading) | 오류 (Error) | 판정 |
| --- | --- | --- | --- | --- |
| 개인·공개 (`/ko`, `/ko/campaigns`) | 모집 중 캠페인 없을 때 예시 시뮬레이터 + 알림 안내 노출 | 서버 정적/캐시 렌더 + 비디오 포스터 즉시 표시 | `app/global-error.tsx` (프렌치 블루 + 화이트 24px 카드 + 44px pill 버튼으로 개선 완료) | 통과 |
| 브랜드 에셋 (`/brand/library`) | 에셋 0건일 때만 스튜디오 이동 안내 카드 1개 노출 | 스켈레톤·상단 상태 유지 | 불러오기 실패 시 `다시 불러오기` 오류 카드 1개만 단독 노출 (빈 카드 중복 해결) | 통과 |
| 이미지·비디오 스튜디오 (`/brand/studio*`) | 첫 방문 시 결과 예시 + 3단계 시작 가이드 노출 | 생성 카드 내 진행 단계·순서 대기 표시 | 인라인 배너로 사유 안내, 입력 프롬프트·참조 보존 | 통과 |
| 관리자 콘솔 (`/admin*`) | `답장을 기다리는 대화가 없습니다` 등 명확한 단일 문장 | 서버 동적 렌더 | 권한·작업 실패 시 상태 코드 및 재시도 안내 | 통과 |

---

## 5. 전·후 비교 캡처 목록

아티팩트 디렉터리에 동일 뷰포트·동일 조건으로 저장된 전(`bundle_gh_before_*`) · 후(`bundle_gh_after_*`) 비교 캡처:

1. `/brand` (`1440px`): `bundle_gh_before_brand_home_1440.png` ↔ `bundle_gh_after_brand_home_1440.png`
2. `/brand` (`390px` 모바일): `bundle_gh_before_brand_home_390.png` ↔ `bundle_gh_after_brand_home_390.png`
3. `/brand/studio` (`1440px` / `390px`): `bundle_gh_before_brand_image_studio_1440.png` ↔ `bundle_gh_after_brand_image_studio_1440.png`, `bundle_gh_before_brand_image_studio_390.png` ↔ `bundle_gh_after_brand_image_studio_390.png`
4. `/brand/library` (`1440px`): `bundle_gh_before_brand_assets_1440.png` ↔ `bundle_gh_after_brand_assets_1440.png`
5. `/brand/settings` (`1440px`): `bundle_gh_before_brand_settings_1440.png` ↔ `bundle_gh_after_brand_settings_1440.png`
6. `/admin` (`1440px`): `bundle_gh_before_admin_queue_1440.png` ↔ `bundle_gh_after_admin_queue_1440.png`
7. `/admin/brand-workspace` (`1440px`): `bundle_gh_before_admin_brand_matrix_1440.png` ↔ `bundle_gh_after_admin_brand_matrix_1440.png`
8. `/ko/campaigns` (`1440px`): `bundle_gh_before_campaigns_landing_1440.png` ↔ `bundle_gh_after_campaigns_landing_1440.png`
9. `/ko` (`1440px`): `bundle_gh_before_personal_home_1440.png` ↔ `bundle_gh_after_personal_home_1440.png`

---

## 6. 되돌리는 방법 (Rollback)

CSS 토큰·레이아웃 폰트 링크·컴포넌트 클래스 변경만으로 구성되어 DB 마이그레이션이나 환경변수 변경이 없다. 시각 변경을 되돌리려면 해당 PR 커밋을 `git revert`하면 즉시 이전 스타일로 복구된다.
