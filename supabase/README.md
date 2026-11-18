# Migrations

Ordered SQL files, applied by filename. There is **no Supabase CLI and no Docker** on the
execution machine (PLAN §11 open item), so these are applied to the cloud project via the Supabase
MCP `apply_migration` once the project exists (docs/SETUP.md), and are verified locally on
[PGlite](https://pglite.dev) inside vitest.

## The core / glue split

| Prefix | Applied by | Contents |
|---|---|---|
| `*_core_*` | PGlite acceptance **and** the cloud project | Everything that runs on stock Postgres: tables, enum, constraints, the composite FK, the `publisher` role, the immutability triggers, `prepare_publish` / `publish_revision`. |
| `*_glue_*` | the cloud project only | Anything that binds to Supabase-managed schemas or roles: RLS enable/force + `anon`/`authenticated` revokes, `service_role` grants, `publisher` BYPASSRLS, storage buckets. |

`tests/helpers/pglite.ts` selects files by that substring, so a new migration is picked up by the
acceptance run automatically — name it `NNNN_core_*.sql` or `NNNN_glue_*.sql` and nothing else.

### The `auth.users` stub

`profiles.id references auth.users on delete cascade` stays in the **core** migration, because it is
part of the real schema. The PGlite harness creates a minimal

```sql
create schema auth;
create table auth.users (id uuid primary key);
```

**before** applying migrations. That stub deliberately lives in the test harness, never in a
migration file — on Supabase, `auth.users` belongs to GoTrue.

## Files

| File | What it establishes |
|---|---|
| `0001_core_roles_helpers.sql` | The `publisher` role (the non-spoofable privileged channel), `is_localized_complete()`, `asset_ext()`, `set_updated_at()`. |
| `0002_core_schema.sql` | PLAN §6 domain model verbatim, `default_policy` seed rows, read-path indexes. |
| `0003_core_guards.sql` | `updated_at` triggers + the five immutability constraint triggers. |
| `0004_core_publish_rpcs.sql` | `canonical_manifest()`, `prepare_publish()`, `publish_revision()`, ownership + grants. |
| `0100_glue_rls.sql` | RLS **enabled and forced, no policies**, on all 12 tables; revokes; `publisher` BYPASSRLS; RPC EXECUTE granted to `service_role` only. |
| `0101_glue_storage.sql` | The four buckets and the record that storage RLS is intentionally policy-free. |

## Two things that will bite on a fresh cloud project

1. **`publisher` needs `BYPASSRLS`.** RLS is `FORCE`d, which applies to table owners too. The
   `publisher` role owns no table, so without BYPASSRLS every publish RPC fails. `0100_glue_rls.sql`
   sets it and raises a warning if the migration runner lacks the privilege — if you see that
   warning, run `ALTER ROLE publisher WITH BYPASSRLS;` as a superuser.
2. **Function ownership.** `0004` does `alter function … owner to publisher`, which requires the
   runner to be a member of `publisher`. `0001` grants that membership and tolerates failure with a
   notice; if ownership does not stick, `current_user` inside the RPCs will not be `publisher` and
   every guard will reject the publish path. `tests/db/migrations.test.ts` asserts the ownership.

## Deleting published content

By design there is no path. The DELETE guards reject any removal of a non-draft revision, and the
composite FK holds the current pointer. Removing a published playbook is a deliberate maintenance
operation for a superuser, and it is not something app code can do — that is the point.

## 운영 적용 이력 (Supabase 프로젝트 `nhokkikjkzjalxqsbzuk`)

적용은 대표 또는 Director가 MCP `apply_migration`으로 한다. 코드 배포 **전**에 적용한다. 아래는 2026-10-23 기준 원장이며, `list_migrations`로 다시 확인할 수 있다.

| 날짜 | 적용 이름 | 파일 | PR |
| --- | --- | --- | --- |
| 2026-10-15 | `core_creator_platform_0046_with_glue_0131` | 0046 + 0131 | #54 |
| 2026-10-15 | `core_campaign_operational_0045_0047_0048_0049_with_glue`, `0135_…`, `0136_…` | 0045·0047~0049 + glue | #55 |
| 2026-10-22 | `0052_core_billing_failure` | 0052 | #78 |
| 2026-10-23 | `0050_core_identity_selfies_with_glue_0137` | 0050(수정본) + 0137 | #76/#81 |
| 2026-10-23 | `0051_core_creator_onboarding_with_glue_0138` | 0051 + 0138 | #79 |
| 2026-10-23 | `0053_core_push_subscriptions_with_glue_0139` | 0053 + 0139 (`profiles.email` NOT NULL 해제 포함) | #80 |
| 2026-10-23 | `0054_core_profile_onboarding` | 0054 | #82 |
| 2026-10-23 | `0055_core_render_finishing` | 0055 (`render_jobs.finishing_at`, `poster_key`) | #87 |
| 2026-10-23 | `0056_core_brand_campaign_terms_with_glue_0140` | 0056 + 0140 | #89 |
| 2026-10-23 | `0057_core_social_accounts_with_glue_0141` | 0057 + 0141 | #90 |
| 2026-10-23 | `0058_core_campaign_designated_invites` | 0058 (glue 없음) | #91 |
| 2026-10-23 | `0059_core_maker_recipes` · `0142_glue_maker_recipes` | 0059 + 0142 (레시피 v2 표·컬럼, 브라우저 롤 차단) | #95 |
| 2026-10-23 | `0060_core_maker_profiles` · `0143_glue_maker_profiles` | 0060 + 0143 (메이커 핸들·공개 프로필·트리거 2개) | #94 |
| 2026-10-24 | `0061_core_render_providers` | 0061 (`render_jobs.provider` CHECK에 kling·google, glue 없음) | #97 |
| 2026-10-28 | `0066_core_brand_shortlist` · `0146_glue_brand_shortlist` | 0066 + 0146 (캠페인 크리에이터 후보 표, 서버 롤 전용) | #113 |
| 2026-10-28 | `0062_core_render_jobs_scale_indexes` | 0062 (`render_jobs` 인덱스 2개, 10/25 커밋 `36f1347` 뒤 누락돼 있던 것) | #114 |
| 2026-10-29 | `0068_core_brand_shortlist_triage` · `0148_glue_brand_shortlist_triage` | 0068 + 0148 (후보 선별: 제외 표시·사진 주색·캠페인 기준 범위, `shortlist_criteria` 서버 롤 update) | #121 |
| 2026-10-29 | `0069_core_maker_bio_en` | 0069 (`platform_creators.bio_en`, `/en` 메이커 소개. glue 없음 — 0131 거부 자세 상속) | #125 |
| 2026-10-29 | `0070_core_brand_shortlist_choice` | 0070 (고객 선별: `passed_at/by` 제외 표시, `confirmed_at` 섭외 확정, 선호·제외 동시 금지 제약. glue 없음) | #126 |
| 2026-10-30 | `0065_core_creative_profiles` · `0145_glue_creative_profiles` · `0071_core_creative_cover` | 0065 + 0145 (`platform_creators` 프로필 칸 10개, `maker_works`·`recipe_unlocks`·`maker_tokens` 서버 롤 전용, RLS 강제) + 0071 (`platform_creators.cover_key`, glue 없음) | #111 |
| 2026-11-02 | `0073_core_maker_payout` | 0073 (`platform_creators.payout` company/external, `royalty_krw` CHECK 0~5,000, glue 없음). 적용 직후 @yunseolfromseoul(`a14d387f-…`)을 `company`로 바꿈 | #174 |
| 2026-10-30 | `0067_core_landing_media` · `0147_glue_landing_media` | 0067 + 0147 (`landing_media` 랜딩 미디어 슬롯, RLS 강제, anon·authenticated 권한 없음, 서버 롤만 쓰기) | #116 |
| 2026-11-03 | `0074_core_brand_entitlements` · `0150_glue_brand_entitlements` | 0074 + 0150 (`brand_feature_policies`·`brand_feature_policy_events`·`brand_plan_assignments`·`brand_plan_events`, RLS 강제, 서버 롤 전용). 적용 직후 Morphic(`deb648e9-…`) 차단 정책(`generative_media`·`sound`·`color_grading`) 반영 | #176 |
| 2026-11-03 | `0075_core_brand_identity` · `0151_glue_brand_identity` | 0075 + 0151 (`brand_identities`·`brand_identity_events`·`brand_memory_events`·`brand_looks`, RLS 강제, 서버 롤 전용) | #181 |
| 2026-11-10 | `0076_core_brand_studio` · `0077_core_brand_studio_film` · `0152_glue_brand_studio` | 0076 + 0077 + 0152 (`brand_studio_assets`·`brand_studio_jobs`·`brand_studio_outputs`·`brand_studio_allowances`·`brand_studio_lanes`, 에셋의 `film_sheets`; RLS 강제, 정책 없음, 서버 롤 전용). 브랜드 스튜디오 v2(`docs/BRAND-STUDIO-V2.md`). 적용 뒤 다섯 테이블 모두 anon·authenticated 권한 없음 확인 |
| 2026-11-06 | `0042`~`0044` · `0127`~`0129` | 0042~0044 + 0127~0129 (월 구독·프리미엄 수정·출시 증빙 테이블, RLS 강제, 서버 롤 전용) | 정기결제(`bill_twinglnyl`) 심사 반영 |

| 2026-11-11 | `0080_core_brand_studio_review` · `0155_glue_brand_studio_review` · `0081_core_brand_studio_library` · `0154_glue_brand_studio_library` | 브랜드 스튜디오 v3(`docs/BRAND-STUDIO-V3.md`): 리뷰 공간(`brand_studio_reviews`·`brand_studio_review_comments`)과 보관함(`brand_studio_folders`·`brand_studio_folder_items`·`brand_studio_likes`). core와 glue를 한 트랜잭션으로 적용(원장 이름 `0080_0155_brand_studio_review`, `0081_0154_brand_studio_library`). 적용 뒤 다섯 테이블 모두 RLS 강제·정책 0개·anon·authenticated 권한 없음 확인 |
| 2026-11-11 | `0078_core_template_cast` · `0079_core_render_slot_inputs` · `0153_glue_render_slot_inputs` | 템플릿 cast 축(`prompt_items.cast_kind`, 기본 'solo')과 추가 사진 자리(`render_slot_inputs`; RLS 강제, 정책 없음, 서버 롤 전용). `docs/CAST-CATEGORIES.md`, PR #197. 0079와 0153은 한 트랜잭션으로 적용(원장 이름 `0079_0153_render_slot_inputs`). `TWINGS_PET_TEMPLATES`·`TWINGS_COUPLE_TEMPLATES`는 꺼져 있다 |
| 2026-11-11 | `0082_core_brand_room_messages` · `0156_glue` · `0083_core_brand_storyboards` · `0157_glue` · `0084_core_brand_room_review` · `0158_glue` | 프로젝트 룸(`docs/BRAND-ROOMS.md`): 대화(`brand_room_messages`·`brand_room_reactions`·`brand_room_reads`), 스토리보드(`brand_storyboards`·`brand_storyboard_frames`), 공유 링크(`brand_room_shares`·`brand_room_share_visits`), 리뷰 확장(`brand_studio_reviews`의 project_id·stack_id·version·source, `brand_studio_review_comments`의 end_ms·strokes·guest_name·share_id·carried_from, `brand_studio_assets.source`에 'delivery'). core와 glue를 한 트랜잭션으로 적용(원장 이름 `0082_0156_…`, `0083_0157_…`, `0084_0158_…`). 적용 뒤 새 테이블 일곱 개 모두 RLS 강제·정책 0개·anon·authenticated 권한 없음 확인 |
| 2026-11-11 | `0159_glue_function_hardening` | DB 권고 반영: 트리거 함수 `guard_brand_prompt`·`release_brand_production_failure`의 `search_path` 고정, 운영에만 있던 `brand_shortlist_enforce_collaboration_cap()`의 anon·authenticated 실행 권한 회수(파일에 없는 함수라 존재할 때만 실행) | 서비스 검수 |
| 2026-11-12 | `0085_core_brand_projects_intake_and_rooms` · `0160_glue_brand_projects_intake_and_rooms` | 프로젝트 의뢰·룸 개편(`docs/BRAND-PROJECTS-E.md`) 및 B2B 플랜 개편(대표 결정 2026-11-12: `b2b_29`·`b2b_49`·`b2b_69`·`project_only`, `brand_feature_policies`에 `self_studio`, `brand_projects.intake_brief` jsonb + `service_role` update 권한, `brand_room_shares.unlock_buckets` jsonb, `idx_brand_room_share_visits_cleanup`). 한 트랜잭션으로 적용 | #207 |
| 2026-11-12 | `0086_core_brand_storage_quotas` · `0161_glue_brand_storage_quotas` | 조직별 저장 공간 한도 및 변경 감사 로그(`docs/BRAND-STORAGE-QUOTAS-F.md`, 대표 결정 2026-11-12: 29만 `200 GB` / 49만 `400 GB` / 69만 `800 GB` / `project_only` `50 GB`+`90일` / 미배정 `50 GB`, `brand_storage_quotas`·`brand_storage_quota_events`, RLS 강제, 정책 0개, 서버 롤 전용). 한 트랜잭션으로 적용 | #209 |
| 2026-11-14 | `0087_core_brand_studio_projects_workflows_mcp` · `0162_glue_brand_studio_projects_workflows_mcp` | 스튜디오 Pro Suite v4(`brand_studio_video_projects`·`brand_studio_workflows`·`brand_studio_playbooks`·`brand_studio_mcp_tokens`, `brand_studio_assets.film_sheets_updated_at`·`film_sheets_expires_at`). 한 트랜잭션으로 적용(원장 이름 `0087_0162_brand_studio_projects_workflows_mcp`). 적용 뒤 네 테이블 모두 RLS 강제·정책 0개·anon·authenticated 권한 없음 확인 | #215 |
| 2026-11-14 | `0064_core_account_deletion_requests` · `0144_glue_account_deletion_requests` | 셀프 계정 삭제(`docs/RUNBOOK-deletion.md`: `account_deletion_requests`; PR #201 통합분, 닫힌 PR #101 옛 파일 미사용). 한 트랜잭션으로 적용(원장 이름 `0064_0144_account_deletion_requests`). 적용 뒤 `RLS=true, FORCE=true`·정책 0개·anon·authenticated 권한 없음 확인 | #217 |
| 2026-11-14 | `0088_core_personal_v2_studio_maker_iap` · `0163_glue_personal_v2_studio_maker_iap` | 개인 v2 선택 컷(`selected_frames`), Hydrogen 디렉터(`director_spec`), 슬롯(`look_ref`/`prop_ref`/`scene_ref`), 키프레임(`keyframes`), 오픈 메이커(`contains_person`, `attested_at`, `attestation_version`), 스토어 격리 IAP 원장(`store_iap_wallets`, `store_iap_transactions`), `giant-daydream` 1440×1080 치수 보정. 한 트랜잭션으로 적용(원장 이름 `0088_0163_personal_v2_studio_maker_iap`). 적용 뒤 두 새 테이블 모두 `RLS=true, FORCE=true`·정책 0개·anon·authenticated 권한 없음 확인 | #217 |
| 2026-11-15 | `0089_core_identity_selfie_photo_check` | 저장한 사진 권고 확인(`identity_selfies.photo_check`·`photo_checked_at`, glue 없음; 대표 지시 2026-11-15) | #223 |
| 2026-11-16 | `0090_core_brand_studio_job_soft_delete` · `0164_glue_brand_studio_job_soft_delete` | 브랜드 스튜디오 실패·중단 작업을 벽에서 지우기(`brand_studio_jobs.deleted_at` 소프트 삭제; 적용 후 확인: 컬럼 존재, RLS on+forced, 브라우저 권한 0, 기존 9행 영향 없음; 대표 지시 2026-11-16) | #226 |
| 2026-11-16 | `0091_core_brand_studio_job_project` · `0165_glue_brand_studio_job_project` | 스튜디오 실행을 프로젝트에 담기(`brand_studio_jobs.project_id`, 프로젝트는 0087의 `brand_studio_video_projects` 재사용; 적용 후 확인: 컬럼 uuid·nullable, 제약 2개와 인덱스 존재, 두 테이블 RLS on+forced, 브라우저 권한 0건, 기존 실행 9건 모두 project_id 없음). 기능은 `BRAND_STUDIO_PROJECTS`가 꺼져 있어 아직 닫혀 있다 | PR #241 |
| 2026-11-18 | `0093_core_brand_review_team_notes` · `0166_glue_brand_review_team_notes` | 시안 리뷰의 팀 메모(`brand_studio_review_comments.visibility` 'public'\|'team', `docs/BRAND-ROOMS-FEEDBACK.md` §5; 적용 후 확인: 컬럼 존재, 제약 2개, 기존 행 전부 public(team 0건), RLS on+forced·정책 0개, anon·authenticated 권한 없음) |
| 2026-11-18 | `0094_core_brand_room_notices` · `0167_glue_brand_room_notices` | 프로젝트 룸 고객 알림 대기열과 수신 설정(`brand_room_notices`·`brand_room_notice_prefs`, `docs/BRAND-ROOMS-FEEDBACK.md` §2; 적용 후 확인: 두 테이블 RLS on+forced·정책 0개, anon·authenticated 권한 없음, service_role만). 발송은 `BRAND_ROOM_NOTIFY=on` 전까지 없다 |

미적용: 0029/0115(옛 portrait 비교, 폐지 경로). 0063(prom-queen 비율)은 원장에 없지만 운영 데이터에는 이미 반영돼 있다.

**클라우드 적용 필요(미적용)**: `0096_core_brand_review_fps` · `0168_glue_brand_review_fps` — 영상 에셋의 프레임 레이트(`brand_studio_assets.fps` numeric(7,3), null 허용, 1–240 검사; `docs/BRAND-ROOMS-FEEDBACK.md` §11). 열 하나 추가라 기존 행은 null로 남고 다시 쓰지 않는다. 코드는 열이 없어도 동작한다(`assetFpsReady`가 없으면 읽지도 쓰지도 않고, 플레이어가 재생 중에 직접 잰다). 적용 후 확인: 열 존재, 제약 `brand_studio_assets_fps`, 기존 행 fps 전부 null, RLS on+forced·정책 0개, anon·authenticated 권한 없음. 브랜치 `claude/rooms-review-stage2`.

다음 번호: core 0098, glue 0171 (0097·0170은 진행 중인 브랜치가 사용).
