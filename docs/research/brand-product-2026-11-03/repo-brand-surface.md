# brand.twings.app 현황과 조직별 기능 허용/차단 훅 지점 (2026-11-03)

조사 기준: `D:\dev\twings` main `119f4ea2`, 읽기 전용(코드 수정·빌드·테스트 실행 없음). 확인 날짜 2026-11-03.
읽은 것: `docs/BRAND-ENGINE.md`, `docs/PLATFORM-2.0.md` §16·§17, `docs/BRAND-MANAGED-WORKSPACE.md`, `docs/BRAND-STAFF-ACCESS.md`, `docs/BRAND-MOAT-AND-STORAGE.md`, `docs/WORKSPACE-HOST-ROUTING.md`, `docs/BRAND-SHORTLIST.md`, `docs/design/TOOLBOX.md`, `app/(brand)/**`, `components/brand-workspace/*`, `lib/brands/**`, `lib/routing/*`, `middleware.ts`, `lib/auth/viewer.ts`, `lib/i18n/config.ts`, 마이그레이션 0027·0031·0032(열 목록만)·0033·0035·0056과 glue 0113·0117·0119·0121, `app/api/brand-*/**`, `app/api/brands/**`, `lib/admin/brand-*.ts`, 관련 테스트 이름.

## 0. 결론

1. **브랜드 표면은 "캠페인 운영 워크스페이스 + 계약형 셀프 스튜디오"로 완성돼 있고, 권한은 `lib/brands/workspace/service.ts`의 세 함수(`member`·`project`·`memberOrStaff`)와 `lib/brands/production/service.ts`의 `member`/`reader`에 모여 있다.** 조직별 기능 정책(entitlement)은 main에 없다. 조직 테이블에 있는 유일한 정책 열은 `studio_managed boolean`이다.
2. **엔타이틀먼트는 한 파일(`lib/brands/entitlements.ts`)에 정의하고 7종류의 지점(내비·페이지·API·서비스 가드·관리자 오퍼레이션·알림·엣지 허용 목록)이 그 함수를 부르면 빠짐없이 막힌다.** 진짜 울타리는 서비스 가드 2곳(`project()`/`member()`)과 `reserveProduction()`이다. 나머지는 표시용이다. 작업 폴더에 오늘 02:58에 생긴 untracked 파일 `supabase/migrations/0074_core_brand_entitlements.sql`·`0150_glue_brand_entitlements.sql`이 같은 모델(기본 전부 허용, 예외 조직만 거부 목록 7개 그룹, B2B 플랜 3개)을 이미 그리고 있다. 다른 에이전트의 진행 중 작업이라 열람만 했고 내용은 검증하지 않았다(참조하는 `lib/brands/features.ts`·`docs/BRAND-PRODUCT.md`는 아직 없다).
3. **캠페인 상세의 `#brief`·`#review` 탭에 얹힌 "YAGI STUDIO" 레이어 4개(`aesthetic-engine`·`brief-concierge`·`human-handoff`·`review-stage`, 커밋 a2a30f6c 2026-10-24)는 정적 프로토타입인데 운영에서 모든 캠페인 페이지에 렌더된다.** 룩북 4개는 하드코딩, "Argon이 기획서를 읽는 중"은 450 ms `setTimeout`, "무로그인 시사 링크"는 서버에 처리 코드가 없고, 데모 영상 `/reel/brands/*.mp4`는 brand 호스트 허용 목록 밖이라 brand.twings.app에서 404다. 하드코딩 한국어 문자열이 1,500개를 넘어 `messages/*.ts` 규칙(AGENTS §4)도 어긴다. `docs/research/brand-landing-2026-10-30/product-facts.md`의 "어디에서도 import되지 않는다"는 지금 main에서는 틀리다(`project-detail.tsx` L24–28, L201, L318–334).
4. **디자인 토큰의 실체는 `--bw-*`가 아니라 `--ys-*` 40개다**(`--bw-*`는 3개). 레드 `#ED1E1E`는 Admin 브리지의 `var()` 폴백 2곳뿐이고 `tests/brands/workspace-taste.test.tsx`가 지킨다. 홈·라이브러리·멤버·설정은 TOOLBOX §1-2(Operate) 기법 3–4개 안에 있고, 캠페인 상세만 프로토타입 레이어 때문에 8개 이상이다.
5. **새 메뉴 '브랜드'·'만들기'는 기존 페이지 골격(`brandContext`→`brandScope`→`selectedAccess`→`BrandUnavailable`/`StaffNotice`)과 `ActionForm`/`/api/brand-workspace` 오퍼레이션 패턴을 그대로 쓰면 된다.** 등록 지점은 6곳(§6 표)이며, `lib/i18n/config.ts`의 `APP_PREFIXES`는 건드릴 필요가 없다(브랜드 경로는 `isBrandPath`로 따로 게이트된다).

## 1. 조직·멤버십·스태프 모델

### 1.1 테이블 (운영 적용된 core 마이그레이션 기준)

