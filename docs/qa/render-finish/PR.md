# feat(renders): 마무리 단계·공유 프레임 캡처·관련 템플릿 그리드·자동재생 상한

첫 경험 PR #82·#83이 남긴 후속 넷(`docs/qa/catalog-wait/PR.md` "다음 행동 제안" 1·2·4 + "남은 위험" 자동재생). 설계 원본 `docs/PLATFORM-2.0.md` §3.2-4·5, `docs/TEMPLATES-IA.md` §12 "공유 카드".

- 브랜치 `claude/render-finish-61be09`, base `main` `90a5b1a`
- 기능 커밋 `d307f49e6aa022edd66227b3d773a24102837da9` (이 본문은 그 다음 커밋)
- `git diff --stat main...d307f49`: 40 files, +1,124 / −49 (캡처 PNG 10장 포함)

## 클라우드 적용 필요: `0055_core_render_finishing.sql`

core만, glue 없음. `render_jobs`에 nullable 컬럼 둘(`finishing_at timestamptz`, `poster_key text` + 키 형식 check). 0107이 `render_jobs`의 클라이언트 권한을 테이블 단위로 회수했으므로 새 컬럼에 grant·policy가 필요 없다.

**적용 순서 무관.** 두 컬럼은 `lib/renders/extras.ts`만 읽고 쓰며, `repo.ts`의 공용 컬럼 목록에는 넣지 않았다(목록에 넣으면 0055 없는 DB에서 렌더 큐 전체가 깨진다). 미적용 DB에서는 기록 실패를 로그 한 줄로 삼키고, 대기 화면은 지금처럼 "만드는 중", 공유 카드는 템플릿 포스터, 결과 페이지는 프레임 캡처를 시도하지 않는다. 테스트로 확인(`tests/renders/service.test.ts` "a database without 0055", `tests/renders/poster.test.ts` "stores nothing on a database without 0055").

## 무엇이 바뀌었나

| # | 영역 | 지금 | 파일 |
| --- | --- | --- | --- |
| 1 | 대기 "마무리" | 패스가 제공사 완료를 본 순간 `finishing_at`을 한 번 기록(`status='running' and finishing_at is null`, running 유지). 영상은 `pollVideoRender`의 `onProviderDone` 훅으로 **다운로드 전**, 이미지는 `finish()`에서 **복사 전**. `renderStage`가 running + `finishingAt` → `finish`. 화면은 3/3, 본문 "영상이 나왔어요. 저장하고 공유 링크를 만드는 중이에요.", 분 대신 "곧 이 화면에 나타나요." | `lib/renders/extras.ts`, `service.ts`, `engines.ts`, `components/renders/stage.ts`, `render-stages.tsx`, `messages/*.ts` |
| 2 | 공유 카드 = 그 사람 프레임 | 결과 페이지(소유자, 영상, 프레임 없음, 0055 있음)에서만 `PosterCapture`가 화면 밖 muted `<video crossOrigin=anonymous>`로 메타데이터 → 0.5초(짧으면 절반) 지점 → canvas(긴 변 ≤1080) → JPEG를 품질 0.82→0.46 단계로 300KB 이하가 될 때까지. 실패(코덱·tainted canvas·iOS·15초 타임아웃)·데이터 절약 모드는 조용히 넘어간다. `POST /api/renders/[id]/poster`: same-origin 403 → 세션 401 → `image/jpeg` 415 → 실제 도착 바이트 기준 300KB 413 → 남의 작업 404 → 미완성·이미지 409 → 이미 있으면 204 → 저장 201, 모든 응답 `private, no-store`. 서버는 `sharp`로 디코드(입력 픽셀 상한)·리사이즈·재인코딩, 메타데이터 없음 → 비공개 `renders` 버킷 `{id}/poster.jpg` + `poster_key`(먼저 온 프레임이 이긴다). 공유 OG 선택 `shareImageSource`: 이미지 결과 → 프레임 → 템플릿 포스터. 프레임은 기존 미디어 게이트웨이 `?poster=1`로, 같은 3일 토큰 범위에서만 읽힌다. 공유 페이지 영상의 `poster` 속성도 그 프레임. | `components/renders/frame-capture.ts`, `poster-capture.tsx`, `app/api/renders/[id]/poster/route.ts`, `lib/renders/poster.ts`, `app/api/renders/media/[id]/route.ts`, `app/(app)/r/[id]/[token]/page.tsx`, `app/(app)/renders/[id]/page.tsx` |
| 3 | 관련 템플릿 | `sm:grid-cols-2` 한 열 → 카탈로그와 같은 4:5 카드 `grid-cols-2`(모바일)·`lg:grid-cols-4`. 관련 목록은 4장이라 md 3열 단계는 두지 않았다(3+1 고아 방지). 마커 `data-related-grid`·`data-related-item`, 스윕에 추가 | `components/prompts/detail.tsx`, `scripts/sweep-anon.ts` |
| 4 | 자동재생 상한 | `card-arming`에 페이지 공용 풀. 화면 안(60% 이상) 카드 중 뷰포트 중앙에 가까운 **4개**만 무장, 나머지는 포스터. 스크롤로 중앙이 바뀌면 rAF 한 번에 재정렬(보이는 카드가 4개 이하면 계산 안 함). 재생 버튼을 누른 카드는 자리를 먼저 갖는다. 기존 25% 미만 회수·정지 유지·reduced-motion 그대로 | `lib/media/card-arming.ts`, `components/prompts/card-media.tsx` |

