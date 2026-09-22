# Campaign results and client onboarding

2026-09-22 · branch `codex/campaign-reporting` · not yet released

## Scope and reference

The owner requested clearer studio campaign management, real client signup/login, Korean/English support, visual top-viewed/top-engagement content and guidance on the existing TWINGS Meta app. The linked private Morphic final report was read in the owner's authenticated Notion browser. Its structure informs this work; client names, creator handles and campaign figures are not copied into public fixtures or marketing claims.

## Product decisions

- Keep `brand.twings.app` for clients and `admin.twings.app` for studio operations. Google/Kakao first sign-in provisions the existing profile; clients create their own organization or accept a scoped invitation. Never enroll users by email domain.
- Keep existing organization isolation, viewer/editor/owner roles and explicit DTOs. Creator compensation, margins and contracts do not appear in the client projection.
- Put measured performance before the brief: views, likes+comments, comments, post count and goal progress. Missing numbers remain unknown, each total shows its measurement coverage, and data sources/timestamps remain visible.
- Show separate top-viewed and top-engagement lists with private production media previews and the actual post link. Previews come from the approved immutable content version, not scraped Instagram thumbnails. Videos use a native player; unavailable previews have an explicit fallback.
- Engagement means likes+comments for this comparison. Shares/saves remain separate because partial availability would make unlike totals appear comparable. View-based rates use the same complete set of posts in numerator and denominator; zero-view posts have no rate.
- `views / followers` is not unique reach. Repeated post views are not unique people. Segment correlations do not establish causation or prove actual DM deliveries.
- Reports use the stored snapshot, never current post metrics. The same calculations drive the dashboard, report and CSV. Authenticated report URLs offer printing/PDF and CSV, without public sharing tokens.
- Existing manual evidence entry remains truthful while Meta authorization is pending. No synthetic daily trend is constructed from one observation. No anti-detection scraping or rotated account automation is introduced.

The supplied reference contains differing Auto DM averages between its table and conclusions; a shared calculation path prevents that class of discrepancy. Customer figures were not imported or corrected in Notion.

## Acceptance

1. Brand first-login guidance and an organization-to-request flow, with Korean/English switching that preserves the current private page.
2. Studio request/active/completed filters, counts, search and direct operation links.
3. Private content previews, separate view/engagement ranking, source/time/coverage and no unknown-as-zero conversion.
4. Read-only report versions with the original measurements, CSV escaping against spreadsheet formulas and browser print support.
5. Cross-organization access denial and existing approval, reporting and billing protections continue to pass.

No new database migration is required for this increment. The existing private content, posts, measurement records and report snapshots are sufficient. No environment variables, OAuth settings, paid-generation flags or legal documents are changed by this branch.

## Meta connection: keys are not enough

Verified against [Meta's official Insights documentation](https://developers.facebook.com/documentation/instagram-platform/insights) on 2026-09-22 and [Meta's official API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

For the proposed Instagram Login path: the creator needs a professional (Business or Creator) account, an Instagram user access token obtained through consent, and `instagram_business_basic` plus `instagram_business_manage_insights`. Standard Access covers owned/managed accounts added to the app; serving independent creator accounts requires Advanced Access. A Meta app ID/secret is the app's identity, not authorization to read every campaign participant's private insights. Facebook Login is an alternative with a different permission/page linkage model.

Next connection work requires confirming the actual app product, access level and approved permissions, then implementing state-bound OAuth, encrypted server-side token storage, disconnect/deauthorization and deletion handling, account-to-post ownership mapping and retries respecting provider limits. No tokens belong in client code, logs, screenshots or Git. Ask for the setup status, never secret values in chat.

Collect only supported metrics for each media type/API version; do not turn empty API datasets into zero. Account metrics have availability/retention limits. Ad-boosted totals may differ from organic-media insights. Preserve metric name, collection time, source, scope and uncertainty with each observation. Use bounded scheduled jobs and rate-limit backoff; variable intervals for avoiding detection are unnecessary.

The current branch does **not** claim that Meta synchronization is connected. It prepares a useful report workflow without waiting for third-party approval. A real provider login/signup round trip must be distinguished from reaching the provider screen; a new account's binding consent remains a user action.

## Browser verification and limits

- Existing authenticated production session reached the brand workspace and its organization. This is not evidence of a newly completed Google/Kakao signup.
- A non-admin local fixture with no organization created a private workspace, moved directly to the brief form, submitted a campaign and reached its requested-state project. No real customer organization, report or message was created.
- This flow exposed a pre-existing `router.push()` followed immediately by `router.refresh()` race: the organization saved, but the setup screen remained. Successful navigation now uses one full document navigation, while same-page mutations still refresh. A regression test failed before the fix and passed after; the original browser flow then passed.
- Desktop 1280px, brand mobile 390px and admin mobile 360px were inspected. Image previews loaded through authenticated attachment routes; campaign status filters and content search worked. The original report retained unknown metrics after a later report contained measured results.
- English persisted through list → project → report at `127.0.0.1`. A language reset was observed at shared `localhost` while other TWINGS tasks were active; its cause is unconfirmed. The locale implementation was not changed based on that single observation.
- Browser print is available; exported PDF pagination and real video playback were not verified. QA assets are synthetic image fixtures, not campaign/customer media.
- Meta OAuth, app review, actual insight collection and new external-provider signup remain separate live checks. The existing Model API key screen at `dev.meta.ai` is not the Instagram Insights authorization flow.

Screenshots: [Korean dashboard](evidence/campaign-reporting/brand-desktop-ko.png), [English mobile](evidence/campaign-reporting/brand-mobile-en.png), [ranked production previews](evidence/campaign-reporting/report-rankings-en.png), [studio queue](evidence/campaign-reporting/admin-queue-en.png), [mobile studio queue](evidence/campaign-reporting/admin-mobile-en.png), [first client request](evidence/campaign-reporting/client-first-request-en.png).

Final local gate (after the onboarding fix): `npx tsc --noEmit` passed; `npx vitest run` **120 files / 1,378 tests passed**; `npm run build:local` passed; `npm run start:local` served port 3000; `npm run sweep:anon` **SWEEP PASSED — 616/616**. No migration or production flag change is needed for this PR.
