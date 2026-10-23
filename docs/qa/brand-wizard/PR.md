## brand.twings.app B1 — 캠페인 마법사 + 캠페인 타임라인

설계 원본: `docs/PLATFORM-2.0.md` §16.2~16.4·16.6. 원칙은 그대로: 브랜드는 **정하고 보고 지불**하고, 선정·검수·지급 확정은 TWINGS가 한다. 결제가 선정·검수·지급을 대신하지 않는다.

- 기능 커밋 HEAD: `0f8e464a3517d600074290f05a855fb062e18971` (이 PR 본문 파일은 그 뒤 커밋)
- base: `main` @ `4845bbf` · 브랜치 `claude/brand-wizard-timeline`
- `git diff --stat main...`: 70 files, +2,796 / −612 (그중 캡처 17장)

### 브랜드가 보게 되는 것
1. **마법사** (`/brand/projects/new` 교체, `data-campaign-wizard`)
   ① 포맷: 캠페인 이름·목표 + 공개 템플릿 카드(TWINGS 오리지널 / 포맷 작가, 카탈로그 카드 미디어 재사용, 2열 4:5) 또는 "브랜드 전용 제작" 설명
   ② 보상·예산: 기존 payout 모델(고정/조회수/고정+조회수), 1인 최저·최고, 조회수 1,000회당, 총예산(부가세 포함/별도), 크리에이터 수. **슬롯 × 최저 보상 ≤ 총예산** 검사
   ③ 대상: 인플루언서 누구나 / 조건(플랫폼·최소 팔로워·성별·지역) / 직접 초대(초대 링크로 직접 전달 안내만)
   ④ 기간·게시 조건: 모집 마감·게시 마감(한국 시간), 필수 해시태그·멘션, **광고 표기(체크·비활성, 끌 수 없음)**, 금지 사항
   ⑤ 요약 한 화면(단계별 "고치기") → **TWINGS 검토 요청**
   - 초안: 워크스페이스별로 이 브라우저 `localStorage`에 단계마다 저장, 다시 열면 첫 미완료 단계에서 이어짐, 보내면 지움. TWINGS에는 "검토 요청" 전까지 아무것도 가지 않는다.
   - 결과: 기존 `project.create` → `createBrandProject` 경로, 상태 `requested`, `brand_projects.campaign_terms`. 서버가 같은 zod 스키마(`lib/brands/workspace/campaign-terms.ts`)로 다시 검증하고, 예산·부가세·게시 마감·플랫폼/팔로워 조건 칼럼은 terms에서 서버가 유도한다. 지난 모집 마감은 거절.
2. **캠페인 타임라인** (프로젝트 상세)
   - 탭: 개요(타임라인 브리프→TWINGS 검토→모집→선정→제작·게시→리포트→정산 + 기존 다음 행동 `projectNextAction` + 성과) · 브리프(요청한 조건 요약) · 콘텐츠 확인 · **지원자** · **결제** · 리포트 · **파일·대화** · **계약·2차 활용**
   - 단계는 저장된 사실(프로젝트 상태, 연결 캠페인 상태·퍼널 수 `loadCampaignParticipation`, 리포트)로만 계산. 스튜디오 제작 캠페인은 모집·선정·정산을 "이 캠페인에는 없음"으로 표시.
   - `/brand/projects/[id]/participants` → `#applicants`, `/funding` → `#payments`(토스 failUrl의 `?failed=1`만 유지)로 리다이렉트. 참여자 상세·주문 결제·결제 복귀 페이지는 유지.
   - **지원자 탭**: `applied`도 보임 — 핸들·플랫폼·팔로워(출처 "자기 신고", B2에서 "확인됨")·프로필·지원 메시지. 소유자·편집자는 **"선호"만** 표시(`campaign_applications.brand_preferred_at`, `applicant.prefer`). 선정 버튼 없음. 선정 뒤에는 상태·게시물 링크·조회수(출처)·참여 공간 링크. 초대 링크 만들기/철회는 기존 폼 재사용.
   - **결제 탭**: 견적 → 수락 → 결제 → 입금 기록 한 흐름(기존 `FundingAction`·`FundingStatus`·`RewardProposalForm` 재배치).
   - 협업 플래그(`CAMPAIGN_COLLABORATION_PUBLIC`)·펀딩 플래그(`CAMPAIGN_FUNDING_PUBLIC`)가 꺼져 있으면 두 탭은 "TWINGS 검토 뒤 열려요" 안내만. 마법사·브리프·타임라인은 플래그와 무관하게 동작.
3. **관리자**: `/admin/campaigns/new?project=<id>`가 기존 `campaign.create` 폼을 그 요청으로 미리 채움(이름·요약·조건 문장은 한국어 칸, 영어 칸은 비움, 지급 기준은 최저 보상 기준 시작값). 관리자 프로젝트 화면에 "이 요청으로 캠페인 만들기" 링크. 오퍼레이션은 그대로.
4. 공개 캠페인 목록(`loadPublicCampaigns`)은 `audience='public'`만.
5. 문안: 브랜드 화면 문안은 `brandWorkspace`(`wizard`·`timeline`·`tabs`·`applicants`·`payments`·`paymentStates`)로. `messages/campaign-*.ts`에서 브랜드 화면만 쓰던 키(`buyer`·`receipt`·`noReceipt`·`participants`·`none`·`invitations`) 삭제, 크리에이터·관리자 문안은 그대로.

