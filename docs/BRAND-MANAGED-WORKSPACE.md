# Studio-managed brand workspaces

Implementation branch: `codex/brand-managed-workspace`, stacked on `codex/brand-workspace-design` (PR #15). Cloud application required for the migrations below. No production data, invitation mail, provider calls or public generation flags were changed.

## Working flows

- `/admin/brand-workspace`: create an organization before any customer signs up, without manufacturing a customer profile or making studio staff a customer member. Prepare a campaign; it starts hidden from clients. Publish it explicitly after reviewing the contents and report.
- `/admin/brand-workspace/organizations/{id}`: invite a verified email as organization owner/editor/viewer; review membership/invitation state; revoke a member or unused invitation; answer general support messages. A campaign can instead receive a read-only invitation without any organization membership.
- `/brand/invite`: preserve the token in the URL fragment/session transfer flow. Signup acceptance binds the verified session email to the profile and invitation email. Token hashes are stored; raw tokens appear once in the issuing administrator's response body, never redirect queries. Links expire after seven days and are not automatically emailed.
- Campaign **Contracts** tab: upload PDFs (20MB maximum), then save a titled version. Choose an existing contract group for a revision. Versions and their files are immutable. Every upload and new version starts studio-only; sharing is explicit per version with an append-only sharing audit. Ordinary creative attachments and home media projections exclude contract files. A client sees only shared versions within campaigns they can access.
- Downloads recheck membership, project visibility and contract sharing. Private contract bytes stream through the authenticated route; no reusable storage URL is handed to the client. Already downloaded files cannot be recalled. The streaming choice follows [Vercel's response-size guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions); cloud runtime verification remains part of migration/deployment rollout.
- `/brand/settings`: owners edit brand name, HTTPS website, description and contact email. Other members have a disabled read-only form; optimistic revisions reject concurrent overwrites.
- `/brand/library`: latest version of every content slot in authorized campaigns; it does not inherit the four-item home preview limit.
- General support drawer: organization-scoped stored messages, studio reply inbox, retry deduplication and rate limiting. Replies are retrieved when opened or refreshed. Campaign approvals and revisions remain in their campaign conversation. No invented support hours, automatic external dispatch or live-chat availability promise.

## Design

The home opens with a real campaign image and its next action, followed by actionable reviews, campaign filters and recent content. No actual customer name or invented performance is added. Existing TWINGS lockup, Helvetica Neue and Pretendard Variable are retained. Campaign details switch between results, brief, content, conversation, reports, files and contracts. All new UI copy is in the KO/EN dictionaries.

Forms disable until hydrated and use POST fallbacks. Successful mutations either refresh the current page or navigate once; simultaneous navigation/refresh and hash-only stale updates are covered by regression tests.

## Database rollout

Apply through the repository's migration process, after the predecessor migrations:

1. `0031_core_brand_managed_workspace.sql`
2. `0032_core_brand_profile_support.sql`
3. `0117_glue_brand_managed_workspace.sql`
4. `0118_glue_brand_profile_support.sql`

**클라우드 적용 필요.** Existing campaigns default to client-visible to preserve their current behavior. Only the new studio preparation flow defaults to hidden. Existing files default to ordinary workspace attachments; contract scope cannot later be changed. Browser roles have no direct table access; server-role updates use explicit column grants. Migrations 0115/0116 remain reserved for the separate post-sampling PR.

## Separate production track

The approved next track is contract-restricted brand creation, with operator-configured limits and private Seedance 2.5 templates. This PR does not claim to implement that render/quota system or enable generation. A real person's own verified identity remains the current legal and provider boundary; third-party likeness grants must be modeled explicitly. No template lineup, price, production limit, external notification copy or live provider entitlement has been invented.

`json-render` was evaluated in the design proposal. Fixed application screens do not require it; no dependency was added. Authorization, sharing and future quota decisions stay in server code.

## Evidence

Final local verification: `npx tsc --noEmit` passed; `npx vitest run` passed **124 files / 1,407 tests**; `npm run build:local` and `npm run start:local` passed; `npm run sweep:anon` reported **SWEEP PASSED — 627/627**. Browser evidence below uses regular-user and administrator fixtures, including mobile and both locales.

`docs/evidence/managed-workspace/` contains local fixture screenshots and browser check summaries. The fixture labels are intentional and are not customer claims. Tests cover studio authority, hidden campaigns, verified-email invitation scope, access revocation, private contracts and immutable versions, settings revisions, support isolation, table permissions, host routing and navigation races. Local browser checks cover actual admin creation/upload/share/download, client settings/support/library, shared-only contracts, KO/EN and desktop/mobile layouts. Real OAuth delivery, cloud schema application and production media APIs are not represented by these local checks.

Evidence correction from the follow-up production PR: the earlier files named `*-en-*` used a query-only locale change and captured Korean. Actual language-button, document-language and English-heading verification is recorded in `docs/evidence/brand-production/` with the brand-host locale transport fix.
