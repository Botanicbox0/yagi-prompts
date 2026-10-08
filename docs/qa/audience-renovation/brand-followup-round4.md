# Brand page final pass: trust and Korea/Japan campaigns

2026-10-08. Founder requested an AI safety FAQ, an unmistakable simultaneous Korea/Japan offer, cleanup, final Fable review, and commit/deployment. This explicit deployment instruction authorizes the final PR merge after validation; no direct push to main is used.

## Scope

- A compact server-rendered Korea/Japan offer is visible immediately after the production/recruitment/publishing steps. It states that both creator pools support simultaneous campaigns and market-specific messages and creators.
- Two new shared-catalog FAQ entries cover AI likeness/privacy/ad disclosures and simultaneous Korea/Japan campaigns. Both locales and FAQPage JSON-LD use the same eight brand questions.
- Consent, model-provider automatic moderation, human content/ad-disclosure review, data-access permissions, disclosed overseas processing/retention/deletion, and the published 24-hour likeness-report review are concrete operating procedures. No certification, legal opinion, all-country compliance guarantee, or absolute-security guarantee is claimed.
- No legal document, identity safeguard, payment flag, customer metric, cloud database, or storage provider is changed.
- Removed four unused brand-copy keys from both dictionaries and the obsolete use-case mock. Earlier revisions removed the unused five-tab client component and CSS. No real campaign data or media is deleted.

## Source checks

Existing published terms sections 5 and 8 and privacy sections 1-6 are the operational source. The access boundary is implemented by the current authenticated workspace permissions; it is not a new certification.

Official regulatory context checked on 2026-10-08:
- Korean endorsement/advertising guidance: https://www.law.go.kr/LSW/admRulSc.do?query=%EC%B6%94%EC%B2%9C%E3%86%8D%EB%B3%B4%EC%A6%9D+%EB%93%B1%EC%97%90+%EA%B4%80%ED%95%9C+%ED%91%9C%EC%8B%9C%E3%86%8D%EA%B4%91%EA%B3%A0+%EC%8B%AC%EC%82%AC%EC%A7%80%EC%B9%A8
- Japan Consumer Affairs Agency disclosure FAQ: https://www.caa.go.jp/policies/policy/representation/fair_labeling/faq/stealth_marketing/
- Korea AI transparency guidance: https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28987&cbIdx=99835&parentSeq=28987

Country rules and channel AI policies are checked for each execution. This revision adds explanatory public copy, not a newly implemented legal-monitoring system or an AI disclosure badge.

## Independent review

Claude `claude-fable-5-1`, tool-free, reviewed only the proposed public Korean copy. It found no major issue, confirmed that the simultaneous market offer was clear, and recommended clearer recruitment and moderation wording plus a plain explanation of YAGI's relationship to TWINGS. These were applied. It did not review source, deployed UI, or independently verify metrics. A previous full-source transmission was rejected by automatic approval review; it was not retried.

## Verification and release

- Final typecheck after copy/palette/dependency changes: passed.
- Final full `npx vitest run --maxWorkers=6`: **194 files / 2,050 tests passed**, 813.04 seconds, exit 0. This run includes the patched image processor and test tooling.
- `npm run build:local`: passed, Next.js 15.5.27, **35/35** static pages. Brand landing remains 5.65 kB route JS / 162 kB first load; brand and story routes retain one-hour revalidation.
- `npm run start:local` then `npm run sweep:anon`: **769/769, SWEEP PASSED**, exit 0, against the isolated QA snapshot.
- Fresh preview and Production verification are the release steps after this commit. Their actual results will be recorded in the PR and release artifact; they are not assumed by the local checks above.

## Dependency security pass

The final read-only production audit reported one critical and three high dependency entries. Patched Next.js 15.5.23 to 15.5.27 and sharp 0.34.5 to 0.35.5. Next.js's pinned PostCSS needs the scoped `next.postcss` override at 8.5.23; the lockfile refresh also resolves source-map-js at 1.2.2. A full audit then identified the development-only Vitest mocker advisory, resolved by pinning Vitest 4.1.11. Final full `npm audit --json`: **0 vulnerabilities**. This audit result does not imply that every listed advisory was exploitable in TWINGS's Vercel deployment.

Primary patch sources:
- https://github.com/vercel/next.js/releases/tag/v15.5.27
- https://github.com/lovell/sharp/releases/tag/v0.35.5
- https://github.com/postcss/postcss/releases/tag/8.5.23
- https://github.com/advisories/GHSA-68fv-2mgg-jv7q
- https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9

Follow-up: removed the three beige/warm color tokens and replaced every brand landing surface that used them with pure white. Black and creator blue remain. Also removed ten unused case-copy fields across KO/EN.

Claude Opus 4.6 was explicitly invoked as claude-opus-4-6 after checking the official Claude Code model configuration. The completed response modelUsage confirms claude-opus-4-6. It reviewed the complete supplied public Korean brand/FAQ copy, found no critical issues, and recommended three wording refinements (remove 감성의, simplify the causative service sentence, and replace 게시를 운영합니다). All three were applied. This is a copy review, not a source/UI or independent-metrics review.

