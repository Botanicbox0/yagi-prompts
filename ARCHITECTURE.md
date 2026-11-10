# ARCHITECTURE — TWINGS 저장소 지도

> 코드가 원본이고 이 문서는 지도다. 경로가 틀리면 코드를 믿고 이 문서를 고친다.
> 규칙·역할·검증 루프는 `AGENTS.md`, 설계·결정은 `docs/PLATFORM-2.0.md`(소비자·메이커·관리자)와 `docs/BRAND-PRODUCT.md`(brand.twings.app 제품화), 이 저장소의 M0 계획(코드 주석의 "PLAN §n")은 루트 `PLAYBOOK-PLAN.md`(2026-08-12, 코드명 PLAYBOOK = TWINGS)다.
> 폴더마다 한 줄 안내: `app/README.md`, `lib/README.md`, `components/README.md`, `tests/README.md`. 처음 오는 에이전트는 `AGENTS.md` → 이 문서 → `docs/INDEX.md` 순서로 읽고, 그다음은 작업 영역의 원본 문서만 연다.

## 1. 한 줄

Next.js 15 App Router 단일 앱이 호스트별로 세 표면(consumer · brand · admin)을 낸다. 데이터는 Supabase Postgres(로컬은 PGlite 스냅샷), 파일은 Supabase Storage + R2 공개 미디어, 배포는 Vercel(`icn1`), 결제는 토스페이먼츠 단건.

## 2. 표면 → 호스트 → route group

| 표면 (`lib/routing/surfaces.ts`) | 호스트 | route group | 캐시 | 진입 |
| --- | --- | --- | --- | --- |
| consumer | `twings.app`, `www.twings.app` | `app/(marketing)/[locale]/…` (공개, 정적 + 태그 + 1h), `app/(app)/…` (로그인, `force-dynamic` + `private, no-store`) | `lib/cache.ts` 태그 | `middleware.ts` → `lib/i18n/config.ts` (`APP_PREFIXES`가 무접두 (app) 경로 게이트) |
| brand | `brand.twings.app`, `brands.twings.app` | `app/(brand)/brand/…` (projects · creators · library · members · settings · studio · usage · invite) | dynamic | `app/(brand)/layout.tsx` → `lib/brands/workspace/service.ts` |
| admin | `admin.twings.app` | `app/(admin)/admin/…` (brand-workspace · campaigns · community · contests · do · funding · inquiries · landing-media · p · playbooks · policy · prompts · risk · subscriptions) | dynamic | `app/(admin)/layout.tsx`, 모든 변경은 `app/(admin)/admin/do/route.ts` |
| 공통 | — | `app/api/*` (상위 27개), `app/auth/*`(callback · signin · signout · review), `app/actions/locale.ts`, `app/creative-media/[file]`, `app/.well-known/*` | — | `vercel.json` cron: `/api/renders/tick` 18:00 UTC, `/api/brands/inquiries/tick` 19:00 UTC |

호스트 판정과 CSP: `lib/routing/surfaces.ts`, `lib/security/workspace-csp.ts`. 로컬/클라우드 스위치: `lib/runtime-mode.ts` (`PLAYBOOK_MODE=local` → PGlite + `.storage/`).

## 3. lib 도메인 (41)

