## 카탈로그 카드 틀 + 가로 템플릿 와이드 타일 + 필터 칩 줄 제거 (대표 피드백 2026-10-28)

`/ko/video` 화면에 대한 대표 피드백을 두 차례 반영했다. 설계 기록은 `docs/PLATFORM-2.0.md` §15.6.

1. **세로·정사각 템플릿은 4:5 카드, 가로 템플릿(16:9, 4:3 …)은 그리드 두 칸을 쓰는 와이드 타일이다.** 카드가 결과물 비율을 따라가던 때는 16:9·4:3 템플릿이 9:16 카드 옆에서 낮은 띠가 되어 묻혔다(1차 피드백). 모든 카드를 4:5로 자르자 이번에는 16:9의 가로 약 55%가 잘려 넓은 장면이 얼굴 클로즈업이 됐다. 대표는 "4:3이랑 16:9가 좀 죽어 보인다"고 했다(2차 피드백, 실제 영상 프리뷰). 와이드 타일은 옆 4:5 카드와 미디어 높이가 같다. 그래서 한 줄의 제목과 칩이 같은 선에 놓이고, 16:9는 가로 약 7%, 4:3은 세로 약 19%만 잘린다. 비율 칩(`16:9`, `4:3` …)은 그대로 둔다.
2. **출처 칩(전체 · 오리지널 · 메이커)과 용도 칩(전체 · 시네마틱 · …)을 없앴다.** `/video`·`/image`와 홈 갤러리 모두 해당한다. 출처는 레일 제목("TWINGS 오리지널" / 메이커 컬렉션)이 말해 준다. 비디오/이미지 전환은 파란 알약 대신 헤어라인 위의 글자 탭이다. 열린 탭은 검은 글자에 2px 밑줄, 다른 탭은 55% 잉크(대비 4.7:1)로, 사이트 내비게이션의 현재 위치 밑줄과 같은 어법이다. 개수 줄("n개 템플릿")도 뺐다.

그리드는 폰 2열, 768px부터 4열이고 3열 단계는 없다. 데스크톱 한 줄은 카드 4장, 타일 2장, 타일 1장 + 카드 2장 가운데 하나다. 폰에서 타일은 한 줄을 다 쓰는 약 1.65:1 카드다.

### 와이드 타일의 높이와 순서
- **높이**: 타일의 미디어 상자가 크기 컨테이너(`@container`)이고 높이는 `calc((100cqi - var(--card-gap)) * 0.625)`다. 4열이면 타일 폭은 두 칸 + 간격이고, 한 칸은 (타일 − 간격) / 2, 4:5 카드 높이는 한 칸의 1.25배다. 간격은 그리드가 `--card-gap`(폰 0.75rem, `sm`부터 1rem)으로 알려 준다. 고정 8:5 근사 대신 이 식을 써서 모든 폭에서 높이가 정확히 같다.
- **순서**: `grid-auto-flow: dense`는 쓰지 않았다. 키보드 순서와 화면 순서가 어긋나기 때문이다. 대신 `pairCards`·`railOrder`(`components/prompts/card-frame.ts`)가 두 칸 단위로 순서를 짠다. 짝 없는 카드는 다음 카드를 옆으로 당겨 오고, 짝을 못 찾은 카드는 레일 맨 끝으로 간다. 그러면 모든 타일이 짝수 칸에서 시작해 2열·4열 어디서도 중간 빈칸이 없다. NEW가 먼저 오는 규칙도 지킨다. NEW 묶음에서 카드 한 장이 남으면 그 묶음 끝에서 첫 번째 이전 카드와 짝을 짓는다.
- **적용 범위**: `/{locale}/video`·`/{locale}/image`·홈 갤러리(`PromptRail`), AI 크리에이티브 프로필 `/{locale}/makers/[handle]`(같은 `PromptRail`), 템플릿 페이지의 관련 템플릿, 렌더 대기 화면의 "다른 포맷 보기". 모두 2열 → 4열 그리드다. 타일은 그리드가 두 칸을 줄 때만 켜진다(`frame="wide"` + `col-span-2`). 그 밖의 카드는 4:5 그대로다. 홀수 열 그리드(홈 `Featured` 섹션 1·2·3열, 지금은 어디서도 렌더하지 않음)에서는 두 칸 단위가 줄 경계를 넘어 빈칸이 생기므로 켜지 않았다.

