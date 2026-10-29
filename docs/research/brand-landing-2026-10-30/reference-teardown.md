# Brand landing rebuild: reference teardown (2026-10-30)

Design research for the `/brands` rebuild ("the creative platform that understands your brand"). The primary reference is daylightcomputer.com. Six light-background references follow, then 12 ranked patterns written for our stack: Next.js 15, CSS modules, small client islands, and no motion library.

**Method.** Python Playwright 1.61 drove headless Chromium at 1440×900 and 390×844. Pages were scrolled with the mouse wheel in 0.5-viewport steps for Daylight and 1-viewport steps for the references; the wheel is used because Daylight runs Lenis, which ignores `scrollTo`. Every figure below comes from `getComputedStyle`, `getBoundingClientRect` or the page's own CSS text, which was pulled from the CSSOM plus a fetch of each linked sheet. The few inferences are marked *(inferred)*. Cookie banners were only ever answered with reject or "do not allow" (only Figma showed one). Nothing was logged into, submitted or downloaded for reuse.

**Captures stay outside the repo.** Third-party captures must never be committed. They live at:
`C:\Users\User\AppData\Local\Temp\claude\D--dev-twings\26f2ef63-381a-48aa-a411-d8ab5327334e\scratchpad\s11\refs\`
(below, `refs\` means this folder). Each site folder holds `fNNN.png` frames, `sheet_NN.jpg` contact sheets, `metrics.json` and `styles.css.txt`.

**Project constraints the patterns respect** (from `docs/design/TOOLBOX.md` and `TASTE.md`):
- White or alabaster `#F8F9FA` page, with `#3875C5` as the only accent, read from the token `--lp-blue`. No red.
- Pretendard Variable 700–800 for headlines, tracked −0.03 to −0.04em.
- Spring easing through CSS `linear()`, with `cubic-bezier(0.22, 1, 0.36, 1)` as the fallback. Never `linear` or the default `ease`.
- No `framer-motion` or any other motion library.
- The hero is video, and sentence headlines run full width.

---

## 1. Daylight (daylightcomputer.com): primary teardown

### 1.1 Stack and how the motion is built
- **Stack:** Next.js App Router on Vercel, with Tailwind utility classes. `<html class="lenis lenis-smooth">` means Lenis smooth scroll. There is no global GSAP or ScrollTrigger. The scroll choreography is custom JavaScript writing transforms and opacity.
- **Not used:** CSS scroll timelines (`animation-timeline` 0, `view-timeline` 0), View Transitions (0) and `scroll-snap-type` (0).
- **Hero scrub:** done on 2 `<canvas>` elements over 6 stills.
- **Video:** a single `<video>`, streamed from Mux as HLS.
- **The structural trick is overlap.** Each scene starts underneath the pinned scene before it, using negative margins: `motion-safe:mt-[-100vh]` and `motion-safe:mt-[calc(-200vh-30vh)]`. Every hand-off is therefore a slide or crossfade while both scenes are on screen, never a hard cut.
- **Motion gating.** Pin lengths sit inside `motion-safe:`, for example `motion-safe:h-[500vh]` and `motion-safe:invisible`. With `prefers-reduced-motion: reduce`, the tall pinned sections collapse to normal stacked content. The CSS holds 8 reduced-motion blocks.
- **Viewport units:** `svh` 18 uses, `lvh` 6 (on fixed full-screen layers, `h-[100lvh]`), `dvh` 2.

### 1.2 Scene map
Desktop 1440×900: the document is **20.98 viewports** tall. Mobile 390×844: **23.55 viewports**, longer because the horizontal track becomes a vertical stack.

| # | Scene (headline) | Top (vh) | Height (vh) | Pinned for | What moves | Media framing |
|---|---|---|---|---|---|---|
| 1 | Hero, "The computer, de-invented" (3 words + 13-word sub) | 0 | 2.0 (`lg:h-[200vh]`; on mobile 1.0, not pinned) | 1.0 vh (`sticky top-0`, 100vh) | Scroll scrubs the device and the grass from **day to night**: the shell turns from white to blue and the screen to amber, across about 1 viewport (`refs\daylight\detail\hero_sheet.jpg`). The card then slides up and off the white page underneath. | **Inset card:** 1404×864 at 1440×900, so an **18px margin on all sides**, with **24px radius**. Inside: a promo card (radius 14px) and a "Take a peek" video thumbnail button (288×180, 16px radius). |
| 2 | Manifesto, "We refuse to accept a future where our devices are exhausting, addictive, and distracting¹" → "Introducing *Daylight* — a healthier, more human-friendly computer" | 1.0 (overlaps by −100vh) | 5.0 | **4.0 vh** | Scroll-scrubbed **per-letter opacity**: each word is split into one span per character, with opacity going 0→1. One word turns accent-coloured with a footnote mark. Line 2 replaces line 1 in the same stage. | Text only, on cream with the fixed window-shadow layer. |
| 3 | Feature track, "The world's first full-speed *paper-like* display" | 3.7 (overlaps by −230vh) | 9.2 | **8.2 vh** | A media card enters from the right and grows to an inset full screen. The whole track then translates horizontally through about 12 panels: a feature trio; use-case cards (Reading, Note-taking, Writing); an app-icon grid; a backpack photo; a sunburst illustration with the vision statement; a full-bleed outdoor portrait ("it's a *computer* you can use *outside*"); and a grass shot with 3 features. | The page's only `<video>`: 1920×1080, 19.4 s loop, `autoplay muted loop playsinline`, `preload=auto`, no poster, `object-fit: cover`, shown at **97.5vw × 96vh, 24px radius**. Other panels are stills at 12–24px radius, plus one full-bleed photo. |
| 4 | "When the lights go off, enjoy the amber glow." → "Goodbye, blue light" | 11.9 (overlaps by −100vh) | 4.0 | 3.0 vh | **The page background scrubs** from cream to peach, taupe, a full-bleed amber field, and finally near-black `rgb(24,25,15)`. The amber field then **shrinks into the screen of the tablet held in two hands**, a field-to-device zoom-out. The nav pill and the newsletter dock flip to dark. | Fixed `h-[100lvh]` layers; 3 stills. |
| 5 | "Dive deeper into Daylight" | 15.9 | 0.7 | – | Hover on 4 icon cards | Stills |
| 6 | "What people / are saying" | 16.6 | 1.94 | The H2 is `sticky top:225px` for 1.44 vh | A **117px (8.1vw) headline split left and right** stays put while tweet-style cards rise over it at staggered speeds; then a press-logo row. | Cards about 16px radius |
| 7 | "Daylight is a Public Benefit Co." | 18.5 | 0.73 | – | – | Sunburst illustration |
| 8 | "DC-1 at a glance" spec row | 19.3 | 0.59 | – | – | Icons |
| 9 | Footer | 19.9 | 1.12 | – | A giant wordmark over a full-bleed warm photo, an ORDER NOW bar and "Ships within 3–5 business days" | Full-bleed |

