# Content slots — what engineering wires and content-ops fills

PLAN §9 splits the work: engineering ships the surfaces, **real content is content-ops and is not
an engineering gate**. Everything below is a seam that is already wired and rendering a designed
placeholder. Filling one is a config or CMS change, never a code change.

---

## Template registration

Use `/admin/prompts/new`. New template addresses are derived from the English title; operators do
not enter a slug. Existing addresses receive a numeric suffix on collision. Older open forms may
still submit a slug, but creation ignores it. Editing a published template keeps its current URL.

Source and making-of notes are optional and collapsed on creation. With JavaScript enabled,
validation errors stay on the current form, preserving its text, selected files and completed
upload receipts. Nothing is saved to browser storage, so this is not a draft or reload recovery.
An uncertain network response must be checked against the template list before retrying.

---

## 1. Hero reel — `HERO_REEL`

**Where** `lib/content/slots.ts` → read only by `components/landing/hero-media.tsx`.

**Now — not rendered.** The landing page (`app/(marketing)/[locale]/page.tsx`) renders `Hero` from
`components/landing/sections.tsx`: a compact type band with the template CTAs and no media panel
(founder pass, 2026-08-13). No page imports `<HeroMedia>`, so this slot and its poster fallback
`components/landing/reel-poster.tsx` are currently unreachable, and setting the variables below
changes nothing on the site. The components are kept pending an owner decision; the steps below
apply only if `<HeroMedia>` is wired back into a page. When it was rendered, a `null` `src` showed
the in-code poster composition; no video is generated or downloaded at build time.

**Swap**

1. Render the reel offline with HyperFrames (§5.4 — "videos are assets, not runtime dependencies").
   Target ~12s, silent, loopable, 16:10, H.264 MP4 (add a WebM sibling if you want one).
2. Upload it somewhere the site can serve (Supabase `public-content`, or `public/media/` for a
   small file).
3. Set the environment variables and redeploy:

   ```
   NEXT_PUBLIC_HERO_REEL_SRC=https://…/hero-reel.mp4
   NEXT_PUBLIC_HERO_REEL_TYPE=video/mp4
   NEXT_PUBLIC_HERO_REEL_POSTER=https://…/hero-reel-poster.jpg
   ```

`<video>` is already wired `autoplay muted loop playsinline preload="metadata"`, and the §5.3-8
scale/parallax scrub applies to whichever of the two is rendered.

**Poster is not optional in spirit.** If you ship `SRC` without `POSTER`, the first frame is blank
until the video decodes, which costs LCP on the landing page.

---

## 1b. Hero evidence — `heroEvidence()` (셀카 → 장면)

**Where** `lib/content/slots.ts` → `components/audience/hero-evidence.tsx`, rendered by the home hero
(`components/audience/creator-home.tsx`). docs/PLATFORM-2.0.md §15.3-2.

**Now — not rendered in production.** Two pictures make the proof: a front-facing selfie and a still
of the scene that same face went into. Both are required; with either one unset the hero keeps its
earlier shape exactly (no empty frame, no layout shift). Which person may appear is a founder decision
(PLATFORM-2.0 §15.5-16: the founder or an internal model with cleared rights).

**Swap** upload the two images (4:5 crops read best; any public URL or a `public/` path) and set:

```
NEXT_PUBLIC_HERO_EVIDENCE_BEFORE=https://…/selfie.jpg
NEXT_PUBLIC_HERO_EVIDENCE_AFTER=https://…/scene-still.jpg
```

then redeploy (the landing is static). Local QA fills the pair with the public AI-generated photo
guide image and an existing template poster (`docs/qa/onboarding-make/README.md`) — a placeholder for
the layout, not a real selfie → scene pair.

---

## 2. Playbook hero images — the catalog cards

**Where** `lib/content/asset-url.ts` → `components/landing/playbook-card.tsx`.

Heroes are always published to the **public** `public-content` bucket (§6 asset lifecycle), so a
card image needs no entitlement check. `publicContentUrl()` builds the URL from
`NEXT_PUBLIC_SUPABASE_URL`; with no Supabase project configured (§11 open item) it returns `null`
and the card renders `CardCover` — a deterministic generated composition, not a grey box.

**Swap** create the Supabase project, set `NEXT_PUBLIC_SUPABASE_URL`, upload heroes through
`/admin` (M4). Nothing else changes: `CardCover` stays as the permanent fallback for playbooks
without a hero.

---

## 3. Ad slot — the house placeholder

**Where** `components/ad/ad-card.tsx` (`AdCard` for the ≥1440 rail, `AdBanner` below it).

v1 renders one house placeholder everywhere, per §3.6. `AD_SLOTS_DB_BACKED` in `lib/flags.ts` is
the seam for a DB-backed `ad_slots` table, deferred until a real advertiser exists.

**Swap** flip the flag, add the table, and give `<AdRail>`/`<AdBanner>` a `slot` prop. The
geometry, the lagged follow and the "one ad per viewport" rule do not change.

---

## 4. Featured card destinations

**Where** `lib/content/links.ts`, gated by `PLAYBOOK_DETAIL_ROUTE_READY` in `lib/flags.ts`.

`/[locale]/p/[slug]` is M2's route. Until it exists **every** card links to `/library`, which
middleware bounces to the sign-in CTA — the §3.1 funnel, minus the public detail page.

**Swap** in M2: flip `PLAYBOOK_DETAIL_ROUTE_READY` to `true`. Showcase cards then go to the public
detail page and everything else keeps funnelling through the login wall, exactly as §3.1 describes.
`tests/content/links.test.ts` asserts the current state and will fail on the flip, so the change is
deliberate rather than incidental.

---

## 5. Fixture content

`scripts/fixtures.ts` holds two playbooks whose media is literally the bytes
`PLAYBOOK FIXTURE PLACEHOLDER :: … :: not real production media`. They exist to exercise every
block kind × visibility through the real publish RPCs, not to be read. Real content lands through
`/admin` with the `content/MANIFEST.md` template that ships in M5 (§9).

---

## Local data

The landing and pricing pages read the catalog through `lib/content/public-catalog.ts`. With no
`DATABASE_URL`, that comes from a local snapshot:

```powershell
npm run db:local   # migrations + fixture publish → .pglite/catalog.tar.gz (gitignored)
npm run dev
```

Without the snapshot the catalog is empty and both pages render their designed empty states — which
is exactly what CI builds.
