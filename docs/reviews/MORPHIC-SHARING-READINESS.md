# Morphic September 2026 KR — private sharing readiness

2026-09-23 · branch `codex/morphic-september-share` · base `8c6cb04` · implemented by Claude Code (`claude-opus-5-5`) in two passes. Local code and tests only: no commit, build, dev server, database/storage write, network call or outbound message by this implementation. **클라우드 적용 필요** for the two new migrations below.

**Production is not prepared.** The coordinator staged the real supplied cover and the seven links into a **local** preview only (project-only commenting guest included) and verified the first pass in a local browser. No cloud database, storage or production write has happened.

## What the campaign needed and what now exists

| Need | Implemented | Where |
| --- | --- | --- |
| Supplied campaign cover | Studio chooses one of the campaign's own uploaded JPEG/PNG/WebP files as the cover (or none). Shown at the top of the campaign and on the client/studio campaign lists. It is an ordinary private project attachment, not a content version. | `setBrandProjectCover`, op `brandWorkspace.cover`, admin "캠페인 대표 이미지" panel |
| Seven already-published Instagram posts | Studio pastes links (one per line, optional known Korea-time publish time). Each is stored as `origin='external_import'`: no content version, no approval, no counts, publish time `NULL` unless supplied. | `importBrandExternalPosts`, op `brandWorkspace.externalPosts`, admin "이미 게시된 게시물 링크 추가" panel |
| Operator can append links later | Re-pasting is safe: normalized platform post id dedupes within a paste, across pastes and against approved posts. Existing links are left alone except that an unknown publish time may be filled once. Completed/cancelled campaigns accept no new links (same freeze as collection). | same |
| Counts | No scraper or fetch. Counts are entered through the existing collection console, which already lists imported posts. Unknown stays `NULL` (—), never 0. | existing `saveBrandPostMetricsBatch` |
| **Publicly rounded view counts** (pass 2) | The Reels grid shows two of the seven view counts only in abbreviated form (the real figures are deliberately not in Git; `12.3K` here is a placeholder). The studio writes the value out (`12.3K` → `12300`) and ticks **축약 표기 / Abbreviated**. The flag `viewsApproximate` is stored on the immutable measurement row and the latest projection in the same transaction, is part of the console save digest, and is frozen into report snapshots. Anything built from such a count reads as approximate: the view, the views total card, the target progress, the views ranking, the engagement rate (when its denominator uses it), the report total (`viewsTotalApproximate`), and the CSV (`조회수 근사치` column, `true`/`false`). A note explains that the value was copied from a rounded public display. The other five exact integers stay exact. | schemas, `observe`/`projectLatest`/`recordBrandPost`, batch digest, `performance.ts`, performance/report UI, console + single form checkbox |
| Reports with unknown dates | A report includes undated imported links (they cannot be placed in or out of a period) and says so: "게시일을 확인하지 못한 게시물 N개는 기간과 관계없이 포함". The note is kept on every frozen snapshot that contains such a link. Dated posts outside the period are still excluded. | `publishBrandReport`, report UI |
| Studio and Morphic can comment | The campaign conversation is "코멘트 / Comments" with a count on the tab, and the studio reply form sits inside that tab. Campaign-only guests can be invited as **열람과 코멘트** (default in the campaign invite form) or **열람만**. | `project(..., {comment})`, `sendBrandMessage`, invite form |
| Distinct post identities | Without verified title metadata, a linked post is named by platform + its canonical post code (e.g. `인스타그램 게시물 · <code>`) in the client table, rankings, report table, collection console and the historical-metrics form. No creator label is invented and no image is borrowed; the campaign cover is never used as a post thumbnail. No thumbnail/metadata subsystem was added. | `postShortId`, performance/report/console UI |
| Client clarity | Imported posts are labelled "링크로 등록한 게시물" and "게시일 미확인"; a note states they were not reviewed or approved in this workspace. Read-only guests see why they cannot comment. | performance/report UI, KO/EN dictionaries |

## Permission model (unchanged except one narrow right)

- **Comment** is a separate right: owners, editors, the studio, and campaign-only guests whose invitation said so. Organization viewers stay read-only (existing test unchanged; no policy expansion). Existing campaign-only guests were invited "조회 전용" and **stay read-only**; the new column defaults to `false`.
- Commenting grants nothing else: no approval, upload, contract access, settings, support drawer, team or new-request rights. A newer invitation redefines the guest's scope (including removing comment). Revocation is immediate.
- Normal posts still require an internally approved, current content version and a publish time — in the service **and** in a database check (`brand_posts_origin_shape`). An import can never carry a content version. `origin`/`content_version_id` are immutable; a known `published_at` is immutable (trigger).
- Cover: composite FK `(id, cover_attachment_id) → brand_attachments(project_id, id)` makes another project's file unreachable; a trigger requires a ready workspace image. Every read goes through the existing authenticated attachment route.
- Metrics semantics unchanged: blank is unknown, `0` is a measured zero, time only moves forward, collection freezes on completion, studio-only writes. `viewsApproximate` defaults to `false` and requires a non-null view count (schema refinement and database checks on both tables). Unticking and saving a later exact observation clears it on the projection; history keeps both.

## Migrations — 클라우드 적용 필요

Apply after `0033` / `0119`, core first. Both files were extended in pass 2 (still unapplied; no new migration number):