## 검증

| 단계 | 명령 | 결과 |
| --- | --- | --- |
| DB 스냅샷 | `npm run db:local` (0055 포함) | 통과 |
| 타입 | `npx tsc --noEmit` | 통과(마지막 수정 뒤 재실행) |
| 단위 | `npx vitest run` | **297 files / 2,882 tests 통과** |
| 빌드 | `NEXT_PUBLIC_APP_URL=http://localhost:3013 npm run build:local` | 통과(`/api/renders/[id]/poster` 포함) |
| 실행 | `PORT=3013 npm run start:local` | Ready |
| 스윕 | `SWEEP_BASE_URL=http://localhost:3013 npm run sweep:anon` | **SWEEP PASSED — 1078/1078** |

새 테스트: finishing_at이 복사 직전·running 상태로 기록되는지(이미지), 영상은 다운로드 전·다운로드 실패해도 한 번만(재시도 패스에서 시각 불변), 0055 없는 DB에서 패스 성공; 단계 매핑(running+finishingAt → finish, queued·failed는 무시)·대기 화면 3/3·분 대신 "곧"; 0055 컬럼 목록·키 형식·glue 없음; 포스터 저장(EXIF 제거·긴 변 1080·먼저 온 프레임 승리·남의 작업·미완성·이미지 결과·PNG/쓰레기 거부·0055 없음); 라우트 권한·바운디드(헤더와 실제 바이트 둘 다)·204/201·오류 전달; 결과 페이지가 캡처를 마운트하는 조건; OG 선택 규칙 3가지; 캡처 유틸(가짜 video·canvas: 크기 상한, 0.5초/절반 seek, 품질 단계, 코덱 오류·tainted·크기 0·정지 시 null, 업로드 실패 무시); 자동재생 6개 중 중앙 4개, 떠난 카드의 자리 넘김, 재생 누른 카드 고정, 언마운트 시 반환.

## 화면 증거 (`docs/qa/render-finish/`)

익명 화면은 운영 빌드(`start:local`, 3013), 로그인 화면은 `next dev` + dev identity(무료 픽스처) + QA 픽스처 DB(`scripts/render-finish-local-qa.ts`, 합성 행 2개)로 찍었다. 헤드리스 Chrome(CDP), 모바일 390×844·320×700(DPR 2, 터치), 데스크톱 1280×800. **모든 캡처 가로 넘침 0.** 로그인 화면 왼쪽 아래 "N"은 Next 개발 표시.