| lib | 역할 | 진입 파일 | 주 테이블 | tests |
| --- | --- | --- | --- | --- |
| `admin` | 관리자 오퍼레이션 레지스트리(`ADMIN_OPERATIONS` = 15개 `*-operations.ts` 병합) + 읽기 모델 | `operations.ts`, `dispatch.ts`, `repo.ts` | 전 도메인 | `tests/admin` |
| `ark` | BytePlus ModelArk 영상 생성 API 경계 | `client.ts`, `assets.ts` | `render_jobs` | `tests/ark` |
| `auth` | 세션 viewer 해석, `requireAdmin`, dev identity | `viewer.ts` | `profiles` | `tests/auth` |
| `billing` | 토스 단건 결제·웹훅·정산 대조. Stripe 파일은 은퇴한 구독용 | `toss-service.ts`, `toss-gateway.ts`, `ledger.ts` | `billing_payments`, `subscriptions`, `stripe_events` | `tests/billing` |
| `brands` | 브랜드 문의(`service.ts`), 워크스페이스(`workspace/`), 제작 계약(`production/`), 후보 공유(`shortlist/`), 2차 활용(`usage/`), Slack, **기능 정책·플랜**(`features.ts`·`entitlements.ts`·`plans.ts`, `docs/BRAND-PRODUCT.md` §4·§6) | `workspace/service.ts`, `repo.ts`, `entitlements.ts` | `brand_*` (0027~0037, 0066, 0074) | `tests/brands` |
| `campaigns` | 캠페인 도메인·상태 머신, 협업(`collaboration/`), 펀딩(`funding/`), 리스크 워커(`risk/`) | `repo.ts`, `service.ts`, `schemas.ts` | `campaigns`, `campaign_*` | `tests/campaigns` |
| `content` | 레거시 playbook 블록 CMS(schemas·load·shape·facade) + 랜딩 미디어 슬롯(`landing-media*.ts`) + 공개 카탈로그 projection | `catalog.ts`, `load.ts`, `landing-media.ts` | `playbooks`, `steps`, `blocks`, `landing_media` | `tests/content` |
| `contests` | 콘테스트(관리자 미리보기만 사용 중) | `repo.ts` | `contests`, `contest_entries` | `tests/contests` |
| `cookies` | 크레딧 지갑(unlock·purchase). HTTP 쿠키 아님 | `repo.ts`, `wallet.ts` | `cookie_ledger`, `prompt_unlocks` | `tests/cookies` |
| `creator-platform` | AI 크리에이티브(메이커) 지원·온보딩·정산·보상 | `service.ts`, `onboarding.ts`, `admin.ts` | `platform_*` (0046, 0051) | `tests/creator-platform` |
| `creator-subscriptions` | 크리에이터 월 구독(미출시, 플래그) | `service.ts` | `creator_subscription*` | `tests/creator-subscriptions` |
| `creators` | 표시 이름 프로필 | `profile.ts` | `profiles` | `tests/creators` |
| `db` | `SqlRunner` 팩토리(PGlite/Postgres), 마이그레이션 적용 | `connect.ts`, `sql-runner.ts` | — | `tests/db` |
| `design` | 디자인 아이덴티티 상수(`docs/design/IDENTITY.md`의 코드판) | `identity.ts` | — | `tests/design` |
| `events` | 퍼널 이벤트 6종 | `track.ts` | `events` | `tests/events` |
| `faq` | FAQ 카탈로그·JSON-LD | `catalog.ts` | — | (없음) |
| `i18n` | 로케일 규칙, `APP_PREFIXES` 엣지 게이트, 사전 로더 | `config.ts`, `dictionaries.ts` | — | `tests/i18n` |
| `identity` | 정면 셀카 보관·실인물 자산·회전 | `selfie-service.ts`, `service.ts` | `identity_selfies`, `identity_groups/assets` | `tests/identity` |
| `images` | 이미지 엔진(Seedream·GPT Image·Gemini) | `engines.ts` | — | `tests/images` |
| `influencers` | SNS 계정 연동·팔로워 검증 워커 | `service.ts`, `worker.ts`, `rules.ts` | `social_accounts`, `social_verify_workers` | `tests/influencers` |
| `kling` | Kling 공식 API 어댑터 | `client.ts`, `models.ts` | — | `tests/kling` |
| `legal` | 약관·환불·개인정보 원문(문구 단일 원본) | `documents.ts` | — | `tests/legal` |
| `makers` | AI 크리에이티브 공개 프로필·대표작·토큰 | `profile.ts`, `works.ts` | `platform_creators`, `maker_works`, `maker_tokens` | `tests/makers` |
| `mcp` | TWINGS MCP 서버(`app/api/mcp`) | `server.ts` | — | (없음) |
| `media` | 미디어 토큰·권한, 카드 arming | `authorize.ts`, `token.ts` | — | `tests/media` |
| `mobile` | 스토어 브리지(`.well-known`) | `store-bridge.ts` | — | `tests/pwa/store-bridge.test.ts` |
| `motion` | 스크롤 모션 기하(순수) | `geometry.ts` | — | `tests/motion` |
| `navigation` | 개인 · 브랜드 audience 네비 | `audience.ts` | — | `tests/navigation` |
| `notify` | 이메일(Resend)·웹푸시·워커·템플릿 | `service.ts`, `worker.ts`, `push.ts` | `notification_*`, `push_subscriptions` | `tests/notify` |
| `premium-editing` | 구독 프롬프트 해석 guard·privacy | `service.ts`, `guard.ts` | — | `tests/premium-editing` |
| `prompts` | **템플릿**(`prompt_items`): 저장소·스키마·카탈로그·추천순·이미지 세트 | `repo.ts`, `schemas.ts`, `catalog.ts`, `recommended.ts` | `prompt_items`, `platform_format_assets` | `tests/prompts` |
| `publish` | CMS 발행 2단계 파이프라인 | `pipeline.ts` | `publish_assets` | (없음, `tests/content`) |
| `recipes` | 레시피 v2(단계·슬롯·실행·자산) | `repo.ts`, `execute.ts`, `schema.ts` | `render_job_recipes`, `recipe_unlocks` | `tests/recipes` |
| `renders` | 렌더 잡 생성·패스·ETA·공유·포스터·알림 | `service.ts`, `engines.ts`, `repo.ts` | `render_jobs`, `render_job_outputs` | `tests/renders` |
| `routing` | 표면·호스트 판정, 안전 반환 경로 | `surfaces.ts` | — | `tests/routes` |
| `security` | 워크스페이스 CSP·nonce | `workspace-csp.ts` | — | `tests/security` |
| `seo` | 사이트맵·robots·JSON-LD·메타 | `sitemap.ts`, `structured-data.ts` | — | `tests/seo` |
| `storage` | 스토리지 드라이버(local · supabase · R2 공개 미디어 직접 쓰기) | `index.ts` | — | `tests/storage` |
| `supabase` | auth/data/service 클라이언트 팩토리 | `auth-client.ts`, `service-client.ts` | — | (없음) |
| `twings` | 가격·원가 플로어·템플릿 가격·크레딧·해상도·구독 플랜·viewer access | `template-price.ts`, `cost-model.ts`, `products.ts` | `prompt_items.price_cents` | `tests/twings` |
| `video` | 영상 모델 뷰(ark + kling) | `models.ts` | — | `tests/video` |
| 루트 | `cache.ts`(태그·revalidate), `flags.ts`(코드 플래그), `runtime-mode.ts`(`PLAYBOOK_MODE`), `marquee.ts` | — | — | `tests/runtime` |

