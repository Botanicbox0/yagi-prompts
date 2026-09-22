# Brand post collection console

2026-09-22 · branch `codex/brand-post-samples` · base `main` 9096de6 · **cloud migration required** (`0030_core`, then `0116_glue`; applied by the owner or Director, not by this PR).

## What the owner decided

- The studio checks post numbers about once a day. The client sees the **latest** totals and content, not a history or curves.
- Normal collection stops when the studio marks the campaign completed (or cancels it).
- Every real observation is kept internally as evidence. Missing older observations are never invented.
- This PR is the administrator console only. CSV migration waits for this PR and the real CSV; OCR is a separate later track. No daily cron, scraper or provider call exists yet.

## Model

| Table | Role |
| --- | --- |
| `brand_post_measurements` | The only observation history. Append-only (immutable trigger; service role has `select, insert` only). Revision 0 is the observation entered with the post; later ones are 1, 2, … |
| `brand_posts` | Latest projection of that history, updated in the same transaction as the insert. |
| `brand_post_collection_batches` (new) | One ledger row per console save: `request_id`, `payload_sha256`, `row_count`, the single `measured_at`. Append-only, deny-all RLS. It is a request ledger, not a second samples table; history rows point at it through `batch_id`. |

Report snapshots (`brand_reports.snapshot`, `metricDefinition: 'sum_of_latest_post_views'`) are untouched and stay frozen. No client DTO gained a history array. `lib/campaigns/**` and public brand pages are untouched.

## Rules (all in `lib/brands/workspace/service.ts`)

1. **Initial observation.** `recordBrandPost` writes history revision 0 in the same transaction when the post is created with values. A post created with no values has no observation, so no row.
2. **Time only moves forward.** A `measuredAt` earlier than the post's latest known `measured_at` → `invalid`. More than 5 minutes in the future → `invalid` (unchanged).
3. **Same instant = correction.** An equal `measuredAt` is accepted and appended as a new revision; both rows stay in history. Reason: the single form has minute resolution, so fixing a typo made in the same minute must be possible without lying about the time.
4. **No erasing.** Once a post has an observation, an "unavailable"/all-blank update → `invalid`. Individual cells may still go blank (a platform can hide a count); blank means unknown, `0` means a measured zero.
5. **Counts may fall.** Providers correct numbers; no monotonic check.
6. **Freeze.** Single and batch saves require `status = 'active'`. Both take `for update` on the project row, the same lock `activateBrandProject` takes, so a save cannot commit after the close. A retry of a save that already committed is still confirmed after the close and writes nothing.
7. **Optimistic revision** per row (`expectedRevision` = `metric_revision`) is kept for both operations.

## Batch (`brandWorkspace.metricsBatch` → `saveBrandPostMetricsBatch`)

- Registered in the existing admin registry, so `POST /admin/do` + `requireAdmin()` + the registry-enumerating auth test cover it. The service re-checks `profiles.is_admin` itself; a self-asserted `viewer.isAdmin` is refused. Posts are looked up by `(project_id, id)`, so a row from another project or organization → `not_found`.
- One transaction, one `new Date()` taken on the server for every row. The schema is `strict`: a submitted `measuredAt` is refused, not ignored.
- Any stale, missing or foreign row throws, so nothing in the batch is written.
- 1–50 rows (`BRAND_METRICS_BATCH_LIMIT`), duplicate post ids → `invalid`. Each row needs a source (`studio_review` or `creator_evidence`) and at least one value. There is no "API/automatic" source to claim.
- Idempotency: the digest covers the project id and the rows sorted by post id (row order is not identity). Same request id + same digest → the stored result is returned; same request id + different digest → `conflict`. Each history row gets a request id derived from `sha256(batchRequestId:postId)`, so the existing `unique(project_id, created_by, request_id)` also blocks a duplicate row.
- Posts are locked in id order to avoid deadlocks between overlapping saves.

## Console (`components/brand-workspace/collection-console.tsx`)

JS-free, one form for the table. A row is read only if the administrator chose it: its own **save this row** button (`only`) or its ticked box + **save selected rows**. Rows that were merely on screen are never saved; a chosen row missing any of its five cells is refused by the parser. The "save selected" button is first in tree order so Enter in a cell never triggers the first row's button. Cells are pre-filled with the latest values and the copy says that all five cells of a chosen row are saved as checked now. When the campaign is not active the fieldset is disabled and `collectionClosed` explains why (ko/en). The old per-post form remains, collapsed, for a genuinely historical time, and only while active.

## Migration `0030_core_brand_post_collection.sql`

Relaxes `revision>0` to `revision>=0`, adds the ledger + `batch_id`, and backfills **only** posts with `metric_revision = 0` that still hold their originally entered values, using the post's own `measured_at`, `created_at`, author and request id. A post that was already revised has lost its first values; that gap stays a gap. `0116_glue` applies deny-all RLS and `select, insert` for the service role. Numbers 0029/0115 are taken by the parallel portrait-comparison PR.

## Compatibility with PR #11 (campaign reporting, unmerged)

No DTO field was renamed or removed; `BrandPost`, `BrandReportSnapshot` and stored snapshots are unchanged. Only additions: `BrandMetricsBatchResult`, the batch schema, one operation. If PR #11 also adds a core migration, renumber on merge; nothing here depends on its tables.

## Behaviour changes to note

- `updateBrandPostMetrics` no longer accepts a `completed` project (owner decision 5).
- `updateBrandPostMetrics` refuses older timestamps and erasure (previously it overwrote the latest values).

## Open points for the owner

- A number cannot be corrected after completion: there is no reopen transition and both operations are frozen. Decide whether a studio-only "post-close correction" is wanted.
- More than 50 posts in one project need two saves. Raise the limit if real campaigns exceed it.
- Future daily scheduler: call `saveBrandPostMetricsBatch`-equivalent logic with a new explicit source value once a provider exists; do not reuse `studio_review`.

## Verification by Codex (2026-09-22)

- `npx tsc --noEmit`: passed.
- `npx vitest run`: 119 files / 1,395 tests passed on the final implementation.
- `npm run build:local`: passed.
- `npm run start:local` on port 3000 and `npm run sweep:anon`: **SWEEP PASSED — 606/606**.
- Local administrator fixture in the actual browser: row save, selected-row save, latest values after navigation, measured zero vs unknown, Korean/English copy, desktop (1440 px) and mobile (390 px), and disabled collection after completion verified. Wide tables scroll inside the panel; the document did not overflow at mobile width.
- Frozen report values remained unchanged while latest post values changed.
- No cloud SQL, production collection, external notifications, or provider calls were made. No real client data was used in UI checks.
- Implemented with Claude Code `--model fable` (resolved `claude-fable-5-1`), reviewed and verified by Codex. The new tests were not run red before implementation; the final passing results above are the verified evidence.
