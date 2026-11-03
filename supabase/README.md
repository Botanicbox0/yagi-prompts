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

미적용: 0042~0044(월 구독·Premium 수정, 미출시), 0029/0115(옛 portrait 비교, 폐지 경로). 0063(prom-queen 비율)은 원장에 없지만 운영 데이터에는 이미 반영돼 있다. 0064·0144는 열린 브랜치가 쓰는 번호. 0074·0075와 0150·0151은 브랜드 제품화 브랜치(docs/BRAND-PRODUCT.md)가 쓴다. 다음 번호: core 0076, glue 0152.
