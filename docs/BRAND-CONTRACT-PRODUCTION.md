# Contract-only brand production

Stacked on PR #16 (`codex/brand-managed-workspace`). This implements the approved **contracted brands with operator-configured production limits** decision. It does not choose a real contract price, allowance or template lineup.

## Service distinction (2026-09-22)

The brand workspace separates two services, both built on studio-designed brand-exclusive formats:

| | 캠페인 운영 / Managed campaigns | 셀프 스튜디오 / Self-serve studio |
| --- | --- | --- |
| Operator | TWINGS coordinates the campaign | Brand team creates its own videos |
| Scope | Format development, influencer content production and publishing, performance reporting | Repeated generation from private templates and authenticated download |
| Brand role | Supply goals/budget, approve content, review posts and reports | Choose template/portrait, generate, publish or run ads independently |
| Commercial model | Scope, schedule and budget agreed per campaign | Currently: agreed contract period and generation allowance |

Both workspace entry pages explain responsibilities, deliverables and terms, with a link to the other service. The sidebar uses the same names in Korean and English. No influencer sourcing, distribution or campaign report is promised as part of self-service production. Fixed templates preserve the intended format, not a guarantee of pixel-identical generated output.

**Pending implementation:** the user also wants a per-use charging option. No rate, payment flow or automatic charge is introduced by this copy change. Current UI describes only the implemented contract allowance. Brand-selected portraits beyond the signed-in user's own verified portrait remain a separate domain/provider/legal change; this wording update does not bypass the existing portrait checks or claim that arbitrary faces are supported.

## Customer and studio flows

- The **Self-serve studio / 셀프 스튜디오** tab lists the organization's contracts, remaining video count, private templates and creation history. A template can use an existing private campaign image or video as its example. Pending/private contract PDFs cannot be used as examples.
- The administrator registers the agreed period (Korea Standard Time), total video allowance and associated campaign. The agreement can separately be stored and shared in that campaign's Contracts tab, from PR #16. Pausing a production contract stops new requests. Previously accepted jobs continue; existing results remain available to active organization members after expiry.
- Each new template is an immutable private `prompt_items` row using the repository's Seedance 2.5 adapter/model catalogue. Duration bounds come from `ARK_MODELS`; the studio supplies the prompt, both titles, duration and aspect. Changes require a new template or contract, rather than silently changing an in-flight render's recipe.
- Only active organization owners/editors can create. Read-only organization members can see results. A project-only report invitation grants no production access. Studio administrators do not receive a free creation bypass: they must also be a writable member of that brand to use its allowance.
- Creation uses the current user's **selected, successful Sunburst identity portrait**, with explicit own-face confirmation. Arbitrary uploads, another user's portrait, caller-provided storage keys and caller-provided admin/payment flags are not accepted. Existing ModelArk asset and liveness rules remain in force. The existing identity page opens on `twings.app` with the same account; its own rollout flag and provider configuration must be enabled before a new customer can prepare a portrait.
- One video reserves one contract creation. A terminal failure restores exactly one creation. The server locks the contract row before counting and reserving, and persists the reservation with the render in one transaction. Retrying the same request returns the original job; changing the template/portrait under that key is a conflict. A database trigger restores allowance in the same transaction as terminal failure, including stale-job recovery and provider callbacks. Intermediate retries keep the reservation.
- The existing 20-request daily account limit remains an abuse guard. Contract allowance has no subscription, refill, cash value or invented price.

## Privacy and delivery

Brand templates are excluded from public catalogue/related/SEO queries, detail shaping, media, copy, announcements and consumer payment/direct-render entry. Their audience cannot change, and the public editor refuses them before any media publication. New private templates never copy media to the public bucket.

Results are stored in the existing private render bucket. The organization result route exposes status and completion only; the authenticated media route rechecks current membership, streams bytes and supports range requests. It returns no storage URL, input portrait, provider cost, recipe or public share token. Consumer owner/share routes and consumer render lists exclude contract jobs. Existing consumer notification emails are skipped for these jobs because their links and copy belong to the consumer flow; the workspace's status poll is the delivery surface.

The brand-host allowlist permits only the new production transports. A narrow same-origin language POST fixes the older server-action language toggle, which the brand host correctly blocked. It preserves the current organization query, writes the preference cookie and mirrors the signed-in profile. General server-action POSTs on workspace pages remain blocked.

## Rollout and limits

**클라우드 적용 필요:** `0033_core_brand_production.sql` and `0119_glue_brand_production.sql`, after PR #16's migrations. Browser roles have no direct access; server-role writes use limited grants. No cloud SQL, `.env.local`, legal text or public generation flag was changed. `RENDER_PIPELINE_PUBLIC=false` remains intact.

The code reuses the existing Seedance 2.5 integration; this PR does **not** certify a live provider generation, new model entitlement or real-person output quality. Those require an authorized user's selected portrait and the deployed provider configuration. Local examples and quota numbers are explicitly fixture-only. Production requires migrations, identity-portrait rollout, provider readiness, a real agreed contract/allowance and operator-selected templates.

## Verification

Final local gates, in order: `npx tsc --noEmit` passed; `npx vitest run` passed **127 files / 1,423 tests**; `npm run build:local` and `npm run start:local` passed; `npm run sweep:anon` reported **SWEEP PASSED — 637/637**. The sweep probes a real private template fixture against public KO/EN detail/catalogue/media/sitemap routes, and refuses anonymous production/status/output requests.

