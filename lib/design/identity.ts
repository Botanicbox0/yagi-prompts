/**
 * TWINGS design identity as code (updated 2026-11-14 Design System v2 Frozen).
 *
 * UI Chrome ("White #FFFFFF + Dark #09090B Dual Surface + <=5% Magnific Pink #FF58AE"):
 *   White Canvas #FFFFFF · Secondary Surface / Pill #F4F4F5 · Hover #E4E4E7 · Rich Black #09090B
 *   Primary CTA only: Magnific Pink #FF58AE (hover #FF389F, active #FF1A90, box-shadow: none)
 *   WCAG AA required: #09090B ink on #FF58AE CTA (6.88:1) · never #FFFFFF on #FF58AE (2.89:1)
 *   Typography: single Pretendard Variable stack, word-break: keep-all, tabular-nums.
 *
 * Photography & Film Color World (`WORLD`, founder 2026-10-30):
 *   Remains cool white and French blue (`#3875c5`, hue [195, 225]°) with warm natural skin.
 */

export const IDENTITY_VERSION = '2026-11-14';

/** UI chrome colour by role: neutral surfaces + <=5% Magnific Pink CTA accent. */
export const COLOUR = {
  /** Main canvas and primary work surface. */
  paper: '#ffffff',
  /** Page ground: pure white canvas; secondary panels use `sky` (#f4f4f5). */
  canvas: '#ffffff',
  /** Secondary panels, sidebars and inactive pills (monochrome cool grey). */
  sky: '#f4f4f5',
  /** Primary text, active/selected fill, and text on solid pink CTA (Rich Ink). */
  ink: '#09090b',
  /** Secondary / label text. */
  body: '#52525b',
  /** Helper descriptions and captions (4.83:1 on #ffffff). */
  muted: '#71717a',
  /** Hover surface and ultra-light structural divider. */
  line: '#e4e4e7',
  lineStrong: '#d4d4d8',
  /** Magnific Pink: primary generation CTA & active focus only. Ink (#09090B) text reads 6.88:1. */
  accent: '#ff58ae',
} as const;

/** Shades mixed from the accent (CSS `color-mix(in srgb, accent N%, base)`). Tints stay monochrome. */
export const ACCENT_MIX = {
  /** Deep berry pink for readable text links on white & wash surfaces (#ad3c76, 5.70:1 on #fff, 5.18:1 on #f4f4f5). */
  text: { accent: 68, base: '#000000' },
  hover: { accent: 90, base: '#000000' },
  pressed: { accent: 80, base: '#000000' },
  /** Monochrome pill surface (#f4f4f5) — pastel blue background tints are forbidden. */
  tint: { accent: 0, base: '#f4f4f5' },
} as const;

export const TYPE = {
  /** Single Pretendard Variable stack across headings, body and controls (word-break: keep-all). */
  sans: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
  /** Single Pretendard Variable stack paired with CSS font-variant-numeric: tabular-nums. */
  mono: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
  display: { weight: 650, tracking: '-0.035em', leading: 1.08 },
  heading: { weight: 650, tracking: '-0.035em', leading: 1.25 },
  body: { weight: 400, tracking: '-0.02em', leading: 1.55 },
} as const;

export const MOTION = {
  /** One spring for everything that moves (TOOLBOX §0). */
  spring: 'linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1)',
  fallback: 'cubic-bezier(0.22, 1, 0.36, 1)',
  quick: '200ms',
  base: '480ms',
  slow: '860ms',
} as const;

export const SHAPE = { radiusMedia: '12px', radiusCard: '16px', radiusDock: '24px', radiusPill: '9999px' } as const;

/** The blue world photographs and films live in (founder 2026-10-30). Skin and lips stay warm; nothing else does. */
export const WORLD = {
  ice: '#f3f7fa',
  mist: '#d0dbe7',
  powder: '#dce8f5',
  steel: '#b4c3d7',
  french: '#3875c5',
  deep: '#2e5f9f',
  navy: '#16233f',
  shadow: '#14171c',
} as const;

/** Which model does what. Fixed from the founder's Americano results; see docs/design/IDENTITY.md §6-1. */
export const MODEL_ROLES = {
  editorial: 'text2image_soul_v2',
  referenceExact: 'seedream_v5_pro',
  faceAndEdit: 'nano_banana_pro',
  film: 'seedance_2_5',
  swap: 'hf_mult_replace_object',
} as const;

/** How photographs sit on the page, so the page owns one hue. */
export const IMAGERY = {
  /** Hue band (degrees) the page's own photographs should live in: cool whites, powder and French blue. */
  ownedHue: [195, 225] as const,
  /** Warm images (pink beauty, amber perfume) are allowed as counterpoint, at most one per screen. */
  warmPerScreen: 1,
  /** Real skin: pores, stray hairs, no gloss retouching. Fictional people only. */
  people: 'fictional, unretouched skin',
} as const;

/** The rules a reviewer (human or model) checks before anything ships. */
export const HARDLINES = [
  'White (#FFFFFF canvas, #F4F4F5 panels/pills) + Dark (#09090B canvas, #111113 surface) + <=5% Magnific Pink (#FF58AE, box-shadow: none) for primary CTA only.',
  'Rich Ink (#09090B, 6.88:1) inside solid #FF58AE CTA buttons; never #FFFFFF text on #FF58AE.',
  'No pastel blue background tints (#EBF5FF / #E8EFF7), no legacy UI blues (#0033FF / #3875C5), and no red emphasis (#ED1E1E).',
  'Single Pretendard Variable stack with word-break: keep-all and tabular-nums on numeric specs.',
  'No engine or competitor names on public pages; unreleased features carry an early-access or coming label.',
  'Korean uses concise, natural studio phrasing: one idea per sentence, helper descriptions in #71717A.',
] as const;

/** WCAG relative luminance and contrast, used by the guard test and by anything that picks text colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** sRGB `color-mix` of the accent with a base, matching what the browser computes. */
export function mixAccent(percent: number, base: string, accent: string = COLOUR.accent): string {
  const ch = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = ch(accent), b = ch(base);
  return '#' + a.map((v, i) => Math.round((v * percent + b[i]! * (100 - percent)) / 100).toString(16).padStart(2, '0')).join('');
}

/** Pairs the page relies on, with the floor each must clear. */
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: string; bg: string; min: number; use: string }> = [
  { fg: COLOUR.ink, bg: COLOUR.canvas, min: 12, use: 'headings' },
  { fg: COLOUR.body, bg: COLOUR.paper, min: 7, use: 'body copy' },
  { fg: COLOUR.muted, bg: COLOUR.canvas, min: 4.5, use: 'captions on the page ground' },
  { fg: COLOUR.body, bg: COLOUR.sky, min: 4.5, use: 'labels on secondary panels' },
  { fg: COLOUR.ink, bg: COLOUR.accent, min: 4.5, use: 'CTA label' },
  { fg: mixAccent(ACCENT_MIX.text.accent, ACCENT_MIX.text.base), bg: COLOUR.canvas, min: 4.5, use: 'accent links on canvas' },
  { fg: mixAccent(ACCENT_MIX.text.accent, ACCENT_MIX.text.base), bg: COLOUR.sky, min: 4.5, use: 'accent text on secondary panels' },
  { fg: COLOUR.ink, bg: mixAccent(ACCENT_MIX.tint.accent, ACCENT_MIX.tint.base), min: 4.5, use: 'chip text on monochrome surface' },
];