사전: `messages/ko.ts`·`en.ts`(최상위 그룹 56개) + `admin-workflow`·`campaign-collaboration`·`campaign-funding`·`campaign-risk`. 하드코딩 금지, `tests/i18n/dictionary.test.ts`가 검사.

## 4. 요청 흐름 3개

### 4.1 템플릿 결제 → 렌더
`app/(marketing)/[locale]/t/[slug]/page.tsx` (가격·CTA: `lib/twings/products.ts`, `lib/prompts/public-catalog.ts`, `components/templates/make-sheet.tsx`)
→ `app/(app)/billing/toss/checkout.tsx` → `POST app/api/billing/toss/orders` (`lib/billing/toss-service.ts` `createTossOrder`)
→ `app/api/billing/toss/confirm/route.ts` (`confirmTossOrder` → `lib/renders/runtime.ts`, 셀카는 `lib/identity/selfie-service.ts`)
→ `lib/renders/service.ts` `createRenderJob` → `render_jobs`
→ 패스: `app/api/renders/tick/route.ts`(cron) `runRenderPass` → `lib/ark/client.ts` 또는 `lib/images/*` / `lib/kling/client.ts`; 콜백 `app/api/renders/callback/route.ts`
→ 결과 `app/(app)/renders/[id]/page.tsx`, 공유 `app/(app)/r/[id]/[token]`, 알림 `lib/notify/*`
→ 웹훅 `app/api/billing/toss/webhook/route.ts` (`reconcileTossWebhook`, 2차 활용·캠페인 펀딩 결제도 정리)

### 4.2 브랜드 캠페인 생성
`brand.twings.app` → `middleware.ts` (`resolveSurface`=brand) → `app/(brand)/layout.tsx` (`loadBrandWorkspace`)
→ `app/(brand)/brand/projects/new/page.tsx` (`components/brand-workspace/campaign-wizard.tsx`, 템플릿 선택 `lib/prompts/catalog.ts`)
→ `POST app/api/brand-workspace/route.ts` → `lib/brands/workspace/service.ts` `createBrandProject` → `brand_projects`
→ 상세 `app/(brand)/brand/projects/[id]/page.tsx` (`lib/brands/usage/*`, `lib/campaigns/funding/*`, `lib/campaigns/collaboration/*`, `lib/brands/shortlist/service.ts`)
→ 스튜디오 측 처리: `app/(admin)/admin/brand-workspace/*` + `lib/admin/brand-workspace-operations.ts`

### 4.3 관리자 오퍼레이션
`app/(admin)/admin/*/page.tsx` 폼 → `POST app/(admin)/admin/do/route.ts`
→ `lib/admin/dispatch.ts` `dispatchAdmin` (`requireAdmin` 재확인 → 이름 조회 → zod)
→ `lib/admin/operations.ts` `ADMIN_OPERATIONS[name]` (prompt · contest · campaign(+production·risk·collaboration·funding) · brand(+workspace·usage·production) · platform · social · landing-media)
→ 도메인 lib 변경 → `lib/cache.ts` `revalidate*` → `outcomeUrl`로 리다이렉트

## 5. 어디를 고치면 되나

