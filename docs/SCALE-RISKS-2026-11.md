# TWINGS 규모 확장 · 운영 안정성 위험 점검 보고서 (2026-11-11)

> 목적: `docs/HANDOFF-2026-11-11-GEMINI.md` §4-I에 따라 기능 확장 전 현재 코드(`main` `a0c04868`)와 운영 인프라(`nhokkikjkzjalxqsbzuk`, `twings-media-apac`, Vercel `yagi-prompts`)의 병목·장애·비용 폭주 지점을 실측 수치와 코드 위치로 정리한 점검 문서다.
> 이 묶음(I)에서는 운영 코드를 바꾸지 않고 위험 목록과 실행 순서만 확정한다.

---

## 1. 2026-11-11 운영 저장소 · DB 실측 요약 (읽기 전용 조회)

고객 개인정보와 비밀값 없이 메타데이터 합계만 읽기 전용 트랜잭션(`BEGIN READ ONLY` → `ROLLBACK`) 및 R2 `ListObjectsV2`로 측정했다.

| 구분 | 위치 | 객체 / 행 수 | 실측 용량 | 플랜 무료 한도 대비 |
| --- | --- | ---: | ---: | --- |
| Postgres DB (`pg_database_size`) | Supabase (`ap-northeast-2`) | 브랜드 조직 3개 | **27.6 MB** (`27,626,643 B`) | 500 MB 중 **5.5%** |
| Supabase Storage `content` (비공개·임시 스테이징) | Supabase Storage | 389개 (`content/` 119 · `brands/` 248 · `brand-seed/` 14 · `brand-studio/` 2 · `brand-rooms/` 6) | **756.0 MB** (`756,009,570 B`) | **아래 합산 시 한도 초과** |
| Supabase Storage `public-content` | Supabase Storage | 14개 | **361.5 MB** (`361,476,598 B`) | R2 이관 잔여분 |
| Supabase Storage `renders` | Supabase Storage | 12개 | **40.7 MB** (`40,661,671 B`) | 개인 렌더 입출력 |
| Supabase Storage 합계 | Supabase Storage 전체 | **415개 → 293개 (11-12 정리)** | **1,158.1 MB → 226.9 MB (`-931.3 MB`)** | Free 1 GB 한도의 **22.7%** (이관·중복 스테이징 정리 완료) |
| Cloudflare R2 `twings-media-apac` | Cloudflare R2 (`media.twings.app`) | 154개 (루트 공개 파일 127 · `st/` 스튜디오·룸 25 · `ig-master/` 2) | **815.6 MB** (`815,557,525 B`) | 무료 10 GB 중 **8.2%** |

---

## 2. 규모별 위험 목록 (심각도순)