| 테이블 | 열(핵심) | 출처 | 비고 |
| --- | --- | --- | --- |
| `brand_organizations` | `id uuid`, `name`(2–100자), `created_by`, `request_id`, `studio_managed`(0031), `website`·`description`·`contact_email`·`profile_revision`(0032), `logo_id`·`logo_revision`(0035) | 0027 | **식별자는 UUID 하나. `slug`는 없다**(`lib/brands/workspace/selection.ts` L5: "no second number exists"). 한 계정이 만들 수 있는 조직 5개(`createBrandOrganization` L330 `count >= 5` → `rate_limited`). |
| `brand_memberships` | PK `(organization_id,user_id)`, `role in (owner,editor,viewer)`, `status in (active,revoked)` | 0027 | 쓰기 = owner·editor, viewer는 읽기. |
| `brand_invites` | `email`, `role in (owner,editor,viewer)`(0031), `token_hash`, `expires_at ≤ 7일`, `issued_by_studio`, `project_id`(캠페인 전용 viewer 초대) | 0027/0031 | owner 초대는 스튜디오만. |
| `brand_project_members` | PK `(project_id,user_id)`, `status`, `can_comment`(service.ts L81에서 읽음, 0034에서 추가된 열로 보이나 파일은 열지 않음) | 0031 | 캠페인 게스트(조직 멤버십 없음). |
| `brand_projects` | `organization_id`, `title`, `objective`, `audience`, `budget_krw`, `criteria jsonb`, `production_mode in (creator,studio)`, `status in (requested,active,completed,cancelled)`, `revision`, `client_visible`(0031), `campaign_terms jsonb`(0056), `shortlist_criteria`(0068) | 0027 | 캠페인 1건. |
| `brand_production_contracts` / `_templates` / `_reservations` | `generation_limit`, `starts_at/ends_at`, `enabled`; 템플릿은 `prompt_items(audience='brand')`; 예약은 `render_jobs` 1:1 | 0033 | 셀프 스튜디오의 계약·횟수. `release_brand_production_failure` 트리거가 실패 렌더의 횟수를 되돌린다. |
| 그 밖에 | `brand_content_versions`·`_decisions`·`brand_messages`·`brand_attachments`·`brand_posts`·`_measurements`·`brand_reports`·`brand_workspace_events`(0027), `brand_contract_documents`·`_sharing_events`(0031), `brand_support_messages`(0032), `brand_organization_logos`(0035), `brand_usage_*` 13표(0037), `brand_shortlist_candidates`(0066) | | 모두 RLS enable+force, `revoke all from public/anon/authenticated/service_role` 뒤 `service_role`에 `select,insert`와 열 단위 `update`만(glue 0113·0117·0119·0121). 브라우저 역할은 테이블 접근이 없다. |

### 1.2 역할과 선택

- 서비스 층 역할: `owner | editor | viewer`(멤버십), `guest`(캠페인 게스트, `brand_project_members`), `studio`(TWINGS 팀 읽기). 선택기 타입 `BrandChoiceRole = BrandRole | 'guest' | 'studio'`(`selection.ts` L337).
- **스태프 판정은 `lib/brands/workspace/staff.ts`의 `hasStaffReadAccess(sql,userId,verifiedEmail)` 하나**: `profiles.is_admin = true` 또는 인증 서버가 확인한 이메일 도메인이 정확히 `yagiworkshop.xyz`. 읽기 전용이고 멤버십을 만들지 않는다. 쓰기 예외는 "운영자 캠페인 준비"(DB 관리자, `/api/brand-workspace/studio`, 허용 오퍼레이션 7개 `lib/admin/brand-host-studio.ts` L582–595)뿐이다.
- **브랜드 전환은 URL `?organizationId=<uuid>`로만** 한다(쿠키 없음). 캠페인 페이지는 그 캠페인의 소유 조직이 우선(`resolveWorkspaceSelection`, `useWorkspaceSelection`). 접근 불가 id는 다른 브랜드로 대체하지 않고 `BrandUnavailable`.
- 선택지 목록은 `loadBrandWorkspaceScope`(`service.ts` L263)가 레이아웃에서 한 번 만든다: 멤버십 → 공유 캠페인 게스트 브랜드 → (스태프면) 나머지 모든 브랜드가 `studio`.
- 권한 가드 위치: `profile()` L45(`sign_in_required`), `studio()` L50(`is_admin`), `member()` L53(멤버십·viewer 쓰기 거부), `project()` L66(캠페인 단위: studio/staff/멤버/게스트, `client_visible` 검사), `readableProject()` L91, `memberOrStaff()` L99, `mutation()` L108(트랜잭션+zod). 프로덕션은 `lib/brands/production/service.ts`의 `actor()` L62·`member()` L75·`reader()` L92, 2차 활용은 `lib/brands/usage/core.ts`의 `seat()` L53, 후보는 `brandProjectSeat()`(`service.ts` L316).

### 1.3 'Morphic'이 코드·픽스처·시드에 있는 곳

| 위치 | 내용 |
| --- | --- |
| `lib/campaigns/brand-stories.ts`, `lib/campaigns/case-studies.ts`, `messages/{ko,en}.ts`, `app/(marketing)/[locale]/brands/**`, `components/campaigns/brand-customer-story.tsx` | **공개 마케팅 사례**(`/brands/stories/morphic`, 대표 승인 2026-10-08). 브랜드 워크스페이스와 무관. |
| `tests/brands/concierge-slack.test.ts` | 테스트 픽스처 `{ id: 'deb648e9-…', name: 'Morphic' }` → Slack 핸들 `@morphic` 변환 검사. |
| `lib/brands/concierge-slack.ts` L27 주석 | 예시 문자열 `"Morphic" -> "@morphic"`. |
| `scripts/brand-workspace-fixtures.ts`(로컬 PGlite 스냅샷) | 조직 이름은 `[Local fixture] Sample brand` 등 — **Morphic 없음**. `scripts/campaign-funding-local-qa.ts`는 `TEST ONLY · TWINGS Funding QA`. |
| `brand_organizations` 시드 SQL | 없음. 조직 행은 `createBrandOrganization`(고객)·`createStudioOrganization`(관리자)만 만든다. |

**운영 DB의 Morphic 조직 id·name 값은 이 조사로 알 수 없음**(읽기 전용 저장소 조사). `docs/reviews/MORPHIC-SHARING-READINESS.md`·`docs/CAMPAIGNS.md`에 "MORPHIC 워크스페이스에서 운영한 캠페인"이라는 서술이 있어 운영에 조직이 있을 가능성은 높지만 코드로는 확인되지 않는다.

