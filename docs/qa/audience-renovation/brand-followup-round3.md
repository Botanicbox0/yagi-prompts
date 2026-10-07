# Brand page: advertising offer and customer stories

2026-10-08. Follow-up on PR #42, replacing abstract service copy with the actual offer: AI ad production, creator participation using their own faces, and managed channel publishing.

## Result

- Hero: “크리에이터가 먼저 만들고 싶은 브랜드 광고.”
- Reel: “크리에이터의 얼굴로, 광고를 완성합니다.” Scaling is explained as one format used by multiple creators, without guaranteed reach.
- Three visible service examples replace five hidden tabs. Each example opens the existing short enquiry dialog with its use-case selection.
- Production: “AI로 만드는 브랜드 광고 영상.” The real Paris film and public Pitch portfolio remain linked.
- Redundant order disclaimer and ongoing-customer workspace card removed from the enquiry section. Header sign-in remains available.
- One Morphic customer story groups the August 90s interview campaign and September Korea/Japan follow-up. Individual campaign records and metrics remain separate.
- Permanent bilingual story index/detail pages, metadata/hreflang, sitemap, CreativeWork lists, and LLM reading-aid links.
- Six buyer FAQs cover delivery, differentiation, production-only work, estimate/schedule, results, and reuse rights. Visible HTML and FAQPage JSON-LD use the same catalog.

## Research and independent review

[Toss Ads customer stories](https://tossads.toss.im/insights?category=%EC%84%B1%EA%B3%B5%EC%82%AC%EB%A1%80) and [Channel Talk customer stories](https://channel.io/kr/blog/topics/3d6f95d1) informed the separation of a concrete product offer from permanent client stories. No third-party performance figures were used as TWINGS evidence.

Claude `claude-fable-5-1` reviewed the proposed public Korean copy in a tool-free session. It supported the three primary titles. Its incorrect August-Korea/September-Japan grouping and generalized organic-spread claim were rejected. It did not inspect the code or UI. A later attempt to send repository source for review was blocked by automatic approval review and was not executed. Codex separately reviewed the code and actual browser behavior.

## Verification

- Typecheck: passed.
- Full `npx vitest run --maxWorkers=4`: **194 files / 2,049 tests passed**, 868.59 seconds. Focused final route/dictionary/SEO/evidence checks: 49 passed.
- `npm run build:local`: **35/35** static pages generated. Brand index, story index and story details retain 1-hour revalidation.
- Brand route JS: **5.65 kB**, down from 6.28 kB in the preceding build. Shared first-load JS remains 162 kB after rounding; this is not a measured conversion or speed improvement.
- `npm run start:local` followed by `npm run sweep:anon`: **761/761, SWEEP PASSED**. Same isolated QA snapshot used by server and sweep.
- Real Chrome: desktop, Korean 390px, English 320px; page width matched viewport with no horizontal overflow. Enquiry links opened the short modal; Escape restored focus to the service card.
- Actual August film decoded at **720×1280, readyState 4**. Playing the second film paused the first; unplayed September films stayed at readyState 0.
- Standalone story: both campaigns present, localized canonical metadata, accessible heading order. Unknown story identifiers return 404 in the production-build sweep.
- Preview and Production enquiry forms were not submitted. No real payment, contract, database migration, or storage migration was performed.

Production merge remains a founder/Director action under AGENTS.md. Cloudflare R2 is still a documented storage proposal, not an implemented migration.
