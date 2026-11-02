# Brand page follow-up — 2026-10-08

Founder changes: blue accents, published August campaign films, natural Korean service descriptions, short enquiry modal, production film and Pitch portfolio, generic hero case link.

## Case presentation research

- [Superside / Colgate-Palmolive](https://www.superside.com/blog/colgate-palmolive): real creative assets alongside customer context, challenge, solution and measured results. Applied as a smaller, film-first story rather than adding unverified testimonials or conversion figures.
- [Runway customer stories](https://runway.com/news/customers): separates work and enterprise enquiries. TWINGS keeps creator product and brand campaign destinations distinct.

## Media provenance

- August campaign workspace: `bc82d3f0-bb8d-4ae7-81ca-d4e26d149c54`. Public post links verified against its records and visible Instagram captions on 2026-10-08.
- `morphic-august-01`: https://www.instagram.com/p/DcXjygPg8fE/ — 90s interview, published August 23.
- `morphic-august-02`: https://www.instagram.com/p/DcShoikJklw/ — 90s interview.
- Both files preserve full frames, embedded marks and interview audio; H.264/AAC, fast-start, metadata stripped. No expiring media URLs or creator names in the application manifest.
- `production-paris`: the actual Paris campaign film on slide 2 of https://pitch.com/v/yagi-production-wokrs-vsrgfd ; 18-second web excerpt, 1280×720, silent, H.264 fast-start. The original full work is available through the portfolio CTA.
- September files remain separate; no August aggregate is attributed to those films.

## Checks

Required typecheck, full Vitest, local production build and anonymous sweep, followed by desktop/mobile browser checks. Results and preview are recorded in PR #42 after execution. No production submission or live Slack test enquiry is sent during QA.

## Independent review

Claude Fable 5.1 (`claude-fable-5-1`) reviewed the public page copy and layout outline in a fresh, tool-free session. It did not receive repository files or inspect the live UI. Applied feedback: a contact CTA instead of wording that implies a contract, a plain-language explanation of organic participation, a generic hero case link, and first-field focus in the short modal. Browser interaction and responsive validation are separate checks by Codex.

## Browser findings

- Confirmed the blue CTA is the creator-side `#0000ee` token.
- Verified published August interview playback at 720×1280, native controls, original post links and poster-first loading.
- Escape closes the modal, restores focus to its trigger and releases the page scroll lock.
- Found and fixed wheel scrolling being intercepted by the site's Lenis handler inside the modal (`data-lenis-prevent`).
- All same-page campaign enquiry links, including header and footer, use the one modal. Modified clicks retain normal anchor behavior.
- Mobile tabs keep the next choice visible without a decorative scrollbar; keyboard arrow controls remain available.
- Mobile case films use a native swipe rail so the actual portrait films remain readable. Confirmed at 390px: no page overflow, second-film access, and only one film playing.
- Anonymous sweep checks actual anchor markup, not duplicated URLs inside the React server payload: final 739/739 passed.
- Short-form browser submission accepted with HTTP 201 against a separate, freshly migrated local snapshot. Confirmed the receipt panel does not claim an email was sent; server output showed Slack disabled and both mail paths skipped. The existing October 3 snapshot and production database were not changed.
- Production calculator link was checked live: Korean calculator, accurately labelled as Korean on the English TWINGS page, with an English enquiry alternative.
- No live enquiry was submitted from Preview or Production. Script-execution emulation was not counted as a completed real no-JavaScript browser test.

## Final local validation

- `npx tsc --noEmit` passed.
- `npx vitest run --maxWorkers 6`: 193 files / 2,046 tests passed. The first unrestricted run also passed; the bounded final run followed the modal fixes.
- `npm run build:local`: compiled, type validation passed, 31/31 static pages generated, brand routes retain 1h revalidation and 162 kB first-load JavaScript.
- `npm run start:local` + `npm run sweep:anon`: 739/739, `SWEEP PASSED`. Server and sweep used the same freshly migrated isolated QA snapshot.
- No dependency, billing flag, price, template or production database changes.
