# Fonts

PLAN §5.2. All faces are **self-hosted WOFF2** — no runtime CDN. Licences are committed under
`LICENSES/`.

| Role | Face | Source | Where it lives |
|---|---|---|---|
| Display (EN) | Big Shoulders 700 / 900 | `@fontsource/big-shoulders` (OFL) | `assets/fonts/`, loaded by `next/font/local` |
| Label / eyebrow (EN) | Anton SC 400 | `@fontsource/anton-sc` (OFL) | `assets/fonts/`, `next/font/local` |
| Mono | Geist Mono 400 | `geist` (OFL) | `assets/fonts/`, `next/font/local` |
| Display + body (KO) | Pretendard Variable | `pretendard` (OFL) | `public/fonts/pretendard/`, linked CSS |
| Body (EN) | Satoshi 400 / 500 | Fontshare (ITF-FFL, founder-accepted 2026-08-13) | `assets/fonts/`, `next/font/local` |

Regenerate everything with `npm run fonts` after bumping a font package.

## Why `next/font/local` instead of hand-written `@font-face`

§5.2 asks for `size-adjust` fallback metrics so the `font-display: swap` handoff is CLS-free.
`next/font/local` derives those overrides from the actual font binaries (`adjustFontFallback`),
which is exact; hand-written numbers would be guesses. Preload, `swap` and self-hosting all come
from the same declaration (`app/fonts.ts`).

Pretendard is the exception: its Korean coverage ships as a 92-slice `unicode-range` dynamic
subset, which `next/font/local` cannot express. The vendor CSS is copied verbatim (relative paths
intact) and linked from each root layout.

## Preload policy

Preloaded: Big Shoulders 700 + 900 (the display faces; §5.2 uses weight extremes only).
Not preloaded: Anton SC (small labels), Geist Mono (prompt blocks are below the fold or behind a
lock), Pretendard (unicode-range slices — the browser picks what the page actually needs).

## Satoshi — resolved 2026-08-13

The founder accepted Fontshare's ITF-FFL and supplied the family; `satoshi-400.woff2` /
`satoshi-500.woff2` live in `assets/fonts/`, loaded by `next/font/local` (`--font-satoshi`,
preloaded — body text is most of every page), licence at `LICENSES/ITF-FFL-Satoshi.txt`.

## KO and the mono stack

Geist Mono has no Hangul coverage. `html:lang(ko)` therefore lists `Pretendard Variable`
immediately after it in `--stack-mono`: latin and digits keep the §5 mono detail identity, and
Korean glyphs inside mono-styled copy (form hints, rail ledes, empty labels) render Pretendard
instead of the browser's last-resort fallback.
