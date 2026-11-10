# 브랜드 스튜디오 개편 (v3) — 2026-11-11

> v2(`docs/BRAND-STUDIO-V2.md`)의 서버(계약·모델·두 경로·허용량·검수 재시도)는 그대로 쓴다. 이 문서는 대표의
> 2026-11-11 피드백으로 **화면과 흐름**을 다시 짠 것이다. v2 문서와 다르면 화면·내비게이션은 이 문서가 맞다.
> 플래그는 그대로 `BRAND_STUDIO_V2`. 꺼져 있으면 운영 화면은 달라지지 않는다.

## 1. 대표가 말한 것 (원문 요지)

1. B2B 스튜디오에는 본인 얼굴 확인이 없다. 브랜드는 AI 페르소나나 다른 인물을 쓴다. "내 사진이 준비됐어요",
   템플릿별 본인 확인 체크를 스튜디오에 두지 않는다.
2. "브랜드 전용 포맷 / 인하우스 패키지"는 제품을 정확히 말하지 않는다. 회사 소개서 기준으로 다시 쓴다.
   구조는 **이미지 만들기**와 **영상 만들기**(캠페인 제작, 스케일 제작, 단일 영상 의뢰, 그리고 야기 팀과 피드백을
   주고받는 리뷰 공간).
3. 이미지 탭은 갤러리 벽 + 떠 있는 프롬프트 바. 차별점은 오른쪽 탭: **폴더 / 좋아요 / 내 업로드**에서 끌어다 쓰기.
4. 부분 수정은 참조 이미지(로고·제품·얼굴)를 받아야 하고, 수정 중에도 다른 탭·다른 생성이 막히면 안 된다.
5. 완성 뒤 편집: Canva류 레이어 편집을 어떻게 녹일지.
6. 참조는 작은 정사각 썸네일 + 아래 번호. "이미지 1" 둥근 칩이 아니다.
7. GPT Image 2.6 Flare / Sunburst 선택 가능. 프롬프트 개선 옆 "!"에 hover하면
   "각 이미지 모델에 최적화 된 프롬프트가 생성됩니다." 모델마다 무엇에 강한지 표시. 버튼을 누르면 입력창이 빛나며
   개선된 프롬프트를 보여 준다(Gemini 3.8 Flash, 고객 무료).
8. 원이 아니라 **크레딧**으로 보여 준다.
9. 왼쪽 사이드바. 탭 순서 변경, 이름 숨기기(접기).
10. 팀 화면에 멤버별 월 크레딧 사용량.
11. 영상: 참고 영상을 넣고 → 리버스 → 참고 영상 없이도 거의 같게 재현. 그리고 이 영상이 캠페인이 되어
    twings.app의 인플루언서·일반 유저에게 노출된다는 것이 보여야 한다.
12. 처음 쓰는 사람을 위한 설명(히어로 + 단계 카드).

## 2. 결정

| 항목 | 결정 |
| --- | --- |
| 내비게이션 | 모픽(샌드박스)·생성 차단 조직은 지금 화면 그대로(`sidebar`). 그 밖의 로그인 조직은 새 **레일**(`rail`). 로그아웃 화면은 `topbar` 유지. |
| 주소 | `/brand/studio` 이미지 · `/brand/studio/video` 영상 · `/brand/studio/review` 리뷰. 예전 `?mode=video`는 영상 주소로 보낸다. |
| 포맷 탭 | 스튜디오 메뉴에서 뺀다. 이미 계약 템플릿이 있는 조직만 영상 화면 아래 작은 링크로 `?tab=formats`에 간다(그 화면은 개인 쪽 렌더 레일이므로 본인 확인을 그대로 둔다). `lib/renders/*`, `lib/identity/*`는 건드리지 않는다. |
| 크레딧 | 표시 단위. `1 크레딧 = 사용량 10원`, 올림. 한 곳(`lib/brand-studio/credits.ts`). DB·정산은 계속 KRW. 플랜별 크레딧 수는 대표 결정. |
| 좋아요 | 멤버 개인 것. |
| 폴더 | 조직이 같이 쓴다(만든 사람 기록). 결과와 업로드 에셋을 함께 담는다. |
| 레이어 편집 | 별도 제품이 아니라 결과의 다음 동작("꾸미기"). 새 의존성 없이 DOM + canvas. 내보내면 새 에셋. |
| 리버스 | 리믹스 방식에 `blueprint` 추가: 참고 영상은 읽기만 하고 제공사에 붙이지 않는다. |
| 리뷰 공간 | 새 표 2개(리뷰 항목, 타임코드 댓글). 브랜드 화면 + 관리자 화면. |
| 워딩 | 각 슬라이스는 초안을 쓰고, 통합 때 Gemma로 한 번에 다듬는다(가격·기간·권한은 바꾸지 않는다). |

