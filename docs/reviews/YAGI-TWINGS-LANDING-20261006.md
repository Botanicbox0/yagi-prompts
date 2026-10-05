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

Final local verification on implementation commit `9a6136dd2129b7034f47482c1885eff4cd12d890`:

- `npx tsc --noEmit`: passed. Final affected route/dictionary suites: 13 tests passed.
- `npx vitest run --maxWorkers=2 --reporter=verbose`: **184 files / 1,998 tests passed**, exit 0. Earlier resource-related timeout runs were not treated as passes.
- `npm run build:local`: passed, exit 0; both YAGI locale pages are statically generated.
- `npm run start:local`: ready on port 3000, explicitly using the PGlite snapshot and local storage.
- `npm run sweep:anon`: **SWEEP PASSED — 701/701 checks**, exit 0, including production-host routing, private-path refusals and independent studio SEO.
- `npm audit`: zero vulnerabilities after the dependency patch.
- Final production browser: the different-person MP4 reached readyState 4 and played without a media error; no browser console error was captured. Original-format MP4 playback was separately verified on the deployment preview.

Preview screenshots: [hero](assets/yagi-hero-20261006.png), [reference-photo/result pairs](assets/yagi-format-pairs-20261006.png).

- Latest deployed preview (commit `9a6136d`) displays both reference photos and plays the actual MP4 demonstration without a media error. The native FAQ opens its answer. Korean and English pages have no horizontal overflow at 320px; the Korean photo/result pairing was also inspected visually at 390px.
- Google Rich Results, code mode, tested the actual deployed JSON-LD graph plus its matching FAQ HTML on 2026-10-06. It detected one valid Organization item. The preview URL crawl failed, so this does not establish crawlability or indexing of the future custom domain. Repeat URL mode after domain cutover. Evidence: `yagi-google-structured-data.png` in the task's local visualization directory.
- The earlier CI sweep exposed Node 24 Fetch overriding the supplied `Host` header, plus two outdated campaign-entry expectations. The sweep now sends a real HTTP request with the requested Host and checks the creator anchor intentionally used by navigation; it retains the production-host positive control and private-path refusals.

## Design and interaction audit — 2026-10-06

**Judgment:** the original assets, restrained cream/ink palette, asymmetric film layout and self-hosted typography establish a credible studio foundation. The page is not yet defensibly best-in-class. Its repeated large sales headings and narrow selection of example films still make parts of it feel like a polished landing template. Automated passes establish behavior and regression safety, not premium taste or conversion performance.

The comparison used the founder's [Brandazine reference](https://www.brandazine.com/en) and the published project/case structure of [Nightjar](https://nightjar.co/). Brandazine's actual brand/creator split and media hierarchy were inspected visually; Nightjar's published project information was read, without claiming its animations were tested. The interaction review also used [Vercel's interface guidelines](https://vercel.com/design/guidelines), [native dialog semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog), [playback rejection handling](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play), and [reduced-motion behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).

| Criterion | Finding | Revision / observed evidence |
| --- | --- | --- |
| Studio identity | Original transparent wordmarks and actual films are stronger than decorative AI illustrations. No gradient orb, glass card, bento badge wall or invented client logo is present. | Kept original assets and their natural film ratios. The TWINGS rabbit loaded correctly; an initially missing lazy image was not mistaken for a white-logo defect. |
| Type hierarchy | Repeated oversized section titles flatten hierarchy; 10px footer text and 11px playback labels are too small. | Reduced approach/workflow heading scale; footer text is 12px, playback text 13px. Korean remains normally spaced Pretendard. |
| Portfolio filtering | Four outlined boxes look like generic product UI. | Plain text categories with a restrained active underline. Actual counts: beauty 1, fashion 1, culture 2, all 4. Enter selects a category. |
| Film inspection | Inline loops lack a comfortable way to inspect the complete work. | Added a native modal cinema viewer with natural-ratio video and browser playback controls. The second video mounts only when requested; initial HTML still contains one video per tile. |
| Media resilience | Rejected play promises could silently leave a dead control. | Localized loading/error/retry feedback; deliberate AbortError pauses are not reported as failures. Rejection and success cases have tests. |
| Keyboard / focus | Film viewing must remain usable without a mouse. | Close button receives focus, Tab remains inside the native modal, Escape closes and restores the opening button. Background videos are paused and page scrolling locked while open. |
| Touch / responsive | Language links were 16px wide and legal links only 18px tall. A later 320px Korean check found a 2px footer-arrow overflow. | Language targets now 44×44px; footer links have 44px minimum height. Mobile wordmark gap reduced, then document width and scroll width both measured 305px at a 320px viewport. |
| Contrast | Muted text needs measurable readability. | Observed computed colors give 5.26:1 on cream and 8.84:1 on ink. This samples body/footer text; it is not a complete WCAG certification. |

Browser checks used Chromium in the Codex in-app browser at 320, 390, 768 and 1440px, across Korean and English. A 390px portrait viewer fit within the viewport with a 44px close button and uncropped 9:16 video. The 30.08-second landscape film played; clicking its native timeline sought to 13.49 seconds, with zero background films playing. At least one enlarged MP4 reached readyState 4 without a media error.

Native fullscreen is **not a passed check**: activating the browser control produced a full-canvas view, but the DOM fullscreen signal remained false and Escape also closed the modal in this browser. Real Chrome/Safari fullscreen needs a separate check. Reduced-motion guards were inspected in code; this browser does not offer motion-preference emulation. Physical iPhone/Safari/Firefox, field Core Web Vitals/INP, target-buyer interviews and conversion impact were not tested.

The largest remaining premium gap is editorial: a more varied, tightly selected showreel and genuine project case pages explaining the brief, production choices and result. Use only approved work, public client names and existing approved metrics. Do not fabricate missing case detail or add decorative effects to disguise it. Bespoke motion can follow that art direction, but a generic cursor or gratuitous scroll takeover is not a substitute.

The copy export now contains 127 entries: the earlier 122 reviewed entries plus five new localized media-control/status strings. The new five were not submitted to Opus; the preserved Opus review remains evidence for its original scope only.

Audit regression verification on implementation commit `d7697e47b5073816365801104961ccb23d8942dd`:

- `npx tsc --noEmit`: passed, exit 0, before the full test suite.
- `npx vitest run --maxWorkers=2 --reporter=verbose`: **185 files / 2,002 tests passed**, exit 0, 1,242.77 seconds. All existing suites were included.
- `npm run build:local`: passed, exit 0; `/yagi/ko` and `/yagi/en` are static, 105kB reported First Load JS including the shared runtime. This is a build-size measurement, not field performance.
- `npm run start:local`: ready on port 3000 with the local PGlite snapshot and local storage.
- `npm run sweep:anon`: **SWEEP PASSED — 701/701**, exit 0.
- Deployed branch preview: new viewer buttons present; actual enlarged MP4 played at readyState 4 with zero background videos playing and no captured console warning/error. Evidence: [work and filters](assets/yagi-audit-work-20261006.png), [native film viewer](assets/yagi-audit-viewer-20261006.png).
- Final local production route opened successfully. The in-app browser had intermittent stale-tab/viewport-transition stalls during QA; a fresh tab recovered. These tool stalls are not counted as successful interactions or attributed to an application defect without evidence.

No required local regression step was skipped. Browser/device and field-performance limitations remain as listed above. Production service, DNS and cloud state were not changed.
