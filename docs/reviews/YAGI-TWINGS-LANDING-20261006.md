# YAGI production / TWINGS creator app

## Product judgement

The platform already separates likeness verification, paid template renders, campaign participation and a private brand workspace. Its distinctive combination is studio direction + legitimate real-person participation + creator-channel distribution. A model picker or generic prompt UI would weaken that position.

The previous consumer landing hid the campaign entry when recruitment was empty, and its navigation opened the brand introduction before participation. This change keeps a durable creator entry, explains the own-face journey after the template catalogue and links the navigation directly to the creator section. The catalogue remains the first scroll.

The production website previously mixed digital-twin creation, studio services and an obsolete studio sign-up destination. It also contained Framer-template vocabulary unrelated to the offer. YAGI now explains the production service, shows work, demonstrates format variation and gives brands and creators distinct destinations.

The service is not operationally ready merely because its landing is clearer. Public paid rendering remains behind the existing sales switch and live-payment prerequisites. No launch flags, face checks, contracts, prices or production credentials change here. Template quantity/selection and payment opening remain founder decisions.

## Brand architecture and references

Observed sources; the application to YAGI is our design judgement, not a claim that any pattern is universally optimal.

| Reference | Observed pattern | Applied decision |
| --- | --- | --- |
| [Runway Studios](https://runway.com/studios) | A production and entertainment arm has its own work-oriented surface, within a larger product ecosystem. | YAGI is the studio; TWINGS remains the maker/participation app. |
| [Block](https://block.xyz/) | A shared mission connects independently named brands, including Square and Cash App. | Explain the relationship in one sentence; preserve each brand's destination and job. |
| [Canva / Affinity](https://www.canva.com/newsroom/news/all-new-affinity/) | Affinity retains a professional app identity as part of Canva. | Avoid replacing TWINGS with a generic YAGI product submenu. |
| [Brandazine](https://www.brandazine.com/en) | Explicit brand and creator entries, media-led proof, use-case explanations. | Audience doors in navigation and a dedicated TWINGS section. No borrowed artwork, names, metrics or sponsorship claims. |
| [OpenAI Kiln example](https://developers.openai.com/showcase/kiln) | A signature interaction directly demonstrates the product, surrounded by restrained editorial commerce. | Actual film filtering/playback and format comparison, instead of decorative dashboards or fake AI input boxes. |
| [OpenAI Nightjar example](https://developers.openai.com/showcase/nightjar-listening-room) | Purposeful audiovisual controls, native scrolling, keyboard access and reduced motion. | Visible play/mute controls, no unsolicited sound, reduced-motion posters and off-screen pause. |
| [Vercel interface guidelines](https://vercel.com/design/guidelines) | Deliberate alignment, readable type, keyboard operation, generous touch targets and necessary animation. | Sans-serif Korean labels, natural tracking, 44px controls and removal of decorative rotating symbols. |
| [Vercel on-brand design process](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md) | Consistent typography and spacing; page structure follows the reader's task. | Brand production and creator participation have their own sections and concrete next actions. |

The Pitch introduction was read through the authenticated browser. Its production + repeatable format + likeness participation + distribution narrative informed the structure. Public client names and unrestricted-quality/scale guarantees were not carried over.

## Copy and typography review

The founder rejected the tiny tracked Korean labels and abstract slogans. The revision uses Pretendard throughout Korean text, 13–14px navigation/labels, normal spacing, larger body text and fewer decorative indices/symbols. At the founder's follow-up request, the format comparison now appears after the hero and service definition, before the portfolio. Both result films appear together rather than behind a toggle, so the reusable-format proposition is visible immediately. Film controls and filters have an actual purpose.

The 122 new dictionary entries are exported in `YAGI-TWINGS-COPY-20261006.csv`. Claude's authenticated web interface was explicitly set to **Opus 4.6 / Medium** for the founder-requested editorial review. The complete recovered response is saved as `YAGI-OPUS46-COPY-20261006.json`, with 22 proposals and before/after clarity, specificity and naturalness scores. These are model judgments, not audience testing or a claim of objective design quality.

Accepted the concrete headline “AI로 만드는 브랜드 필름.” and aligned the English. Reworked awkward English noun compounds and mismatched step titles. Adapted the definition to avoid claiming every production task happens through TWINGS. Kept studio-example disclosure, own-face verification, per-video payment wording, agreed usage conditions and the possibility of varying AI results. Declined the proposal to turn “can vary” into a certainty and retained explicit recruitment-empty guidance. Legal documents are unchanged.

## Implementation

A second Opus 4.6 review covered the earlier, side-by-side format demonstration. Its proposal and editorial decision are saved in `YAGI-OPUS46-SCALE-20261006.json`. The founder found the short face-focused headline unclear, so the final version spells out the reusable-format benefit: “하나의 포맷으로 여러 크리에이터의 영상을 만듭니다.” / “One format for your brand. A video for each creator.” The body connects own-face creation with publishing under campaign terms. We retained result variation and did not adopt “only the person changed,” because the sample shots and timing differ.

- Production entry: `/yagi/ko` and `/yagi/en` on local/branch previews.
- TWINGS links to its working `/yagi/[locale]` entry, so creator-to-studio navigation does not depend on the future Framer domain cutover.
- Future custom-domain entry: `https://yagiworkshop.xyz/ko` and `/en`, rewritten to the static production routes. `www` canonicalizes to the apex.
- Separate root layout, metadata, Organization/WebSite/Service/FAQPage graph, locale alternates, sitemap, robots and LLM documents. No TWINGS PWA/session infrastructure injected into the studio layout.
- Exact production host and asset allowlists. App/API/auth/private storage routes fail closed. No forwarded host trust is added.
- All prose lives in the bilingual dictionaries. Metrics use the existing founder-approved dictionary values: 9 videos, 2M+ views, 300+ derivative organic posts.
- Satoshi and Pretendard are already self-hosted and licensed in the repository. No font CDN or new tracking script.

## Asset provenance

- Logo sources: original 2048px transparent PNG attachments in the founder-provided Slack channel. Replaced the screenshot and opaque TWINGS export. Alpha transparency is verified with Sharp metadata and statistics; no AI redraw or background-removal approximation.
- The founder's later supplied 2073×758 transparent YAGI text logo replaces the typeset header/footer wordmark. The original YW symbol remains the favicon and structured-data logo. The supplied bitmap is used without alteration.
- Four campaign films/posters: existing `public/reel/campaigns` studio format examples. These are explicitly separate from campaign performance claims.
- VP9/Opus WebM copies preserve these six existing films for browsers without H.264 playback. MP4 remains the first source. No new render/provider API is invoked.
- Format comparison: existing `public/reel/studio-demo` assets. The two films differ in timing and shots and are not synchronized or claimed to be frame-for-frame identity substitutions.
- Each result now has its own reference photo. The original format uses the founder-supplied `codex-clipboard-0683a07d-455f-4e90-900f-fbf2f6aabf67.png`, also observed on slide 4 of the supplied [Pitch presentation](https://pitch.com/v/yagi-workshop_introduction-biu5b4/7a42e89a-914d-4a37-ac3c-624610e3c7f3). The other-person result uses the existing reference selfie, whose relationship to the variant is established in `components/brand-workspace/studio-showcase.tsx`. Images are copied without modification; the new photo is displayed at 74–88px.
- The Framer hero video was inspected but asset export failed; it is not used in this implementation.

## Security patch

Next 15.5.23 → 15.5.27, Sharp 0.34.5 → 0.35.5, Vitest 4.1.10 → 4.1.11. Next's PostCSS is pinned to 8.5.23 with a narrowly scoped override. The patch preserves Next 15 and the current route architecture. `npm audit` reports zero vulnerabilities after installation; this is dependency evidence, not a claim of a complete penetration test.

## Release boundary

Branch/PR review precedes merge. Main is not pushed by the executor. Changing Framer DNS or adding the YAGI custom domain to Vercel is a separate operational step after review. Existing production URLs, redirects and YAGI legal-page migration need to be checked before domain cutover. No cloud migration is required.

## Validation

New failing tests were recorded before implementation, then passed: independent host boundary/SEO and persistent creator discovery. Full typecheck, Vitest, local build, HTTP sweep and responsive browser results are recorded in the PR once completed.
