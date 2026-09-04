# YAGI end card — "Produced by YAGI WORKSHOP"

A 3-second cinematic production credit, built in [Remotion](https://www.remotion.dev) so every
frame is deterministic and the piece can be re-rendered at any size or with the lockup on alpha.

| Output | File | Spec |
|---|---|---|
| Landscape | `renders/yagi-ending-16x9.mp4` | 1920x1080, 30 fps, 90 frames, H.264 CRF 16 |
| Vertical | `renders/yagi-ending-9x16.mp4` | 1080x1920, same timeline |
| Poster | `renders/yagi-ending-poster.png` | frame 60 (the hold) |
| Monogram | `brand/yagi-mark.svg`, `brand/yagi-mark-black.svg` | static mark, cream / near-black |

## Run it

```bash
cd video
npm install
npm run studio          # live preview + scrubbing at http://localhost:3000
npm run render          # 16:9 mp4
npm run render:vertical # 9:16 mp4
npm run render:alpha    # ProRes 4444 with alpha — lockup only, drop it over your last shot
npm run still           # poster png (frame 60)
npm run brand           # regenerate the SVG monogram from src/mark-geometry.ts
```

Remotion downloads its own headless Chrome on first render. In a container that already has one,
point it there instead: `REMOTION_BROWSER_EXECUTABLE=/path/to/chrome npm run render`.

## Design

**Studio identity, not product identity.** The card credits YAGI WORKSHOP the studio, so it uses
the studio palette from the YAGI design system (deep black `#080808`, cream ink `#E8E4DC`, one
muted gray) rather than the YAGI PROMPTS hyperlink blue. Monochrome on purpose: the restraint is
the conviction. No colour gradients; the only falloff is a luminance vignette, and per-frame film
grain (SVG turbulence, seed = frame) lifts the blacks the way stock does.

**Monogram.** A "Y" whose two arms are goat horns (yagi = goat). Single colour, no outline,
geometric. The horns are explicit outer/inner edge cubics: the outer edge leaves the stem's top
corner straight up, so horn and stem share a tangent and the silhouette has no shoulder. Because
the outline is generated from curves, the horns can *grow* on screen — the path is re-sampled each
frame up to the current growth with the moving front squeezed to a point.

**Type.** The same self-hosted faces the site ships (PLAN §5.2): Big Shoulders 900 for `YAGI`,
Satoshi 500 tracked wide for `WORKSHOP`, Geist Mono for the eyebrow. Weight and size sit at the
extremes (230 px vs 30 px vs 20 px), which is the hierarchy rule, not decoration.

## Timeline (30 fps)

| Frames | Beat |
|---|---|
| 0–4 | black |
| 4–18 | stem rises from its foot |
| 12–34 | horns grow out of the stem |
| 16–36 | `PRODUCED BY` tracks in from wide to set |
| 20–46 | `Y` `A` `G` `I` rise through a baseline clip, 3 frames apart |
| 30–52 | `WORKSHOP` letters fade in while the tracking settles |
| 36–56 | hairline extends from centre |
| 46–72 | hold |
| 72–89 | dissolve to black |

The whole lockup pushes in 3.5 % across the shot. Every curve is the site's `ease-out-quint`.

## Where things are

| Path | What |
|---|---|
| `src/EndingCard.tsx` | the scene: timeline constants, per-letter reveals, vignette, dissolve |
| `src/Mark.tsx` | animated monogram (stem rise, horn growth) |
| `src/mark-geometry.ts` | the mark's curves and the static SVG export — single source of truth |
| `src/Grain.tsx` | per-frame film grain |
| `src/fonts.ts` | `@remotion/fonts` loaders for the WOFF2 files in `public/fonts/` |
| `scripts/export-mark.ts` | writes `brand/*.svg` from the geometry module |