| 하고 싶은 것 | 고칠 곳 | 같이 볼 것 |
| --- | --- | --- |
| 템플릿 가격·판매 상태 문장 | `lib/twings/template-price.ts`, `lib/twings/products.ts` (`storefrontOpen`) | AGENTS §5 가격은 대표 결정 |
| 새 (app) 경로 | `app/(app)/…` + `lib/i18n/config.ts` `APP_PREFIXES` | `tests/routes/app-boundaries.test.tsx`, `scripts/sweep-anon.ts` |
| 새 관리자 동작 | `lib/admin/<domain>-operations.ts`에 추가 → `operations.ts` spread | `tests/admin` |
| 사용자 문구 | `messages/ko.ts`·`en.ts` | Gemma 워딩 경로(AGENTS §2), `tests/i18n` |
| 템플릿 카탈로그 순서 | `lib/prompts/recommended.ts` | `lib/cache.ts` `revalidatePrompts` |
| 결제·웹훅 | `lib/billing/toss-*.ts`, `app/api/billing/toss/*` | Director 전용(AGENTS §2), `tests/billing`, `tests/routes/toss-payment-routes.test.ts` |
| 얼굴·셀카·렌더 안전 장치 | `lib/identity/*`, `lib/renders/*`, `lib/ark/*` | 우회 금지(AGENTS §4) |
| 약관 문구 | `lib/legal/documents.ts` | 대표 승인 |
| 스키마 | `supabase/migrations/NNNN_core_*.sql` + `NNNN_glue_*.sql` → `npm run db:local` | `supabase/README.md` 운영 적용 원장, PR 본문 "클라우드 적용 필요" |
| 랜딩 미디어 슬롯 | `lib/content/landing-media*.ts`, `/admin/landing-media` | `docs/CONTENT-SLOTS.md` |
| 호스트·CSP | `lib/routing/surfaces.ts`, `lib/security/workspace-csp.ts`, `middleware.ts` | `tests/routes/workspace-hosts.test.ts` |

## 6. 환경·플래그

- 환경변수 목록·로컬/클라우드 스위치: `docs/SETUP.md` §0, `lib/runtime-mode.ts`, `.env.example`.
- 코드 플래그: `lib/flags.ts` (`RENDER_PIPELINE_PUBLIC`, `PLAYBOOKS_IN_NAV=false`, `ASSET_LIBRARY_MODE` 등). 환경 플래그: `TWINGS_COMMUNITY`·`TWINGS_FORMAT_CREATORS`·`TWINGS_CREATOR_APPLICATIONS`·`TWINGS_IMAGE_REWARDS`(전부 off), `CREATOR_SUBSCRIPTION_PUBLIC`, `PREMIUM_EDITING_ENABLED`, `CAMPAIGN_*_PUBLIC`.

## 7. 검증 매트릭스

| 명령 | 범위 | CI |
| --- | --- | --- |
| `npx tsc --noEmit` | app · lib · components · tests · scripts (tsconfig include 전체) | `ci.yml` |
| `npx vitest run` | `tests/**/*.test.ts(x)` 378파일, PGlite per suite, `pool: forks` | 4 shard |
| `npm run build:local` / `start:local` | `PLAYBOOK_MODE=local` 강제 | `ci.yml` build job |
| `npm run sweep:anon` | 익명 방문자 1,000+ 체크, `data-*` 마커 157종 | `ci.yml` |
| `npm run security:client` / `security:built` | 서버 키가 클라이언트 번들에 없는지 | `ci.yml` |

## 8. 이름 유산 (바꾸지 않는 이유와 읽는 법)

| 보이는 이름 | 읽는 법 |
| --- | --- |
| GitHub `yagi-prompts`, Vercel `yagi-prompts`, `package.json` `playbook` | = TWINGS. 외부 연결이라 유지 |
| `PLAYBOOK_MODE`·`PLAYBOOK_LOCAL_DB`·`PLAYBOOK_DEV_IDENTITY` | 로컬/클라우드 스위치. 이름 유지 |
| `PLAYBOOK-PLAN.md`, 코드 주석 "PLAN §n" | 2026-08-12 M0 계획. 설계의 현행 원본은 `docs/PLATFORM-2.0.md` |
| `playbooks`·`steps`·`blocks` 테이블, `lib/content`·`lib/publish`·`components/playbook`, `/[locale]/p/[slug]`, `/library`, `/admin/playbooks` | 레거시 블록 CMS. 네비에서 숨김(`PLAYBOOKS_IN_NAV=false`), 라우트는 살아 있음 |
| `lib/prompts`, `prompt_items` | = 템플릿 |
| `lib/cookies` | = 크레딧 지갑 |
| `lib/twings` | = 가격·자격 규칙 |
| `lib/makers`·`lib/creator-platform`·`app/(app)/creators`·`/[locale]/makers/[handle]` | = AI 크리에이티브(공급자). `lib/influencers`·`app/(app)/campaigns` = 캠페인 크리에이터 |
| `lib/billing/stripe-*`, `/api/stripe/webhook`, `/billing/retired.ts` | 은퇴한 구독. 현행 결제는 토스 |
