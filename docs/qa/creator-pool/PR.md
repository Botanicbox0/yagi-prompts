## B2-b — brand.twings.app 크리에이터 풀과 지정 초대

설계 원본: `docs/PLATFORM-2.0.md` §16.5·§16.6·§17.3 (+ §17.4 구현 메모 추가). 전부 `TWINGS_INFLUENCERS`(기본 **off**) 뒤에 있고, 초대는 `CAMPAIGN_COLLABORATION_PUBLIC=on`에서만 열린다. 선정은 계속 TWINGS가 한다.

- 기능 커밋: `d1a0db6be57f49648e89765782b9887c8902fb40` (브랜치 `claude/hopeful-sinoussi-15b33a`, base `main@df89f4c`)
- `git diff --stat main...HEAD`: 41 files, +1,562 / −32 (그중 `docs/qa/creator-pool/` 캡처 10장)

### 브랜드가 보게 되는 것

| 영역 | 내용 |
| --- | --- |
| `/brand/creators` (`data-creator-pool`) | 사이드바 "크리에이터"(플래그 on + 선택한 브랜드의 소유자·편집자일 때만). 카드(`data-creator-card`) = 플랫폼 아이콘 · 플랫폼 · `@핸들`(링크 없음) · "팔로워 약 3천/1.3만/12.5만"(1,000 단위 반올림) · "YYYY-MM-DD 확인"(관리자 확인일, KST) · 이미 초대한 캠페인 수. 핸들 검색(부분 일치, `strpos` — `_`도 글자 그대로) · 플랫폼 · 팔로워 구간(3천~1만/1만~5만/5만~10만/10만 이상, **반올림한 값 기준**) GET 폼(`data-creator-filters`, `organizationId` 유지). 한 번에 60명, 넘으면 좁혀 보라는 안내. |
| 상태 | 플래그 off → "준비 중"(`data-creator-pool="closed"`), 뷰어·외부인·TWINGS 팀 보기 → "소유자와 편집자만"(`forbidden`), 0057 없음 → `unavailable`, 협업 플래그 off → 카드는 보이고 "캠페인 협업이 열리면 초대할 수 있어요", 모집 중 캠페인 없음 → "TWINGS가 모집을 열면 초대". |
| "캠페인에 초대" 다이얼로그 (`data-creator-invite-dialog`) | 이 브랜드의 **지원을 받는 `recruiting` 캠페인**(활성·공유 프로젝트에 연결)만. 캠페인마다 "모집 마감 · 초대 n/한도". 이미 초대한 캠페인·한도 찬 캠페인은 고를 수 없음. 보낸 뒤 "초대를 보냈어요" + 화면 새로고침. 요청 id는 캠페인별로 재사용해 두 번 눌러도 초대 1건. |
| 지원자 탭 | 캠페인마다 "크리에이터 풀에서 초대한 사람 · n"(`data-invited-creators`): `@핸들 · 플랫폼`, "초대됨 · 아직 지원 전 / 초대됨 · 지원함 / 초대 철회 / 초대 링크 만료", 수락 전이면 "초대 철회". 풀에서 내려간 사람은 핸들 대신 "지금은 풀에 없는 크리에이터". 초대로 들어온 지원자 카드에 "초대됨" 배지(`data-applicant-invited`). 초대 링크 칸에 "크리에이터 풀에서 초대하기 →"(플래그 on·소유자/편집자). 손으로 만든 초대 링크 목록에서는 지정 초대를 뺐다(사람 목록에 이미 있음). |

### 서버 규칙