## 2. 지금 브랜드가 할 수 있는 것 — 라우트별

호스트 규칙(`lib/routing/surfaces.ts`, `middleware.ts`): brand.twings.app은 `brandRouteAllowed` 밖이면 404, 세션 없는 페이지는 `/auth/choose?next=…`, 초대 랜딩만 익명 허용, `GET/HEAD` 아닌 요청은 같은 출처만. 모든 응답 `private, no-store` + nonce CSP(`lib/security/workspace-csp.ts`).

| 라우트 | 화면 목적 | 호출 서비스 함수 | 쓰는 테이블 | 플래그 |
| --- | --- | --- | --- | --- |
| `/brand` | 홈: 캠페인 목록·개수 칩·서비스 안내·조직 만들기(처음 계정)·스태프 "새 캠페인 만들기" | `loadBrandWorkspaceScope`(레이아웃), `loadBrandWorkspace(…,{organizationId})`, `countPendingSharedCampaigns`, `withHomeOverview` | `brand_organizations`, `brand_memberships`, `brand_projects`, `brand_project_members`, `brand_content_versions`, `_decisions`, `brand_attachments`, `brand_posts` | — |
| `/brand/projects/new` | 캠페인 마법사 5단계(§16.3) → `project.create`; 관리자 스태프 보기는 `StudioPrep`(스튜디오 문) | `createBrandProject`(`campaign_terms` 검증 `lib/brands/workspace/campaign-terms.ts`), `loadPromptCatalog`(포맷 카드), 스튜디오: `createStudioOrganization`·`createStudioProject` | `brand_projects`, `brand_workspace_events`, `prompt_items` | 초안은 `localStorage`(`twings.brand.campaign-draft.v1:`) |
| `/brand/projects/[id]` | 캠페인 한 화면 9탭: performance·brief·shortlist·review·applicants·payments·reports·conversation(+files)·contracts(+usage) | `loadBrandProject`, `loadBrandUsage`, `loadProjectCollaboration`·`loadProjectApplicants`(멤버만), `loadFundingProject`, `loadBrandShortlist`·`loadStudioShortlist`, `loadPromptBySlug`; 쓰기: `content.decide`, `message.send`, `attachment.reserve/complete`, `usage.*`, `shortlist.choose/pick` | 0027 전부 + `brand_contract_documents`, `brand_usage_*`, `brand_shortlist_candidates`, `campaigns`·`campaign_applications`·`campaign_participant_invites`·`campaign_collaboration_links`·펀딩 표 | `CAMPAIGN_COLLABORATION_PUBLIC`(초대 가능 여부, **off**), `CAMPAIGN_FUNDING_PUBLIC`+`POLICY_READY`(결제 탭, **off**), `usagePaymentsOpen()`(2차 활용 결제), `TWINGS_INFLUENCERS`(풀 링크, **off**) |
| `/brand/projects/[id]/funding/[orderId]`, `…/funding/return`, `…/funding` | 캠페인 펀딩 견적 결제(토스 위젯) · 복귀 · 탭으로 리다이렉트 | `loadFundingCheckout`, `fundingDeps`, `open()` | 펀딩 주문 표 | 위와 같음; **Tailwind 유틸 클래스**(`mx-auto max-w-3xl`)로 `bw-*` 밖 |
| `/brand/projects/[id]/usage/[caseId]/pay`, `/brand/usage/return` | 2차 활용 견적 결제·복귀 | `loadBrandUsage`, `getTossGateway`, `/api/brand-workspace/usage` | `brand_usage_quotes`·`_payments`·`_grants` | `usagePaymentsOpen()`(`VERCEL_ENV`로 라이브 결제 요구) |
| `/brand/projects/[id]/reports/[reportId]` | 리포트 인쇄 화면 | `loadBrandProject` | `brand_reports` | — |
| `/brand/projects/[id]/participants/[applicationId]` | 참여자 상세(`role==='brand'`만) | `loadParticipation` | 캠페인 참여 표 | — |
| `/brand/studio` | 셀프 스튜디오: 단계 기계(`studioStage`: onboarding→requested→templates-pending→ready→used-up/read-only), 계약·남은 횟수·템플릿·생성 이력, 얼굴 준비 링크(twings.app `/identity/selfie|verify`) | `loadProductionWorkspace`, `loadBrandSupport`+`studioRequestStatus`, `currentSelfie`, `identityStatusFor`·`needsLiveness('seedance-2.5')`, 생성: `POST /api/brand-production` → `createBrandRenderJob` → `reserveProduction`(엔진 `seedance-2.5`만, 계약 기간·`generation_limit`) → `createAuthorizedRender` | `brand_production_*`, `prompt_items(audience='brand')`, `render_jobs`, `brand_attachments`, `brand_support_messages`, `identity_selfies` | `ARK_ASSET_MODE`, `IDENTITY_SELFIE_LIMIT`; `ownFaceConfirmed` 필수(`consent_required`), 저장 셀카 없으면 `identity_required` |
| `/brand/studio/[id]` | 생성 결과(상태 폴링·미디어) | `loadProductionOutput`, `/api/brand-production/[id]`, `…/media` | 위와 같음 | — |
| `/brand/library` | 승인 상태별 콘텐츠 최신 버전 전체 | `loadBrandWorkspace(…,{includeAllContent:true})` | 홈과 같음 | — |
| `/brand/members` | 팀: 멤버 목록·초대·해제(owner), 스태프는 읽기 | `loadBrandMembers`, `invitation.create`→`createBrandInvitation`, `member.revoke`→`revokeBrandMember` | `brand_memberships`, `brand_invites`, `profiles` | — |
| `/brand/settings` | 브랜드명·웹사이트·설명·연락 이메일(owner), 로고 | `loadBrandSettings`, `organization.update`→`updateBrandSettings`, 로고 `POST /api/brand-workspace/organizations/[id]/logo`→`storeBrandOrganizationLogo`, `organization.logo.remove` | `brand_organizations`, `brand_organization_logos`(비공개 staging 버킷) | — |
| `/brand/creators` | 크리에이터 풀(owner·editor): 카드·필터·"캠페인에 초대" | `loadCreatorPool`, `POST /api/brand-creators`→`issueInvitation`+`notifyCampaignInvitation` | `social_accounts`, `campaign_targets`, `campaigns`, `campaign_participant_invites` | `TWINGS_INFLUENCERS=on`(**off** → "준비 중"), `CAMPAIGN_COLLABORATION_PUBLIC` |
| `/brand/invite` | 초대 수락(익명 랜딩, 토큰은 fragment) | `invitation.accept`→`acceptBrandInvitation`(verifiedEmail 일치) | `brand_invites`, `brand_memberships`/`brand_project_members` | — |
| 레이아웃 지원 서랍(`WorkspaceSupport`) | 조직 단위 실시간 문의 | `GET/POST /api/brand-workspace` `support.send`→`sendBrandSupport` + `notifySlackBrandConcierge`, GET 시 `syncSlackConciergeReplies` | `brand_support_messages` | `SLACK_BRAND_CONCIERGE_ENABLED`·`_BOT_TOKEN`·`_CHANNEL_ID`(없으면 Slack 생략, 메시지는 저장) |

