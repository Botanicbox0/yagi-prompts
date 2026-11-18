# Prompt Architect profiles — changelog

Every rule change bumps the `version` in the file's header, adds a line here, and ships with the before/after
tables of `scripts/architect-eval.ts` in the PR. Jobs record the versions they were written with
(`work.enhancer.profileVersion`, `coreVersion`).

## core 2026-11-19.2 (shared rules: core, tasks, skin)

- **Tone variant default stays `short` for every model.** The founder's paid check on production (54 cells, close-ups
  with `none` / `short` / `full`) showed no consistent visible difference — n=1 per cell, 2026-11-19. The env override
  `BRAND_STUDIO_ENHANCER_SKIN_VARIANT` stays for further tests.
- Same check: the new rules beat the current ones on Seedream 5.5 (pores, redness and freckles kept, identity closer;
  the current rules smoothed skin and, on full-body shots, dropped freckles and lightened skin); a small gain on Nano
  Banana Pro and GPT Image 2.6; people with GPT Image 2.6 look fine.
- Side effect seen in that check: the new-rule pictures took on the person reference's own mood (grey studio, calm
  light). Fixed in wording: a person reference supplies the person, never its backdrop, light or colour grade unless
  asked (`tasks.ts`), and the realism light rule now works inside the scene and mood the request asks for (`skin.ts`).
  A plain ad request (no realism words) already kept its bright campaign scene before and after the fix
  (`scripts/architect-eval.ts --emit-plain`).

## 2026-11-19.1

- **All profiles get a header** (`version`, target model ids, `sources` with the date each was read and the claim
  it backs, `lastVerified`; rules tagged `[official]` / `[aggregator]` / `[house]` / `[founder: date]`). Lookup by
  model id first, then by family (`MODEL_BLOCKS` in `index.ts`).
- **core**: the image grounding rule no longer asks for a long description of every reference; the task says how
  much each role gets. A focal length or camera height is a viewpoint and may be written (gear and brands still not).
- **seedream**: references are "Image N" (founder 2026-11-19, BytePlus guide); "Figure N" is still read in old
  prompts and typed words. One use-case phrase; quoted text ends with "no other text"; ceiling 200 words with three
  or more references or the skin rule (else 60–140). The skin line moved to the people rules (`skin.ts`).
- **nano-banana**: positive phrasing throughout (Google's "semantic negative prompts"), the logo sentence included;
  one intent phrase; up to eight sentences with three or more images. New model blocks: **Nano Banana Pro**
  (6 object / 5 character / 3 style references, step-by-step for complex scenes) and **Nano Banana 2.1**
  (10 object / 4 character references, no style input, strong small text).
- **gpt-image**: "photorealistic photograph" for photographs; a people step (framing, gaze, hands, contact);
  unusual words spelled once; positive logo sentence. People with GPT Image are allowed (founder 2026-11-19: the
  old ban was about GPT Image 2.0 for fashion lookbooks). New **GPT Image 2.6** block (layout hierarchy); the
  `reasoning_effort` parameter is chosen in `provider/complexity.ts`; the markup rule exists for a markup edit,
  which no studio flow sends yet.
- **tasks (image)**: product and logo references are bound by what to keep (label, cap, proportions, colours), not
  re-described; style and place references keep the detailed description.
- **skin (new)**: base people rule, realism rule (zones, light that shows relief, portrait perspective, hands /
  arms / neck in wide frames, no grain or sharpening), tone rule with variants `none` / `short` / `full`
  (provisional default `short`; `BRAND_STUDIO_ENHANCER_SKIN_VARIANT` overrides), the in-place restore sentence
  for a partial edit on a face. Detection in `planSkin`.
- **seedance**: header only (2026-11-15.1, unchanged rules).