**Whole-page fixed layers** (`position: fixed`, measured):
- **Ambient light.** `fixed inset-0 mix-blend-multiply`, holding 1 video and 4 images: a soft **window-light and leaf shadow** multiplied over every light scene. This is the brand idea, daylight, made physical.
- **Night background.** `fixed … opacity-0 transition-opacity duration-500 bg-night`, which fades in for the night chapters.
- **Nav cluster.** Fixed at top right; described in §1.5.
- **Newsletter dock.** Fixed at bottom right: 352×90, 14px radius, with an inline email field. It is present on every frame.

Frames worth opening:
- `refs\daylight\1440x900\f000.png`: the hero inset card.
- `f005.png`: the manifesto mid-reveal, with the accent word.
- `f009.png` → `f010.png`: the media card entering the horizontal track.
- `f013.png`: use-case cards.
- `f019.png`: the full-bleed portrait panel.
- `f024.png` → `f027.png`: background scrub, amber field, field-into-device.
- `f034.png`: the sticky split headline with floating cards.
- `f039.png`: the footer wordmark.
- Mobile: `refs\daylight\390x844\sheet_00.jpg` and `sheet_01.jpg`.

### 1.3 Typography (computed at 1440 / 390)
- **Display: ABC Arizona Flare**, a serif.
  - **Weight 300, letter-spacing −0.07em, line-height 0.97–1.0.**
  - H1 is **60px at 1440 (4.17vw)** and **40px at 390 (10.26vw)**. H2s run 55–65px. The testimonial display line is 117px.
  - Single words are set in italic: *paper-like*, *Daylight*, *computer*, *outside*.
- **The fluid formula,** from the CSS:
  ```css
  font-size: clamp(var(--min) * 1rem, calc(var(--min) * 1rem + (100vw - 768px) / (1920 - 768) * (var(--max) - var(--min))), var(--max) * 1rem);
  ```
  - `.title-md` scales 3.5→4.5rem on desktop and 2.5→4.5rem on mobile. The interpolation runs from a 768px to a 1920px screen.
- **Body: ABC Room.**
  - 20.8px at 1440 (1.44vw), weight 400/500, **line-height 1.1, tracking −0.05em**.
  - Secondary text is 18px on a 19.8px line.
  - Labels are ABC Room / Room Extended 500 caps at 13–16px with **+0.025em** tracking ("AT A GLANCE", "ORDER NOW" at 14.5px).
  - Body is large and tight, with short measures: 600–700px max-width for paragraphs.

### 1.4 Grid and spacing
- **Content and text widths.** Content max-width is 1167px (9 uses; 81vw at 1440). Text measures are 1080, 960, 900, 700 and 600px.
- **Page inset.** 18px on desktop, about 8.5px on mobile (the video is 373px wide in a 390px viewport).
- **Gutter.** 96px between feature columns.
- **Vertical spacing is in vw** (`--spacing-vw-32` = 6.67vw / 16.67vw / 34.13vw by breakpoint, `py-vw-56`). Spacing grows with viewport width, so a desktop scene keeps the same composition at 1280 and at 1920. It behaves like a scaled artboard.

### 1.5 Nav
- **It is not a bar.** A fixed **pill cluster at top right**: Home · Product · FAQ in a light pill, plus ORDER NOW in an orange pill, 14px caps. The logo mark sits at top left. During the hero, a "Meet Daylight Kids" promo card hangs under the pills, then leaves.
- **It never hides.** The nav stays at top 18px in all 41 frames and after a scroll-up.
- **It flips to dark** in the night chapters.
- **Mobile.** The pill reduces to ORDER NOW plus a menu glyph. The menu is a left drawer (`lg:max-w-[30vw]`, `rgba(250,244,242,.9)` with `backdrop-filter: blur(16px)`) over a `bg-night/20` scrim with a 400ms transition.

### 1.6 Motion values found in CSS
- Durations: 150ms (10 uses), 200ms, 250ms, 300ms, 350ms, 400ms, 500ms.
- Easings: `cubic-bezier(0.4,0,0.2,1)` 11 uses, `ease-out` 19, one `cubic-bezier(0.23,1,0.32,1)`.
- Keyframes: header add-on and submenu in/out, `slide-fade-in`, `scale-fade-in`, `slide-down`, `pulse` and `pulse-slow`.
- All scroll motion is JavaScript; CSS covers only micro-interactions.

