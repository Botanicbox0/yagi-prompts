# TWINGS creator platform — design and release contract

2026-10-15. Implementation branch: `codex/creator-platform`, based on `e258674`.

## Product loop

Keep the promise: become the protagonist of a tested format with your own face. A private **content request** lets any signed-in customer describe what they want, attach a reference link and continue a conversation with the studio. It is not an unrestricted prompt editor or a promise that an AI has started generating. The studio can turn recurring demand into a commissioned format. Replies stay in the authenticated inbox; no outbound mail is sent by this feature.

An **approved format creator** is an invited supplier, distinct from a consumer on the existing Creator subscription. Approval is an explicit, revocable permission. They submit a title, example link, private recipe and rights attestation. Only the studio can turn a submission into a draft template and publish it through the existing admin QA workflow. Submission never publishes, sets a sale price or grants admin rights. A new version requires new review. Copying an existing row must never silently change its creator attribution.

## Decisions and open commercial settings

- Owner decision: creator receives 80% of distributable margin; TWINGS receives 20%. This is not 80% of gross sales.
- Owner follow-up supersedes the previous blanket credit prohibition **for this proposed reward program**: reward SNS posts with image-only credits, not cashback. No credit purchase, transfer, cash withdrawal or video redemption.
- Proposed margin definition: actual revenue excluding tax and refunded amounts, less actual provider cost and payment fees. Do not add new fixed-cost allocations to the existing pricing model. An unknown cost is pending, never zero. Preserve currency and the exchange rate/evidence used for each settlement.
- Grant only against a completed, paid, non-refunded eligible render; one post and one render can earn once globally. Creator royalties are protected first. Reward cost liability must not exceed the remaining platform margin. Budget the full redemption cost; do not rely on users forgetting credits.
- Credit denomination, image prices, award caps, validity/retention periods, eligible countries, publication retention period and terms need owner approval. No monetary defaults are invented. Existing paid prices and legal pages remain unchanged pending approved release wording.
- Subscription/brand/free/admin renders must not inherit a one-time order's reward budget. Subscription revenue allocation, creator contract, reserves, tax documents and payout schedule remain launch gates. An accrual is not an executed bank transfer.

## Rewards and moderation