| # | 항목 | 근거 파일 | 어느 규모에서 터지는지 | 심각도 | 대책 | 비용 |
| --- | --- | --- | --- | --- | --- | --- |
| **R-01** | **업로드 스테이징이 Supabase `content` 버킷을 거치며 완료 후 원본을 지우지 않음 (1 GB 한도 도달 + 50 MB 상한 충돌)** | `lib/storage/index.ts`<br>`lib/storage/public-media-direct.ts`<br>`lib/storage/r2-private.ts`<br>`lib/brand-studio/assets.ts`<br>`lib/brand-rooms/deliveries.ts` | **11-12 조치 전 1.158 GB 도달 → 11-12 검증 삭제(`-931.3 MB`)로 226.9 MB 복구 및 `releaseStaging` 자동 해제로 재발 차단 완료.** 남은 과제는 `twings-private-apac` 비공개 R2 버킷 연결로 50 MB 상한 해제. | **치명 (P0) · 1차 해소** | 1) `StorageDriver.releaseStaging` 적용 완료(게시·스튜디오·룸 이관 직후 스테이징 즉시 해제).<br>2) `lib/storage/r2-private.ts` 구현 완료(`R2_PRIVATE_BUCKET` 설정 시 S3 Presigned PUT 직접 업로드 전환).<br>3) 검증 완료된 중복·유령 스테이징 122개(`931.3 MB`) 정리 완료. | R2 무료 구간 내 (\$0) · 초과 시 \$0.015/GB-월 (전송료 \$0) |
| **R-02** | **Vercel 플랜 문서 오기 정정 완료 (실제 Vercel Pro + 서울 `icn1` 운영 확인)** | `AGENTS.md §0`<br>`vercel.json:1-16` | **해소됨 (2026-11-12 확인).** `yagi-workshops-projects` 팀이 이미 **Vercel Pro** 플랜이며 `vercel.json`에 `"regions": ["icn1"]`(서울)과 `maxDuration = 300`이 적용되어 있음이 확인되었다. | **해소 완료** | `AGENTS.md` §0 및 본 보고서의 구형 Hobby 표기를 **Vercel Pro**로 현행화 완료. | 이미 구독 중 (추가 비용 \$0) |
| **R-03** | **프롬프트 보정(`prompt.enhance`)·영상 분석(`film.analyze`)의 무제한·무과금 Gemini 호출** | `lib/brand-studio/jobs.ts:132-192`<br>`app/api/brand-studio/route.ts` | **악성 스크립트 또는 오작동 탭 1개.** 두 동작 모두 `reserveAllowance`(`monthly_cap_krw`) 검사와 사용자·조직별 속도 제한, 동시 실행 제한이 없다. 크레딧 한도가 0인 조직 계정으로도 50 MB 영상 Gemini 업로드·프롬프트 보정을 무한 반복해 `GEMINI_API_KEY` 비용을 무제한 소진할 수 있다. | **높음 (P1)** | 1) 조직·사용자별 분당 호출 상한(예: 보정 20회/분, 영상 분석 4회/분)을 DB 또는 Upstash/메모리 버킷으로 적용.<br>2) 월 한도(`monthly_cap_krw <= 0`) 닫힌 조직은 미리보기 보정·분석도 차단.<br>3) 일일 전체 AI API 지출 서킷 브레이커 도입. | 코드 수정만 (\$0) |
| **R-04** | **시안·첨부 완료 시 서버 함수가 파일 전체를 RAM에 3중 적재 (200 MB 시 OOM)** | `lib/brand-rooms/deliveries.ts:98-139`<br>`lib/storage/r2-public.ts:28-39`<br>`lib/brand-studio/finish.ts:23-38`<br>`app/api/brand-rooms/messages/route.ts`<br>`app/api/brand-rooms/storyboards/route.ts` | **150~200 MB 시안 영상 단 2건 동시 업로드.** `staging.read()`(`arrayBuffer` + `Uint8Array`) → `Buffer.from(bytes)` 복사로 파일 크기의 3~4배(600~800 MB) RAM을 점유해 1,024 MB 서버리스 함수가 OOM 종료된다. `messages`·`storyboards` 라우트에는 `maxDuration` 선언도 없고, `assets.ts:114-166`은 네트워크 I/O 동안 DB `FOR UPDATE` 잠금을 쥐고 있다. | **높음 (P1)** | 1) 브라우저 → R2 직접 Presigned PUT 후 서버는 `HEAD`로 크기·타입만 검증(바이트 무복사).<br>2) 썸네일 추출 전 DB 트랜잭션 분리(I/O 중 행 잠금 금지).<br>3) 업로드 완료 라우트에 `maxDuration = 60` 명시. | 코드 수정만 (\$0) |
| **R-05** | **룸·레일 다중 폴링과 요청당 인증·DB 왕복 증폭** | `components/brand-rooms/chat/use-feed.ts:185-209` (`4s` / 백그라운드 `20s`)<br>`components/brand-rooms/chat/inbox.tsx:22, 106` (`20s` 중복)<br>`components/brand-workspace/rail-activity.tsx:32, 182` (`20s`, `30s`)<br>`lib/auth/viewer.ts:48-69`<br>`lib/brand-rooms/messages.ts:648, 654` | **동시 접속 30~50탭.** 활성 룸 탭 1개가 분당 20~35회(스레드 열면 `useFeed` 2중 마운트, 숨긴 탭도 분당 3회 계속 폴링) 호출한다. 요청마다 `getViewer()`가 Supabase HTTP 3회(`getUser` + `profiles` + `subscriptions`)를 부르고 DB 트랜잭션을 2번 열어, **50탭 기준 분당 서버 함수 1,000회 · DB 트랜잭션 2,000회 · Supabase Auth/REST 3,000회**가 발생하며 `PG_POOL_MAX=2` 기준 연결 풀(~60개)을 고갈시킨다. | **높음 (P1)** | 1) 숨긴 탭(`document.hidden`)은 폴링 완전 일시정지 후 복귀 시 즉시 1회 동기화.<br>2) 레일과 인박스의 `/api/brand-rooms/summary` 폴링을 단일 공유 컨텍스트로 합침.<br>3) `loadRoomMessages`의 2중 트랜잭션을 1회로 합치고 `DATABASE_URL`이 Supavisor 트랜잭션 풀러(`:6543`)를 쓰는지 고정 확인.<br>4) 묶음 E에서 알림함 통합 시 SSE/Realtime 전환 검토. | 코드 수정만 (\$0) |
| **R-06** | **생성 작업 워커(`TWINGS-Studio-Lane`) 단일 PC 의존 및 슬롯 동시성 초과** | `scripts/brand-studio-lane-worker.mjs:45, 237-249`<br>`lib/brand-studio/lanes.ts:16, 196, 218-228`<br>`lib/brand-studio/job-store.ts:78`<br>`lib/brand-studio/engine.ts:265, 274` | **동시 생성 작업 6건 이상 또는 워크스테이션 재부팅·절전 1회.** 1) 워커 한도(`STUDIO_LANE_MAX = 8`)가 결과 슬롯이 아닌 **작업 수**를 세어 `8작업 × 4장 = 32개` 동시 프로세스를 띄우므로 Sunra 계정 상한(20개)을 즉시 넘긴다. 2) 워커가 작업을 `running`으로 잡은 뒤 죽으면 `claimJobs`가 건너뛰어 **최대 24시간 멈춤** 상태가 된다. 3) 일일 크론이 하루 5건(`limit: 5`)만 수거한다. | **높음 (P1)** | 1) 워커 동시성 세마포어를 작업 수가 아닌 **출력 슬롯 단위(예: 최대 12슬롯, 내부 여유 8슬롯 보존)**로 변경.<br>2) `running` 상태에서도 워커 하트비트가 3분 이상 끊기면 `queued` 재할당 또는 API 경로 자동 우회.<br>3) Sunra OAuth 리프레시 토큰 서버 보관 또는 API 키 잔액 충전으로 단일 PC 의존 해소. | 코드 수정 (\$0) + 선택형 API 예치금 |
| **R-07** | **스튜디오 동일 출처 미디어 게이트웨이가 캐시 없이 원본 전체를 서버 RAM으로 중계** | `app/api/brand-studio/media/[...key]/route.ts:13, 25, 30`<br>`lib/brand-studio/http.ts:5-10`<br>`lib/storage/r2-public.ts:49-60` | **편집기 동시 사용 20명 이상 또는 고해상도(20 MB) 이미지 반복 열람.** 해시 주소(`st/<sha256>.png`)라 내용이 절대 바뀌지 않는데도 `Cache-Control: private, no-store`로 내려보내 열 때마다 R2 → Vercel 함수 RAM 전체 적재 → 브라우저 전송을 반복한다(`HEAD` 요청도 전체 파일을 읽음). Vercel 대역폭(100 GB)과 함수 실행 시간을 소모한다. | **중간 (P2)** | 1) Cloudflare R2 `media.twings.app`에 `brand.twings.app`·`twings.app` 출처 `Access-Control-Allow-Origin` CORS 헤더를 설정해 브라우저 Canvas가 R2에서 직접 읽게 함.<br>2) 게이트웨이 유지 구간에도 `private, max-age=31536000, immutable` 적용 및 `HEAD` 요청 시 바이트 다운로드 생략. | \$0 (Cloudflare R2 CORS 설정) |
| **R-08** | **목록 페이지네이션 부재, 상관 서브쿼리 반복, 인덱스 우회** | `lib/brand-studio/repo.ts:101-127, 183-193`<br>`lib/brand-rooms/messages.ts:173-174, 1043-1069`<br>`lib/brand-rooms/storyboards.ts:278-281, 732`<br>`lib/brand-studio/review.ts:217-219, 362-376, 597` | **조직당 작업 60건 초과 / 룸 메시지 수천 건 / 시안 댓글 수백 건.** 1) `jobsOf`가 `LIMIT 60` 고정(커서 없음)이라 이미지 60번 생성하면 이전 비디오 작업이 목록에서 영구히 밀려 안 보인다. 2) `storyboards.ts:278`이 `ref->>'kind'`로 조회해 `idx_brand_room_messages_ref`(`ref_key`) 인덱스를 타지 못한다. 3) `keyStillUsed`의 `OR thumb_key = $1`에 `thumb_key` 인덱스가 없다. 4) 4초 폴링마다 행별 상관 서브쿼리 2~5개가 돈다. | **중간 (P2)** | 1) `jobsOf`에 `kind`(이미지/비디오 분리) 필터 + `created_at` 커서 페이지네이션 추가.<br>2) `storyboards.ts` 스레드 집계를 `ref_key LIKE 'storyboard:' \|\| $2 \|\| ':%'`로 고쳐 기존 인덱스 활용.<br>3) `brand_studio_assets(thumb_key)`·`brand_studio_outputs(thumb_key)` 부분 인덱스 추가.<br>4) 시안 댓글 조회 상한(예: 500건) 지정. | 코드 + 인덱스 마이그레이션 (\$0) |
| **R-09** | **공개 공유 링크(`/s/[token]`) 암호 잠금 악용(Lockout DoS) 및 봇 조회수 쓰기 증폭** | `lib/brand-rooms/shares.ts:392-423, 463-493`<br>`app/api/brand-rooms/shares/public/route.ts:25-36`<br>`supabase/migrations/0084_core_brand_room_reviews_shares.sql:64` | **암호 걸린 공유 링크 URL이 메신저 미리보기 봇이나 외부인에게 노출될 때.** 1) 누구든 10분 안에 틀린 암호 8번을 보내면 링크 자체가 잠겨 실제 고객사 담당자가 못 연다(속도 제한도 서버리스 인스턴스별 `Map`이라 분산 우회 가능). 2) 쿠키 없는 메신저 미리보기 봇 요청마다 방문 기록 `INSERT` + `views + 1` 행 잠금 + 인덱스 못 타는 `DELETE ... WHERE hour < ...`가 실행된다. | **중간 (P2)** | 1) 실패 횟수를 공유 링크 전체가 아닌 **(공유 ID + 요청 IP 해시)** 단위로 잠그고, 링크 전체 잠금은 제거.<br>2) `HEAD` 및 주요 메신저·크롤러 `User-Agent`(Slackbot, kakaotalk-scrap 등)는 조회수 `INSERT/UPDATE` 생략.<br>3) `brand_room_share_visits(share_id, hour)` 인덱스 추가 후 정리는 일일 배치로 이동. | 코드 + 인덱스 (\$0) |
| **R-10** | **오류 추적·운영 알림·DB 자동 백업·PR CI 공백** | `package.json:50-84`<br>`.github/workflows/ci.yml:6` | **운영 장애·실수 1회 발생 시.** 1) Vercel Hobby 로그는 1시간 뒤 사라지며 Sentry·슬랙 장애 알림이 없어 워커 정지·결제 웹훅 오류·Sunra 잔액 소진을 고객 문의 전까지 모른다. 2) Supabase Free에는 자동 백업·시점 복구(PITR)가 없다. 3) GitHub Actions 무료 시간(2,000분) 소진으로 PR 자동 검사가 꺼져 있다. | **높음 (P1)** | 1) 치명 오류(`closeLane`, 웹훅 5xx, 워커 5분 무응답) 발생 시 내부 운영 채널 알림 웹훅 발송(5분 중복 억제).<br>2) 워크스테이션 예약 작업으로 매일 새벽 암호화된 `pg_dump` 읽기 전용 백업 보관(30일 순환) 또는 Supabase Pro 전환.<br>3) CI 재개 시 `typecheck`/`security:client` 4중 중복 실행 제거해 분 소모 40% 절감. | 로컬 백업 스크립트 \$0 · Supabase Pro 선택 시 월 \$25 |