## 3. 내비게이션 레일 (슬라이스 A)

- `data-brand-layout-mode`에 세 번째 값 `rail`. `navigation.tsx`의 `Scoped`에서 모픽 판정이 아니고
  `studioV2`(서버가 넘긴 `brandStudioV2Open()`)가 켜져 있으면 `rail`, 아니면 지금처럼 `topbar`.
  **`sidebar` 분기의 마크업과 CSS는 한 글자도 바꾸지 않는다**(하드라인).
- 레일: 접힘 72px(아이콘 + hover 툴팁) ↔ 펼침 232px(아이콘 + 이름). 맨 아래 토글. 상태는
  `localStorage` `twings_brand_rail_v1`(`{ expanded: boolean }`), 순서는 기존 `twings_brand_nav_order_v1`.
- 항목(기본 순서): 이미지 `/brand/studio` · 영상 `/brand/studio/video` · 리뷰 `/brand/studio/review` ·
  캠페인 `/brand` · 크리에이터 `/brand/creators`(열려 있을 때) · 에셋 `/brand/library` · 브랜드 키트 `/brand/identity`.
  아래쪽: 팀 `/brand/members` · 설정 `/brand/settings` · 언어 · 로그아웃.
  스튜디오 세 항목은 `visible.studio`일 때만.
- 가운데 채운 **"+" 만들기** 버튼: 메뉴(이미지 만들기 / 영상 만들기 / 참고 영상으로 만들기 / 캠페인 의뢰).
- 순서 바꾸기: 끌어서(이미 있음) + 펼친 상태에서 "순서 편집"(위·아래 화살표, 초기화).
- 크레딧 계기: 레일 아래. 펼침 "크레딧 12,340 / 30,000" + 막대 + 채워지는 날, 접힘은 고리 아이콘 + 툴팁.
  허용량 0인 조직은 표시하지 않는다.
- 활성 표시: 흰 알약 + 왼쪽 3px 파란 막대. `/brand/studio`는 하위 주소(`/video`, `/review`)에서 활성으로 보이지 않게
  정확히 맞춘다.
- 640px 이하: 아래 탭 바(이미지·영상·리뷰·캠페인·더보기).
- 설명 컴포넌트 `components/brand-studio/explainer.tsx`(A 소유): 히어로(제목·한 줄·버튼 둘·미디어 자리) +
  단계 카드 3~6개 + "다시 보지 않기"(`localStorage`). 이미지·영상·리뷰 화면이 같이 쓴다.
- 팀 화면: 멤버별 "이번 달 크레딧"(사용 크레딧, 실행 수, 조직 대비 막대). `brand_studio_jobs.created_by` 기준,
  실패·취소 제외, 한국 시간 달력 월. 소유자·스튜디오 스태프만 보는 기존 화면 안에 둔다.

## 4. 이미지 화면 (슬라이스 B1 + B2)

```
┌ 레일 ┬──────────────── 갤러리 벽 ────────────────┬ 보관함 레일 ┐
│      │  [결과 카드들: 줄 맞춘 타일, 여백 4px]      │ 폴더│좋아요│업로드 │
│      │                                            │  썸네일 그리드  │
│      │        ┌─ 떠 있는 프롬프트 바 ─┐            │  (끌어다 놓기)  │
└──────┴────────┴───────────────────────┴───────────┴────────────────┘
```

**갤러리 벽(B1)**
- 화면 끝까지 채우는 줄 맞춤 타일(높이 고정, 비율대로 폭). 날짜 구분선은 얇게.
- 카드 hover: 좋아요 하트, 폴더에 담기, 참조로 쓰기, 더보기 메뉴(열기 · 다시 만들기 · 설정 다시 쓰기 · 부분 수정 ·
  꾸미기 · 영상으로 만들기 · 폴더에 담기 · 캠페인으로 보내기 · 저장 · 삭제).
