/**
 * TWINGS design identity as code (2026-10-30). This is the brand side's own "hardline" file: the same shape
 * a brand's identity takes in brand.twings.app (colour roles, type, motion, imagery, voice), written for
 * TWINGS itself. CSS copies these values into variables (components/design/identity.module.css `.identity`)
 * and tests/design/identity.test.ts fails when the two drift, when a pair loses contrast, or when red comes
 * back. Change a value here first; the guard tells you which stylesheet to follow.
 *
 * The human and AI-readable version is docs/design/IDENTITY.md; the guard fails if that file loses a value.
 * Sources: docs/design/TOOLBOX.md §0 (white mode, one blue, no red), docs/design/TASTE.md (founder verdicts),
 * the founder's reference photos for the blue (2026-10-29), docs/wording/brand-landing-2026-10-30.md (voice).
 */

export const IDENTITY_VERSION = '2026-10-30';

/** Colour by role, never by hue name. One accent; every other blue is mixed from it. */
export const COLOUR = {
  /** Cards and the work surface. */
  paper: '#ffffff',
  /** The page ground: a cool alabaster so white cards and photos lift off it. */
  canvas: '#f6f7f9',
  /** A pale sky taken from the reference backdrop, for quiet bands behind blue-world photos. */
  sky: '#e8eff7',
  ink: '#0e1013',
  body: '#41444d',
  muted: '#676b75',
  line: '#e4e6ea',
  lineStrong: '#c7ccd3',
  /** French blue: fills, rings, focus, the CTA. White text on it reads 4.65:1. */
  accent: '#3875c5',
} as const;

/** Shades mixed from the accent (CSS `color-mix(in srgb, accent N%, base)`), so a new accent is one edit. */
export const ACCENT_MIX = {
  /** Blue text: deeper so small type stays AA on canvas and tints. */
  text: { accent: 85, base: '#000000' },
  hover: { accent: 82, base: '#000000' },
  pressed: { accent: 66, base: '#000000' },
  /** Chips and selected rows. */
  tint: { accent: 9, base: '#ffffff' },
} as const;

export const TYPE = {
  /** One family for Korean and Latin; weight and tracking carry the hierarchy. */
  sans: "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif",
  /** Spec labels only: lens, hex, ratios, step numbers. It reads as a production sheet. */
  mono: "var(--font-geist-mono), 'Pretendard Variable', Pretendard, ui-monospace, SFMono-Regular, Menlo, monospace",
  display: { weight: 540, tracking: '-0.052em', leading: 1.02 },
  heading: { weight: 560, tracking: '-0.045em', leading: 1.06 },
  body: { weight: 430, tracking: '-0.01em', leading: 1.62 },
} as const;

export const MOTION = {
  /** One spring for everything that moves (TOOLBOX §0). */
  spring: 'linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1)',
  fallback: 'cubic-bezier(0.22, 1, 0.36, 1)',
  quick: '240ms',
  base: '520ms',
  slow: '900ms',
} as const;

export const SHAPE = { radiusMedia: '18px', radiusCard: '24px', radiusPill: '999px' } as const;

/** The blue world photographs and films live in (founder 2026-10-30). Skin and lips stay warm; nothing else does. */
export const WORLD = {
  ice: '#f3f7fa',
  mist: '#d0dbe7',
  powder: '#dce8f5',
  steel: '#b4c3d7',
  french: COLOUR.accent,
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

/** How photographs sit on the page, so the page owns one hue the way the accent does. */
export const IMAGERY = {
  /** Hue band (degrees) the page's own photographs should live in: cool whites, powder and French blue. */
  ownedHue: [195, 225] as const,
  /** Warm images (pink beauty, amber perfume) are allowed as counterpoint, at most one per screen. */
  warmPerScreen: 1,
  /** Real skin: pores, stray hairs, no gloss retouching. Fictional people only. */
  people: 'fictional, unretouched skin',
} as const;

/** The rules a reviewer (human or model) checks before anything ships on the brand side. */
export const HARDLINES = [
  'The accent is defined once; every other blue is mixed from it.',
  'No red as emphasis: no red buttons, dots or gradients (YAGI v1.2 red does not apply to TWINGS).',
  'White and translucent grounds; the photograph carries the colour.',
  'Small blue text uses the text shade; white on the accent fill is the only white-on-colour pairing.',
  'No engine or competitor names on public pages; unreleased features carry an early-access or coming label.',
  'Korean is 합니다체 in a founder voice: one idea per sentence, lists of two at most.',
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
  { fg: COLOUR.muted, bg: COLOUR.sky, min: 4.5, use: 'captions on sky bands' },
  { fg: '#ffffff', bg: COLOUR.accent, min: 4.5, use: 'CTA label' },
  { fg: mixAccent(ACCENT_MIX.text.accent, ACCENT_MIX.text.base), bg: COLOUR.canvas, min: 4.5, use: 'blue links on canvas' },
  { fg: mixAccent(ACCENT_MIX.text.accent, ACCENT_MIX.text.base), bg: COLOUR.sky, min: 4.5, use: 'blue text on sky bands' },
  { fg: mixAccent(ACCENT_MIX.text.accent, ACCENT_MIX.text.base), bg: mixAccent(ACCENT_MIX.tint.accent, ACCENT_MIX.tint.base), min: 4.5, use: 'chip text on tint' },
];
