# 둘러보기 · 기다림 · 결과 · 공유 카드 (catalog-wait, 2026-10-23)

요구사항 원본: `docs/PLATFORM-2.0.md` §3.2-4·5, §15.2 표, §15.3-4·5·6, §15.5-15(대표 결정: 세로 템플릿 카드 4:5 두 열). `docs/TEMPLATES-IA.md` §12 "공유 카드".

## 무엇이 바뀌었나

| 영역 | 이전 | 지금 | 파일 |
| --- | --- | --- | --- |
| 카드 프레임 | 모든 카드 16:9, 세로 결과물은 검은 레터박스 | 세로(정사각 포함)는 4:5(object-cover), 가로(폭/높이 ≥ 1.2)만 16:9. 판정 순서: 예시 미디어 실측 → `aspect_default` → 매체 기본(영상 9:16·이미지 4:5) | `components/prompts/card-frame.ts`, `prompt-card.tsx` |
| 카드 정보 | 크레딧("YAGI 제작") · 엔진 칩(SEEDANCE 2.5) · 제목 · 용도 · "자세히 보기" | 제목 + 길이 칩(15초) + 비율 칩(9:16) + "신규". 작가 포맷(`source ≠ yagi` 또는 `author_handle`)만 "작가 @handle". 카드 전체가 링크 하나(stretched link), 보조 CTA 없음 | `prompt-card.tsx` |
| 카드 재생 | 마우스는 호버, 터치는 뷰포트 | 모든 기기에서 뷰포트 60% 진입 시 음소거 자동재생, 25% 미만이면 디코더 회수(기존 `card-arming`). 보이는 재생/정지 버튼(44px, 링크 위 z-10). 정지하면 다시 스크롤해 와도 정지 유지. `prefers-reduced-motion`이면 자동재생 없음, 버튼으로만 재생 | `card-media.tsx` |
| 그리드 | 1열 → sm 2열 → lg 3열 | 모바일 2열 · md 3열 · lg 4열, `items-start`. 가로 카드는 한 칸(dense 배치 없음: 키보드 순서와 화면 순서를 같게) | `rails.tsx` |
| 레일 순서 | featured → newest | "신규" 배지 카드 먼저(안정 분할), 나머지는 기존 순서 | `card-frame.ts` `railOrder` |
| 카탈로그 첫 화면 | 제목 → GEO 정의문 → 사각 탭 → 칩 | 제목 → 매체 pill → 용도 pill(용도가 2개 이상일 때만) + "N개 템플릿" → 카드. 정의문은 그리드 아래(HTML 유지) | `components/templates/listing.tsx`, `filter-chips.tsx`, `pill.ts` |
| 대기 | "만드는 중입니다" + 깜빡이는 바 | 단계 셋(사진 확인 → 만드는 중 → 마무리), `progressbar` 1/3·2/3, "보통 N분쯤 걸려요"(실측 중앙값), 알림 선택(그대로), "기다리는 동안 다른 포맷 보기" 카드 4장 | `components/renders/render-stages.tsx`, `stage.ts`, `wait-browse.tsx`, `lib/renders/eta.ts` |
| 폴링 | 6초 고정 | 탭이 보일 때만 6초, 작업 생성 2분 뒤부터 15초, 숨겨지면 멈추고 돌아오면 즉시 한 번 | `components/renders/refresh-schedule.ts`, `auto-refresh.tsx` |
| 실패 | 이유 + 환불 문장(작은 회색 mono) | 이유 본문 + 환불 문장(본문 크기·전체 잉크·파란 좌측선 `data-render-refund`) | `app/(app)/renders/[id]/page.tsx` |
| 결과 | 제목 → 결과물 → 다운로드/다시 만들기 → 공유 링크 텍스트 | 결과물 먼저(세로 영상은 화면 높이에 맞춤) → 다운로드 · 공유 · 같은 얼굴로 하나 더(`/{locale}/video`) → 제목 → 별점·문제 알리기. 데스크톱은 결과물 옆에 동작 | 같은 파일, `share-result.tsx`, `result-media.tsx` |
| 공유 링크 | 제목만, noindex | OG/Twitter 카드: 제목 "내 얼굴로 만든 {템플릿}", 이미지 결과는 결과물 자체, 영상은 템플릿 포스터. noindex 유지. 하단 "나도 만들기" → 템플릿 페이지 | `app/(app)/r/[id]/[token]/page.tsx` |