- **풀 목록** `lib/brands/creator-pool.ts` `loadCreatorPool`: `social_accounts.status='verified' and follower_count >= 3000 and pool_consent_at is not null`(`POOL_MEMBER_SQL`, 초대와 같은 술어). `submitted`·`rejected`·`expired`·동의 없음·3,000 미만은 안 나온다. 응답에는 소셜 계정 행 id·핸들·플랫폼·반올림 수치·확인일·이 브랜드에서 초대된 캠페인 id만. **사용자 id·이메일·이름·정확한 수치·프로필 URL 없음**(테스트 캐너리).
- **권한**: 그 브랜드의 active 멤버십 `owner|editor`만. 관리자(TWINGS 팀 보기)는 목록도 초대도 안 된다(관리자 동작은 `/admin/do`).
- **지정 초대** = 기존 `issueInvitation`에 `socialAccountId`(선택) 추가: 같은 트랜잭션에서 `campaign_targets(campaign_id,user_id,invited_by=브랜드 사용자,invited_at)` 삽입 + `campaign_participant_invites.invited_user_id` 바인딩(이메일 지정과 동시에 쓸 수 없음). 같은 사람 두 번 → `conflict`(targets 기본키), 같은 요청 재시도 → `invitation_retry`, 캠페인당 살아 있는 지정 초대 `min(slots×5, 50)` 넘으면 `invite_limit`, 풀에 없는 계정 → `not_found`, 뷰어·TWINGS 팀 → `forbidden`, 플래그 off·0058 없음 → `unavailable`. 기존 하루 100건 상한·모집 중 검사는 그대로.
- **수락**: `acceptInvitation`이 `invited_user_id`와 로그인 계정이 다르면 `wrong_account`(참여 폼 문구 "이 초대는 다른 TWINGS 계정에 보낸 거예요…"). **철회**: 수락 전 지정 초대를 철회하면 `campaign_targets` 행도 지운다 → 그 사람에게서 `invited` 캠페인이 사라지고, 다시 초대할 수 있다.
- **가시성(§17.2, B2-a 규칙 확인)**: `audience='invited'`는 `campaign_targets`에 있는 사람에게만 `/campaigns/open`에 보이고 지원 가능 — 지정 초대로 들어간 사람만 보이고 다른 사람은 못 본다는 테스트 추가. 초대받은 사람은 메일 링크가 없어도(알림 off) 목록에서 일반 지원으로 참여할 수 있다.
- **알림**: `notifyCampaignInvitation`(`lib/campaigns/notify.ts`, 기존 `sheet`·`mailer`·수신 거부 링크 재사용, 새 채널 없음). `profiles.notif_updates=true`인 계정에만, 초대 1건당 idempotency key `campaign-invitation:{invitationId}` 하나. 버튼은 계정에 묶인 초대 링크 `/campaigns/{slug}/join#token=…`. `/api/brand-creators`가 **새 초대일 때만** `after()`로 보낸다(재시도·거절은 메일 없음). 초대 링크는 브랜드 브라우저로 돌려주지 않는다.
- **호스트**: `isBrandPath`에 `creators`, `brandRouteAllowed`에 `POST /api/brand-creators`(GET 등은 404). `authReturnPath`는 `isBrandPath`를 따라 `/brand/creators?…`로 복귀.

### 마이그레이션 — 클라우드 적용 필요

- `supabase/migrations/0058_core_campaign_designated_invites.sql`: `campaign_participant_invites.invited_user_id uuid references profiles(id)`, 부분 유니크 `(campaign_id, invited_user_id) where invited_user_id is not null and revoked_at is null`, `guard_campaign_collaboration_immutable()`에 새 칼럼을 불변 목록으로 추가(0136의 `search_path=public,pg_temp`를 정의에 다시 넣음 — `create or replace`가 지우기 때문).
- glue 없음: 0132가 서버 역할에 표 전체 INSERT를 주고 UPDATE는 수락·철회 칼럼만이라 새 칼럼은 삽입 때 한 번만 쓰인다. 다음 번호 core 0059 · glue 0142(`supabase/README.md` 미적용 줄에 기록).
- 순서 무관: 0058 없이 배포돼도 풀 목록은 보이고 초대만 `unavailable`(리더는 `information_schema`/`to_jsonb`로 확인).

### 검증

| 명령 | 결과 |
| --- | --- |
| `npm run db:local` | OK (로컬 픽스처에 풀 계정 6 · 모집 중 invited 캠페인 1 추가) |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **314 files / 3,005 tests passed** |
| `NEXT_PUBLIC_APP_URL=http://localhost:3016 npm run build:local` | exit 0 (`ƒ /brand/creators`, `ƒ /api/brand-creators`) |
| `NEXT_PUBLIC_APP_URL=http://localhost:3016 PORT=3016 npm run start:local` + `SWEEP_BASE_URL=http://localhost:3016 npm run sweep:anon` | **SWEEP PASSED — 1111/1111** (새 체크 7개) |

