# TWINGS on white: colour system

Research note, 2026-10-29. Contrast ratios use the WCAG 2.x luminance formula; OKLCH is computed from sRGB. Apple, Stripe, Arc and Visie hexes were read from their live CSS on 2026-10-29, Linear's from linear.app/brand. Aesop, Byredo and COS refused automated fetches, so no hex is claimed for them.

## 1. Fundamentals that matter on white

| Principle | What it says | TWINGS consequence |
|---|---|---|
| 60-30-10 | Dominant / secondary / accent areas. Itten's contrast of extension (Goethe's light values: red 6, blue 4) explains it: brighter hues need less area to balance. | Photo-led page: ~60% white, ~35% photography and ink, **≤5% blue**. The accent is the smallest area, not a full 10%. |
| Tonal system + one accent | Material 3 derives neutral palettes from the brand hue at very low chroma; Refactoring UI tints greys toward a temperature. | TWINGS greys already sit at OKLCH hue 275–286, beside the blue's 264. Keep them: they make the blue look intended. |
| Analogous / complementary / split | Complements maximise tension; analogous schemes calm. | Blue's complement is amber-orange, i.e. the warm photos. Chrome stays analogous (blue-grey); the complementary tension lives only between chrome and photo, with white between them. |
| Warm vs cool neutrals | Warm whites feel editorial, cool whites technical. | #F7F7F8 and #E8E8EB are cool. One warm neutral (#F6F3EE, hue 81) is allowed as a photo mat, never in the same component as cool greys. |
| Saturated accent on white | Small high-chroma areas read crisp; large fields glare and halate around thin white type. | #0000EE has OKLCH chroma 0.297, the sRGB gamut edge. Right at button and link size; deepen it for big fields. |
| Simultaneous contrast | Neighbours push each other toward their complements; equal-lightness opposites vibrate at edges (Albers). | Blue beside amber makes the amber oranger and the blue more violet. Beside cherry red you get chromostereopsis: red floats forward, blue sinks. |

**Why the #ED1E1E button reads cheap**
- White on #ED1E1E is **4.37:1**, under WCAG 1.4.3's 4.5:1 for a button label.
- It is mid-luminance (OKLCH L 0.60) at high chroma, neither ink-dark nor paper-light, so it glows and dominates at any size.
- On white, saturated red signals sale, error, alert, live. Apple HIG warns against one colour carrying two meanings, and TWINGS still needs red for form errors.
- It clashes with cherry-red product shots, and it is YAGI's dark-mode colour moved onto white without the black that makes it work.

## 2. How premium brands put one colour on white

| Brand | Base / ink | Accent | Where it lives | Share (estimate) |
|---|---|---|---|---|
| Apple product pages | #FFFFFF, #F5F5F7 / #1D1D1F, #6E6E73 | #0071E3 (4.70:1) | Pill buttons and text links only; product photos carry colour | ~1–2% |
| Stripe | #FFFFFF, #F8FAFD / navy #061B31 | #533AFD (scale 25–900), formerly #635BFF | Buttons, links, one gradient hero | 5–15% |
| Linear | #F4F5F8 / #222326 | Desaturated blue, mostly for backgrounds | Monochrome wordmark; colour rare | <2% |
| Arc | #FFFFFF / #000000, #1A1A1A | `--accent: #4E36FF` | Highlights, illustrations | small |
| Visie | #FFFFFF / #1B1B1B, #EDEDED, #E8E8E8 | #1284E7, tints #F3F9FE, #DBEDFB | Links, focus, selected states; creatives' work carries colour | ~1–3% |
| Aesop, Byredo, COS, Kinfolk | White or warm off-white / black type | None | Photography and type do everything | 0% |
| Klein / IKB | #002FA7 (screen stand-in for the 1960 pigment) | One matte, monumental field | One moment, never sprinkled | 1 moment |