API 한눈에: `/api/brand-workspace`(POST 오퍼레이션 19개 = `organization.update|logo.remove|create`, `support.send`, `project.create`, `content.decide`, `message.send`, `invitation.create|accept`, `usage.inquire|message|withdraw|requestChanges|accept`, `member.revoke`, `shortlist.pick|choose`, `attachment.reserve|complete`; GET 지원 메시지), `/api/brand-workspace/studio`(관리자 문, 7개), `/api/brand-workspace/usage`, `/api/brand-workspace/attachments/[id]`, `/api/brand-workspace/organizations/[id]/logo`, `/api/brand-workspace/shortlist/[id]/avatar`, `/api/brand-production`(+`[id]`, `[id]/media`), `/api/brand-creators`, `/api/brand-shortlist-worker/import`(비밀값 전용), `/api/brands/inquiries`(마케팅 의뢰 폼, brand 호스트 밖).

관리자 오퍼레이션(`/admin/do`, `lib/admin/operations.ts`에 스프레드): `BRAND_WORKSPACE_OPERATIONS` 27개(`brandWorkspace.*`: shortlist 5·logo 2·cover·externalPosts·postPresentation·settings·support·revokeInvite·organization·createProject·invite·visibility·revokeAccess·contract·contractShare·metricsBatch·status·content·message·post·metrics·report), `BRAND_PRODUCTION_OPERATIONS` 3개(`brandProduction.contract|template|enabled`), `BRAND_USAGE_OPERATIONS`, `BRAND_OPERATIONS`(`brandInquiry.status`). 관리자 화면: `app/(admin)/admin/brand-workspace/{page,organizations/[id],[id],[id]/reports/[reportId],usage,usage/[caseId]}`.

알림: 브랜드 워크스페이스 자체는 **이메일을 보내지 않는다**(`lib/brands/email.ts`는 마케팅 의뢰 폼의 접수·알림 메일, `lib/brands/service.ts`). 외부 발송은 Slack 컨시어지(`support.send`)와 풀 초대 메일(`notifyCampaignInvitation`, `/api/brand-creators`) 둘뿐. 웹 푸시 없음.

## 3. aesthetic-engine · brief-concierge · service-guide · studio-* — 실동작인가