### 1.7 Media policy
The page has 61 `<img>`, 2 canvases and **1 video**. The immersion comes from choreography over stills, not from video volume. Corner radii: 24px for big media; 16px for cards and buttons; 14px for the dock; 8px for the form; 6.4px for the small button.

### 1.8 Interaction devices
- **No cursor follower.** Moving the pointer from the left of the hero to the right changed **0.0%** of pixels.
- **No toggles and no compare view.**
- **What it uses instead:**
  - scroll-scrub
  - one video-thumbnail button that opens a player
  - card hover
  - a newsletter dock with an inline field
  - a sticky headline with floating cards
  - the background-colour scrub as the main storytelling device

### 1.9 Copy pacing
- **608 words over 21 viewports, about 29 words per viewport.**
- H1/H2 headlines: median **6 words**, max 15 (the manifesto).
- The manifesto spends **4 pinned viewports on 23 words**.
- Every scene has one headline and at most one short paragraph. Feature items are a 2–3-word title plus a line of 14 words or fewer.

### 1.10 Take and leave
- **Take:**
  - full-screen scenes with overlapping hand-offs
  - inset 24px media frames
  - `motion-safe` gating
  - a single colour-field moment
  - the pill nav and the persistent dock
  - type and spacing that scale like an artboard
  - very low words per screen
- **Leave:**
  - Lenis (scroll hijack, extra JavaScript, accessibility cost)
  - 21 viewports of length; ours should stay at or under about 14 on desktop
  - serif display at weight 300; ours is Pretendard 700–800
  - orange and amber
  - per-letter splitting, which reads poorly in Korean and with screen readers

---

## 2. Reference set: six light-background sites

**Selection.** Twenty-one candidates were probed. Dark-dominant sites were dropped: Flora, Recraft, Koto, Teenage Engineering and Nothing. So were broken or blocked ones: Visual Electric does not resolve, OpenAI showed a bot wall, and Shopify Editions is a WebGL shell with scroll inside a canvas. Award status was not verified here, so it is not claimed. What was chosen is current, light, and admired by designers as craft references.

| Site | Length (vh) | Words / vh | H1/H2 median words | Videos | Notable CSS |
|---|---|---|---|---|---|
| Apple AirPods Pro 3 | 32.5 | 120 (about 60 without footnotes) | 3 | 16 | sticky ×8, snap-x ×2, mask ×21, clip-path ×40 |
| Cosmos | 4.1 | 55 | 5 | 5 | `@view-transition { navigation: auto }`, container queries |
| Luma | 9.9 | 52 | 3 | 2 | – |
| Clay | 11.4 | 86 | 5 | 10 | GSAP and ScrollTrigger, sticky ×34 |
| Dia | 7.4 | 73 | 5.5 | 4 | snap-x mandatory, drag carousel |
| Figma | 9.7 | 28 | 2 | 0 | hover rules ×27 |

### 2.1 Apple, AirPods Pro 3 (apple.com/airpods-pro)
**Why it's here.** This is the reference implementation of white-page, scroll-scrubbed product storytelling. Every pattern is shipped at scale and degrades gracefully: the `<html>` carries `no-reduced-motion`, `enhanced` and `inline-media` capability classes.

**Facts**
- Page: `#FFF` alternating with `#F5F5F7` bands, SF Pro Display 600.
- Headlines: "The best thing you've never heard." is 96px (6.67vw). Stat numerals ("2x more", "4x more") are 80px. H2s are 56–64px.
- Product subnav: sticky for the whole page.
- Hero: full-bleed video at 100vw × 100vh.
- "Get the highlights": a gallery of **87.5vw × 75.6vh media at 28px radius** on `scroll-snap-type: x mandatory`, with a play/pause button and dot paddles.
- "Take a closer look": chips at bottom left (Sound quality, Fit and feel, Heart rate sensing) swap the view of one product stage.
- "Intelligent noise control" runs 20 viewports, with sticky 100vh scenes pinned about 1.5 vh each.
- Staggers use CSS variables: `animation-delay: calc(var(--staggered-delay) * 1s)`.
- Transitions: 320ms with `cubic-bezier(0.4,0,0.6,1)` (171 uses).

**Patterns to take**
1. **Inset media gallery:** 87.5vw, 28px radius, native snap-x, autoplay with a visible pause control and a progress dot per slide.
2. **One stage, chips that swap the chapter.** The camera and product stay; only the state changes.
3. **Short headline (2–4 words), one paragraph, one big numeral.** Pacing comes from type scale, not from copy length.

**Screenshots**
- `refs\apple-airpods\1440x900\f000.png`: full-bleed hero.
- `f001.png`: highlights gallery.
- `f002.png`: closer-look chips.
- `f004.png`: 96px headline over the ring video.
- Contact sheet: `sheet_00.jpg`.

### 2.2 Cosmos (cosmos.so)
**Why it's here.** A visual-curation tool for creatives. A24, Nike, Aesop, Apple, Pentagram, Loewe, Chanel and MoMA sit in its logo wall. It proves a white page can feel immersive with almost no copy (4 viewports total), and its audience is our audience.

**Facts**
- Background `lab(100 0 0)`. Type: cosmosOracle 700 at 72px (5vw), tracked −4%.
- **Hero tile cloud.** Image and video tiles at 12px radius are scattered around a centred headline and rotated about ±6° (`matrix(0.9945, ±0.1045, …)`). With no input, 12.2% of pixels changed over 3 seconds, so the tiles drift. Pointer movement raised that to 17.7%, which suggests a small parallax *(inferred)*.
- The headline's noun phrase rotates: "go-to outfit" on one load, "lamp with character" on another, each with a matching tile set.
- The hero CTA is a search field.
- **Feature cards** sit in a horizontal snap row ("Build your world, your way").
- **Brand list:** huge grey brand names stacked as type ("Ralph Lauren, Snow Peak, COS, Dr Martens…"), with product images beside the active one.
- Cross-document View Transitions are on.

