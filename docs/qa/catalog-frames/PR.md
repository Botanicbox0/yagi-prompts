## 카탈로그 카드 틀 통일 + 필터 칩 줄 제거 (대표 피드백 2026-10-28)

`/ko/video` 화면에 대한 대표 피드백 두 가지를 반영했다. 설계 기록은 `docs/PLATFORM-2.0.md` §15.6.

1. **모든 카드를 같은 4:5 세로 틀에 넣었다.** 카드가 결과물 비율을 따라가던 탓에 16:9·4:3 템플릿이 9:16 카드 옆에서 낮은 띠가 되어 묻혔다. 이제는 예시를 틀에 꽉 차게 자른다(`object-cover`, 초점 가로 50%·세로 35%). 결과물의 실제 비율은 카드의 비율 칩(`16:9`, `4:3` …)이 그대로 알려 준다.
2. **출처 칩(전체 · 오리지널 · 메이커)과 용도 칩(전체 · 시네마틱 · …)을 없앴다.** `/video`·`/image`와 홈 갤러리 모두에서 뺐다. 출처는 레일 제목("TWINGS 오리지널" / 메이커 컬렉션)이 말해 준다. 비디오/이미지 전환은 파란 알약 대신 헤어라인 위의 글자 탭으로 바꿨다. 열린 탭은 검은 글자에 2px 밑줄, 다른 탭은 55% 잉크(대비 4.7:1)이고, 사이트 내비게이션의 현재 위치 밑줄과 같은 어법이다. 개수 줄("n개 템플릿")도 뺐다. 거르는 기능이 없으니 몇 편인지는 그리드를 보면 안다.

그리드는 폰 2열, 768px부터 4열이다. 3열 단계를 없애서 데스크톱 한 줄이 차면 폰 두 줄도 찬다.

### 틀을 고른 근거
운영 화면(twings.app)의 실제 미디어에 틀만 바꾼 CSS를 입혀 390px·1440px로 찍어 비교했다.

| 파일 | 내용 |
| --- | --- |
| `05-frame-compare-390.jpg` | 이전 / **4:5 자르기(채택)** / 1:1 자르기 / 4:5 + 흐린 배경 |
| `06-frame-compare-1440.jpg` | **4:5 자르기(채택)** / 1:1 자르기 |

- 1:1은 모든 카드가 작아지고 9:16을 더 많이 자른다(핑크 시그널 폴더폰).
- 4:5 + 흐린 배경(가로 예시는 통째로 두고 뒤에 흐린 사본)은 가로 템플릿이 다시 낮은 띠가 된다. 피드백 1과 같은 문제다.
- 4:5 자르기에서는 운영 중인 가로 템플릿 8편 모두 주인공이 틀 안에 남았다. 렌즈 포털 발레리나만 왼쪽 클로즈업 얼굴이 반쯤 잘리고, 발레리나는 온전하다.
- 세로 초점 35%는 9:16 클립의 머리 위가 덜 잘리게 한다. 가로 예시에는 영향이 없다.

### 화면 (before = 운영, after = 이 브랜치 로컬 빌드)
로컬 스냅샷의 예시 미디어는 회색 자리표시자다. 실제 미디어로 본 모습은 위 비교 이미지의 "4:5 cover (chosen)" 칸이 이 브랜치와 같은 규칙이다.

| | 390px | 1440px |
| --- | --- | --- |
| `/ko/video` before | `01-before-ko-video-390.jpg` | `02-before-ko-video-1440.jpg` |
| `/ko/image` before | `03-before-ko-image-390.jpg` | `04-before-ko-image-1440.jpg` |
| `/ko/video` after | `11-after-ko-video-390.jpg` | `12-after-ko-video-1440.jpg` |
| `/ko/image` after | `13-after-ko-image-390.jpg` | `14-after-ko-image-1440.jpg` |

