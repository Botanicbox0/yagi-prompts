# feat(catalog): 4:5 두 열 카드·카탈로그 첫 화면·대기 단계·공유 카드

브랜치 `claude/catalog-wait-4fb43a` → `main`. PR 열기: https://github.com/Botanicbox0/yagi-prompts/pull/new/claude/catalog-wait-4fb43a

- 기능 커밋: `0ff20f76197efebac5ab9b15b7731c5657a791c2` (base `f837ca4`)
- 이 본문은 그 위의 문서 커밋 하나로 들어간다.
- 마이그레이션 없음. 클라우드 적용할 것 없음.

## 왜

대표 결정(2026-10-23, `docs/PLATFORM-2.0.md` §15.5-15): 세로 템플릿 카드는 **4:5 두 열**, 2026-08-14 "모든 카드 16:9"는 가로 템플릿에만. 같은 문서 §15.2·§15.3-4·5·6과 §3.2-4·5의 둘러보기·기다림·결과 순서를 한 번에 맞춘다. 공유 카드는 `docs/TEMPLATES-IA.md` §12 "공유 링크 OG = 그 사람 프레임 + 나도 만들기".

## 무엇이

1. **카드** (`components/prompts/prompt-card.tsx`, `card-frame.ts`, `card-media.tsx`, `rails.tsx`)
   - 프레임 판정: 예시 미디어 실측 → `aspect_default` → 매체 기본(영상 9:16·이미지 4:5). 폭/높이 ≥ 1.2만 16:9(letterbox), 나머지 4:5(cover).
   - 정보: 제목 + 길이 칩(15초) + 비율 칩 + 신규. 엔진명·"YAGI 제작"·용도 줄·"자세히 보기" 제거. 작가 포맷(`source ≠ yagi` 또는 `author_handle`)만 "작가 @handle"(지금 운영 데이터엔 해당 없음, 코드 경로만).
   - 카드 전체가 링크 하나. 보이는 재생/정지 버튼 44px(링크 오버레이 위). 뷰포트 진입 자동재생 + 이탈 시 디코더 회수(기존 `card-arming`), 정지는 유지, reduced-motion은 자동재생 없음.
   - 그리드: 모바일 2열 · md 3열 · lg 4열. 레일은 신규 먼저, 나머지 featured → newest.
2. **카탈로그 첫 화면** (`components/templates/listing.tsx`, `filter-chips.tsx`, `pill.ts`)
   - GEO 정의문은 그리드 아래(HTML 유지). 매체 탭·용도 칩 선택 상태를 같은 pill로. 용도가 하나뿐이면 칩 행 숨김, "N개 템플릿"은 서버 렌더로 유지.
3. **대기** (`app/(app)/renders/[id]/page.tsx`, `components/renders/render-stages.tsx`, `stage.ts`, `wait-browse.tsx`, `refresh-schedule.ts`, `auto-refresh.tsx`, `lib/renders/eta.ts`)
   - 단계 셋 + `progressbar`(1~3/3, 값 텍스트에 단계 이름). `data-render-stage`.
   - 예상 시간 "보통 N분쯤 걸려요": 같은 엔진 + 같은 템플릿 길이의 최근 성공 50건 중앙값, 10건 미만이면 이미지 2분·영상 5분, 쿼리 실패 시 기본값.
   - 폴링: 보일 때만 6초, 작업 생성 2분 뒤 15초, 숨기면 멈추고 돌아오면 즉시 1회.
   - "기다리는 동안 다른 포맷 보기" 카드 4장(같은 매체 먼저, 만드는 템플릿 제외). `NotifyChoice` 마운트 그대로.
   - 실패: 이유 본문 + 환불 문장(기존 `renders.notCharged`)을 본문 크기·전체 잉크로(`data-render-refund`).
4. **결과**: 결과물 먼저(세로 영상은 화면 높이에 맞춤, 데스크톱은 옆에 동작) → 다운로드 · 공유(`navigator.share`, 없으면 3일 링크 복사, 둘 다 안 되면 링크 표시) · 같은 얼굴로 하나 더(`/{locale}/video`) → 제목 → 별점·문제 알리기(기존).
5. **공유 링크** (`app/(app)/r/[id]/[token]/page.tsx`): OG/Twitter `summary_large_image`, 제목 "내 얼굴로 만든 {템플릿}", 이미지 결과는 결과물(`/api/renders/media/{id}?s=…`), 영상은 템플릿 포스터, 둘 다 없으면 사이트 카드. `noindex, nofollow` 유지. 하단 "나도 만들기" → 템플릿 페이지.
6. **문안**: `messages/ko.ts`·`en.ts`에 `prompts.cardSeconds/cardAuthor/cardAuthorAnonymous`, `renders.wait.*`, `renders.share/shareCopied/shareFailed/oneMore`, `renders.shareCard.*`만 추가. 재생 버튼은 기존 `creatorJourney.playPreview/pausePreview`를 같이 쓴다.

## 검증 (로컬, Windows)

| 명령 | 결과 |
| --- | --- |
| `npm run db:local` | 스냅샷 재생성(13 prompt items) |
| `npx tsc --noEmit` | 통과 |
| `npx vitest run` | **286 파일 / 2,793 테스트 통과** |
| `NEXT_PUBLIC_APP_URL=http://localhost:3012 npm run build:local` | 통과 |
| `PORT=3012 npm run start:local -- -p 3012` | Ready |
| `SWEEP_BASE_URL=http://localhost:3012 npm run sweep:anon` | **SWEEP PASSED — 1055/1055** |