1. `supabase/migrations/0034_core_brand_client_sharing.sql` — `brand_posts.origin` + nullable `content_version_id`/`published_at` only for imports, origin shape check, publish-time/origin guard; `views_approximate boolean not null default false` with `check(not views_approximate or views is not null)` on **both** `brand_post_measurements` and `brand_posts`; `brand_projects.cover_attachment_id` + FK + image guard; `brand_invites.can_comment` (campaign-scoped only), `brand_project_members.can_comment`.
2. `supabase/migrations/0120_glue_brand_client_sharing.sql` — server-role column updates for exactly `brand_projects.cover_attachment_id`, `brand_posts.published_at`, `brand_posts.views_approximate`, `brand_project_members.can_comment`. `brand_post_measurements` stays insert-only; browser roles still get nothing.

Existing rows are unaffected: every current post becomes `approved_content`, every existing observation exact (`false`). Stored report snapshots have no flag and are read as exact. The console digest only includes the flag when it is `true`, so a retry of an exact save made before deployment still matches. PGlite local snapshot (`npm run db:local`) was not regenerated by this implementation.

## Operator steps once migrated (not done here)

1. `/admin/brand-workspace/{campaign}`: upload the supplied cover image under 비공개 파일, then pick it in 캠페인 대표 이미지.
2. Paste the seven links into 이미 게시된 게시물 링크 추가. Add a publish time after a link only if it was actually checked on Instagram.
3. In 지표 수집, enter only counts that were actually read. For the two abbreviated grid values write the displayed figure out (e.g. `12.3K` → `12300`) and tick 축약 표기; leave the five exact integers unticked; leave unread cells blank.
4. Invite Morphic contacts with 이 캠페인만 · 열람과 코멘트, publish the campaign to the client, and deliver invite links manually (no mail is sent).

## Tests actually run

Pass 2 (this update):

- `npx tsc --noEmit`: 0 errors.
- `npx vitest run tests/brands tests/admin tests/i18n tests/db tests/routes`: **48 files / 478 tests passed**. The full suite was not rerun in this pass; the coordinator runs the final gates.
- New in `tests/brands/client-sharing.test.ts` (now 19): history/projection sync (approximate → exact correction, both history rows kept, history immutable, unticked stays exact); approximate-without-views refused in batch, single update, record, and by the database on both tables; the flag is part of the console save identity (same request, flag toggled → conflict, no second row); exact vs approximate totals, rate flag and CSV column; frozen snapshot keeps the approximate value after a later exact correction, and a legacy snapshot without the field reads exact; admin checkbox parsing (ticked vs absent, batch and single); glue grant on `brand_posts.views_approximate` but none on `brand_post_measurements`.
- New in `tests/brands/client-sharing-ui.test.tsx` (now 11, KO and EN): `약 12,300` / `≈ 12,300` on the post, the total that includes it and its card, the explanation note, exact counts unmarked, readable post codes, and the console checkbox prefilled from the latest observation.
- Updated `tests/admin/brand-workspace-form.test.ts`: the batch parser now states `viewsApproximate: false` for an unticked row.
- Mutation checks: dropping the flag from the projection update failed 3 tests; dropping it from the batch digest failed the save-identity test. Code restored both times.

Pass 1: `npx tsc --noEmit` passed; full `npx vitest run` passed **138 files / 1,523 tests**; the comment guard and cover mime/scope check were each disabled once and caught. The six supplied links normalize locally (no network) to 6 valid, distinct, unchanged URLs; they are not stored in Git.

Not done by this implementation: build, start, anonymous sweep, browser/visual verification, cloud migration, production data entry, Instagram inspection. (The coordinator's local browser check of pass 1 is theirs, not this report's evidence.)

## Open questions

1. Reports include undated links in every report period. Alternative: exclude them with a note, or add a studio toggle per report.
2. The report form still uses a date period based on publish time; if Morphic wants a whole-campaign report, publish one covering the campaign dates.
3. Cover is chosen from existing uploads; there is no crop/focal-point control.
4. Linked posts are named by post code only; verified titles/thumbnails would need a separate, consented metadata source.
5. An approximate count is stored as the displayed value written out (`12.3K` → `12300`); the true count may differ within the platform's rounding, which is not modeled.

## Coordinator verification (2026-09-23)

- Collected all seven supplied posts through normal Instagram pages and creator Reels tabs. Raw observations, capture times, client handles and image are outside Git in private local preparation files. Missing values and unverified publication dates remain null; repost counts are not treated as shares.
- Added the seventh reel through URL normalization; the local campaign contains seven distinct posts. Two rounded view displays retain their precision flag.
- Regenerated the local PGlite snapshot and populated the actual service paths, including a campaign-only commenting guest. No cloud writes or external invitations.
- Adjusted the campaign header to preserve the full portrait beside the brief; initial desktop/mobile browser checks confirmed the image and KO/EN commenting flow.
- Final coordinator gates: TypeScript passed; full Vitest passed **138 files / 1,534 tests**. Build, anonymous sweep and final browser pass follow below.

- Final build and start: `npm run build:local` and `npm run start:local` passed. `npm run sweep:anon`: **SWEEP PASSED — 637/637**.
- Final browser: seven posts and rounded-total labels visible in KO/EN; re-pasting the same reel using both `/reel/` and `/p/` forms kept the count at seven; an unsupported URL was rejected. Studio and campaign-only guest each posted a local-only comment and both were visible after server restart. Initial stale browser hydration after switching fixture identity resolved on a fresh document load, without a code change. Private desktop captures remain outside Git; mobile width was checked during the first pass.
- Current release scope is code readiness plus private local preparation, **not a production campaign or a delivered customer invitation**. PR19 is the base dependency. The two cloud migrations, production organization/campaign/cover/posts and the named customer invitation remain to be applied by the representative or Director under AGENTS §3.