Tests cover real studio authority, member/viewer isolation, own selected portrait and liveness refusal, quota exhaustion, retry fingerprint conflicts, failed enqueue rollback, terminal failure restoration through `runRenderPass`, expiry/pause/revocation, private public-surface exclusion, private output access and range streaming, cross-origin refusal, locale cookies and safe return paths. Contract locking is exercised on PGlite; a multi-connection cloud Postgres stress test has not been run.

Browser checks in `docs/evidence/brand-production/` exercise administrator contract/template creation, pause/resume, private preview loading, disabled creation before a selected portrait, actual KO/EN buttons and desktop/mobile layouts. The English check asserts the visible heading and document language. Earlier PR #16 files named `*-en-*` used only a query parameter and did not prove an English render; the screenshots here are the corrected evidence. No screenshot claims a live paid generation.

### Service wording follow-up

The service distinction update passed the same ordered loop: TypeScript; 127 Vitest files / 1,423 tests; local production build and start; anonymous sweep **637/637**. KO/EN desktop (1440px) and mobile (390px) evidence is in `docs/evidence/brand-service-distinction/`. Browser checks verified visible scope and contract terms, cross-service link destinations, locale switching, no horizontal overflow and no page errors. Direct visual inspection covered the Korean studio desktop and English campaign mobile screenshots. The first browser script incorrectly expected a campaign heading while on the studio page; its expectation was corrected and the full check rerun. No live generation, cloud migration, production release or new billing model was exercised by this copy-only follow-up.

## Self-serve template requests (2026-09-22)

The studio header includes **전용 템플릿 의뢰 / Request a template** before a production contract exists, and also for brands with existing templates. The dialog collects a required video brief plus optional reference links, expected volume, schedule and budget. It submits a labelled structured message to the existing organization-private support thread; the brand and studio can review and reply there. It creates no campaign, contract, generation reservation or charge. This is an intake conversation, not a new request-status workflow or automated email/Slack notification.

Owners/editors can submit; the existing service rechecks current membership on the server. Read-only members see an explanation. A user without a workspace can create one and return to the studio. The form uses the selected writable organization, retains its idempotency key on uncertain responses, and displays confirmation only after a successful server response. Reference links remain plain text; they are not fetched or rendered as remote embeds. No provider, billing, legal or migration changes are included.

Browser evidence in `docs/evidence/studio-inquiry/` covers KO/EN, desktop/mobile, a real local-fixture submission, persistence in the support thread and a simulated lost response after the server writes. Retrying stored exactly one message with the same request ID. The form explicitly says that scope, fees and usage conditions are agreed after consultation, and that submission itself does not create a contract or take payment.

## Studio onboarding (2026-09-24)

`/brand/studio` now lays itself out by stage (`lib/brands/production/stage.ts`). If there is no contract, the heading says what the studio does and makes **전용 템플릿 의뢰하기 / Request a custom template** the main action. Below it are the four steps (request → format design and contract → template and verified portrait → create and download), two example videos with a reference photo, and the studio/campaign scope. The face setup is only asked for once a template exists. After a brand sends a request, the page reads it back from the existing support thread by its `messageTitle` heading and says whether TWINGS has replied. This is a read of the thread, not a new status workflow. Returning brands see templates first; the explanation is folded into one `<details>`. When the allowance is used up or every contract has ended, the page says so and makes an additional request the main action. Viewers and the TWINGS team view get no request button. Review and evidence: `docs/reviews/STUDIO-ONBOARDING-20260924.md`.

Validation for template intake: `npx tsc --noEmit`, `npx vitest run` (127 files / 1,423 tests), `npm run build:local`, `npm run start:local`, and `npm run sweep:anon` (637/637) passed in order. Existing support tests cover membership revocation, unrelated-user rejection and idempotency. Local browser verification covers the owner submission path; no real customer message, external notification or production deployment was sent.

## Language and action placement (2026-09-23)

Language is a workspace preference rather than a primary task. The brand shell places language and sign-out in the desktop sidebar footer; on mobile they sit beside the logo, above navigation. A native 한국어 / English select uses the existing locale POST endpoint and retains the current organization query. Before hydration or without JavaScript, an explicit localized submit button remains available. The default admin language buttons are unchanged.

The redundant global top bar was removed. Campaign requests are offered within the campaign page (heading for existing campaigns, existing setup/empty-state entry otherwise); the self-serve studio has its own template-request button beside its heading. This avoids showing two competing service requests on the studio page. Mobile sign-out is an icon with a translated accessible name and title; both controls retain 44px minimum targets.

Browser checks exercise 1440/768/390/320px widths, actual language POSTs, retained organization selection, reload persistence, both service actions, keyboard utility order and a JavaScript-disabled fallback. Screenshots and measurements live in `docs/evidence/workspace-controls/`. The initial harness measured streamed HTML before styles finished loading and changed a select before hydration; checks now wait for page load and the auto-submit readiness marker, and the product gained an explicit pre-hydration submit fallback.

Final validation for control placement: TypeScript passed; Vitest **127 files / 1,423 tests** passed; local build/start passed; anonymous sweep **637/637** passed. Direct visual review covered the English 320px studio, English desktop studio, Korean 390px studio and Korean desktop campaign page. No production deployment was performed; the browser evidence is local. No new migration, legal copy or generation flag change.