**Patterns to take**
1. **Rotated drifting tile cloud** as a living wall of outputs: our creator-scale scene and the output gallery.
2. **Huge grey typographic list** whose active row darkens and reveals media. A strong device for use cases or brand categories.
3. **Rotating noun in the headline**, synced to the imagery (one product category per load or interval).

**Screenshots**
- `refs\cosmos\1440x900\f000.png`: tile cloud.
- `f001.png`: snap feature cards.
- `f002.png`: typographic brand list.
- `f003.png`: logo wall.

### 2.3 Luma (lumalabs.ai)
**Why it's here.** The closest competitor-shaped story: an "AI creative partner" for agencies and brands, with Serviceplan, dentsu, HUMAIN and Aperture in the logo row. Its hero is a working brand board, the exact claim we make.

**Facts**
- Page: white with black interlude bands. Type: Graphik 500, H1 52px, H2 48px.
- **Hero:** a full-bleed 100vw × 100vh background video of an agent board labelled "Blossom · Brand Exploration · Generating". A prompt card ("What's due this week?") is docked at the bottom.
- Product UI frames: **84.4vw at a 2.29:1 aspect ratio, 24px radius**.
- Section rhythm: white, then black "Research", then white "Recent News".
- Layout: max-width 1280px with 32px padding.

**Patterns to take**
1. **The hero video is the product working on a brand,** with a status label ("Brand Exploration · Generating") and a prompt chip. This beats an abstract reel.
2. **An ink band as a chapter break** within a white page. We'd use it for Production.
3. **Ultra-wide product frames (2.3:1, 24px radius)** for UI shots, so screenshots read as scenes, not as cards.

**Screenshots**
- `refs\luma\1440x900\f000.png`: board hero.
- `f002.png`: logos and wide frame.
- `f003.png`: white-to-black band.

### 2.4 Clay (clay.com)
**Why it's here.** The best current light-mode example of **stacked sticky cards** telling a four-step system story, each step with its own looping 3D clip. It maps one to one onto our workflow-steps section.

**Facts**
- Type: Roobert VF 575, H1 88px (6.11vw). Built on Webflow with GSAP and ScrollTrigger.
- **Four step cards** (DATA, AGENTS, ORCHESTRATION, ACTIVATION) are each `position: sticky` at 0.86vh tall inside a 3.21vh parent, a 2.36vh pin. Each new card slides over the last. Each has its own pastel tint and an 8 s looping video at 41vw × 75vh with 24px radius.
- Wide frames use a **48px** radius.
- A chip row of use cases sits under "What do you want to build?".
- Easings: `cubic-bezier(0.165,0.84,0.44,1)` (29 uses) and `(0.075,0.82,0.165,1)`.
- Stagger: `animation-delay: calc(var(--i) * .15s + .2s)` on `fadeUp`.

**Patterns to take**
1. **Stacked sticky cards.** Pure CSS sticky, each card's `top` offset by its index so the labels stack like tabs.
2. **A looping clip beside each step** (8 s, muted). The step shows the thing happening.
3. **Index-driven CSS stagger** (`--i`), with no JavaScript for entrance timing.

**Screenshots**
- `refs\clay\1440x900\f003.png`: DATA card.
- `f004.png` → `f005.png`: cards stacking.
- `f010.png`: full-bleed footer scene.

### 2.5 Dia (diabrowser.com)
**Why it's here.** Calm, editorial, light. It shows how a product page holds a **persistent CTA** and a **scroll-spy step list** without feeling like SaaS.

**Facts**
- Background `rgb(251,250,246)`. Type: Exposure VAR 500 for display (48px) and ABC Oracle 300/350 for UI and body (54px H2).
- Hero: a huge display wordmark behind a product window over a yellow gradient, closed by a **curved horizon arc**.
- **A "Download Dia for free" pill is sticky for 6.84vh**, essentially the whole page, at bottom centre.
- **Numbered step list:** 01 Start your day two steps ahead, 02 Synthesis…, 03 Find the answer…. It is sticky on the left (a 1.63vh pin) while the media on the right swaps.
- Videos: `object-fit: contain`, at 16px radius (77vw hero) and 12px.
- Carousel: `scroll-snap-type: x mandatory; scroll-snap-stop: always`. Snap is disabled while dragging (`:active { scroll-snap-type: none }`).
- Easings: `cubic-bezier(0.77,0,0.175,1)` and `(0.22,1,0.36,1)`.

**Patterns to take**
1. **Persistent bottom CTA pill.** For us: "Book a demo", always one click away, so the form never has to sit high on the page.
2. **Scroll-spy step list with a media swap,** active item in ink and the rest at 40%.
3. **Snap carousel that releases snap while dragging,** so mouse dragging feels free.

**Screenshots**
- `refs\dia\1440x900\f000.png`: wordmark hero and arc.
- `f001.png`: sticky step list.
- `f003.png`: two-card section and sticky pill.

### 2.6 Figma (figma.com)
**Why it's here.** A creative-tool homepage that sells *precision with taste*. Its bento of real creative work, overlaid with live controls, is the best model for showing "direction" as something you can touch.

