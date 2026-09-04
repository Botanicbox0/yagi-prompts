# YAGI end card — "Produced by YAGI WORKSHOP"

A 3-second cinematic production credit, built in [Remotion](https://www.remotion.dev) so every
frame is deterministic and the piece can be re-rendered at any size or with the lockup on alpha.

| Output | File | Spec |
|---|---|---|
| Landscape | `renders/yagi-ending-16x9.mp4` | 1920x1080, 30 fps, 90 frames, H.264 CRF 16 |
| Vertical | `renders/yagi-ending-9x16.mp4` | 1080x1920, same timeline |
| Quiet variant | `renders/yagi-ending-16x9-fade.mp4` | same card, letters fade up instead of constructing |
| Poster | `renders/yagi-ending-poster.png` | frame 60 (the hold) |
| Wordmark | `brand/yagi-workshop.svg`, `brand/yagi-workshop-black.svg` | static, cream / near-black |

## Run it

```bash
cd video
npm install
npm run studio          # live preview + scrubbing at http://localhost:3000
npm run render          # 16:9 mp4 (strokes construct the letters)
npm run render:vertical # 9:16 mp4
npm run render:fade     # 16:9 mp4, the quiet fade-up version
npm run render:alpha    # ProRes 4444 with alpha — lockup only, drop it over your last shot
npm run still           # poster png (frame 60)
npm run brand           # regenerate the SVG wordmark from src/wordmark.ts
```

Remotion downloads its own headless Chrome on first render. In a container that already has one,
point it there instead: `REMOTION_BROWSER_EXECUTABLE=/path/to/chrome npm run render`.

## Design

**The wordmark is the logo.** No icon, no monogram, no mascot: the studio's name, drawn once,
carries the identity the way A24's does. `YAGI WORKSHOP` is not typeset in a font. Every letter is
constructed in `src/wordmark.ts` from straight strokes and circular arcs of a single stroke weight
on a 100-unit cap height. Diagonals overshoot the cap box and are clipped flat at the cap line and
baseline (the geometric-sans construction); round letters overshoot by one unit so they read
optically the same height; a small kerning table pulls the leaning pairs (Y–A, K–S) together.

**Restraint.** Deep black `#080808`, one cream ink `#E8E4DC`, and nothing else. No colour
gradients; the only falloff is a luminance vignette. Per-frame film grain (SVG turbulence,
seed = frame) lifts the blacks the way stock does. `PRODUCED BY` is Satoshi 500, small, tracked,
at 55 % — a credit line, not a headline.

**Motion.** Because the letters are strokes, they can build themselves: verticals rise from the
baseline, rings sweep round, diagonals extend, left to right with 1.8 frames between letters. The
`reveal` prop switches to `fade`, where the letters simply come up — the quieter ident.

## Timeline (30 fps)

| Frames | Beat |
|---|---|
| 0–6 | black |
| 6–50 | the wordmark constructs itself, left to right |
| 34–54 | `PRODUCED BY` comes up above it |
| 50–76 | hold |
| 76–89 | dissolve to black |

The whole lockup pushes in 2.5 % across the shot. Every curve is the site's `ease-out-quint`.

## Where things are

| Path | What |
|---|---|
| `src/wordmark.ts` | the letterforms, layout and kerning, and the static SVG export — single source of truth |
| `src/Wordmark.tsx` | the animated wordmark (`draw` / `fade`) |
| `src/EndingCard.tsx` | the scene: timeline, credit line, vignette, dissolve, portrait sizing |
| `src/Grain.tsx` | per-frame film grain |
| `src/fonts.ts` | `@remotion/fonts` loader for the Satoshi WOFF2 in `public/fonts/` |
| `scripts/export-wordmark.ts` | writes `brand/*.svg` from the geometry module |