| 파일 | 확인한 것 |
| --- | --- |
| [01-wait-finish-390.png](01-wait-finish-390.png) | running + `finishing_at`: ✓사진 확인 · ✓만드는 중 · **3 마무리**(`aria-valuenow=3`), "영상이 나왔어요…", "곧 이 화면에 나타나요." |
| [02-wait-finish-desktop.png](02-wait-finish-desktop.png) | 1280px 같은 상태 |
| [10-result-video-390.png](10-result-video-390.png) | 결과 페이지. 이 방문에서 브라우저가 프레임을 캡처해 `POST /api/renders/{id}/poster 201`(dev 로그) → `.storage/renders/{id}/poster.jpg` 608×1080 JPEG 25KB, EXIF 없음 |
| [11-share-video-390.png](11-share-video-390.png) | 공유 링크: `og:image` = `/api/renders/media/{id}?s={token}&poster=1`, 영상 `poster`도 같은 프레임 |
| [12-share-video-desktop.png](12-share-video-desktop.png) | 1280px 공유 |
| [13-share-card-frame.png](13-share-card-frame.png) | 공유 카드 이미지 자체(토큰 범위 게이트웨이 응답). 픽스처 영상은 이미 공개된 `public/reel/brands/morphic-august-01.mp4`라 위아래 검은 띠가 있다 |
| [20-related-390.png](20-related-390.png) | 템플릿 페이지 "비슷한 템플릿" 2열(4장) |
| [21-related-320.png](21-related-320.png) | 320px 2열, 넘침 0 |
| [22-related-desktop.png](22-related-desktop.png) | 1280px 4열 |
| [30-autoplay-cap-desktop.png](30-autoplay-cap-desktop.png) | `/ko/video` 1280×1400: 화면 안 카드 10, 무장 2 — 아래 "한계" 참고 |

## 건너뛴 검사 · 한계

- **자동재생 상한은 브라우저에서 "5개 이상 중 4개"를 재현하지 못했다.** 로컬 픽스처 카탈로그에 예시 영상이 있는 카드가 2장뿐이라 화면 안 무장은 2였다(상한 아래). 상한 규칙은 단위 테스트(6개 중 중앙 4, 넘김, 고정, 반환)로만 확인. 운영 카탈로그(영상 카드 8장 이상) 데스크톱에서 `document.querySelectorAll('[data-armed="true"]').length ≤ 4` 확인 필요.
- **실기기 미확인**: iOS Safari에서 화면 밖 muted 비디오의 프레임 디코드와 Supabase 서명 URL의 CORS(`crossOrigin=anonymous` → 302 → storage). 실패하면 캡처가 조용히 빠지고 카드는 템플릿 포스터로 남는다(회귀 없음). 프리뷰/운영에서 영상 결과 한 번 열고 `render_jobs.poster_key`가 채워지는지 보면 된다.
- 프레임 캡처는 **소유자가 결과 페이지를 한 번 열어야** 생긴다. 메일 링크로 공유 링크만 바로 퍼뜨리면 그때까지 템플릿 포스터다.
- "마무리" 구간은 짧다(제공사 완료 → 다운로드 → 업로드, 보통 수 초). 폴링 6초/15초라 그 사이에 화면이 안 바뀔 수도 있다. 다운로드가 실패해 재시도로 넘어가면 그동안은 "마무리"로 보인다(제공사는 끝났으므로 사실).
- OG 크롤러는 게이트웨이의 302(10분 서명 URL)를 따라가야 한다 — 이미지 결과에서 이미 쓰던 방식과 같다. 카카오·슬랙 실제 미리보기는 확인하지 않았다.
- 프리뷰 URL: PR을 연 뒤 Vercel이 만든다(이 세션은 Vercel 대시보드를 보지 않았다).

## 남은 위험

- 0055 미적용 상태로 배포하면 기능 1·2가 꺼진 채로 동작한다(오류 없음). 적용 뒤에는 즉시 켜진다.
- 동시에 두 탭에서 결과 페이지를 열면 둘 다 캡처·업로드할 수 있다. 같은 키에 덮어쓰고 `poster_key`는 한 번만 기록된다(같은 영상의 같은 지점이라 결과 동일).
- 관련 템플릿의 가로(16:9) 카드는 한 칸을 그대로 쓴다(카탈로그와 같은 규칙) — 세로 카드와 같은 행에서 높이가 다르다.

## 다음 행동 제안

1. 0055 클라우드 적용(Director/대표).
2. 운영에서 영상 결과 1건으로 `poster_key` 생성과 카카오톡 미리보기 확인.
3. 데스크톱 `/ko/video`에서 무장 카드 수 ≤ 4 확인.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