**Facts**
- Type: figmaSans **400** (not bold) at 56px for the H1, tracked −1.25px.
- Hero: a layered collage of product artefacts.
- Bento: real creative outputs with **UI controls overlaid** (a "Texture" knob, sliders, colour pickers, cursors), under "Powerfully expressive. Incredibly precise."
- A "95%" stat at 88px next to a quote.
- A logo marquee.
- A **full-width black "Get started" bar** as the close.
- Transitions: 180ms (46 uses). Hover rules: 27.

**Patterns to take**
1. **Media with controls on top.** The control *is* the explanation. Ours would be a light-direction knob, a palette chip, a lens value.
2. **A full-width CTA bar** as the last screen, more confident than a centred button.
3. **Restrained display weight at large size.** Not ours (TOOLBOX fixes 700–800), but proof that size, not weight, carries hierarchy.

**Screenshots**
- `refs\figma\1440x900\f000.png`: collage hero.
- `f003.png`: bento with live controls.
- `f006.png`: stat and logos.
- `f007.png`: CTA bar.

---

## 3. Shared implementation kit (read before the patterns)

**Scene contract.** Every scroll scene exposes one variable, `--p`, going 0→1. Children read only `--p`. Native and fallback paths write the same variable, so the CSS is written once.

```css
/* scenes.module.css */
@property --p { syntax: '<number>'; inherits: true; initial-value: 0; }
@keyframes scene-p { from { --p: 0 } to { --p: 1 } }

.scene { position: relative; }
@media (prefers-reduced-motion: no-preference) {
  .scene[data-pin="2"] { height: 300svh; }      /* pinned for 2 viewports */
}
.stage { position: sticky; top: 0; height: 100svh; overflow: clip; } /* clip, not hidden: hidden breaks sticky */

@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .scene { view-timeline: --scene block; }
    .stage { animation: scene-p linear both; animation-timeline: --scene; animation-range: contain 0% contain 100%; }
  }
}
/* the `linear` keyword here is the timeline mapping, not a visual easing; shape the motion in the children */
.card { transform: translateY(calc((1 - var(--p)) * 40px)); opacity: clamp(0, var(--p) * 3, 1); }
```

**Fallback island.** `'use client'`, about 1 KB. It runs only when `!CSS.supports('animation-timeline: view()')` and reduced motion is off.
- One IntersectionObserver collects the scenes on screen.
- A single passive scroll listener schedules one rAF.
- For each active scene: `p = clamp((-rect.top) / (rect.height - innerHeight), 0, 1)`, then `stage.style.setProperty('--p', p)`.
- No per-frame layout reads outside active scenes.

**Support.** `animation-timeline` ships in Chromium 115+ and Safari 26+. Check Firefox at build time; always feature-detect. Same-document View Transitions: Chromium 111+, Safari 18+, recent Firefox; detect `document.startViewTransition`.

**Easing tokens.** Scrubbed motion maps scroll 1:1; apply shape with `calc` on `--p`, or use a short `animation-range`. Discrete transitions (chips, tabs, reveals) reuse the existing spring token, `--ys-spring` in `app/(brand)/workspace.css` (a `linear(…)` curve behind `@supports (transition-timing-function: linear(0, 1))`). The landing gets the same value, not a second curve, with `cubic-bezier(0.22,1,0.36,1)` as the fallback. Durations: 180–320ms for UI and 500–700ms for scene reveals. These match the references: Figma 180ms, Apple 320ms, Daylight 150–500ms.

**Video policy**
- Use `<video muted playsInline loop preload="none" poster=…>` with one IntersectionObserver island: `play()` at ≥ 0.5 intersection and `pause()` below it.
- Never autoplay under reduced motion. Show the poster and a play button instead.
- Encode 8–12 s loops at 1080p H.264, about 2–4 Mbps, plus a 720p `<source media="(max-width: 767px)">`. HLS isn't needed at this length.
- The poster (AVIF) is the LCP element. Use `fetchpriority="high"` on the hero poster only.

**Section budget.** Our target versus Daylight's 21 viewports.

| Scene | Desktop height | Pinned | Mobile |
|---|---|---|---|
| Hero | 200svh | 1 | 100svh, no pin |
| Why + compare | 250svh | 1.5 | 100svh, drag only |
| Brand: hardlines, memory, direction | 300svh | 2 | Chips, no pin |
| Workflow (5 steps) | 350svh | 2.5 | Native snap-x, 100svh |
| Output gallery | 100svh | – | 100svh snap-x |
| Creator scale | 200svh | 1 | 100svh |
| Production | 100svh | – | 100svh |
| Closing | 100svh | – | 100svh |
| **Total** | **about 16 vh, 8 pinned** | | **about 8–9 vh** |

Pinned viewports convert scroll into motion, so they read shorter than stacked content. If the founder still finds the page long, the first cuts are the workflow pin (use snap-x on all viewports) and the brand pin (use chips).

---

## 4. The 12 patterns, ranked

### 1. Full-screen sticky stages with overlapping hand-offs
- **What:** every section is a 100svh stage. Scenes overlap: the next one starts underneath the pinned one, as with Daylight's `mt-[-100vh]`. Transitions are therefore slides or crossfades, never page-like cuts. This is the backbone that makes the page "fill the screen".
- **Where:** all sections.
- **Implementation**
  - Server component `<Scene pin={n}>` renders `<section class=scene data-pin>` with `<div class=stage>`.
  - The overlap is `margin-top: calc(-1 * 100svh)` on the next scene, set only under `prefers-reduced-motion: no-preference` and only on desktop (`min-width: 1024px`).
  - The stacking order uses `z-index` per scene.
  - Hand-off motion runs off the next scene's `--p` (`opacity`, `translateY`, `scale`).
  - With reduced motion, heights become `auto` and the margins `0`.