MUSINSA is a pattern reference, not a source of TWINGS amounts. [Official domestic FAQ](https://store.musinsa.com/app/cs/faq/005/005000) describes review/purchase/event accrual and non-cash redemption; its indexed details may lag. [Global Points](https://help-global.musinsa.com/hc/en-us/articles/21893369296537-What-is-Point) separates rewards from cash and supports subsequent purchases. Older [2021 policy notice](https://store.musinsa.com/app/cs/notice_view/5185?page=1) explicitly discusses rewards exceeding inexpensive product prices: the relevant lesson is a per-order cost cap, not its historical payout table.

Claim states: submitted → approved / rejected → revoked where documented fraud or an underlying refund is confirmed. A submitted URL is evidence to review, not ownership proof. Require the actual output, account ownership, visible incentive disclosure, matching public content and a dated reviewer decision. Do not auto-fetch arbitrary URLs: canonicalize supported post hosts/paths, strip tracking, reject credentials/ports/redirect shorteners/private hosts. Start with manual verification; later use authorized platform APIs per platform/account permissions. API access to a personal Instagram account is not assumed.

Credits use an append-only grant/reserve/release/reversal ledger with idempotency keys and per-wallet locking. Terminal render failures release exactly once; unknown/running outcomes do not release. A reversed, already-spent award can produce a negative balance that blocks further spending rather than issuing cash debt collection automatically. Awarded balances are not manually overwritten. Quote image cost on the server from an approved, versioned policy, never from browser price/medium fields. General account suspension and account-closure/financial-retention workflows need integration before the reward pilot; this implementation does not introduce a new account suspension system.

SNS incentive disclosure is a launch requirement. Ratings are independent of rewards: no minimum star score and no positive wording requirement. The [FTC review rule](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers) prohibits conditioning incentives on positive/negative sentiment and highlights disclosure. Country-specific terms and platform requirements must be reviewed before expanding eligibility; this design is not a worldwide legal clearance.

## Trustworthy quality signals

One rating per customer per template, tied to a real terminal render. Allow failed results too, to avoid survivorship bias. Exclude staff and the template's own creator from the public customer average. Show count, distribution and an honest empty state. An arithmetic average remains an arithmetic average; a Bayesian score can later rank templates without replacing the displayed average. Do not label a tiny sample as reliable.

Moderation excludes duplicate/abusive/fraudulent ratings with reason, actor and immutable history; restore is supported. Low sentiment is not a moderation reason. Studio QA is separately labelled and never added to the customer average. Template revision/engine cohorts and recent failure rate should inform internal QA. Freeze publication when regressions exceed an approved threshold, not an invented threshold in this release.

## Face-photo funnel

Show eye-level, front-facing, one-person examples before upload and keep them visible on retry. A self-hosted, version-pinned MediaPipe Face Landmarker runs in a disposable browser worker after file selection. No pixels or landmarks are transmitted for assessment. The SDK's built-in usage telemetry is blocked before fetch; a worker-specific CSP restricts connections and scripts to this origin as a second boundary. The model is SHA-256 checked at build time; runtime files come from the exact lockfile version. The worker resizes to 1024 pixels, closes resources, and is terminated on file change, navigation or a 15-second timeout.

Owner decision on 2026-10-15: face-angle assessment is **advisory only**. Angle, missing/multiple face, loading and unavailable states never disable submission. The customer may continue with the selected photo after the existing rights consent. No second override checkbox is required. Existing provider moderation and identity verification stay mandatory. Broad yaw/pitch/roll hints (20/25/15 degrees) are engineering heuristics, not calibrated measurements or approval of identity. Validate diverse consented photos/device performance before tuning; never turn these thresholds into a submission gate without a new owner decision.

## Security model and rollout

Public HTML, JavaScript and media can be copied. Zero scraping is impossible. Private recipes and server code must be absent from HTML/RSC/JSON/client bundles and public storage, not merely hidden with CSS, encryption whose key is shipped to the browser, or robots.txt. Private GitHub access is a separate control.

Use explicit DTO allowlists, server-only boundaries, default-deny RLS and no direct browser table privileges. Bind mutations to the session, same-origin requests and strict bounded payloads. Serialize per-user quotas and money operations in database transactions. Use CSP/secure headers where compatible, short-lived private media access, redacted errors and tests that attempt cross-account reads and forbidden property injection. Preserve SEO for public catalog pages; apply abuse controls to expensive authenticated operations.

Release independently: (1) photo guidance and leak regression checks; (2) private requests and verified ratings; (3) invited creator submission and admin review; (4) image reward pilot after commercial/terms approval; (5) royalties and global expansion after accounting/contract verification. The owner authorized cloud application and deployment on 2026-10-15; migration 0046 + 0131 was applied as one transaction. Preview must fail closed when schema/flags are absent. Never enable real-money behavior from a client flag.

## Acceptance evidence

Required: typecheck, all Vitest suites, local DB migrations, production local build, anonymous authorization sweep, desktop/mobile browser inspection; additional adversarial tests for duplicate awards, parallel spend, failed generation release, creator self-review, cross-account references, URL normalization, recipe absence and unavailable schema. Production migration, provider quality, real payments and payouts are separate checks.

The [security selection report](SECURITY-RESEARCH-2026-10-15.md) records the daily/weekly/monthly GitHub observation and adopted controls. [QA inventory and evidence](qa/creator-platform.md) distinguish measured results from release gates.

## Operator activation contract

1. Applied `0046_core_creator_platform.sql` and `0131_glue_creator_platform.sql` to Supabase on 2026-10-15 (owner authorized) on the verified cloud baseline. 0046 also supplies the two shared render cost fields without opening the separately staged subscription features; 0043 tolerates these existing fields when it is applied later. The owner explicitly authorized cloud application and deployment on 2026-10-15.
2. `TWINGS_COMMUNITY=on` opens private requests and verified ratings; `TWINGS_FORMAT_CREATORS=on` opens supplier submissions for explicitly approved accounts. Both default off. `/admin/community` uses the existing admin role and `/admin/do` operation registry.
3. Approve a supplier's contract version before granting permission. Accepting a format creates a pending catalog entry. Complete media, translations, engine/price and QA through the existing editor before publication. The DB refuses disclosure or reassignment of an accepted private recipe.
4. Before rewards, approve country eligibility, credit denomination, cap, expiry/retention, account closure, incentive disclosure and legal wording. Register the immutable initial policy and a measured studio-owned image offer through admin. No such policy or amounts are seeded in production. Changes to an already active denomination need a separate migration/version plan, not editing historical grants.
5. Only then set `TWINGS_IMAGE_REWARDS=on` and `TWINGS_REWARD_TERMS_VERSION` to the approved policy's exact `terms_version`. Missing/mismatched policy keeps reward submission/redemption closed. Turning flags off blocks new customer use; terminal failures and refunds still reconcile existing entries.
6. Verify actual usage-cost reporting and payment evidence, then record the order settlement before approving its SNS claim. Keep the claim pending if any cost or evidence is missing. Disable an image offer when its provider pricing changes; editing the template invalidates its existing fingerprint. A policy cost budget is not an external provider spending limit.
7. Review creator accruals and refunds before manually controlled payouts. Bank transfer, global-currency order adapters, subscription revenue attribution, minimum payout, reserves and tax/KYC are not implemented by this pilot.

Jobs without provider-usage cost evidence, and jobs with multiple execution attempts, remain `cost_pending`: the current render row does not establish every possibly billable retry's total cost. Some image providers currently report estimates only. A complete invoice/per-attempt cost adapter is required before those jobs can earn rewards or finalize royalty accruals.

No new outbound email or SNS posting is part of this feature. The feature is intentionally staged behind the above gates; enabling it is not an automatic consequence of merging this branch.