- 진행 중 카드는 벽 안에서 자리 잡고 단계(대기 · 만드는 중 · 마무리)를 보여 준다. 실패 카드는 이유 한 줄 + 다시.
- 카드는 끌 수 있다(`REF_DRAG_TYPE`): 프롬프트 바, 부분 수정 참조, 레이어 편집기, 폴더로.
- 빈 상태: 설명 히어로 + 예시 문장.

**프롬프트 바(B1)**
- 아래 가운데 떠 있는 반투명 패널. 위: 참조 줄(**정사각 썸네일 44px + 아래 번호 1, 2, 3 …**, hover 시 ✕, 끌어서 순서 변경,
  누르면 쓰임/피할 것 메모). 가운데: 입력창. 아래: 모델 칩 · 비율 · 해상도 · 장수 · ✨개선 · [만들기 **N 크레딧**].
- 모델 칩을 누르면 목록: 이름 + **무엇에 강한지 한 줄** + 장당 크레딧. 예) Seedream 5.0 Pro "사진 같은 질감과 제품 화보",
  Nano Banana Pro "글자·로고가 정확, 부분 수정", GPT Image 2.6 Flare "지시를 가장 정확히 따름, 빠름",
  GPT Image 2.6 Sunburst "최고 품질, 복잡한 구성과 긴 글자". (문장은 카탈로그 사실로 확인한 것만.)
- **프롬프트 개선**: 토글(자동 개선, 기본 켬) + 옆 "!" — hover/포커스 툴팁
  "각 이미지 모델에 최적화 된 프롬프트가 생성됩니다." ✨ 버튼을 누르면 `prompt.enhance` 호출 → 입력창 테두리가
  빛나며 흐르고, 끝나면 개선된 문장으로 바뀐다("원래 문장으로" 되돌리기 제공). 이렇게 미리 개선한 문장은
  `enhance: false`로 보낸다. 무료라는 점을 툴팁 둘째 줄에 적는다.
- 금액 표시는 전부 크레딧. 허용량 줄은 "남은 크레딧 N".
- `StudioApp`에 `mode: 'image' | 'video'` — 화면이 매체를 고정한다(영상 화면이 `mode="video"`로 쓴다).
- 창 이벤트 `STUDIO_JOB_STARTED`를 들으면 보드를 다시 읽는다(다른 화면이 작업을 시작했을 때).

**새 모델(B1)**
- `gpt-image-2.6-flare`, `gpt-image-2.6-sunburst`: `npm run studio:catalog`로 Sunra 카탈로그에서 별칭·엔드포인트·
  인자 이름·가격을 **읽어서** 등록한다. 추측으로 넣지 않는다. 카탈로그에 없으면 `awaiting_provider`.
- 프롬프트 프로필 `gpt-image` 추가(`enhancer/profiles/gpt-image.ts`).
- 부분 수정에 쓸 수 있으면 `regionEdit: true`.

**부분 수정 v2(B1)**
- 뷰어에서 상자를 그리면 왼쪽에 "입력 미리보기"(잘린 영역 = 1번), 그 옆에 참조 줄(2번부터 번호).
  참조는 보관함 레일·갤러리에서 끌어오거나 파일로 올린다. 종류(로고·제품·인물·스타일)를 고를 수 있다.
- 모델 선택(부분 수정 가능한 모델만) + 크레딧 표시 + 지시문.
- **보내면 폼이 바로 닫히고** 갤러리에 진행 카드가 생긴다. 뷰어를 닫아도, 다른 화면으로 가도 작업은 서버에서 계속된다.
  여러 부분 수정을 동시에 보낼 수 있다(조직 동시 실행 한도 안에서).
- 완료 결과에서 **전/후 비교 슬라이더**.
- 다른 화면에 있을 때 끝난 작업은 레일 토스트로 알린다(`STUDIO_JOB_SETTLED`, A가 표시).

**보관함 레일(B2)** — `components/brand-studio/rail/*`
- 탭 셋: **폴더**(조직 공유, 만들기·이름 바꾸기·삭제, 폴더 안 그리드) / **좋아요**(내가 누른 결과·에셋) /
  **업로드**(지금의 에셋 패널: 올리기, 검색, 역할, 이름·태그 편집, 삭제).