- **Cost and risks**
  - Cost: medium, since it is the base for everything else.
  - Sticky breaks under any ancestor with `overflow: hidden`; use `clip`.
  - Use `svh` on mobile to avoid URL-bar jumps.
  - Focus order must follow DOM order. Overlap is visual only, so the tab order stays sane.

### 2. Inset hero film that scrolls out from a white page
- **What:** Daylight's hero card. The film sits in a frame inset 16–18px with a 24px radius. While pinned, scroll pushes it up and slightly down in scale, revealing the white page and the first headline underneath. The headline runs full width over the film (TASTE §5).
- **Where:** hero.
- **Implementation**
  - The section is 200svh with a sticky 100svh stage.
  - The frame: `inset: 16px; border-radius: 24px; overflow: clip`.
  - Exit motion: `transform: translateY(calc(var(--p) * -12svh)) scale(calc(1 - var(--p) * 0.06))`, with the frame's `border-radius` growing to 40px.
  - Overlay copy: `opacity: calc(1 - var(--p) * 2)`.
  - The video island handles play and pause. The filmLabel caption sits bottom-left in a 14px-radius glass chip; `backdrop-filter` is allowed there (TOOLBOX §3).
- **Cost and risks**
  - Cost: low.
  - LCP is the poster, so ship it as AVIF under 150 KB.
  - Mobile: no pin, frame inset 8px, radius 20px.
  - Reduced motion: a static poster with a play button.

### 3. Scrubbed generic-vs-on-brand wipe with a real handle and pair chips
- **What:** the same product and the same request, as two shots. While pinned, scroll drives a vertical wipe from "Plain generation" to "TWINGS". Once the user grabs the handle, the handle takes over. Chips for Logo, Skin and Light swap the pair, and each chip's one-line note ("The plain version turned the mark into a letter Y") appears beside the seam. The idea comes from Daylight's same-object day/night scrub and Apple's closer-look chips.
- **Where:** compare ("Why it all looks the same").
- **Implementation**
  - Stack two `<img>` in one frame. The top one is clipped: `clip-path: inset(0 calc((1 - var(--wipe)) * 100%) 0 0)`.
  - Native path: `--wipe` follows `--p` across a 0.15–0.85 range.
  - The handle is a styled `<input type="range">` with `aria-label="Compare plain and TWINGS"` and `aria-valuetext="TWINGS 60%"`. The `CompareSlider` island writes `--wipe` and sets `data-manual` to stop the scroll binding.
  - Chips are a `role="tablist"`. Swap pairs inside `document.startViewTransition()`, with a `view-transition-name` on the frame for a crossfade.
  - Preload only the active pair, and the next pair on chip hover or focus.
- **Cost and risks**
  - Cost: medium.
  - Touch: give the stage `touch-action: pan-y` and the handle `touch-action: none`, so vertical scroll and horizontal drag don't fight.
  - On mobile, skip the pin and the scroll binding, and keep the drag.
  - Keyboard: the range input gives arrow-key steps for free.

### 4. One persistent stage, three chapters (hardlines, brand memory, one-line direction)
- **What:** the product stage stays fixed while the text column steps through three chapters. Each chapter morphs the same UI:
  - website input → rule chips ("Logo front-on, fixed size · No colours outside the palette…")
  - approved shots collecting into a memory strip
  - the typed prompt "autumn, morning window light" expanding into a spec line ("85mm · eye level · window light upper left · #3A3F4A · #F4EFE6")

  It combines Apple's "Take a closer look" (one stage, chapter chips), Dia's scroll-spy list and Figma's controls-on-media.
- **Where:** the brand hardline, memory and direction demo.
- **Implementation**
  - Desktop: a 300svh scene with a two-column sticky stage. The left column has 3 `<article>` chapters. An IntersectionObserver with `rootMargin: -45% 0 -45% 0` sets `data-chapter` on the stage.
  - The stage's DOM is a single UI mock, a server-rendered HTML/CSS mock, not a screenshot. Its states are toggled by `data-chapter`. Each state change runs inside `startViewTransition` so the chips fly into place; shared elements get a `view-transition-name`.
  - The prompt expansion is CSS only: spec tokens reveal with `--i` staggers at 60ms (`animation-delay: calc(var(--i) * 60ms)`), using the spring token.
  - Mobile: no pin; the three chapters become chips above the stage.
  - Numbers in the spec use `tabular-nums` (TOOLBOX D).
- **Cost and risks**
  - Cost: medium-high. This is the money scene: worth it, and it is the place for the 3–4 TOOLBOX techniques (hairlines, blur-to-sharp, shared-layout morphing).
  - Risk: the mock must be honest; "early access" status text stays visible.
  - Screen readers get the chapter text as normal articles. Mark the decorative mock `aria-hidden`, with an equivalent text list.

### 5. Pinned horizontal track for the five workflow steps; native snap on mobile
- **What:** Daylight's 8.2 vh feature track. Vertical scroll moves a horizontal strip of five step panels: Read the reference → Pick the model → Check → Animate → Deliver. Each panel is a 24px-radius inset media frame with a looping clip, plus a large step numeral ("01/05").
- **Where:** professional-workflow steps.
- **Implementation**
  - The scene height is `calc(100svh + (var(--n) - 1) * 70vw)`.
  - The track transform is `translateX(calc(var(--p) * -1 * (100% - 100vw)))` on a `width: calc(var(--n) * 70vw)` flex row.
  - A progress hairline at the bottom, `scaleX(var(--p))`, in `--lp-blue`.
  - Below 1024px: the same markup becomes `overflow-x: auto; scroll-snap-type: x mandatory`, with panels at `scroll-snap-align: center` and `scroll-snap-stop: always` plus prev/next buttons. That is zero extra vertical length, and it matches the founder's "horizontal sliders OK".
  - Reduced motion: the snap carousel on every viewport.
  - Keyboard focus inside the translated track: on `focusin`, the island scrolls the window to the matching `--p`.
