# Fonts

PLAN §5.2. All faces are **self-hosted WOFF2** — no runtime CDN. Licences are committed under
`LICENSES/`.

| Role | Face | Source | Where it lives |
|---|---|---|---|
| Display (EN) | Big Shoulders 700 / 900 | `@fontsource/big-shoulders` (OFL) | `assets/fonts/`, loaded by `next/font/local` |
| Label / eyebrow (EN) | Anton SC 400 | `@fontsource/anton-sc` (OFL) | `assets/fonts/`, `next/font/local` |
| Mono | Geist Mono 400 | `geist` (OFL) | `assets/fonts/`, `next/font/local` |
| Display + body (KO) | Pretendard Variable | `pretendard` (OFL) | `public/fonts/pretendard/`, linked CSS |
| Body (EN) | **Satoshi — NOT PRESENT** | Fontshare (ITF-FFL) | see below |

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

## Satoshi — open item, flagged to the Director

Satoshi is the EN body face in §5.2. It is licensed through Fontshare's ITF Free Font Licence and
is distributed only behind an interactive download flow on fontshare.com — accepting terms and
downloading a binary from a third-party site is not something this milestone performs
unattended. **It is therefore not in the repo.**

Until it is added, the EN body resolves down the documented fallback stack in `app/globals.css`:

```css
--stack-body: 'Satoshi', 'Pretendard Variable', ui-sans-serif, system-ui, -apple-system,
  'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
```

The `'Satoshi'` entry is already first, so adding the files is a drop-in:

1. download the Satoshi WOFF2 family (400 + 500) from Fontshare;
2. put them in `assets/fonts/` as `satoshi-400.woff2` / `satoshi-500.woff2`;
3. add a `localFont({ … variable: '--font-satoshi', adjustFontFallback: 'Arial' })` block to
   `app/fonts.ts` and put `var(--font-satoshi)` at the head of `--stack-body`;
4. copy the ITF-FFL licence text to `LICENSES/ITF-FFL-Satoshi.txt`.

KO is unaffected: `html:lang(ko)` never falls back to a latin-only face (§5.2).
