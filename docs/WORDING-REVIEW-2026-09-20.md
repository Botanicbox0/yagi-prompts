# TWINGS copy review — 2026-09-20

The owner requested an editorial exchange with **Claude Opus 4.6**. Codex invoked the installed Claude CLI twice with `--model claude-opus-4-6`; both calls completed successfully and their returned `modelUsage` contained `claude-opus-4-6`. This was an actual model review, not an attributed simulation. The CLI ran without tools, slash commands or session persistence. Input contained source dictionaries and product facts, not environment values, credentials or customer records.

## Review and decisions

1. Round one received the complete Korean and English dictionary files and the current release constraints. Its response proposed wording changes and raised structural concerns. Its hand-counted leaf totals were inaccurate; they are not used as coverage evidence.
2. Codex checked those claims against rendered page code, feature flags, identity mode and billing scope. Round two received those corrections, a 40-key bilingual draft, all current brand-workspace strings, and AST-counted dictionary fingerprints (1,668 string leaves per locale at that checkpoint).
3. Claude accepted the corrections and offered revised wording. Codex selected and edited the useful suggestions. **40 keys / 77 localized string values changed** through this review, in addition to the new brand UI and explicit availability/entry copy. Unchanged labels were kept; review does not imply every string needed rewriting.

Accepted: concrete task names, clearer photo instructions, creator-facing “정산 대기” instead of “홀드”, brand goals/budget/content/results in the campaign explanation, direct browsing language in search descriptions, and explicit version-specific approval.

Rejected or corrected:

- “Verified once per account” / “인증된 얼굴 하나”: camera verification is conditional in the current virtual identity mode. Consent and campaign usage terms do not prove universal camera verification.
- A claim that the current pricing page simultaneously sells legacy cookies, Pro and template purchases: its actual page renders template pricing. Dormant financial strings and existing entitlements were left intact; subscriptions remain deferred.
- “REAL REACH”: replaced with the concrete destination, creators’ own channels. No guaranteed audience, automated matching or automatic social synchronization is promised.
- Treating the seven-day waiting period as the duration of review: existing creator rules remain seven days **after** review, subject to campaign terms.
- “The brand receives the report” where this could imply automatic delivery: the copy directs the brand to the workspace. No new email or Slack transport was enabled.
- Replacing clear dashboard labels with a slogan, and sentence fragments such as “스튜디오가 함께”: retained task-oriented headings and a complete, concrete service statement.
- Calling report values live: published reports retain their publication-time snapshot. Later measurements do not alter a published version.

“워크스페이스” remains consistent within the brand product; “브랜드 공간” is used as a plain-language marketing entry. The legacy technical category “pipeline” remains a content category, not a description of the brand workflow.

## Page structure and search

The campaign page leads to the working brand workspace, with pre-signup consultation as a secondary option. The brand workflow follows request → content review → published posts/results. A request is explicitly not a payment or contract.

Visible FAQ and JSON-LD use the same catalog. Closed consumer generation and checkout are disclosed from the same feature flag; no purchase Offer is emitted while closed. Metadata invites browsing templates and requesting campaigns. Case-study numbers remain the previously authorized figures. See [SEO-GEO.md](./SEO-GEO.md) for structured-data and crawler scope; no ranking or rich-result eligibility is promised.

Legal document bodies, prices, payment rules, subscriptions and public-generation flags were not changed by this editorial pass. No real message was sent to a customer or creator.

## Verification

Reviewable changes: [40-key bilingual before/after table](./copy-review-2026-09-20.csv). The clarity, specificity and naturalness scores are **Codex editorial assessments**, not scores supplied by Claude. They evaluate each key in its UI context; the rationale column explains the judgment.

Run `node scripts/dump-copy.mjs --out tmp/copy-catalog.csv` to reproduce the full bilingual inventory (1,672 keys at release). `source_usage` identifies static source references or explicitly labeled candidates; it does not claim verified rendered-route coverage. The script reads TypeScript ASTs without executing dictionaries or loading environment/database values.

The final mobile review removed the duplicated campaign description below the hero. Its existing visible introduction now also serves as the service-definition paragraph.

Dictionary key parity, nonempty translations, interpolation placeholders, legal-document tests, structured-data tests and campaign notification tests passed after the copy edits (37 tests). Full application/build/browser evidence is recorded in [BRAND-LAUNCH.md](./BRAND-LAUNCH.md).