- **Cost and risks**
  - Cost: medium.
  - Performance: animate transform only, cap at 5 panels, and play only the visible panel's video.
  - Clay's stacked sticky cards are the vertical-friendly alternative if horizontal scrubbing tests badly.

### 6. Tabbed inset gallery: snap-x, autoplay progress, visible pause
- **What:** Apple's "Get the highlights": 87.5vw × 75vh frames at 28px radius, one at a time. Tabs for Product shots, Try-on and Video ads swap the set. Each slide shows a progress bar while its clip plays, then advances.
- **Where:** output gallery ("Eight products, one set of rules").
- **Implementation**
  - Server-render all slides into a `scroll-snap-type: x mandatory` scroller.
  - The `Gallery` island:
    - observes the active slide with an IntersectionObserver at threshold 0.6
    - drives progress with a CSS `@keyframes` on `scaleX`, its duration set to the clip length through `--dur`
    - advances on `animationend` with `scrollTo({ left, behavior: 'smooth' })`
    - pauses on hover, focus or the pause button
  - Tab switches use View Transitions.
  - "Example screens. Products and models are fictional." sits as a quiet caption.
- **Cost and risks**
  - Cost: low-medium.
  - WCAG 2.2.2: auto-advancing content needs a pause control, so it is mandatory.
  - No autoplay under reduced motion.
  - Lazy-load the off-screen tab sets.

### 7. Word-level manifesto reveal, pinned and short, with one blue word
- **What:** Daylight's 23-word manifesto. Words go from 15% to 100% ink as you scroll; one word lands in `--lp-blue`. For us: "AI ads are starting to look alike" ("AI로 만든 광고가 서로 닮아 갑니다"), which hands off into the compare wipe in pattern 3.
- **Where:** the opener of "Why", or between the hero and the compare.
- **Implementation**
  - The server splits the sentence into word spans with `style="--i:n"` and sets `--n` on the parent. Use eojeol (space-separated) units for Korean and never letters.
  - CSS: `opacity: clamp(0.15, var(--p) * var(--n) - var(--i), 1)`, all driven by one `--p`.
  - Pin 1.0–1.5 vh at most, not Daylight's 4.
  - The full sentence remains one `<h2>`; spans are inline, so screen readers read words normally.
- **Cost and risks**
  - Cost: low.
  - Risk: over-long pins feel like scroll-jacking; keep it under 1.5 vh.
  - Reduced motion: full ink.

### 8. Scale wall: drifting tiles over a sticky giant line
- **What:** for "one ad, dozens of creators, each with their own face". A sticky 8–10vw headline or number stays put while vertical creator tiles (9:16, 16px radius, rotated ±4–6° like Cosmos) drift upward across it at three parallax speeds, as Daylight's testimonial cards rise over its "What people / are saying" split. Only approved numbers and phrases appear (AGENTS §5).
- **Where:** creator-campaign scale.
- **Implementation**
  - A 200svh scene. The headline is `position: sticky; top: 30svh`.
  - About 12–18 tiles are absolutely placed in three columns. Each column has `--speed` (0.6, 1, 1.4) and `transform: translateY(calc((0.5 - var(--p)) * var(--speed) * 120svh)) rotate(var(--r))`.
  - Tiles are stills (AVIF, about 30–60 KB each). At most 3 of them are videos, played only on hover or focus on desktop.
  - Idle drift: a 20 s `@keyframes` translate of about 8px, disabled under reduced motion.
- **Cost and risks**
  - Cost: medium.
  - Performance: limit tiles to 18, use `will-change: transform` only while the scene is active (toggled by an IntersectionObserver), and avoid blur filters on moving tiles.
  - Accessibility: the tiles are decorative (`alt=""`), and the claim lives in the headline text.

### 9. One full-bleed blue field that collapses into a frame
- **What:** Daylight's amber beat, our only colour moment. The white page tints into a full-bleed `--lp-blue` field, then the field shrinks into the screen of a phone or ad frame. "This is where it lands" is the hand-off from creator scale to production.
- **Where:** the transition from creator scale to production.
- **Implementation**
  - A fixed, scene-scoped layer (`position: sticky` inside the scene, not page-level `fixed`).
  - Background: `color-mix(in srgb, var(--lp-blue) calc(var(--p) * 100%), #fff)` for the first half.
  - Second half: `clip-path: inset(calc(var(--q) * 30svh) calc(var(--q) * 38vw) round calc(var(--q) * 32px))`, where `--q = clamp(0, var(--p) * 2 - 1, 1)`, revealing the device frame image behind it.
  - Production follows as an ink band, Luma style.
- **Cost and risks**
  - Cost: low-medium.
  - **Contrast: white on `#3875C5` is about 4.4:1.** That passes for large text (24px+, or 18.7px bold) but **fails for body text**. Keep only headline-size type on the field, or darken through `--ys-accent-text`.
  - Use it once only; a second colour field would dilute it.

### 10. Floating pill nav with theme flip, plus a persistent "Book a demo" dock
- **What:**
  - Daylight-style pill cluster at top right instead of a bar: "Work · How it works · Pricing" plus a solid ink "Book a demo" pill.
  - It flips to light-on-dark over the ink and blue scenes.
  - After the hero, a Dia-style bottom-centre dock carries the same CTA plus "See the work".