- 모든 썸네일은 끌 수 있고(`startRefDrag`), 누르면 프롬프트 바 참조에 붙는다. 폴더 위에 카드를 떨어뜨리면 담긴다.
- 접기 가능(48px 손잡이). 전화에서는 아래 시트.
- 서버: `brand_studio_folders`, `brand_studio_folder_items`, `brand_studio_likes`
  (`0079_core_brand_studio_library.sql` + `0154_glue_brand_studio_library.sql`, RLS 강제·정책 없음·service role만),
  `lib/brand-studio/library.ts`, `POST/GET /api/brand-studio/library`. 권한·샌드박스 확인은 기존 서비스와 같은 가드.

## 5. 레이어 편집 "꾸미기" (슬라이스 E)

- 진입: 결과·에셋의 더보기 → "꾸미기". 전체 화면 편집기(`components/brand-studio/layers/*`, `next/dynamic`).
- 바탕 = 그 이미지(원본 픽셀). 레이어: 이미지(보관함에서 끌어오거나 고르기 — 로고·제품 컷), 글자(Pretendard 등 3~4종,
  크기·굵기·색·정렬·자간·줄 간격), 도형(사각·원, 채움·테두리·모서리).
- 조작: 이동·크기·회전, 가운데/가장자리 스냅 안내선, 순서, 복제, 잠금, 숨김, 투명도, 실행 취소/다시(⌘Z), 방향키 미세 이동.
- 내보내기: 원본 해상도 PNG → 기존 업로드 경로(`studio.upload`)로 새 에셋 저장 → 업로드 탭에 나타남.
  같은 출처 주소(`/api/brand-studio/media/…`)만 그리므로 canvas가 오염되지 않는다.
- 편집 상태(JSON)는 `localStorage`에 바탕 키별로 임시 저장(다시 열면 이어서). 서버 저장은 다음 단계.
- 다음 단계(이번 범위 아님): 브랜드 키트 색·서체 자동 적용, 채널 규격 일괄 내보내기, 서버 저장 문서.

## 6. 영상 화면 (슬라이스 C)

- 위: 시작하는 세 가지 카드
  1. **문장으로 만들기** — 프롬프트 바로 포커스.
  2. **참고 영상으로 만들기** — 리버스 패널을 연다.
  3. **제작 의뢰** — 아래 의뢰 구역으로.
- 가운데: 영상 갤러리 + 프롬프트 바(`<StudioApp mode="video">`).
- **리버스 패널**(`components/brand-studio/video/reverse.tsx`, 큰 서랍):
  1. 참고 영상 올리기/고르기.
  2. 읽기(`film.analyze`): 요약 + **샷 표**(시간 · 구도 · 카메라 · 동작) + 룩 + 사운드. 샷은 고칠 수 있다.
  3. 방식 선택 — **설계도로 재현**(`blueprint`: 영상을 붙이지 않고 설계도만으로 새로 만든다. 인물이 나온 참고 영상도 쓸 수 있다) /
     **참고 영상 붙여 만들기**(`reference`) / **이 영상 고치기**(`edit`).
  4. 무엇을 바꿀지(제품·인물·장소) + 참조 이미지 + 지킬 것(카메라·타이밍·구도·동작·룩) + 사운드(같이 / 음악 없이 / 무음).
  5. 480p 시안 → 확인 → 1080p. 크레딧 표시.
  - 시작하면 `STUDIO_JOB_STARTED`를 쏘고 서랍을 닫는다.
- 서버: `STUDIO_REMIX_METHODS`에 `blueprint`. 계약에 고친 샷(`shots?`)을 받는다. `plan`은 참고 영상 입력 과금 없이
  계산, `prepare`는 영상을 제공사 요청에 넣지 않는다. 프롬프트는 Video-Creator 방식(시각 스타일 블록 + 초 단위 타임라인,
  경계마다 컷/전환 명시, 카메라 이동은 이동·팬·줌을 구분)으로 Gemini가 쓴다. Gemini에 닿지 못하면 샷 표를 그대로
  타임라인 문장으로 편다. 설계도 읽기는 지금 시트보다 촘촘해야 한다(필요하면 `film-sheet`에 깊이 옵션).
- **캠페인으로 이어지는 길**(설명 띠): 영상 → 포맷으로 확정 → twings.app 개인 화면에 캠페인 공개 → 참여자가 자기 버전
  제작·게시 → 리포트. 영상 결과의 "캠페인으로 보내기"(`asFormat`)와 같은 말로.