| 컴포넌트 | 마운트 | 데이터 소스 | 서버 호출 | 판정 |
| --- | --- | --- | --- | --- |
| `aesthetic-engine.tsx`(541줄, client) | 모든 캠페인 `#brief` 하단(`project-detail.tsx` L326) | `LOOKBOOK_PRESETS` 4개 하드코딩(atelier-editorial·city-neon-pace·botanical-daylight·rose-glow-beauty), props `locale`·`referenceLinks` | **없음**(클립보드 복사만) | 정적 목업. 영상 `/reel/brands/{production-paris,city-fashion,tea-editorial}.mp4`·`/reel/campaigns/beauty-rose.mp4`는 `public/`에 있지만 brand 호스트 허용 목록(`STUDIO_DEMO_FILES` 5개)에 없어 **brand.twings.app에서 404**(`tests/routes/brand-host.test.ts` "keeps every other reel path … closed"). 하드코딩 한국어 459개. |
| `brief-concierge.tsx`(936줄, client) | `#brief`(L318) | `GAP_QUESTIONS`·`SAMPLE_CHAOS_MEMO_*` 하드코딩; 파일은 이름만 state에 넣고 바이트를 읽지 않음 | "Argon 분석" = `setTimeout(450ms)`로 단계 전환(L220–226). 최종 "제작 명세서 v{n}" 텍스트를 `message.send`(캠페인) 또는 `support.send`(조직)로 POST(L317–345) → **실제 `brand_messages`/`brand_support_messages` 행 + Slack 전달** | 반(半)목업. UI에 "Argon(Gemini) × Fable 5.1" 모델명이 노출된다(L386–398). 하드코딩 764개. |
| `human-handoff.tsx`(263줄, client) | 탭 위(L201) | 없음 | `message.send`+`support.send`로 "긴급 요청" 저장(L63–83) | 실동작(저장+Slack)이나 "YAGI Executive Producer에게 전달" 같은 SLA 문구는 근거 없음. 하드코딩 189개. |
| `review-stage.tsx`(456줄, client) | `#review`(L331) | **실제** `contents`·`messages`·`decisions` props; 타임코드 핀은 메시지 본문 정규식 | 없음. "무로그인 시사 링크"는 `?share=stakeholder&mode=…&pin=required`를 복사만 하고 **서버에 처리 코드가 0건**(인증 페이지 그대로) | 재생기는 실데이터, 공유 기능은 목업. 콘텐츠 없으면 `/reel/brands/production-paris.mp4`(brand 호스트 404). |
| `service-guide.tsx`(65줄, server) | `/brand` 빈 상태·접힘, `/brand/studio` | 사전 `brandWorkspace.serviceGuide` **있음**, 그 위에 트랙 카드 2장을 하드코딩(`isEn`을 사전 라벨 문자열 비교로 판정) | 없음 | 정적. 문구에 "Argon & Fable structure the brief"·"YAGI PRODUCTION"이 하드코딩. |
| `studio-onboarding.tsx` | `/brand/studio` | 사전(`productionStudio.onboarding`) + `studioStage` | 없음 | 정적 안내, 규칙 준수. |
| `studio-showcase.tsx`(client) | 위 안 | `STUDIO_DEMO` 5파일(허용 목록에 정확히 등록) | 없음 | 정적 예시, 규칙 준수. |
| `production-create.tsx`(client) | `/brand/studio` 템플릿 카드 | props | `POST /api/brand-production`(requestId 멱등) | **실동작**(렌더 큐). |
| `studio-prep.tsx`·`studio-cover-forms.tsx` | `/brand/projects/new`, 캠페인 페이지 스태프 도구 | 사전 | `POST /api/brand-workspace/studio`(`ManagedForm`, `x-twings-studio: 1`) | 실동작(관리자). |
| `support.tsx`(`SupportDrawer`, 411줄) | 레이아웃(멤버; `studio` 역할은 클라이언트 마운트 뒤 `owner`로 **표시만** 승격, 서버는 거부) | 실제 `brand_support_messages` | GET/POST `/api/brand-workspace` | 실동작. 하드코딩 72개, 빠른 문의 칩 4개 하드코딩, "담당 PD 슬랙 채널과 실시간 연동" 문구는 `SLACK_BRAND_CONCIERGE_*` 미설정 시 사실이 아니게 된다. |

테스트 `tests/brands/project-polish-ui.test.tsx` L115–133은 이 레이어의 `data-aesthetic-engine`·`data-brief-intake`·`data-handoff`·`data-mood-dna="atelier-editorial"`·`data-stakeholder-share-bar` 존재를 **단언**하므로, 걷어낼 때 이 테스트도 같이 고친다.

## 4. `bw-*` 토큰 체계와 TOOLBOX Operate 적용 상태

- `app/(brand)/workspace.css`: 3,808줄·189 KB(a2a30f6c에서 +2,321줄). 토큰은 `html[data-brand-workspace]`에 정의: `--bw-*` **3개**(`bw-font`·`bw-line`·`bw-tone`), 실제 색·면 토큰은 `--ys-*` **40개**(`ys-canvas #f8f9fa`, `ys-bg/surface #fff`, `ys-sidebar`, `ys-raised`, `ys-hover`, `ys-glass`, `ys-hairline/line/line-strong`, `ys-ink/-hover/-secondary/-muted`, `ys-accent #3875c5`, `ys-accent-text`(85% 어둡게), `ys-danger #a3392f`, `ys-red=var(--ys-danger)`, `ys-stage #111113`(영상 뒤만) 등). 클래스는 `.bw-*` 334개, `.ys-*` 166개(라이브 컴포넌트가 쓰는 것 46개 — 로고 락업·파워드바이·트랙 카드·리뷰 스테이지; 나머지 120개는 §3의 프로토타입 전용이거나 미사용).
- 레드: `#ed1e1e` 2곳(L1047 `var(--ys-strong, #ED1E1E)`, L1063 지원 말풍선 폴백) 모두 Admin 셸 브리지의 폴백이고, `tests/brands/workspace-taste.test.tsx`가 "red only as a low-chroma danger state"·"keeps the YAGI red out of every shared rule except as an Admin fallback"·"no right-hand rails"·"lockup without the red live dot"·"gliding pill"을 고정한다. `#FAD204` 1곳(지원 미읽음 배지 폴백).
- TOOLBOX §1-2(Operate) 적용: 알라바스터 바탕+흰 프레임(`bw-shell`), 회색 아이콘 사이드바, 큰 제목+개수 칩(`bw-count-chip`), 한 줄 pill 탭(`project-tabs.tsx`가 View Transitions로 글라이드, reduced-motion 존중), 라운드 미디어 그리드(`bw-content-grid`), 다층 주광 그림자+더블 링(주석 "Daylight: several faint layers … double ring"), 동심 반경, `linear()` 스프링 1개. 스튜디오 결과에는 `AmbientBleed`(§1-3 Ambient Color Bleed), 카드에는 `WorkspaceSpotlight`(Cursor-Tracking Spotlight). 기법 수: 홈·라이브러리·멤버·설정 ≈ 4개(프레임·그림자/링·칩/탭·스포트라이트) — 기준 안. 셀프 스튜디오 ≈ 5개(+Ambient Bleed). **캠페인 상세는 §3 레이어 때문에 8개 이상**(다크 시네마 스테이지, 유리 공유 바, 스크럽 타임라인, 컨시어지 배지, 바이럴 카드 …) — "한 화면 3–4개" 원칙 밖.
- 집계: `backdrop-filter` 28, `box-shadow` 128, `gradient(` 15, 그레인 7, `:has()` 15, `prefers-reduced-motion` 5, `mix-blend`·`mask-image`·`clip-path` 0, `@container` 0.
- 사이드바 로고는 `YagiStudioLockup`("YAGI STUDIO") + "Powered by TWINGS"다. brand.twings.app의 브랜드 이름이 TWINGS가 아니라 YAGI STUDIO로 보인다(대표 결정 항목, §8).