새 테스트(실패 → 구현 → 통과 순서로 작성): `tests/brands/creator-pool.test.ts`(verified+동의+3,000만, 반올림·구간·짧은 표기, 캐너리 — 사용자 id·프로필 URL·이메일·이름·정확 수치·`user_id`/`profile_url`/`email` 키 부재, 검색·필터, owner/editor만·viewer/외부인/TWINGS 팀 거절, 플래그 off, 협업 off면 초대 닫힘), `tests/campaigns/designated-invitation.test.ts`(targets+바인딩, 멱등·중복 거절, 한도, 풀 밖 계정·권한·플래그, 바인딩 계정만 수락·타인 `wrong_account`, 대상만 목록에 보임, 철회 후 재초대, 지원자 탭 "초대됨", 메일 — 알림 on 1통·키 1개·off는 0통·수신 거부 링크), `tests/routes/brand-creators-api.test.ts`(플래그 off 404·교차 출처 403·익명 401·TWINGS 팀 403·엄격한 본문·링크 미반환·`after()` 메일 1회·거절은 메일 없음), `tests/db/designated-invites.test.ts`(칼럼 불변·살아 있는 지정 초대 1건·철회 뒤 재발급), `tests/brands/creator-pool-ui.test.tsx`(카드·GET 폼·상태 문구·프로필 링크 없음), `tests/brands/campaign-wizard-ui.test.tsx`(지원자 탭 "초대됨"), `tests/routes/brand-host.test.ts`(허용 목록·복귀 경로·미들웨어). 사전 키는 기존 `tests/i18n`가 ko/en 짝을 확인.

스윕(`scripts/sweep-anon.ts`): 브랜드 호스트 `/brand/creators` 익명 → 로그인 뒤 같은 경로로 복귀, `POST /api/brand-creators` 익명 → 401/404 + no-store, `GET` → 404, 소비자 호스트 `POST` 익명 → 401/404.

### 브라우저 확인 (로컬 `dev:free`, `TWINGS_INFLUENCERS=on`, `CAMPAIGN_COLLABORATION_PUBLIC=on`)

로컬 픽스처(`scripts/brand-workspace-fixtures.ts`)에 모집 중 `invited` 캠페인 1개와 가상 풀 계정 6개(동의 5 · 미동의 1, `*@fixture.invalid`) 추가. headless Chrome(CDP)으로 실제 클릭: 다이얼로그에서 초대 보내기 → "초대를 보냈어요" → 카드 "캠페인 1개에 초대함" → 지원자 탭 "초대됨 · 아직 지원 전". **가로 넘침 0**: 390px 풀·다이얼로그, 320px 풀·다이얼로그·지원자 탭(`scrollWidth == innerWidth`). **44px 미만 타깃 0**: 320px 풀의 버튼·선택·입력·링크, 다이얼로그의 버튼·선택지.

캡처 `docs/qa/creator-pool/`: 1280 — `01-pool` · `02-filter`(TikTok·3천~1만) · `03-invite-dialog` · `04-invite-sent` · `05-pool-invited` · `06-applicants-invited` / 390 — `11-pool` · `12-filter`(Instagram) · `13-invite-dialog` · `14-applicants-invited`. 모든 핸들은 가짜(`local.pool.*`).

### 건너뛴 검사 · 남은 위험

