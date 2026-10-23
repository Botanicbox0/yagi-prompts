## B2-a — SNS 연결 신청 · 관리자 확인 · 로컬 AI 보조 · 캠페인 탭 가시성

설계 원본: `docs/PLATFORM-2.0.md` §17.1·17.2·17.4 (PR #88), 대표 결정 2026-10-23(수동 확인으로 시작, 연결 계정 중 하나라도 3,000+, 일반 사용자에게도 캠페인 탭 노출 + 티저).

- 기능 커밋: `23a09ee878ce018cb5228f15e1aa59ded5007d3d` (브랜치 `claude/influencer-identity-3221e7`, base `main@c3260e9`)
- `git diff --stat main...HEAD`: 67 files, +2,955 / −7 (코드·테스트·마이그레이션 53 files +2,876 / −7, 나머지는 `docs/qa/influencer-identity/` 캡처와 기록)
- 전부 `TWINGS_INFLUENCERS`(기본 **off**) 뒤에 있다. off면 운영 화면은 지금과 같다.

### 무엇이 바뀌나

| 영역 | 내용 |
| --- | --- |
| 데이터 | `0057_core_social_accounts.sql` / `0141_glue_social_accounts.sql`: `social_accounts`(unique(user_id, platform), 상태 submitted·verified·rejected·expired, source manual·api, `ai_*` 제안 칸, 워커 리스 칸, `recheck_at`, `pool_consent_at`), `social_account_writes`(하루 5회 장부), `social_verify_workers`(하트비트), `profiles.influencer_since`. glue는 0131 형태(RLS enable+force, browser 역할 revoke, service_role만). |
| 판정 | `lib/influencers/rules.ts` `isInfluencer(sql, userId)` = verified 계정 중 `follower_count >= INFLUENCER_MIN_FOLLOWERS(3000)`. 합산 아님, AI 값·사용자 입력 무시, 저장된 `expired` 제외. 확인 후 90일이 지나면 화면엔 "만료 · 다시 제출" 안내, 자격은 유지(§17.1). 재제출은 `recheck_at`만 찍고 `verified` 유지(핸들이 바뀌면 새 신청). |
| 신청 | `/identity/social`(390px 한 손, 한 열): 플랫폼 · 프로필 링크/@핸들(플랫폼 호스트만, 파싱만) · 팔로워 수(선택) · 캡처 1장(JPEG/PNG ≤5MB → sharp 재인코딩 JPEG, 메타 제거, 긴 변 1600px, 비공개 `renders` 버킷 `social/{id}/evidence.jpg`) · 풀 노출 동의(선택). `GET/POST/PATCH/DELETE /api/identity/social`(플래그 → same-origin → 세션 순, 바운디드, 하루 5회, 전부 `private, no-store`). 해제는 반려가 아니라 행+캡처 삭제. `/account` "SNS 연결" 카드. |
| 관리자 | `/admin/community#social` "SNS 확인" 큐: 캡처(관리자 전용 라우트) · 링크 · 사용자 입력 · AI 제안(수치·신뢰도·모델·핸들 일치 여부)을 나란히. `social.verify`(숫자 **직접 입력** 필수, measured_at=now, source=manual, `influencer_since` 최초 1회) · `social.reject`(사유 필수, 사용자에게 보임). 0051 표가 없어도 큐는 뜬다. `/admin` 홈에 대기 건수 한 줄. |
| 로컬 AI | `/api/social-verify-worker/{claim,complete,heartbeat,evidence}`(새 비밀키 `SOCIAL_VERIFY_WORKER_SECRET`, 위험 워커와 같은 방식) + `scripts/social-verify-worker.ts`. gpu-arbiter `127.0.0.1:11434`만(루프백 아님·11444 거부), `SOCIAL_VERIFY_MODEL` 또는 설치된 qwen→gemma vision 모델 자동 선택, 없으면 "no vision model"로 멈춤. 결과는 `ai_*`에만, 3회 실패 뒤 `ai_note='failed:<code>'`, 신청 상태는 `submitted` 그대로. 워커 없이도 신청·확인은 동작. |
| 가시성 | `lib/influencers/visibility.ts`: public 모두 · influencers 인플루언서 또는 `campaign_targets` 대상 · invited 대상만(초대 링크 토큰도 초대 증거). 로그인 목록 `/campaigns/open`(뷰어별·무캐시, `APP_PREFIXES` 패턴·robots·스윕 등록): 인플루언서는 "인플루언서 캠페인" 섹션이 위, 아니면 티저 "인스타그램·틱톡을 연결하면 더 많은 캠페인이 열려요". `loadApplyState`(invited 비대상 → 404, influencers 비자격 → 폼 대신 연결 안내) · `applyToCampaign` · `acceptInvitation`이 `influencer_required`로 서버에서 거절. 이미 지원한 사람은 자기 지원서를 계속 본다. 공개 `/{locale}/campaigns`는 손대지 않음(B1 필터). |
| 안전 | 캡처는 소유자·관리자·리스를 가진 워커(서명 URL 10분 또는 리스 확인 경로)만. 자격 판정에 캡처·AI 값을 자동으로 쓰지 않는다. 로그·워커 출력에 핸들·캡처·비밀값 없음. |

### 검증 (최종 코드 기준)

| 명령 | 결과 |
| --- | --- |
| `npm run db:local` | OK |
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | **302 files / 2,919 tests passed** (새 테스트: `tests/influencers/{social-schema,service,worker,visibility}.test.ts`, `tests/routes/identity-social.test.ts`, `collaboration.test.ts` 초대 수락 케이스) |
| `NEXT_PUBLIC_APP_URL=http://localhost:3015 npm run build:local` | OK (`/identity/social`, `/campaigns/open`, API 라우트 ƒ) |
| `NEXT_PUBLIC_APP_URL=http://localhost:3015 PORT=3015 npm run start:local` + `SWEEP_BASE_URL=http://localhost:3015 npm run sweep:anon` | **SWEEP PASSED — 1096/1096** (새 18개: SNS 페이지·상태·캡처·관리자 캡처·워커 4종·`/campaigns/open`) |
| 로컬 AI 실제 실행 | `qwen3.8:27b-bf16`(gpu-arbiter 경유)로 가짜 캡처 2건 판독, 2분 11초. `3,050 · 1.00 · 핸들 일치`, "3.2K subscribers" → `3,200 · 1.00 · 핸들 일치`. 상세는 `docs/qa/influencer-identity/README.md` |
| 브라우저(로컬 dev, `TWINGS_INFLUENCERS=on`) | 390px·1280px: 제출 → 확인 중, 반려 사유, 확인됨, 계정 카드, 티저, 인플루언서 섹션, 관리자 큐에서 4,215 직접 입력 → verified, 지원 화면 `influencer_required` 안내 |

테스트 순서는 정직하게 적는다: 이번 슬라이스는 구현을 먼저 쓰고 테스트를 붙였다(실패→구현 순서 아님). 테스트를 처음 돌렸을 때 실제 결함 3개(파라미터 타입 추론, sharp 오류 코드, `verified` 배너 문구)를 잡아 고쳤다.

### 캡처

`docs/qa/influencer-identity/` — `01`~`12` (390px 신청·상태·폼·계정 카드·티저·인플루언서 목록·지원 거절, 1280px 상태·티저·관리자 큐·관리자 홈). 모든 캡처의 계정은 그려 낸 가짜(`*.local`).

### 클라우드 적용

0056/0140(#89)과 0057/0141 모두 **운영 적용 완료**(2026-10-23, `supabase/README.md` 원장에 행 추가, 다음 번호 core 0058 · glue 0142). 0057 리더는 여전히 `to_regclass`로 확인하므로 표가 없는 환경에서도 500 대신 "unavailable".

### 환경변수 (`.env.example`에 이름만)

- `TWINGS_INFLUENCERS` — 기본 off. 켜기 전에 0057/0141(+0056/0140) 적용.
- `SOCIAL_VERIFY_WORKER_SECRET` — Vercel과 워크스테이션 양쪽, 32자 이상. 없으면 워커 라우트 404.
- 워크스테이션 전용: `SOCIAL_VERIFY_API_ORIGIN`, `SOCIAL_VERIFY_WORKER_ID`, `OLLAMA_URL`(기본 `http://127.0.0.1:11434`), `SOCIAL_VERIFY_MODEL`(선택).

### main(B1 #89) 병합 뒤 재검증

- `origin/main@234c155`을 병합(텍스트 충돌 없음). `collaboration/service.ts`·`messages/*`·`sweep-anon.ts`·`migrations.test.ts`는 양쪽 변경이 모두 남은 것을 확인.
- 0056이 main에 있으므로 가시성 규칙은 `campaigns.audience`·`campaign_targets`를 그대로 읽는다(`to_jsonb`/`to_regclass` 우회 제거). 테스트·로컬 QA 픽스처의 0056 대역 DDL도 제거.
- 재검증: `npm ci` → `db:local` OK → `tsc` 0 → `vitest` **309 files / 2,972 tests passed** → `build:local` OK → `start:local` 3015 + `sweep:anon` **SWEEP PASSED — 1104/1104**.

### 건너뛴 검사 · 남은 위험 · 대표 결정 대기

- 프리뷰 URL 스크린샷은 없음(로컬 dev 캡처로 대신). 플래그 off라 프리뷰에서도 화면은 "준비 중"이다.
- 이번 PR에서 `expired` 상태를 자동으로 쓰는 재측정 작업은 없다(90일은 표시만). 재측정 주기·자동화는 §17.3/B2-b 이후.
- 비공개(`influencers`/`invited`) 캠페인의 **공개 상세 페이지** `/{locale}/campaigns/{slug}`는 슬러그로 여전히 열린다(지원은 서버에서 거절). 상세 페이지 가림은 B1 영역이라 손대지 않았다.
- 워커 예약 실행(작업 스케줄러 등록)은 하지 않았다. 대표 승인 뒤 `README.md`의 조용한 실행 방식으로.
- 문구(ko/en)는 창업자 톤으로 썼지만 Opus 4.6 문구 검토는 아직. 특히 계정 카드·티저·반려 안내.
- 약관 §5.3 문안(SNS 캡처 수집·로컬 AI 판독)과 개인정보 처리방침 반영 여부는 **대표 결정**(약관 문구 변경) — 플래그를 켜기 전에 필요.

### 다음 행동

1. Director 리뷰 → B1(#89) 병합 → 이 PR 병합.
2. 0056/0140 → 0057/0141 클라우드 적용.
3. 약관·개인정보 문안 결정 뒤 `TWINGS_INFLUENCERS=on`, 워크스테이션에 워커 비밀키·예약 등록.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