- **제작 의뢰** 카드 셋(소개서 기준, 기존 의뢰 흐름으로 연결):
  - 크리에이터 캠페인 제작 → `/brand/projects/new?track=creator_campaign`
  - 스케일 제작(마스터 포맷 하나로 여러 편) → `?track=template_build`
  - 단일 영상(브랜드 필름) → `?track=studio_film`
  - `lib/brands/workspace/commission-tracks.ts`의 세 트랙 문구도 같은 말로 고친다(가격·기간 숫자는 그대로).
- 계약 템플릿이 있는 조직만: 아래 작은 링크 "계약한 전용 템플릿"(`?tab=formats`).
- 고객 문구에 엔진·경로 이름, 공급처 이름, 클라이언트 실명을 쓰지 않는다. 스튜디오 예시에 모픽 자료·"영상 9편 · 200만 뷰+"를 쓰지 않는다.

## 7. 리뷰 공간 (슬라이스 D)

- `/brand/studio/review`: 왼쪽 목록(리뷰 항목: 제목·상태·댓글 수), 오른쪽 플레이어 + 타임라인 핀 + 댓글.
- 항목 만들기: 스튜디오 결과·에셋의 더보기 "리뷰에 올리기"(D가 내보낸 함수를 B1이 메뉴에 연결) 또는 리뷰 화면에서 고르기.
  야기 팀이 납품 시안을 올리는 것도 같은 표(관리자 화면).
- 댓글: 본문 + 시각(ms, 없으면 전체 댓글) + 화면 위치(x, y 0..1, 선택) + 답글 + 해결 표시.
  작성자 역할 `brand` | `studio`. 영상은 핀을 누르면 그 시각으로 이동, 이미지도 위치 핀.
- 상태: `open` → `changes_requested` | `approved`.
- 표: `brand_studio_reviews`, `brand_studio_review_comments`
  (`0080_core_brand_studio_review.sql` + `0155_glue_brand_studio_review.sql`).
  API `/api/brand-studio/review`. 관리자: `/admin/brand-studio/reviews` 목록·상세, 답글·시안 올리기는
  `lib/admin/operations.ts` 오퍼레이션으로.
- 브랜드가 댓글을 쓰면 내부 알림(기존 concierge 알림 함수). 고객 화면에는 내부 도구 이름이 나오지 않는다.
- 권한: 소유자·편집자 작성, 뷰어 읽기, 샌드박스 조직 404.

## 8. 슬라이스 사이의 약속

`components/brand-studio/seams.ts`에 타입과 이벤트 이름이 있다. 구현은 각 소유자가 채운다.

| 소유 | 파일 |
| --- | --- |
| A | `components/brand-workspace/navigation.tsx`, `app/(brand)/layout.tsx`, `app/(brand)/rail.css`, `components/brand-workspace/rail-*.tsx`, `components/brand-studio/explainer.tsx`, `app/(brand)/brand/members/page.tsx`, `lib/brand-studio/member-usage.ts`, `messages/studio-shell.ts`, 테스트 `tests/brand-studio/shell/*` |
| B1 | `components/brand-studio/{studio-app,board,dock,dock-model,tray,viewer,region-editor,use-dock,use-viewer,use-studio,store,refs,copy,api,v2-page,icons,poller}.ts(x)`, 새 `components/brand-studio/gallery/*`, `app/(brand)/studio-v2.css`, `lib/brand-studio/{models,usage-rate}.ts`, `lib/brand-studio/provider/requests.ts`, `lib/brand-studio/enhancer/profiles/*`(영상 프로필 제외), `messages/*`의 `brandStudio`, `scripts/studio-catalog.ts`, 테스트 `tests/brand-studio/ui/*`, `tests/brand-studio/server/models*` |
| B2 | `components/brand-studio/rail/*`, `components/brand-studio/{asset-panel,asset-editor}.tsx`, `lib/brand-studio/{library,library-contracts}.ts`, `app/api/brand-studio/library/*`, 마이그레이션 0079/0154, `messages/studio-library.ts`, 테스트 `tests/brand-studio/library/*` |
| C | `app/(brand)/brand/studio/video/*`, `components/brand-studio/video/*`, `components/brand-studio/remix-panel.tsx`, `lib/brand-studio/{plan,prepare,reference-video}.ts`의 리믹스 부분, `lib/brand-studio/film-sheet/*`, `lib/brand-studio/enhancer/profiles/seedance.ts`·`tasks.ts`, `lib/brand-studio/contracts.ts`의 리믹스 부분, `lib/brands/workspace/commission-tracks.ts` 문구, `messages/studio-video.ts`, 테스트 `tests/brand-studio/video/*` |
| D | `app/(brand)/brand/studio/review/*`, `components/brand-studio/review/*`, `lib/brand-studio/{review,review-contracts}.ts`, `app/api/brand-studio/review/*`, `app/(admin)/admin/brand-studio/*`, 관리자 오퍼레이션 등록, 마이그레이션 0080/0155, `messages/studio-review.ts`, 테스트 `tests/brand-studio/review/*` |
| E | `components/brand-studio/layers/*`, `messages/studio-layers.ts`, 테스트 `tests/brand-studio/layers/*` |

