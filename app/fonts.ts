import localFont from 'next/font/local';

/**
 * PLAN §5.2 font ops, locked at M0.
 *
 * Self-hosted WOFF2 (no runtime CDN), `font-display: swap`, and — the reason these go through
 * `next/font/local` rather than hand-written @font-face — `adjustFontFallback` derives the
 * `size-adjust` / `ascent-override` fallback metrics from the ACTUAL font files, so the swap is
 * CLS-free without anyone hand-guessing numbers.
 *
 * Pretendard is NOT here: its Korean coverage ships as a 92-slice `unicode-range` dynamic subset,
 * which next/font/local cannot express. It is linked as vendor CSS from app/layout.tsx.
 *
 * Satoshi (EN body) is NOT here either — see public/fonts/README.md. The EN body stack falls back
 * per §5.2 until the Fontshare licence file is added by hand.
 */

/** Display, EN. Both display weights preload — §5.2 uses 700 and 900, nothing between. */
export const bigShoulders = localFont({
  src: [
    { path: '../assets/fonts/big-shoulders-latin-700.woff2', weight: '700', style: 'normal' },
    { path: '../assets/fonts/big-shoulders-latin-900.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-big-shoulders',
  display: 'swap',
  preload: true,
  fallback: ['Arial Narrow', 'Helvetica Neue', 'Arial', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

/** Label / eyebrow, EN. Small text, below the LCP element — not preloaded. */
export const antonSC = localFont({
  src: [{ path: '../assets/fonts/anton-sc-latin-400.woff2', weight: '400', style: 'normal' }],
  variable: '--font-anton-sc',
  display: 'swap',
  preload: false,
  fallback: ['Arial Narrow', 'Impact', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

/** Prompts and param tables. Always behind a lock or below the fold — not preloaded. */
export const geistMono = localFont({
  src: [{ path: '../assets/fonts/geist-mono-400.woff2', weight: '400', style: 'normal' }],
  variable: '--font-geist-mono',
  display: 'swap',
  preload: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
  adjustFontFallback: false,
});

export const fontVariables = [
  bigShoulders.variable,
  antonSC.variable,
  geistMono.variable,
].join(' ');
