# Brand workspace cloud migration verification — 2026-09-20

The two brand workspace migrations were applied under the owner's 2026-09-20 launch authorization. The apply receipt confirms COMMIT at **2026-09-20 05:44:11.529 KST** (`2026-09-19T20:44:11.529Z`). No checkout or subscription migration was included in this operation.

A separate post-commit connection verified the live database at **2026-09-20 05:46:01.706 KST** (`2026-09-19T20:46:01.706Z`). This verification used `BEGIN READ ONLY`, checked `transaction_read_only=on`, and ended with `ROLLBACK`. It performed catalog queries and row counts only; no customer records, fixture inserts, DDL, credentials or connection strings are included here.

## Applied migration history

Exactly two matching rows exist in `supabase_migrations.schema_migrations`. Each row contains one source statement whose SHA-256 matches both the approved apply receipt and the current migration file.

| File | Stored history name | Stored version | SHA-256 |
| --- | --- | --- | --- |
| `0027_core_brand_workspace.sql` | `0027_core_brand_workspace` | `20260919204411` | `5f7ca2626baeb993e01e00903d9619c367538c73d221a378bc00888aa076edf6` |
| `0113_glue_brand_workspace.sql` | `0113_glue_brand_workspace` | `20260919204412` | `260b1a7b08f4cd4fafd07b59058a44ba881991c15bb986c930ba127e944db30b` |

The approved apply operation executed core then glue and inserted both history rows in the same transaction. The preceding dry-run passed the same privilege gates and confirmed rollback before the apply operation.

## Live tables and data counts

The new workspace schema contains exactly these **12 tables**. All have row-level security enabled and forced. All counts were **zero** at verification time, confirming that no local brand fixtures or workspace records had been seeded into production at that point. These counts are a point-in-time observation, not a constraint on subsequent authorized product use. The existing `brand_inquiries` table is outside this migration and count check.

| Table | Rows |
| --- | ---: |
| `brand_attachments` | 0 |
| `brand_content_decisions` | 0 |
| `brand_content_versions` | 0 |
| `brand_invites` | 0 |
| `brand_memberships` | 0 |
| `brand_messages` | 0 |
| `brand_organizations` | 0 |
| `brand_post_measurements` | 0 |
| `brand_posts` | 0 |
| `brand_projects` | 0 |
| `brand_reports` | 0 |
| `brand_workspace_events` | 0 |

## Effective privileges

- `PUBLIC`, `anon` and `authenticated` have no table or column privileges on these 12 tables. The role checks include inherited privileges.
- `service_role` has `SELECT` and `INSERT` on all 12 tables. It has no table-wide `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` privilege, and no column-level `REFERENCES` privilege.
- Column-level `UPDATE` is limited to exactly the **20 columns** below. No other columns are writable through UPDATE grants.

| Table | Allowed UPDATE columns |
| --- | --- |
| `brand_memberships` | `status`, `role` |
| `brand_invites` | `accepted_at`, `accepted_by`, `revoked_at` |
| `brand_projects` | `status`, `revision`, `updated_at` |
| `brand_content_versions` | `review_revision` |
| `brand_attachments` | `status`, `sha256` |
| `brand_posts` | `verification`, `metrics_source`, `measured_at`, `views`, `likes`, `comments`, `shares`, `saves`, `metric_revision` |

Exactly three zero-argument trigger functions were checked: `brand_attachment_guard()`, `brand_content_version_guard()` and `brand_workspace_immutable()`. None grants `EXECUTE` to `PUBLIC`, `anon`, `authenticated` or `service_role`.

These database grants do not replace server-side authorization: every workspace operation must still check the current organization membership or live studio-admin role. This record confirms the migration and database verification only; production application deployment, authentication and browser checks are separate release gates in [BRAND-LAUNCH.md](BRAND-LAUNCH.md).