- **Where:** global.
- **Implementation**
  - The nav is `position: fixed` in a server component.
  - The `NavTheme` island uses an IntersectionObserver on `[data-theme]` sections with `rootMargin: 0 0 -95% 0`, which detects the section under the nav. It sets `data-nav-theme` on `<html>`, and CSS swaps tokens with a 240ms spring.
  - The dock appears when the hero's `--p` exceeds 0.9, using `translateY` and opacity, and hides over the closing CTA screen so CTAs aren't duplicated.
  - The pill glass is `backdrop-filter: blur(14px) saturate(1.4)` on a 72% white fill (an allowed HUD use).
- **Cost and risks**
  - Cost: low.
  - On mobile the dock must not cover the snap-carousel controls; give it `bottom: max(16px, env(safe-area-inset-bottom))` and hide it while a carousel is in view.
  - Focus ring in blue.

### 11. Artboard-scaled type and spacing tokens
- **What:** Daylight's clamp interpolation between 768px and 1920px, with vw-based vertical spacing, so each 100svh stage keeps its composition at any desktop width.
- **Where:** global tokens in the landing CSS module.
- **Implementation**
  - `--fs-display: clamp(2.5rem, calc(2.5rem + (100vw - 768px) * 0.04167), 5.5rem)`: 40px at 768 → 88px at 1920, a slope of 48/1152.
  - `--fs-h2: clamp(2rem, …, 4rem)`; `--fs-body: clamp(1.0625rem, …, 1.25rem)`.
  - Headlines in Pretendard 700–800, `letter-spacing: -0.035em`, `line-height: 1.02`. Korean needs about 1.15 for two-line wraps; check `word-break: keep-all`.
  - Spacing: `--space-stage: clamp(48px, 6.67vw, 128px)`.
  - Measure: 34–40ch for body, `max-width: 1200px` for content, inset 16px (mobile) / 24px (desktop).
  - Words per screen: at most about 30. Headlines at most about 18 Korean syllables (Daylight's median is 6 English words).
- **Cost and risks**
  - Cost: low.
  - Risk: vw type ignores user zoom unless it is mixed with rem, which the clamp's rem ends handle (WCAG 1.4.4).
  - Test 1280×720 laptops, where 100svh stages get tight: drop the display size by one step through `@media (max-height: 760px)`.

### 12. Closing: full-bleed film, giant wordmark, full-width CTA bar
- **What:** Daylight's footer (a giant wordmark over a warm full-bleed photo, a CTA bar, a reassurance line) crossed with Figma's full-width black "Get started" bar. Ours: a looping brand film, the TWINGS wordmark at about 22vw clipped at the bottom edge, a single full-width ink "Book a demo" bar, and one line such as "Reply within one business day". That line needs founder confirmation: it is a service commitment.
- **Where:** closing.
- **Implementation**
  - A 100svh scene. The film is a `<video>` at `object-fit: cover`, with a 30% ink gradient only at the bottom third.
  - The wordmark is inline SVG at `width: 100%`, revealed by a `clip-path` driven by `--p`.
  - The CTA bar: `height: clamp(64px, 6vw, 96px)`, full container width, with a spring hover `scale(1.01)`.
- **Cost and risks**
  - Cost: low.
  - The second autoplay video on the page: pause it whenever it's off screen.
  - Make sure the bar is a real `<a>` to the form route or dialog, not a JS-only `div`.

---

## 5. Considered and not recommended
- **Lenis or any smooth-scroll hijack.** Daylight uses it. It adds JavaScript, breaks native momentum and find-in-page jumps, and conflicts with the no-library rule; native scroll plus scroll timelines is enough.
- **Canvas image-sequence scrubs** (Daylight's hero canvas, Apple-style frame sequences). Heavy payloads (tens of MB) and decode cost on mobile. Use a scrubbed `clip-path`/transform over one video or two stills instead.
- **Page-wide ambient light layer** (Daylight's fixed `mix-blend-multiply` window shadow). Beautiful, and it ties to our "one window light, upper left" copy. But a fixed full-screen blended layer forces compositing on every frame. If wanted, use it only inside the hero and compare stages, as a static AVIF with a 30 s CSS drift, desktop only.
- **Per-letter splitting.** Unreadable rhythm in Korean, and VoiceOver can spell out letters. Word level only.
- **Cursor followers and spotlights.** None of the references rely on one. TOOLBOX allows a faint sheen on fine pointers; keep it to one card type, never on the hero.

## 6. The six screenshots that best show the patterns
All six are under `refs\`:
1. `refs\daylight\detail\hero_sheet.jpg`: inset hero card (18px inset, 24px radius) scrubbed from day to night. Patterns 1 and 2.
2. `refs\daylight\1440x900\f010.png`: media card expanding into the pinned horizontal track. Pattern 5.
3. `refs\daylight\1440x900\f026.png`: full-bleed colour field before it collapses into the device (`f027.png`). Pattern 9.
4. `refs\apple-airpods\1440x900\f001.png`: inset snap gallery at 87.5vw with a 28px radius and play controls. Pattern 6.
5. `refs\dia\1440x900\f001.png`: sticky scroll-spy step list with media swap and the persistent CTA pill. Patterns 4 and 10.
6. `refs\clay\1440x900\f005.png`: stacked sticky step cards with a per-step looping clip. Fallback for pattern 5.

Also useful:
- `refs\daylight\1440x900\f005.png`: manifesto reveal. Pattern 7.
- `refs\daylight\1440x900\f034.png`: sticky split headline with floating cards. Pattern 8.
- `refs\cosmos\1440x900\f000.png`: drifting tile cloud. Pattern 8.
- `refs\figma\1440x900\f003.png`: controls on media. Pattern 4.
- `refs\luma\1440x900\f000.png`: a brand board as the hero video. Pattern 2.