### 클라우드 적용 — 완료 (2026-10-23, Director, `0056_core_brand_campaign_terms_with_glue_0140`)
- `supabase/migrations/0056_core_brand_campaign_terms.sql` — `brand_projects.campaign_terms jsonb`(객체만), `campaigns.audience text not null default 'public' check in ('public','influencers','invited')`, `campaign_targets(campaign_id, user_id, invited_by, invited_at, pk(campaign_id,user_id))`, `campaign_applications.brand_preferred_at timestamptz`
- `supabase/migrations/0140_glue_brand_campaign_terms.sql` — `campaign_targets` RLS enable+force, public/anon/authenticated revoke, service_role grant(0131 형태)
- 순서가 중요: 0056 없이 배포하면 공개 캠페인 목록 쿼리(`audience`)가 실패한다. `supabase/README.md` 운영 적용 이력에 #89 행으로 기록(main 병합 커밋에서).

### 재검증 — main(#87·#88) 병합 뒤 (2026-10-23)
병합 커밋 `589c61d`(충돌은 `supabase/README.md`만: main의 0055 미적용 메모 유지 + 0056/0140 적용 행 추가). `npm ci` → `db:local` OK → `tsc` exit 0 → `vitest` **304 files / 2,935 tests passed** → `build:local`(3014) exit 0 → `start:local` 3014 + `sweep:anon` **SWEEP PASSED — 1086/1086**.

### 검증 (worktree, Windows — 병합 전 첫 실행)
| 단계 | 결과 |
| --- | --- |
| `npm run db:local` | OK (로컬 픽스처: 마법사로 보낸 요청 1건 + 픽스처 프로젝트에 연결된 `invited` 캠페인과 가상 지원자 3명) |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **300 files / 2,908 tests passed** |
| `NEXT_PUBLIC_APP_URL=http://localhost:3014 npm run build:local` | exit 0 |
| `PORT=3014 npm run start:local` + `SWEEP_BASE_URL=http://localhost:3014 npm run sweep:anon` | **SWEEP PASSED — 1084/1084** (새 브랜드 호스트 체크 8개 포함: 마법사·상세·옛 참여자/결제 경로가 로그인 후 같은 경로로 복귀) |
| 브라우저(`dev:free`, 협업 플래그 on, 1280·390·320) | 키보드만으로 1~4단계 진행·검증 실패 시 첫 오류 칸 포커스·단계 이동 시 제목 포커스, 초안 저장/복원, 검토 요청 → `requested` 상세로 이동·초안 삭제, 선호 표시/해제, 옛 경로 리다이렉트, **320px 가로 넘침 0**(5단계·상세 탭) |

새 테스트: `tests/brands/campaign-terms.test.ts`(단계 검증·광고 표기 고정·슬롯/예산·초안 저장/복원·칼럼 유도·관리자 미리 채우기), `campaign-timeline.test.ts`, `campaign-wizard-service.test.ts`(`requested` 생성·서버 재검증·멱등), `campaign-wizard-ui.test.tsx`(5단계·탭·지원자 노출 규칙·선정 버튼 없음·플래그 off 안내·리다이렉트·관리자 폼), `tests/campaigns/applicants.test.ts`(applied 노출·선호 권한: 뷰어·외부인·TWINGS·완료 캠페인 거절·플래그 off), `public-audience.test.ts`, `tests/db/brand-campaign-terms.test.ts`(표·칼럼·제약·RLS 실제 거부), 호스트 허용 목록·사전 키 이동 테스트. 기존 탭 테스트는 새 탭 구조로 갱신.

### 캡처 (`docs/qa/brand-wizard/`)
1280: `01-format` · `02-reward` · `03-audience` · `04-schedule` · `05-review` · `06-timeline-requested` · `07-timeline-active` · `08-applicants-preferred` · `09-payments-closed`
390: `10-timeline` · `11-applicants` · `12-payments-closed` · `13-format` · `14-reward` · `15-audience` · `16-schedule` · `17-review`
(로컬 픽스처라 포맷 카드 미디어는 자리표시 이미지)

### 건너뛴 검사 · 남은 위험
- 프리뷰 배포 URL 확인은 PR 생성 뒤 Vercel 빌드에서. 브랜드 호스트(brand.twings.app) 실제 도메인 확인은 운영 반영 뒤.
- 펀딩 플래그 on 상태의 결제 탭은 단위 테스트(견적·수락 숨김·실패 안내)로만 확인, 실제 토스 흐름은 기존 경로 그대로라 재검증하지 않음.
- `audience`·`campaign_targets`를 읽는 가시성(인플루언서/초대 전용 노출)은 B2. 지금 관리자 폼은 새 캠페인을 여전히 `public`으로 만든다(미리 채우기 화면에 그렇게 안내).
- 지원자 팔로워는 모두 "자기 신고". "확인됨"은 B2의 `social_accounts` 뒤.
- 기존 "콘텐츠 확인"(브랜드 승인) 탭은 §16.4 목록에 없지만 기능 손실이 생겨 유지했다.

### 대표 결정 필요
- 마법사 초안을 서버에 남길지(지금은 브라우저 저장, 검토 요청 전에는 TWINGS가 볼 수 없음).
- 지원자에게 보여줄 범위(핸들·팔로워·지원 메시지·프로필 링크 — 연락처·실명 없음)가 지원 동의 문안과 맞는지(약관·지원 동의 문구 확인).
- 관리자 미리 채우기의 지급 시작값(최저 보상=고정 보상, 최고 보상=상한) 기준.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