공유 파일 규칙
- `messages/en.ts`·`ko.ts`: 자기 모듈을 import해 자기 키 한 줄만 더한다(`studioShell`, `studioLibrary`, `studioVideo`,
  `studioReview`, `studioLayers`). `brandStudio` 본문은 B1만 고친다.
- `lib/routing/surfaces.ts`·`lib/i18n/config.ts`: 자기 주소만 더한다.
- `tests/brands/workspace-security.test.ts`의 표 개수는 통합 때 Fable이 맞춘다.
- 같은 작업 폴더에서 여러 에이전트가 동시에 일한다. 남의 파일의 타입 오류는 고치지 않고 보고한다.
  `npm run build*`, 서버 실행, `db:local`, git 커밋·브랜치 변경을 하지 않는다. `npx tsc --noEmit`과 자기 테스트만 돌린다.

## 9. 하드라인 (모든 슬라이스)

1. 모픽 격리: `isSandboxedClientOrganization` / `studioV2Visible` 가드를 새 주소·새 API 전부의 첫 줄에 둔다.
   샌드박스 조직은 새 화면·새 API 모두 404, 레일·"+ 만들기"·크레딧 계기·리뷰 링크가 보이지 않는다. `sidebar` 화면은 그대로.
   `tests/brand-studio/sandbox.test.ts`에 새 주소·API를 더한다.
2. Toss 심사: 결제·약관·가격·`RENDER_PIPELINE_PUBLIC`, `lib/creator-subscriptions/**`, `lib/auth/review-login.ts`,
   `app/(app)/billing/**`, `lib/legal/documents.ts`를 건드리지 않는다. `lib/flags.ts`는 함수 추가만.
3. 제공사 검수·얼굴 검증을 우회하는 코드는 쓰지 않는다. 개인 쪽 렌더 레일은 그대로.
4. 새 이미지·영상은 Sunra로만. 구현 중에는 가짜 제공사(`BRAND_STUDIO_PROVIDER=fake`)만 쓴다. 유료 호출 금지.
5. 고객 화면에 내부 도구·엔진 경로·공급처 이름을 쓰지 않는다. 비밀값은 이름만.
6. 디자인: `docs/design/IDENTITY.md` → `TASTE.md` → `TOOLBOX.md`를 먼저 읽는다. 흰 바탕 + 반투명 패널 +
   TWINGS 블루 하나(#3875C5, 글자 #3063A7) + Pretendard. 빨강 CTA 없음. 화면마다 기법 3~4개.

## 10. 대표 결정 대기

- 크레딧 단위(잠정 10원)와 플랜별 월 크레딧(₩290,000 플랜 포함), 멤버별 한도를 둘지.
- 좋아요·폴더 보관 기간, 리뷰 공간을 계약 고객에게만 열지.
- 계약 템플릿(개인 얼굴 레일) 화면을 B2B에서 완전히 내릴지.
- GPT Image 두 모델의 고객 기본 노출 여부(원가가 높으면 상위 플랜만).

## 11. 다음 단계 제안 (이번 범위 아님)

1. **시안 대조 점검**: 480p 시안을 참고 영상과 자동 비교해 "2번 샷 0.4초 빠름, 카메라 일치" 같은 차이 목록을 주고,
   고를 것만 고쳐서 다시.
2. **@에셋 부르기**: 프롬프트에서 `@`로 저장한 로고·제품을 불러 참조로 붙인다.
3. **한 장 → 채널 세트**: 승인한 한 장을 4:5 / 9:16 / 16:9로 제품을 지킨 채 늘린다.
4. **댓글 → 수정**: 리뷰 댓글(시각·위치)을 그대로 부분 수정·영상 고치기 지시로 보낸다.
5. **설계도 보관함**: 리버스 설계도를 저장해 제품·인물만 바꿔 다시 만든다(포맷의 씨앗).