- 프리뷰 URL 확인은 PR 생성 뒤 Vercel 빌드에서. 두 플래그가 운영에서 off라 프리뷰에서도 풀은 "준비 중"이다.
- **대표 작품 자리**: 사용자가 결과물 공개에 동의하는 저장소(표·칼럼)가 아직 없다. 그래서 모든 카드가 플랫폼 아이콘이다. 공개 동의를 새로 만들면 약관 문안이 필요해 이번에는 만들지 않았다(레시피 v2 "공개 선택"과 함께 정할 일).
- "모집 중/검토 중 캠페인" 중 **검토 중(`selecting`)은 목록에서 뺐다**: `acceptInvitation`이 `recruiting`·마감 전만 받기 때문에 초대해도 수락할 수 없다. `draft`도 같은 이유.
- 한 사람이 플랫폼 두 개로 풀에 있으면 카드가 두 장이다. 초대는 사람 단위라 한 장에서 초대하면 두 장 모두 "초대함"이 되고 다이얼로그에서 그 캠페인을 고를 수 없다(서버도 `conflict`로 막는다). 사람 단위로 카드를 합칠지는 화면 결정으로 남긴다.
- 지정 초대 링크는 기존처럼 7일 또는 모집 마감 중 이른 때 만료된다. 만료 뒤에도 `campaign_targets`는 남아 그 사람은 목록에서 계속 지원할 수 있다(한도 계산에는 철회 전까지 포함).
- 로컬 dev에서 CSS를 고치는 순간 Fast Refresh 전체 새로고침과 겹친 요청 1건이 500(`Unexpected end of JSON input`, 개발 서버 내부)이었다. 같은 요청을 직접 다시 보내면 404/400으로 정상 처리되고 재실행에서는 재현되지 않았다. 프로덕션 빌드 스윕에는 해당 없음.
- 문구(ko/en)는 창업자 톤으로 썼지만 Opus 4.6 문구 검토는 아직.

### 대표 승인 필요 문안 (문서는 고치지 않았다)

풀 노출 동의(`/identity/social`의 `social.poolLabel`·`poolHint`)와 `lib/legal/documents.ts`를 대조했다.

1. **개인정보처리방침 §4 제3자 제공** — 지금 예외는 "캠페인에 **선정된** 크리에이터의 활동명·SNS 주소·게시물 링크를 해당 캠페인 브랜드에 전달(지원 시 동의)"뿐이다. 풀은 **지원 전**에, **모든 브랜드 워크스페이스의 소유자·편집자**에게 핸들·플랫폼·반올림한 팔로워 구간·확인일을 보여준다. 이 경우가 문서에 없다. 제안:
   > - 크리에이터 풀 노출에 동의한 회원의 SNS 핸들·플랫폼·반올림한 팔로워 구간·TWINGS 확인일을 브랜드 워크스페이스의 소유자·편집자에게 보여주는 경우(동의를 끄면 바로 중단)
2. **§1 수집 항목·§2 이용 목적** — 선택 항목에 "SNS 계정 확인 캡처, 크리에이터 풀 노출 동의 여부"(B2-a에서 이미 지적), 목적에 "크리에이터 풀 노출과 브랜드의 캠페인 초대 전달" 추가 필요.
3. **동의 화면 문구(`social.poolHint`)** — 지금: "브랜드에는 핸들, 플랫폼, 반올림한 팔로워 구간만 보여요. 이름과 연락처는 보이지 않아요. 언제든 끌 수 있어요." 실제로는 **확인한 날짜**도 보이고, 브랜드가 **캠페인 초대**를 보낼 수 있으며 캠페인 알림을 켠 경우 메일이 간다. 제안:
   > 브랜드에는 핸들, 플랫폼, 반올림한 팔로워 구간, TWINGS가 확인한 날짜만 보여요. 이름과 연락처는 보이지 않아요. 브랜드는 캠페인 초대만 보낼 수 있고, 캠페인 알림을 켜 두면 초대 메일이 가요. 언제든 끌 수 있어요.
   (en: "Brands see your handle, platform, a rounded follower range and the date TWINGS checked it — never your name or contact details. Brands can only invite you to a campaign; with campaign mail on you get the invitation by email. You can turn this off any time.")
4. 플래그 `TWINGS_INFLUENCERS`를 켜기 전에 1~3이 확정돼야 한다.

### 다음 행동

1. Director 리뷰 → 0058 클라우드 적용(순서 무관) → 병합.
2. 위 문안 대표 결정 → 약관·개인정보 반영 → `TWINGS_INFLUENCERS=on`(+ `CAMPAIGN_COLLABORATION_PUBLIC=on`일 때 초대 가능).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
