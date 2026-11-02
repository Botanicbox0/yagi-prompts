# Production rollout — 2026-09-23

User authorized deploying all completed, unshipped TWINGS changes. Baseline production commit: `9096de64992e68e466591b6f38a28722386a779c`.

## Included

- PR #3: wording inventory/review tools and candidate documentation (not automatic approval of candidate copy).
- PR #10: portrait comparison and explicit user selection; existing rollout flag stays closed.
- PR #11/#12: campaign reporting, operator collection console and observation history.
- PR #13/#14/#15: locale detection, brand login experience and workspace design.
- PR #16/#17: studio-managed brands, verified invitations, contract PDFs, settings/support, contract-limited private production, self-service template intake and responsive language/action placement.

The release branch retains the feature histories. Two collection/managed-workspace conflicts were resolved by preserving both operation sets and all 20 brand tables in access checks. Portrait and collection core migration numbers remain 0029/0030; managed workspace/profile/production cores are renamed 0031/0032/0033 to remove collisions. The SQL contents are unchanged.

## Database and compatibility

Apply only the ten reviewed files in `docs/evidence/production-rollout/migrations.json`. Core changes precede grants in a single transaction with short lock/statement timeouts and an advisory lock; migration names, statements and unique timestamp versions are recorded in Supabase migration history. Validate RLS/FORCE RLS and browser-role denial before commit. The dry run against the actual project succeeded and rolled back. Preflight found zero portrait attempts (including pending) and zero brand posts; no user content was removed or seeded.

The earlier PR #17 Vercel build failed because `/sitemap.xml` queried `prompt_items.audience` before its schema existed. Schema must be present before the cloud build. The baseline app tolerates the additive brand columns. Portrait comparison changes the slot model; its production flag is absent/closed, and there are no portrait rows/in-flight attempts at release preflight.

## Deliberately unchanged

No general generation-flag opening, identity-portrait opening, live-payment switch, new prices, subscription, per-use brand billing, legal-body changes, arbitrary brand-face input, social scraping, real provider generation or external messaging. These require their separate pending decisions. Draft PR #1 (video assets) and #4 (unfinished app/product design) are not runtime release work. Older host-routing PR #5 predates the already-shipped domain work; do not overwrite current routing with that historical branch.

## Release method

Create one release PR to main after local gates, apply reviewed cloud schema, require successful integrated preview/CI, then merge the release PR without squashing to preserve included branch ancestry. Verify the production deployment commit and the three public host boundaries. Keep operational outcomes/evidence here; never include credentials, customer data or bearer URLs.

## Applied schema

The ten migrations were committed to Supabase project `nhokkikjkzjalxqsbzuk` in one transaction after a successful rolled-back dry run. The migration evidence includes file hashes; all eight new brand tables passed RLS/FORCE RLS and anon/authenticated denial checks before commit. No sample brands, fixture users or content were seeded to cloud. No existing portrait attempts or brand posts existed at preflight.

## Integrated verification

- `npx tsc --noEmit`: passed.
- `npx vitest run`: 133 files, 1,461 tests passed.
- `npm run db:local`, `npm run build:local`, `npm run start:local`: passed.
- `npm run sweep:anon`: **SWEEP PASSED — 637/637 checks passed**.
- `npm run cloud:smoke`: **32 passed, 0 failed, 0 skipped**; temporary private-storage probe removed.

Cloud preview and production deployment checks follow the release PR. These checks do not constitute a real customer OAuth round trip, provider generation, payment or invitation delivery test.