## 5. 조직별 기능 정책을 넣을 때 서버가 빠짐없이 막는 훅 지점

### 5.1 한 곳에서 정의

`lib/brands/entitlements.ts`(신규)

```ts
export const BRAND_FEATURES = ['generative_media','sound','color_grading','brand_learning','campaigns','creator_pool','agent_access'] as const;
export type BrandFeature = typeof BRAND_FEATURES[number];
export async function loadBrandEntitlements(sql, organizationId): Promise<Set<BrandFeature>>   // 행 없음 = 전부 허용(denied 목록 방식)
export async function brandFeatureAllowed(sql, organizationId, feature): Promise<boolean>
export class FeatureDenied extends Error { code = 'feature_disabled' }
```

- 저장: `brand_feature_policies(organization_id pk, denied_features text[], note, revision, updated_by, updated_at)` + append-only `brand_feature_policy_events`. **untracked 0074/0150이 정확히 이 모양**(거부 목록 7개 그룹 check 제약, 플랜 `b2b_39|b2b_69|b2b_99`). 그 파일의 소유 에이전트와 합쳐야 하며, 표가 없을 때 "전부 허용"으로 degrade하는 규칙(`socialReady()` 같은 `to_regclass` 검사 패턴, `lib/influencers/rules.ts` L731)을 따른다.
- 기능 이름은 **엔진·라우트가 아니라 제품 능력 그룹**으로 둔다. 새 화면이 그룹에 속하면 그날부터 막힌다.
- `BrandFailureCode`(`lib/brands/workspace/types.ts` L450)에 `'feature_disabled'`를 추가하고 `/api/brand-workspace`의 상태 매핑(route.ts L160–172)에서 403으로 보낸다.

### 5.2 호출 지점(파일·함수)

| 층 | 지점 | 무엇을 하나 |
| --- | --- | --- |
| **서비스 가드(진짜 울타리)** | `lib/brands/workspace/service.ts` `member()` L53, `project()` L66 — 옵션 `feature?: BrandFeature` 추가, 멤버십 확인 직후 `brandFeatureAllowed` 실패 시 `Denied('feature_disabled')`. `mutation()` L108을 통해 모든 쓰기가 지나므로 호출부 19곳이 아니라 이 두 함수만 고친다 | 고객 쓰기·읽기 전부 |
| | `lib/brands/production/service.ts` `reserveProduction()` L397: `member(sql,user,orgId,true)` 다음 줄에 `generative_media` 검사(계약 행 잠금 안, 횟수 차감 전) | 영상 생성 |
| | `lib/brands/usage/core.ts` `seat()` L53, `lib/brands/creator-pool.ts` `poolRole()` L92(`creator_pool`), `lib/brands/shortlist/service.ts` `pickShortlistCandidate`/`chooseShortlistCandidates`(`campaigns`) | 2차 활용·풀·후보 |
| **API 라우트** | `app/api/brand-workspace/route.ts` POST `switch` L66: `OPERATION_FEATURE: Record<operation, BrandFeature|null>` 표로 서비스 호출 전 거부(서비스 가드가 다시 막으므로 이 층은 빠른 실패용) | 19 오퍼레이션 |
| | `app/api/brand-production/route.ts` POST(서비스 가드로 충분, 코드 매핑만), `app/api/brand-creators/route.ts` POST L29–32 뒤, `app/api/brand-workspace/usage/route.ts` | |
| **서버 액션** | 브랜드 표면에 `'use server'`는 **없다**(전부 fetch→API 또는 `/admin/do`·스튜디오 문). 새로 만들지 말고 같은 경로를 쓴다 | — |
| **페이지** | `components/brand-workspace/scope.ts` `brandScope()` L41의 반환값에 `features`를 더하고(`loadBrandEntitlements` 1회), 각 `app/(brand)/brand/*/page.tsx`가 `selectedAccess`처럼 읽는다. 꺼진 기능의 **전용 페이지는 `notFound()`**(brand 호스트의 "존재를 말하지 않는다" 자세, `not-found.tsx` 유지), **탭·섹션은 안내 한 줄**(`bw-note`, 사전 키 `brandWorkspace.access.featureOff`) | 404 또는 안내 |
| **내비(메뉴 숨김)** | `lib/brands/workspace/selection.ts` `sectionVisibility(choice)` L412·`poolVisible` L418·`switchHref` L423 — `BrandWorkspaceChoice`에 `features: BrandFeature[]`를 실어 `loadBrandWorkspaceScope`(L263)가 채운다(브랜드 수만큼 `brand_feature_policies`를 한 번에 읽음). `components/brand-workspace/navigation.tsx` `Links` L95의 `shown`에 반영, `access.ts` `NavigationVisibility`에 새 키 | 메뉴 자체 제거 |
| **관리자 오퍼레이션** | `lib/admin/dispatch.ts` `dispatchAdmin()` L22는 **게이트하지 않는다**(스튜디오는 항상 운영할 수 있어야 한다). 대신 새 오퍼레이션 `brandEntitlement.set`(`lib/admin/brand-entitlement-operations.ts`)을 `lib/admin/operations.ts` L716 레지스트리에 등록하고, 조직 화면 `app/(admin)/admin/brand-workspace/organizations/[id]/page.tsx`에 폼을 둔다. brand 호스트 문(`lib/admin/brand-host-studio.ts` 허용 목록)에는 넣지 않는다(정책 변경은 admin.twings.app에서만, 감사는 `platform_audit`) | 정책 편집 |
| | `brandProduction.contract|template`(계약 생성) 실행 시 `generative_media`가 거부된 조직이면 `fail('invalid', '이 브랜드는 생성 기능이 꺼져 있음')`로 경고 | 모순 방지 |
| **알림** | `lib/brands/concierge-slack.ts` `notifySlackBrandConcierge()`(support.send 뒤)와 `app/api/brand-creators/route.ts`의 `notifyCampaignInvitation` — 서비스 가드가 먼저 거부하면 도달하지 않으므로 별도 분기 불필요; `agent_access`(MCP) 같은 발송형 기능이 생기면 그 송신 함수 첫 줄에서 검사 | |
| **엣지** | `lib/routing/surfaces.ts` `isBrandPath`/`brandRouteAllowed`는 **조직을 모른다**(세션·DB 없음). 기능 차단을 엣지에 두지 않는다. 새 경로 등록만 | — |
| **테스트** | `tests/brands/workspace-security.test.ts`·`staff-workspace.test.ts` 패턴(PGlite + 실제 라우트)으로 "거부 조직의 owner가 생성·초대·풀·2차 활용을 시도하면 403/`feature_disabled`" 추가; `tests/routes/brand-host.test.ts`에 새 경로 | |