### 화면 — 실제 영상(운영 템플릿 10편)
기준 화면은 이 브랜치 로컬 빌드의 `/ko/video`(이 브랜치의 CSS·헤더·탭)다. 영상 레일은 이 브랜치의 `PromptRail`에 운영 화면의 공개 카드 데이터(제목, 비율, 길이, NEW, 포스터·영상 URL)를 넣어 렌더한 것으로 바꿨다. 각 카드에는 운영 영상을 붙여 실제 프레임에서 멈췄다(설치된 Chrome, H.264). 프리뷰 배포는 Vercel 인증 뒤에 있어 헤드리스로 열 수 없었다. before는 바로 앞 커밋(a755d75)의 규칙이다(모든 카드 4:5, 짝 맞춤 없음).

| | 1440px | 375px |
| --- | --- | --- |
| before (모두 4:5) | `21-tile-before-ko-video-1440.jpg` | `22-tile-before-ko-video-375.jpg` |
| after (와이드 타일) | `23-tile-after-ko-video-1440.jpg` | `24-tile-after-ko-video-375.jpg` |

운영 영상 템플릿 10편 가운데 8편이 가로(16:9 4편, 4:3 4편)라서, after의 데스크톱 줄은 대부분 타일 2장이다. NEW인 렌즈 포털 발레리나가 맨 앞에 오고, 9:16 두 편(핑크 시그널 폴더폰, summer peach)이 한 줄에 나란히 선다. 18칸이라 4열에서는 마지막 줄에 타일 1장(기억 속 영화의 주인공)이 반 줄로 남는다. 이미지 탭은 운영 템플릿이 3:4 한 편뿐이라 바뀌는 게 없다.

이전 라운드 화면(같은 폴더): `01`~`04` 운영(비율을 따르던 카드), `05`·`06` 틀 비교(4:5 / 1:1 / 4:5 + 흐린 배경), `11`~`14` 4:5 단일 틀의 로컬 빌드(회색 자리표시자).