## 서비스가 구분하지 않는 것 (정직하게 남긴 것)

- **"마무리" 단계는 지금 화면에 현재 단계로 나오지 않는다.** 제공사 완료 → 결과 복사 → `markRenderSucceeded`가 한 패스 안에서 끝나 DB에 중간 상태가 없다. 그래서 `running`은 끝날 때까지 "만드는 중", `succeeded`가 되면 단계 대신 결과물이 나온다. 마무리를 보여주려면 렌더 서비스에 상태(`finishing`)나 타임스탬프가 필요하다(엔진·서비스는 이번 범위 밖).
- **영상 공유 카드의 이미지는 템플릿 포스터다.** 결과 프레임 추출에는 서버 ffmpeg가 필요해 이번에 하지 않았다.
- 대기 예상 시간 표본: 같은 엔진 + 같은 템플릿 길이(`prompt_items.runtime_seconds`)의 최근 성공 50건, `finished_at - created_at` 중앙값. 10건 미만이면 이미지 2분 · 영상 5분. 해상도(720p/1080p)는 아직 구분하지 않는다.

## 화면 증거

카탈로그 화면은 운영 빌드(`build:local` → `start:local`, 3012), 대기·결과·공유는 로그인 화면이 필요해 `next dev` + dev identity(무료 픽스처 계정, 3013)로 찍었다. 대기·결과 캡처 왼쪽 아래 "N"은 Next 개발 모드 표시다. 결과물 자리는 로컬 픽스처라 4:3 영상(`public/reel/brands/city-fashion.mp4`)을 9:16 작업에 넣었다 — 그래서 검은 띠가 보인다. 실제 9:16 결과물은 프레임을 꽉 채운다. 카탈로그 픽스처 포스터는 회색 격자 PNG다.

캡처는 헤드리스 Chrome(CDP)으로, 모바일은 390×844·320×700(DPR 2, 터치), 데스크톱은 1280×800. 모든 캡처에서 가로 넘침 0(`scrollWidth - innerWidth`).

| # | 파일 | 확인한 것 |
| --- | --- | --- |
| 1 | [01-catalog-video-390.png](01-catalog-video-390.png) | `/ko/video` 첫 화면: 제목 → 매체 pill → 용도 pill → "10개 템플릿" → 2열 카드. 정의문 없음(그리드 아래로). 카드: 신규 배지 · 길이 칩(15초/30초) · 비율 칩 · 제목, 엔진·크레딧·"자세히 보기" 없음, 영상 카드에 재생 버튼 |
| 2 | [02-catalog-video-390-full.png](02-catalog-video-390-full.png) | 전체 페이지: 세로 픽스처는 4:5, 가로 픽스처(1280×720 등)는 16:9 한 칸. 커뮤니티 픽스처만 "작가 @hana"·"작가 @jun". 그리드 아래 정의문 |
| 3 | [03-catalog-video-320.png](03-catalog-video-320.png) | 320px: 2열 유지, 가로 넘침 0, 칩 행은 가로 스크롤 |
| 4 | [04-catalog-video-desktop.png](04-catalog-video-desktop.png) | 1280px: 4열, pill 두 줄이 같은 선택 스타일 |
| 5 | [05-catalog-video-desktop-full.png](05-catalog-video-desktop-full.png) | 1280px 전체 |
| 6 | [06-catalog-image-390.png](06-catalog-image-390.png) | `/ko/image`: 이미지 템플릿 4:5, 길이 칩 없음, 비율 칩 4:5 |
| 7 | [07-home-gallery-390-full.png](07-home-gallery-390-full.png) | 홈 갤러리 레일도 같은 2열 카드(홈 page.tsx는 건드리지 않음, 히어로는 다른 세션) |
| 8 | [08-catalog-video-en-390.png](08-catalog-video-en-390.png) | 영어: "15s" · "by @handle" · "Creator format" |
| 9 | [09-catalog-reduced-motion-390.png](09-catalog-reduced-motion-390.png) | `prefers-reduced-motion: reduce`: 무장(armed) 카드 0개, 재생 버튼은 남음("영상 재생") |
| 10 | [10-wait-make-390.png](10-wait-make-390.png) | 대기(running): "만들고 있어요" · ✓사진 확인 → **2 만드는 중** → 3 마무리 · "보통 4분쯤 걸려요"(픽스처 이력 12건 실측) · 알림 선택(기존) · "기다리는 동안 다른 포맷 보기" 4장(만드는 템플릿 제외) |
| 11 | [11-wait-make-320.png](11-wait-make-320.png) | 320px 대기 |
| 12 | [12-wait-make-desktop.png](12-wait-make-desktop.png) | 1280px 대기, 다른 포맷 4열 |
| 13 | [13-wait-check-390.png](13-wait-check-390.png) | 대기(queued): **1 사진 확인** 현재 단계 |
| 14 | [14-failed-390.png](14-failed-390.png) | 실패: 이유(본문) + 환불 문장(본문 크기, 파란 좌측선) + 다시 만들기 + 문제 알리기 |
| 15 | [20-result-video-390.png](20-result-video-390.png) | 결과 영상 첫 화면: 결과물 → 다운로드 · 공유 · 같은 얼굴로 하나 더(한 줄, 첫 화면 안) |
| 16 | [22-result-video-320.png](22-result-video-320.png) | 320px: 세 번째 동작이 남은 폭을 쓰고 줄바꿈, 넘침 0 |
| 17 | [23-result-video-desktop.png](23-result-video-desktop.png) | 1280px: 결과물 옆 아래에 동작·제목·공유 기간 |
| 18 | [24-result-image-390.png](24-result-image-390.png) | 결과 이미지 4:5 |
| 19 | [30-share-video-390.png](30-share-video-390.png) | 공유 링크(영상): 결과물 → "내 얼굴로 만든 네온 골목 달리" → 다운로드 → 하단 "나도 만들기" → `/ko/t/neon-alley-dolly`. `og:image` = 템플릿 포스터 |
| 20 | [31-share-image-390.png](31-share-image-390.png) | 공유 링크(이미지): `og:image` = 결과물(`/api/renders/media/{id}?s=…`) |
| 21 | [32-share-video-desktop.png](32-share-video-desktop.png) | 1280px 공유: 결과물 옆에 제목과 "나도 만들기" |