## 6. 새 메뉴 '브랜드'(고정 층)와 '만들기'(엔진 실행)

### 6.1 재사용할 것

| 용도 | 재사용 |
| --- | --- |
| 페이지 골격 | `brandContext()` → `brandScope()` → `selectedAccess()` → `BrandUnavailable`/`StaffNotice` (모든 `app/(brand)/brand/*/page.tsx`가 같은 12줄) |
| 쓰기 | `ActionForm`(`operation` + `requestId` 멱등, 하이드레이션 전 비활성, POST 폴백) → `/api/brand-workspace` `switch` + `mutation()`(zod·트랜잭션·`Denied`) |
| 파일 | `BrandUpload` + `attachment.reserve/complete`(서명 업로드, 서버가 바이트 재검사, `brand_attachments` 불변) — 룩 레퍼런스·로고·LUT 파일에 그대로 |
| 상태 기계 | `lib/brands/production/stage.ts` `studioStage()` 방식(순수 함수 + `data-*-stage` 마커) |
| 결과 화면 | `AmbientBleed` + `ProductionResult` 폴링 패턴(`/brand/studio/[id]`) |
| 생성 큐 | `reserveProduction()`→`createAuthorizedRender()` 경로. 얼굴 검증·제공사 검수는 그대로(`ownFaceConfirmed`, `savedSelfiePhoto`, `needsLiveness`) |
| 아이덴티티 스키마 | `lib/design/identity.ts`(`COLOUR`·`ACCENT_MIX`·`TYPE`·`MOTION`·`SHAPE`·`WORLD`·`MODEL_ROLES`·`IMAGERY`·`HARDLINES`, `contrast()`·`mixAccent()`) — BRAND-ENGINE §3이 말한 대로 조직별 `brand_identities` jsonb의 스키마로 복제 |
| 화면 부품 | `bw-heading/bw-title/bw-count-chip`, `bw-panel`, `bw-note`, `bw-empty`, `bw-row/bw-list`, `bw-content-grid/bw-content-card`, `WorkspacePreview`, `ProjectTabs`(해시 탭), 후보 화면의 카드/리스트 토글·선택 막대·상세 시트(`shortlist.tsx`) |
| 사전 | `messages/{ko,en}.ts` `brandWorkspace.*` 블록(ko 약 125키) + `tests/i18n/dictionary.test.ts` |
| 마이그레이션 자세 | 0027/0113 패턴: core(표·check·불변 트리거) + glue(RLS enable+force, `revoke all`, `service_role`에 `select,insert`와 열 단위 `update`) |

### 6.2 피할 것

- `isKo ? "…" : "…"` 하드코딩(§3 레이어 4개와 `service-guide`·`support`가 1,600개 넘게 갖고 있다).
- brand 호스트에서 열리지 않는 `/reel/*` 데모 미디어; 데모가 필요하면 `STUDIO_DEMO_FILES`처럼 정확한 파일명을 허용 목록에 넣는다.
- `setTimeout`으로 흉내 낸 "AI 분석 중", UI의 모델명·에이전트명(Argon·Fable·Gemini) 노출(BRAND-ENGINE §6 "공개 페이지에 엔진 이름을 쓰지 않는다").
- 어두운 셸·오른쪽 레일(TASTE/TOOLBOX), Tailwind 유틸 직접 사용(펀딩 페이지가 선례), 새 `--bw-*`·`.ys-*` 접두 추가(토큰은 `--ys-*`, 클래스는 `.bw-*`로 통일), `localStorage`에 결정 사항 저장(마법사 초안처럼 "이탈 보호"에만).
- 쿠키·서버 "현재 브랜드"(선택은 URL `organizationId`만).

### 6.3 등록 지점(빠뜨리면 404 또는 노출 누락)