### 바뀐 것
- `components/prompts/card-frame.ts`: `cardFrame()`(가로/세로 > 1 → `wide`), `WIDE_HEIGHT`, `CARD_GRID_GAP`, `pairCards()`, 짝 맞춤을 넣은 `railOrder()`. `CARD_RATIO = '4 / 5'`는 세로·정사각 카드용으로 남는다(캠페인 마법사도 쓴다).
- `components/prompts/prompt-card.tsx`: `frame` prop(기본 `portrait`). `wide`면 `data-frame="wide"`, 미디어 상자 `@container`, 높이 `WIDE_HEIGHT`. `card-media.tsx`는 `height` prop을 받는다. 자르기는 그대로 `object-cover object-[50%_35%]`.
- `components/prompts/rails.tsx`·`detail.tsx`(관련 템플릿)·`components/renders/wait-browse.tsx`: 순서는 `railOrder`/`pairCards`, 타일은 `col-span-2`, 간격은 `CARD_GRID_GAP`.
- `components/templates/listing.tsx`: 글자 탭(`MediumTabs`)만 남겼다. 지운 파일: `components/prompts/filter-chips.tsx`, `components/templates/origin-filter.tsx`, `components/prompts/pill.ts`. 홈(`app/(marketing)/[locale]/page.tsx`)의 용도 칩도 뺐다. `lib/navigation/public-state.ts`에서 `?useCase=` 읽기·쓰기를 지웠다(`/brands`의 `?useCase=`는 별개 코드).
- 사전(`messages/ko.ts`·`en.ts`): `prompts.filterHeading·filterAll·filterCount·filterReset`을 지웠다. `templates.origin*` 네 키는 일부러 남겼다(아래 #111 참고). `KO_TERMS`·`EN_TERMS`는 건드리지 않았다.
- `scripts/sweep-anon.ts`: `/{locale}/video`의 레일마다 카드를 하나씩 본다. 비율 칩이 가로로 긴 카드는 `col-span-2` + `data-frame="wide"` + 높이식, 나머지는 `min-w-0` + `data-frame="portrait"` + `aspect-ratio:4 / 5`여야 한다. 짝수 칸이 아닌 곳에서 시작하는 타일이 없어야 하고, 스냅숏에 타일이 한 장 이상 있어야 한다. 칩 마커와 `data-frame="landscape"`·16:9 틀은 없어야 하고, 열린 탭에는 `aria-current="page"`가 있어야 한다.
- 테스트(`tests/ui/catalog-cards.test.tsx`): 틀 판정, 타일 마크업·높이식, 두 칸을 주지 않는 곳의 4:5 유지, 짝 맞춤(전부 타일 / 전부 카드 / 섞임 / 홀수 카드 / NEW 먼저). 길이 0~8의 모든 W·S 배열 511가지에서 빈칸 없음·누락 없음·순서 유지도 확인한다.

### 검증 (AGENTS.md §3)
- `npx tsc --noEmit` — 통과
- `npx vitest run` — **333 파일 / 3,188 테스트 통과**
- `npm run build:local` — 통과
- `npm run start:local`(3000) + `npm run sweep:anon` — **SWEEP PASSED — 1169/1169**
- 로컬 빌드 측정(헤드리스 Chrome, 375 · 390 · 640 · 768 · 1024 · 1440px): 가로 넘침 0, 한 줄 안의 미디어 높이 차 0.00px, 제목 위치 차 0.00px. 1440에서 타일 492×297.5(1.65:1), 카드 238×297.5. 375에서 타일 327×196.9, 카드 157.5×196.9. 실제 영상을 넣은 화면도 같은 값이다.

### PR #111(`claude/creative-profile`)과의 관계
- `KO_TERMS`·`EN_TERMS`와 스윕의 메이커 프로필 절은 건드리지 않았다. #111의 메이커 프로필 테스트는 9:16 템플릿으로 `data-frame="portrait"`를 확인하므로 그대로 통과한다.
- `templates.origin*` 네 키는 #111이 바로 윗줄(`makerRailLede`)을 고쳐 충돌이 나서 남겼다. 후속(두 PR이 다 들어간 뒤 한 커밋): 사전의 `templates.origin*` 네 키와 `prompts.filterEmpty`, `tests/i18n/dictionary.test.ts`의 `originMaker` 한 줄, 메이커 페이지의 `filteredEmptyLabel={dict.prompts.filterEmpty}` 한 줄을 지운다.

### 남은 것·위험
- 레일 끝의 반 줄은 템플릿 수와 비율이 정한다(지금 운영 영상: 가로 8 + 세로 2 = 18칸 → 4열에서 마지막 줄 타일 1장). 몇 편을 올릴지는 템플릿 선정과 같은 대표 결정이다.
- 가로 템플릿이 많으면 페이지가 길어진다. 운영 영상 10편 기준 데스크톱 3줄 → 5줄, 폰 5줄 → 9줄. 가로 템플릿을 제 모양에 가깝게 보여 주는 대가다.
- 예시 이미지가 없는 템플릿에 나오는 글자 포스터는 좁은 4:5 칸에서 긴 단어가 줄을 넘긴다("TALKIN G"). 이전부터 있던 문제이고, 운영 템플릿은 모두 예시 이미지가 있다.
- 결제·가격·약관·템플릿 상세 페이지의 만들기/결제 카드는 건드리지 않았다. 클라우드 DB 적용이 필요한 마이그레이션은 없다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