### 카드 재생 실측 (헤드리스 Chrome, 운영 빌드 `/ko/video`, 390px 터치)

픽스처 영상은 재생 가능한 파일이 아니라서 첫 카드의 소스를 실제 영상(`/reel/brands/city-fashion.mp4`)으로 바꿔 확인했다.

| 단계 | 결과 |
| --- | --- |
| 로드 | 화면 안의 영상 카드 2장만 무장(`data-armed="true"`), `<video>` 2개 |
| 실제 영상 | `paused: false`, `readyState 4`, 버튼 `영상 멈추기`, 44×44, 버튼 중심의 최상위 요소가 버튼(링크 오버레이에 가리지 않음) |
| 정지 누름 | `<video>` 언마운트(디코더 반납), 포스터로 돌아감, 버튼 `영상 재생` |
| 아래로 갔다가 돌아옴 | 정지한 카드는 정지 유지, 옆 카드는 다시 무장 |
| 재생 누름 | 다시 무장, `<video>` 1개 |
| 맨 아래 카드 | 화면 밖이면 무장 해제 |

폴링(6초 → 2분 뒤 15초, 숨김 중 정지, 돌아오면 즉시 1회)은 `tests/renders/wait-result.test.tsx`가 가짜 타이머로 검증한다. 내장 브라우저 패널이 숨겨진 상태에서는 IntersectionObserver가 돌지 않아 카드가 무장되지 않는다 — 실제 보이는 탭과 헤드리스 Chrome에서는 정상이다.

## 로컬 QA 재현

`.pglite/`(gitignore) 아래 일회용 스크립트로 했다 — 저장소에는 넣지 않았다.

1. `npm run db:local` 스냅샷에 무료 픽스처 계정의 렌더 작업(대기 `queued`는 created_at을 30분 뒤로 둬 페이지의 stranded 패스가 집지 않게, 만드는 중 `running`은 `provider_task_id` null로 둬 제공사 폴링이 실패 처리하지 않게, 성공 영상·이미지, 실패, ETA용 성공 이력 12건)을 넣고 스냅샷을 다시 쓴다. 결과 키는 게이트웨이 규칙대로 `<작업 uuid>/result.mp4`.
2. `PLAYBOOK_DEV_IDENTITY=<무료 픽스처 id> npx tsx scripts/run-local.ts dev -p 3013`
3. 끝나면 `npm run db:local`로 스냅샷을 되돌린다(스윕 전에 반드시).
