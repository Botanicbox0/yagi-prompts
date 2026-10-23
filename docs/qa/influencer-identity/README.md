# B2-a 인플루언서 SNS 연결 — 로컬 QA와 워커 운영 메모

설계 원본: `docs/PLATFORM-2.0.md` §17.1·17.2·17.4 (PR #88). 이 폴더는 로컬 검증 기록과 캡처다.

## 무엇이 생겼나

| 영역 | 위치 |
| --- | --- |
| 데이터 | `supabase/migrations/0057_core_social_accounts.sql`, `0141_glue_social_accounts.sql` — `social_accounts`, `social_account_writes`(하루 5회 장부), `social_verify_workers`(워커 하트비트), `profiles.influencer_since` |
| 판정 | `lib/influencers/rules.ts` — `INFLUENCER_MIN_FOLLOWERS = 3000`, `isInfluencer(sql, userId)`(verified · follower_count ≥ 3000, `expired` 제외), 프로필 링크 정규화 |
| 신청 | `/identity/social` + `POST/GET/PATCH/DELETE /api/identity/social`, 본인 캡처 `/api/identity/social/{id}/evidence`, `/account` "SNS 연결" 카드 |
| 관리자 | `/admin/community#social` "SNS 확인" 큐, 오퍼레이션 `social.verify`(숫자 직접 입력 필수) · `social.reject`(사유 필수), 관리자 캡처 `/api/admin/social/{id}/evidence`, `/admin` 홈 큐 한 줄 |
| 로컬 AI | `/api/social-verify-worker/{claim,complete,heartbeat,evidence}` + `scripts/social-verify-worker.ts` |
| 가시성 | `lib/influencers/visibility.ts` — `/campaigns/open`(로그인 목록), `loadApplyState`·`applyToCampaign`·`acceptInvitation`의 `influencer_required` |
| 플래그 | `TWINGS_INFLUENCERS`(기본 off). off면 `/identity/social`은 "준비 중", API·워커는 404, 회원 목록은 `public`만 |

## 규칙 요약 (코드가 원본)

- 자격 = 연결 계정 **하나라도** 관리자가 확인한 팔로워 3,000 이상(`status='verified'`). 합산 아님. AI 값·사용자 입력값은 판정에 쓰지 않는다.
- 확인 후 90일이 지나면 화면에 "만료"로 보이고 새 캡처를 안내한다. 자격은 유지된다(§17.1). 다시 제출하면 `recheck_at`이 찍히고 `verified`는 그대로, 관리자 재확인 대기. 핸들이 바뀌면 새 계정으로 보고 `submitted`부터.
- 저장된 `status='expired'`는 이후 재측정 작업용으로 남겨 두었다(이번 슬라이스에서 쓰지 않음). `isInfluencer`는 이 값을 세지 않는다.
- 캠페인: `public` 모두 · `influencers` 인플루언서 또는 `campaign_targets` 대상 · `invited` 대상만(초대 링크 토큰 자체도 초대 증거). 이미 지원한 사람은 자격이 바뀌어도 자기 지원서를 계속 본다.
- `campaigns.audience`·`campaign_targets`는 B1(0056, #89)의 것을 그대로 읽는다.

## 로컬 AI 워커 (워크스테이션)

```bash
SOCIAL_VERIFY_API_ORIGIN=https://twings.app SOCIAL_VERIFY_WORKER_SECRET=… SOCIAL_VERIFY_WORKER_ID=yagi-server npx tsx scripts/social-verify-worker.ts
```

- Ollama는 반드시 gpu-arbiter `http://127.0.0.1:11434`(기본값). 루프백이 아니거나 11444면 시작하지 않는다.
- 모델: `SOCIAL_VERIFY_MODEL`이 있으면 그것(설치돼 있어야 함), 없으면 설치된 모델 중 이름이 `qwen`으로 시작하고 `/api/show`의 capabilities에 `vision`이 있는 것, 없으면 `gemma` 계열. 둘 다 없으면 아무것도 claim하지 않고 `exit 2`("no vision model").
- 한 번 실행 = 한 패스(최대 20건, 한 번에 1건). 실패하면 그 건을 실패로 보고하고 패스를 멈춘다(공유 GPU 보호). 서버가 1분·5분 뒤로 다시 줄을 세우고, 3번째 실패에서 `ai_state='failed'`, `ai_note='failed:<code>'`. 신청 상태는 `submitted` 그대로.
- 로그에는 코드만 남긴다(캡처·핸들·비밀값 없음).

### Windows에서 콘솔 창 없이 돌리기

스크립트는 자식 프로세스를 띄우지 않는다(`fetch`만). 예약 실행은 전역 규칙의 조용한 러너로 감싼다.

```powershell
C:/Users/User/AppData/Local/Programs/Python/Python312/pythonw.exe D:/dev/agent-harnesses/windows-background/agent-harness/quiet_run.pyw --log D:/logs/social-verify.log -- C:/Program Files/nodejs/npx.cmd tsx scripts/social-verify-worker.ts
```

환경변수는 작업 스케줄러 계정 환경에 둔다(비밀값을 명령줄에 쓰지 않는다). WSL에서 돌리면 Windows 콘솔 플래그는 필요 없다. Node에서 이 스크립트를 다른 프로그램이 띄울 때는 `windowsHide: true`.
예약 등록 자체는 대표 승인 뒤에 한다(워커 서비스·포트 변경 금지 규칙과 같은 취급).

## 로컬 화면 QA 재현

```bash
mkdir -p .pglite/influencer-qa
npx tsx scripts/db-local.ts --dir .pglite/influencer-qa/data
npx tsx scripts/influencer-identity-local-qa.ts
PLAYBOOK_LOCAL_DB_DIR=.pglite/influencer-qa/data TWINGS_INFLUENCERS=on PORT=3016 npm run dev:free   # dev:pro, dev:admin
```

픽스처의 캡처는 전부 그려 낸 가짜(`hana.local`, `mina.local`)다.

## 실제 로컬 AI 실행 기록 (2026-10-23)

- 환경: 이 PC → gpu-arbiter `http://127.0.0.1:11434`. 설치 모델 중 `qwen3.8:27b-bf16`·`qwen3.8:27b-q4_K_M`·`yagi-crm-gemma4:31b-q8_0`이 `vision` 지원. 이름이 `qwen`으로 시작하는 첫 모델 `qwen3.8:27b-bf16`이 선택됨(`yagi-crm-*`, `crmbench-*`는 후보에서 빠짐).
- 대상: 로컬 dev 서버(`dev:admin`, `TWINGS_INFLUENCERS=on`, 로컬 전용 임시 secret)의 대기 2건. 둘 다 그려 낸 가짜 캡처(`@hanatv.local` 3,050 · 브라우저에서 제출한 `@mina.tube.local` "3.2K subscribers").
- 결과: `social-verify worker pass completed (qwen3.8:27b-bf16, 2 read)`, 2분 11초(첫 호출의 모델 로드 포함). 관리자 큐: `3,050 · 신뢰도 1.00 · 핸들 일치`, `3,200 · 신뢰도 1.00 · 핸들 일치`("3.2K"를 3,200으로 풀어 읽음). 신청 상태는 둘 다 `submitted` 그대로.
- 이어서 관리자 화면에서 `@mina.local`(틱톡)에 4,215를 직접 입력해 확인 → `verified`, `/admin` 홈 "SNS 연결 신청을 확인하세요 2건 대기".

## 캡처

| 파일 | 화면 |
| --- | --- |
| `01-campaigns-teaser-390.jpg` · `06-…-1280.jpg` | `/campaigns/open`, 일반 회원: 티저 한 줄 + "누구나 참여" |
| `02-social-status-390.jpg` · `07-…-1280.jpg` | `/identity/social`: 반려(사유) · 확인 중 |
| `03-social-form-390.jpg` | 연결 폼(플랫폼 · 링크 · 팔로워 수 · 캡처 미리보기 · 풀 동의) |
| `04-social-submitted-390.jpg` | 제출 직후 상태 문장 |
| `05-account-card-390.jpg` | `/account` "SNS 연결" 카드 |
| `08-campaigns-influencer-390.jpg` | 인플루언서: "인플루언서 캠페인" 섹션이 위에, 티저 없음 |
| `09-social-verified-390.jpg` | 확인됨 · 날짜 · 출처, 팔로워 12,400명 |
| `10-admin-queue-1280.jpg` | `/admin/community#social`: 캡처 · 링크 · 사용자 입력 · AI 제안(수치·신뢰도·모델) · 확인/반려 |
| `11-admin-home-count-1280.jpg` | `/admin` 홈 큐 한 줄 |
| `12-apply-influencer-required-390.jpg` | 인플루언서 캠페인 지원 화면, 자격 없음: 폼 대신 연결 안내 |
| `fake-follower-screenshot.png` | 워커 실행에 쓴 가짜 캡처(픽스처 스크립트가 그림) |