---

## 3. 권장 조치 순서와 대표 의사결정 필요 자원

1. **즉시 요청할 유료 인프라 (대표 승인·결제 필요)**
   - **Vercel Pro (월 \$20)**: 상업 서비스 약관 준수(`twings.app` 토스 라이브 결제 및 B2B 구독 운영), 서울 리전(`icn1`) 고정, 함수/대역폭 여유 확보, 분 단위 크론 활성화.
   - **Cloudflare R2 유료 카드 연결 확인 (월 예상 \$1~5 수준)**: 스튜디오·룸·시안 업로드를 R2 직접 업로드로 일원화하고 `media.twings.app` CORS를 열어 게이트웨이 병목을 없애기 위해 필요.
   - **Supabase Pro (월 \$25, 선택 — 당장은 로컬 일일 암호화 `pg_dump` + R2 직접 업로드 전환으로 Free 유지 가능)**: 일일 자동 백업과 Egress 여유(250 GB), 파일 객체 50 GB 상한이 필요할 때 전환.
2. **후속 묶음에 자연스럽게 포함할 코드 조치**
   - **묶음 E (프로젝트·시안 리뷰 개편)**: 시안·첨부 R2 직접 업로드(R-01, R-04), 룸 폴링 통합·숨김 탭 일시정지(R-05), 공유 링크 IP별 잠금(R-09).
   - **묶음 C (비디오 스튜디오 개편)**: 보정·분석 호출 속도 제한(R-03), `jobsOf` 이미지/비디오 분리 및 커서 페이지네이션(R-08), 워커 슬롯 세마포어(R-06).
   - **묶음 F (조직별 저장 한도)**: R2/Supabase 사용량 정합 집계, 삭제 파일 실물 정리, 대표 승인 후 `content` 버킷 내 스테이징 잔여분 회수(R-01).