### 바뀐 것
- `components/prompts/card-frame.ts`: `CARD_RATIOS`·`cardFrame()`(세로/가로 판정)을 `CARD_RATIO = '4 / 5'` 하나로 바꿨다. 캠페인 마법사의 템플릿 카드도 같은 상수를 쓴다.
- `components/prompts/prompt-card.tsx`·`card-media.tsx`: 언제나 4:5·`object-cover object-[50%_35%]`. 카드 마커 `data-frame="portrait"`는 그대로 두었다(메이커 페이지 테스트와 스윕이 이 값을 본다).
- `components/prompts/rails.tsx`: `grid-cols-2 md:grid-cols-4`. 필터용 `data-use-case`와 숨겨 둔 "이 용도는 비었다" 줄을 없앴다. `useCaseLabels`·`filteredEmptyLabel`은 선택 prop으로 남겼다. 아직 넘기는 호출부(메이커 페이지)가 있기 때문이다.
- `components/templates/listing.tsx`: 글자 탭(`MediumTabs`)만 남겼다. 지운 파일: `components/prompts/filter-chips.tsx`, `components/templates/origin-filter.tsx`, `components/prompts/pill.ts`.
- `app/(marketing)/[locale]/page.tsx`: 홈 갤러리의 용도 칩도 뺐다(같은 컴포넌트, 템플릿 6편 이상일 때 나오던 줄).
- `lib/navigation/public-state.ts`: `?useCase=` 읽기·쓰기(`readUseCase`·`useCaseHref`)를 지웠다. `/brands`의 `?useCase=`는 별개 코드라 그대로다.
- 사전(`messages/ko.ts`·`en.ts`): 쓰지 않게 된 `prompts.filterHeading·filterAll·filterCount·filterReset`과 `templates.originHeading·originAll·originStudio·originMaker`를 지웠다. `KO_TERMS`·`EN_TERMS`는 건드리지 않았다.
- `scripts/sweep-anon.ts`: `/{locale}/video`에서 카드 수 = `data-frame="portrait"` 수 ≤ `aspect-ratio:4 / 5` 수인지, `data-frame="landscape"`·16:9 틀이 없는지, 넓은 템플릿의 비율 칩 `16:9`가 남는지, 칩 마커(`data-use-case-filter`·`data-origin-filter`·`aria-pressed`)가 없는지, 열린 탭에 `aria-current="page"`가 있는지 확인한다. 메이커 절에서는 "출처 칩 있음"을 "출처 칩 없음"으로 바꿨다.
- 테스트: `tests/ui/catalog-cards.test.tsx`(틀·탭·칩 부재), `tests/ui/prompts.test.tsx`(레일에 필터 상태 없음), `tests/navigation/public-state.test.ts`, `tests/i18n/dictionary.test.ts`(지운 키 한 줄).

### 검증 (AGENTS.md §3)
- `npx tsc --noEmit` — 통과(출력 없음)
- `npx vitest run` — **333 파일 / 3,179 테스트 통과**
- `npm run build:local` — 통과
- `npm run start:local`(3000) + `npm run sweep:anon` — **SWEEP PASSED — 1167/1167**
- 768px 태블릿: 4열(카드 168×210), 가로 스크롤 없음. 탭 높이 44px.

### PR #111(`claude/creative-profile`)과의 관계
- `KO_TERMS`·`EN_TERMS`와 스윕의 메이커 프로필 절은 건드리지 않았다. `PLATFORM-2.0.md`는 §7.5·§14.2 표·§15에만 손대고 새 절은 §15.6에 넣었다(#111은 끝에 §20을 붙인다).
- 두 브랜치를 `git merge-tree`로 시험 병합했을 때 충돌이 없다.
- #111이 먼저 들어가든 나중에 들어가든 메이커 페이지는 `filteredEmptyLabel={dict.prompts.filterEmpty}`를 계속 넘기고, 그 prop은 이제 쓰이지 않는다. 두 PR이 다 들어간 뒤 그 한 줄과 `prompts.filterEmpty` 키를 지우면 된다(후속).

### 남은 것·위험
- 레일 마지막 줄에 한 장만 남는 경우는 그리드가 아니라 템플릿 수가 정한다(지금 운영 오리지널 영상 9편 → 4·4·1, 메이커 1편). 몇 편을 올릴지는 템플릿 선정과 같은 대표 결정이다.
- 예시 이미지가 없는 템플릿에 나오는 글자 포스터는, 좁은 칸에서 긴 단어가 줄을 넘긴다("TALKIN G", 로컬 메이커 레일). 이전에도 데스크톱 4열에서 같았던 문제이고, 운영 템플릿은 모두 예시 이미지가 있어 보이지 않는다.
- 결제·가격·약관·템플릿 상세 페이지의 만들기/결제 카드는 건드리지 않았다. 클라우드 DB 적용이 필요한 마이그레이션은 없다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
