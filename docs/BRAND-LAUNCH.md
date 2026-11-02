# Brand workspace release

## Authorized scope

2026-09-20: the owner requested real Kakao login verification, a main release, and a functional `brand.twings.app`. This supersedes the earlier draft-only domain/prototype checkpoint. Canonical address: `brand.twings.app`; `brands.twings.app` redirects GET/HEAD workspace navigation only. Consumer payment/generation flags, subscriptions, legal documents, and automatic outbound communications are unchanged.

## Product contract

- A signed-in user creates a brand organization and submits a campaign request with a total budget, objective, audience, schedule, production preference and references. A request is not payment or acceptance of a production contract.
- The studio reviews requests and manages production. The brand sees its own progress, content versions, review decisions, conversation, posted links and published reports.
- Organization membership is required for every brand read and write. Service-role access does not waive authorization. The owner controls team access; no email-domain auto-enrollment.
- Only explicit external DTO fields cross into brand HTML, RSC or JSON. Creator payouts, internal costs, margins and unrelated personal information are absent from that model.
- Public legacy recruitment listings no longer expose payment amounts. The creator's own application still presents participation/payment terms before consent. This is not a change to an existing creator's agreement. Old emails and previously published content cannot be recalled by a code change.
- Content approval identifies an immutable version and requires the expected review revision. New content versions require a new review. Conversation messages never imply approval. An approval does not itself change financial or legal terms.
- References remain private. Uploaded bytes are checked against type and size limits; no server-side fetching of arbitrary reference URLs. Downloads recheck access and cloud delivery uses an expiring private URL.
- Metrics carry a source and collection time. Missing values remain unknown; total views are the sum of the latest per-post figures, not unique reach. Reports are immutable snapshots; corrections produce a new version. Social API synchronization is not claimed.

## Infrastructure

One existing Next/Vercel project and database serve the three surfaces. Exact host/path allowlists and host-bound authentication keep their roles separate. The workspace is dynamic, `private, no-store` and `noindex`. Cookies are not shared through a parent-domain setting.

DNS change: `brand` CNAME to the existing Vercel project target, DNS only. Preserve the root, www, admin and plural-brand records. Add only `https://brand.twings.app/auth/callback` and its query-string variant to Supabase's redirect allowlist. The plural alias never forwards OAuth codes or write requests.

New migrations: `0027_core_brand_workspace.sql` and `0113_glue_brand_workspace.sql`. **Applied to the cloud on 2026-09-20 under the owner's launch authorization.** An independent read-only check verified both stored source hashes, the exact 12-table schema, role and function privileges, and zero initial workspace rows. See [the cloud migration verification record](BRAND-CLOUD-MIGRATIONS-2026-09-20.md). They are independent of the unmerged single-checkout migrations (0025/0111) and reserved subscription migrations (0026/0112). Do not apply every unmerged migration as a shortcut.

## Release gates

1. Typecheck, complete Vitest suite, `build:local`, `start:local`, and `sweep:anon` with `SWEEP PASSED`.
2. Host smoke, organization isolation/revocation, duplicate-write protection, stale approval, private attachment verification and report snapshot tests.
3. Actual desktop/mobile brand onboarding, request, message, review and report flows against local fixtures; corresponding studio actions.
4. Cloud migration fingerprint and table privilege verification before merging the reviewed release to main.
5. Production deployment ready; canonical DNS/TLS, login return and private route headers verified. Kakao is complete only after the provider round trip, not merely after reaching its login screen.
6. Claude Opus 4.6 editorial review and a second response to Codex's fact/policy critique. Record the actual model and accepted/rejected proposals. Authentication or model failure must not be represented as completed review.

## Local release evidence — 2026-09-20

- `npx tsc --noEmit`: passed.
- `npx vitest run`: 112 files / 1,338 tests passed.
- `npm run build:local` and `npm run start:local`: passed with the local snapshot, no cloud credentials required.
- `npm run sweep:anon`: **SWEEP PASSED — 594/594**, including 25 new brand checks against nonempty private fixtures.
- `node scripts/smoke-workspace-hosts.mjs 3000`: **HOST SMOKE PASSED — 87/87**.
- Actual local browser: brand request creation, private upload, conversation, studio activation/content sharing, version-specific brand approval, metric update and report publication passed. A second ordinary user was denied the first organization's data and created a separate organization. An older published report retained its original unknown metrics after a newer report was published.
- Desktop and 390px mobile were visually checked. Horizontal overflow was fixed; measured document width was 375px within the 390px viewport. Licensed Helvetica Neue and Pretendard Variable assets loaded. The existing TWINGS lockup and `by yagi workshop` appeared correctly.
- Kakao real-account verification remains pending at the provider password step. Provider-page reachability is not an authenticated round trip. Production authenticated workflow and response-loss injection were not claimed as browser-verified; service/API tests cover retry and authorization contracts.

The final checks followed fixes for a stale literal-copy test, reader-aid locale redirects, and missing privacy headers on anonymous app redirects. The campaign introduction is rendered once, rather than duplicating its metadata description below the hero.

## Recovery

Keep the previous production deployment available. If the workspace fails verification, roll back the application deployment or close the brand surface at the host boundary. Preserve new organization and campaign data; do not drop tables or reset real accounts to conceal a launch failure. DNS can remain pointed at the same project while the brand app is closed. Re-run checks after a correction before reopening.