새 테스트(먼저 실패 확인 후 구현): `tests/ui/catalog-cards.test.tsx`(프레임 선택·엔진명/자세히 보기 없음·작가 크레딧 조건·재생 규칙·44px 버튼·신규 먼저·2열·정의문 위치·칩 숨김·pill 통일), `tests/renders/wait-result.test.tsx`(단계 매핑·대기 페이지·다른 포맷 레일·실패 환불·폴링 가시성/백오프·ETA 규칙·결과 3동작·공유 OG·나도 만들기), `tests/renders/eta.test.ts`(PGlite 실제 쿼리: 엔진·길이 필터, 실패 제외, 10건 경계, 쿼리 실패 시 기본값). 고친 기존 테스트: `tests/ui/prompts.test.tsx` 카드 3건(엔진 칩·크레딧·자세히 보기가 빠진 결정 반영), `tests/routes/consumer-surface.test.tsx` 환불 문장 1건(흐린 회색 → 전체 잉크).

스윕 변경: `/en·/ko/video`에서 `SEEDANCE 2.5` 존재 확인을 빼고 `data-frame="portrait"`·`"landscape"`·`data-card-duration`·`data-card-aspect` 존재, `data-model-chip`·`data-card-detail` 부재, 정의문이 마지막 카드 뒤에 있는지를 본다. 템플릿 상세의 `SEEDANCE 2.5` 확인(다른 세션 범위)은 그대로.

카드 재생은 헤드리스 Chrome으로 운영 빌드에서 실측했다(자동재생·44×44·버튼이 최상위·정지 유지·재무장·회수). 표는 `docs/qa/catalog-wait/README.md`.

## 화면 (`docs/qa/catalog-wait/`)

390px·320px·1280px. 카탈로그 01~09(운영 빌드), 대기 10~14·결과 20·22~24·공유 30~32(dev + dev identity, 왼쪽 아래 "N"은 개발 모드 표시). 전부 가로 넘침 0. 목록과 확인 내용은 README.

## 건너뛴 검사 · 한계

- **"마무리" 단계는 현재 단계로 보이지 않는다.** 제공사 완료 → 결과 복사 → succeeded가 한 패스에서 끝나 DB에 중간 상태가 없다. 서비스에 `finishing` 상태(또는 타임스탬프)가 생기면 `components/renders/stage.ts` 한 곳만 바꾸면 된다.
- **영상 공유 카드 이미지 = 템플릿 포스터.** 결과 프레임 추출(ffmpeg)은 하지 않았다.
- 결과 영상은 `controls`가 있는 자동재생(음소거) 그대로다 — reduced-motion 분기는 카드에만 넣었다.
- 실제 웹 공유 시트·클립보드 동작은 단위 테스트(가짜 navigator)로만 확인했다. 실기기 확인 필요.
- 대기 페이지 폴링은 가짜 타이머 테스트로 확인했다(브라우저에서 탭 숨김을 재현하지 않았다).
- 결과·공유 캡처의 결과물은 4:3 픽스처 영상이라 9:16 프레임에 검은 띠가 있다(실제 9:16 결과는 꽉 찬다).
- 프리뷰 URL: push 후 Vercel 프리뷰가 생기면 Director가 확인(이 세션은 gh가 없어 PR·프리뷰 링크를 직접 확인하지 못했다).

## 남은 위험

- 데스크톱에서 화면 안 영상 카드가 모두 동시에 재생된다(4열 × 2~3행). 기존 회수 로직은 화면 밖만 회수한다. 저사양 노트북에서 무거우면 "화면 안에서도 최대 N개"를 두는 게 다음 손잡이다.
- 홈 갤러리도 같은 카드·그리드를 쓴다(홈 `page.tsx`는 건드리지 않음). 용도가 하나뿐인 운영 데이터에서는 홈의 칩도 사라지고 "N개 템플릿"만 남는다.
- 템플릿 페이지의 `RelatedPrompts`(`components/prompts/detail.tsx`)는 `sm:grid-cols-2`라 모바일에서 4:5 카드가 한 열 전체 폭이 된다. 그 파일은 onboarding-make 세션 범위라 건드리지 않았다 — 맞추려면 `grid grid-cols-2 gap-x-3 gap-y-6 lg:grid-cols-4`.
- 사용하지 않게 된 사전 키(`renders.waitingTitle`, `waitingBody`, `stageMatching`, `makeAgain`은 실패 화면에서 계속 씀)는 지우지 않았다.

## 다음 행동 제안

1. 렌더 서비스에 마무리 상태 기록 → 단계 셋 완성.
2. 결과 영상 첫 프레임 추출(서버 ffmpeg 또는 제공사 썸네일) → 공유 카드를 "그 사람 프레임"으로.
3. 같은 ETA 함수(`lib/renders/eta.ts`)를 결제 직전 한 줄(§3.2-3 "보통 N분 걸려요")에 연결(템플릿 페이지 세션).
4. `RelatedPrompts` 그리드를 두 열로.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