| 순서 | 파일 | 변경 |
| --- | --- | --- |
| 1 | `lib/routing/surfaces.ts` `isBrandPath` L257 정규식 | `brand|make`(제안 경로 `/brand/identity`, `/brand/make`) 추가 → GET 허용·세션 게이트·CSP(`needsWorkspaceCsp`가 `isBrandPath`를 읽음)·`authReturnPath` 자동 적용 |
| 2 | 같은 파일 `brandRouteAllowed` L312 | 새 API(`/api/brand-make` 등)는 메서드까지 명시 |
| 3 | `lib/brands/workspace/selection.ts` | `sectionVisibility`·`switchHref`에 섹션 추가(역할·엔타이틀먼트) |
| 4 | `components/brand-workspace/access.ts` `NavigationVisibility`, `navigation.tsx` `entries`, `app/(brand)/layout.tsx` 라벨 props | 메뉴 항목·아이콘·라벨(사전 키) |
| 5 | `messages/ko.ts`·`en.ts` `brandWorkspace` | 문구 |
| 6 | `scripts/sweep-anon.ts` brand 경로 목록(익명 → 로그인 복귀 검사), `tests/routes/brand-host.test.ts` | 검증 |

`lib/i18n/config.ts` `APP_PREFIXES`는 **불필요**: 미들웨어가 `isAppPath(pathname) || isBrandPath(pathname)`로 게이트한다(L131). `/brand`는 twings.app·프리뷰 호스트에서도 열리므로 로컬 검증은 포트 그대로 된다.

### 6.4 '브랜드'·'만들기'의 데이터(제안)

- `brand_identities(organization_id pk, version, colour jsonb, type jsonb, imagery jsonb, lighting jsonb, revision, updated_by)` — 스키마는 `lib/design/identity.ts`와 같은 키.
- `brand_rules(organization_id, kind in (logo, forbidden_phrase, palette_lock, face_consent), payload jsonb)`.
- `brand_memory_events(organization_id, project_id null, kind in (approved_cut, fix, banned_phrase, saved_look), ref jsonb, created_by, created_at)` — append-only(`brand_workspace_immutable()` 재사용).
- `brand_looks(organization_id, name, lut_attachment_id → brand_attachments, measured jsonb)`.
- '만들기'는 `render_jobs` + 새 `brand_make_runs(organization_id, step, instruction, spec jsonb, outputs jsonb)`; 횟수·단가는 엔진 보고서(`repo-engines-pipeline.md`)와 과금 보고서(`repo-billing-b2b.md`) 결론을 따른다.

## 7. TWINGS 제안

1. **엔타이틀먼트는 거부 목록 + 한 함수**로 간다(§5.1). untracked 0074/0150 작성자와 합치고, `member()`/`project()`/`reserveProduction()` 세 곳에 먼저 넣는다. 표가 없으면 전부 허용으로 degrade.
2. **§3 프로토타입 레이어를 캠페인 페이지에서 내린다**(`project-detail.tsx` L201·L318–334, `project-polish-ui.test.tsx` L115–133, `workspace.css` L1479–2992 약 1,514줄). '만들기' 메뉴를 만들 때 `review-stage`의 실데이터 재생기(버전 핀·비교)만 사전화해서 되살린다. 운영에서 지금 고객이 보는 "Argon 분석"·"무로그인 시사 링크"는 동작하지 않는 약속이다.
3. **하드코딩 문구를 사전으로 옮긴다**: `service-guide.tsx`(42), `support.tsx`(72)부터. `tests/i18n/dictionary.test.ts`가 지켜준다.
4. **brand 호스트에서 404 나는 데모 영상**을 바로잡는다(허용 목록 추가 또는 제거).
5. '브랜드' 메뉴는 `lib/design/identity.ts` 스키마를 조직 단위로 옮기는 P0(BRAND-ENGINE §6)부터; 편집기는 설정 페이지의 `ActionForm`+`fieldset disabled`(owner만) 패턴을 복제한다.
6. `concierge-slack.ts`의 하드코딩 폴백 채널 id(`C0B74D4L6MN`)는 환경변수로 뺀다(코드에 운영 식별자).
7. `support.tsx`의 "studio → owner 표시 승격"(`context-links.tsx` L25)은 서버가 거부하므로 안전하지만, 운영자 화면에서 보내기 폼이 보이는 것은 BRAND-STAFF-ACCESS §"지원 메시지"의 "운영자 보기에서 띄우지 않는다"와 어긋난다 — 문서나 코드 중 하나를 맞춘다.

## 8. 대표 결정 필요

1. brand.twings.app 사이드바 브랜드명: 지금은 "YAGI STUDIO · Powered by TWINGS". TWINGS for Brands(BRAND-ENGINE §1)와 맞출지.
2. 캠페인 페이지의 프로토타입 레이어(브리프 컨시어지·룩북·무로그인 공유)를 즉시 내릴지, '만들기' 출시까지 둘지.
3. 엔타이틀먼트 기능 그룹 이름과 수(untracked 0074의 7개: generative_media·sound·color_grading·brand_learning·campaigns·creator_pool·agent_access)와 B2B 플랜 id(`b2b_39|69|99`) — 과금 보고서와 함께 확정.
4. 거부된 기능의 페이지 동작: 404(존재 숨김) vs 안내(업셀). 위 제안은 전용 페이지 404 + 탭 안내.
5. 운영 Morphic 조직의 예외 정책 여부와 범위(코드로는 조직 존재 자체를 확인할 수 없음).
6. 새 메뉴 경로 이름(`/brand/identity`·`/brand/make` 제안)과 한국어 라벨('브랜드'·'만들기').

## 부록 A. 확인하지 못한 것

- 운영 DB 행(조직·멤버십·플랜) 전부. `supabase/migrations/0032`·`0034`·`0037`·`0066`·`0068`·`0070`은 열 이름만 grep했고 본문은 읽지 않았다.
- `lib/renders/*`·엔진 단가·크레딧은 `repo-engines-pipeline.md`·`repo-billing-b2b.md` 담당.
- untracked 0074/0150의 정합성(FK·glue 권한·tolerate 규칙)은 검토하지 않았다.
