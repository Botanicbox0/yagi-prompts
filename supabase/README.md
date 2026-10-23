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

미적용: 0042~0044(월 구독·Premium 수정, 미출시), 0029/0115(옛 portrait 비교, 폐지 경로). 다음 번호: core 0055, glue 0140.