The accent marks **action** (Apple, Visie) or **one signature moment** (Klein, Stripe's hero). It never decorates. Luxury retailers drop it and let photos colour the page.

## 3. Electric blue #0000EE

| Pair | Ratio | Verdict |
|---|---|---|
| #0000EE on #FFFFFF | 9.40:1 | AAA |
| #0000EE on #F7F7F8 / #E8E8EB | 8.78 / 7.69 | AAA |
| White on #0000EE | 9.40:1 | AAA label |
| #0000EE on #000000 / #111111 / #202126 | 2.23 / 2.01 / 1.71 | Fails; never on dark |
| #0000EE vs #111111 body text | 2.01:1 | Below G183's 3:1, so links need an underline |

- #0000EE is the HTML Standard's default `:link` colour. Underlined in a custom typeface it reads as a deliberate web-native choice; as bare coloured text it reads unstyled.
- Vibration risk peaks against amber, cherry and blush photos. Keep at least 24px of white or neutral between blue and warm imagery, and never put blue over a photo.
- Keep **#0000EE pure** for buttons, links, focus and the mark. For fills larger than about a quarter of the viewport use **#1414B8**: 21% less chroma, 3° toward ultramarine, white text 11.53:1. Deeper and calmer, closer to Klein, same identity.

## 4. Recommended TWINGS-on-white palette

| Role | Token | Hex | Use / contrast |
|---|---|---|---|
| Paper | `--paper` | #FFFFFF | Page background |
| Surface | `--surface` | #F7F7F8 | Cards, form wells, video placeholders |
| Hairline | `--line` | #E8E8EB | Dividers, card edges (decorative, 1.22:1) |
| Control border | `--line-strong` | #86888F | Inputs, outline buttons: 3.54 on white, 3.31 on surface (meets 1.4.11) |
| Ink | `--ink` | #111111 | Headlines, body: 18.88:1 |
| Dark surface | `--ink-2` | #202126 | Footer, video bands: white text 16.07:1 |
| Secondary ink | `--muted` | #6B6D75 | Captions, meta: 5.16 white, 4.82 surface |
| Accent | `--color-blue` | #0000EE | Primary CTA, links, focus ring, mark |
| Accent hover | `--blue-hover` | #0000C4 | White label 11.69:1 |
| Accent pressed | `--blue-pressed` | #00009E | White label 14.06:1 |
| Accent deep | `--blue-deep` | #1414B8 | The one large blue field per page: 11.53:1 |
| Accent tint | `--blue-tint` | #EEEEFF | Selected chip or row: blue text 8.19:1 |
| Accent on dark | `--blue-on-dark` | #8080FF | Links on #111111 / #202126: 5.80 / 4.93 |
| Warm mat (optional) | `--mat` | #F6F3EE | Behind warm product sets only: ink 17.06, muted 4.66 |
| Error | `--error` | #C41E1E | Form validation only: 5.91:1 |

**CTA rules**
- Primary: #0000EE fill, white label, rectangle with the cards' 4px radius, 48px tall. Blue means "you can act", the Apple HIG key-colour model.
- One primary per viewport, at most one secondary beside it (1px #111111 outline or underlined ink text).
- On photography or video the CTA is white fill with an ink label.
- Hover darkens to #0000C4. No shadows, glows or gradients.

**Photo-led sections**
- Chrome stays neutral: white or #F7F7F8, ink text, no mood-matched pastel backgrounds.
- The warm mat is the single exception, for a whole section of warm sets.
- Captions in #6B6D75; no coloured badges on images.
- Blue appears only as the section's one CTA or link, outside the image frame.

## 5. Alternatives

| Palette | What changes | Gains | Costs |
|---|---|---|---|
| A. Gallery mono | Primary CTA is #111111 with a white label; blue only in the mark, link underlines and focus | Never fights a photo; COS/Byredo calm | Blue identity nearly vanishes; reads like a client's shop; weaker action cue |
| B. Klein field | Same chrome plus one full-bleed #1414B8 (or #002FA7) band with the key headline and a white CTA | Memorable art-world signature, strong recall | Competes with warm sets, needs 96px+ of white around it; #002FA7 looks duller on screen than the pigment; easily repeated into wallpaper |

## Don'ts

- No #ED1E1E or #FAD204 on the TWINGS landing; they belong to YAGI's dark brand.
- No blue text or icons on #000000, #111111 or #202126; use #8080FF.
- No blue over, inside or tinting photos and video; no duotones.
- No second accent and no accent gradients.
- No #6B6D75 on #E8E8EB (4.22:1).
- No #E8E8EB as an input border (1.22:1).
- No warm and cool neutrals in one component.
- No more than one blue field per page.

## Sources

- Johannes Itten, *The Art of Color* (1961): seven contrasts, contrast of extension.
- Josef Albers, *Interaction of Color* (1963): relativity of colour, vibrating boundaries.
- Material Design 3, colour roles and tonal palettes: m3.material.io/styles/color/roles
- Apple Human Interface Guidelines, Color: developer.apple.com/design/human-interface-guidelines/color
- WCAG 2.2 SC 1.4.1, 1.4.3, 1.4.11; Technique G183.
- HTML Living Standard §15.3.4 (`:link { color: #0000EE }`).
- Adam Wathan and Steve Schoger, *Refactoring UI* (2018).
- Chromostereopsis (Einthoven, 1885).
- Live CSS of apple.com, stripe.com, arc.net, visie.io; linear.app/brand (read 2026-10-29).
