/**
 * Landing media slots — every image the marketing pages show from `public/`, by name, so the founder
 * can replace one from `/admin/landing-media` without a deploy (2026-10-29: "wix처럼 편하게 수정").
 *
 * A slot is one file wherever it appears. The default is the file in `public/`; an override is a row
 * in `landing_media` pointing at a `public-content` object (lib/content/landing-media-server.ts).
 * Videos and their posters are not slots: a new poster over an old film would show one thing and
 * play another. For the same reason a still that stands next to a film and shows its product is not a
 * slot either (FILM_BOUND_STILLS).
 *
 * This module is imported by client components, so it holds data and pure lookups only.
 */
import type { EvidencePair } from './slots';

export type LandingMediaPage = 'brands' | 'home';
export type LandingMediaGroup =
  | 'contrast'
  | 'looks'
  | 'cuts'
  | 'vto'
  | 'homeHero';

export interface LandingMediaSlot {
  /** `<area>/<file name without extension>`, e.g. `landing/sc-balm`. */
  key: string;
  page: LandingMediaPage;
  group: LandingMediaGroup;
  /** The file in `public/` shown until an override exists. */
  src: string;
  /** Shape the page shows it in; uploads keep their own shape, the admin tile uses this one. */
  ratio: string;
  /** Longest useful width on the page; uploads are scaled down to it, never up. */
  width: number;
  /** Cut-outs keep their transparency. */
  alpha?: true;
}

/** Stills tied to a film: each ad's product shot shows the bottle or tube that ad plays. */
export const FILM_BOUND_STILLS: readonly string[] = ['landing/ad-heart', 'landing/ad-coat'];

/** Override URLs by slot key; a slot that is absent shows its default. */
export type LandingMedia = Readonly<Record<string, string>>;

export const NO_LANDING_MEDIA: LandingMedia = Object.freeze({});

/** The fashion looks and beauty shots, in page order (components/brand-studio/v7.tsx). */
export const LANDING_LOOKS = ['coat', 'drape', 'street', 'carpet', 'knit', 'sculpt'] as const;
export const LANDING_CUTS = ['flower', 'face', 'sphere', 'gel', 'recline', 'beads'] as const;

function landing(name: string, group: LandingMediaGroup, ratio: string, width: number): LandingMediaSlot {
  return { key: `landing/${name}`, page: 'brands', group, src: `/reel/landing/${name}.webp`, ratio, width };
}
function studio(name: string, ratio: string): LandingMediaSlot {
  return { key: `studio/${name}`, page: 'brands', group: 'vto', src: `/reel/studio/${name}.webp`, ratio, width: 720 };
}

export const LANDING_MEDIA_SLOTS: readonly LandingMediaSlot[] = [
  // Brand landing, in page order.
  ...LANDING_LOOKS.map((key) => landing(`look-${key}`, 'looks', '2:3', 1000)),
  ...LANDING_CUTS.map((key) => landing(`cut-${key}`, 'cuts', '3:4', 1000)),
  ...['logo', 'garment', 'skin'].flatMap((pair) => [landing(`c-${pair}-raw`, 'contrast', '1:1', 1000), landing(`c-${pair}-ours`, 'contrast', '1:1', 1000)]),
  studio('vto-garment', '1:1'),
  ...['vto-set-front', 'vto-set-upper', 'vto-set-side'].map((name) => studio(name, '3:4')),
  // The founder's own picks (2026-10-30), shown in the fashion looks gallery.
  ...['vto-look-upper', 'vto-look-side', 'vto-look-front'].map((name) => studio(name, '3:4')),
  studio('vto-free-amber', '2:3'),
  studio('vto-free-alley', '2:3'),
  studio('vto-free-mirror', '3:4'),
  studio('vto-free-sofa', '9:16'),
  studio('vto-free-drape', '1:1'),
  // The home hero's selfie → scene pair.
  { key: 'studio-demo/reference-selfie', page: 'home', group: 'homeHero', src: '/reel/studio-demo/reference-selfie.jpeg', ratio: '4:5', width: 960 },
  { key: 'studio-demo/different-person', page: 'home', group: 'homeHero', src: '/reel/studio-demo/different-person.jpg', ratio: '4:3', width: 1664 },
];

const BY_KEY: ReadonlyMap<string, LandingMediaSlot> = new Map(LANDING_MEDIA_SLOTS.map((slot) => [slot.key, slot]));

export function landingMediaSlot(key: string): LandingMediaSlot | undefined {
  return BY_KEY.get(key);
}

/**
 * The URL to render for a slot: the override when one exists, else the default file. An unknown key
 * is a programming error (a renamed file the registry was not told about) — fail loudly in tests and
 * development instead of shipping a broken image.
 */
export function mediaSrc(media: LandingMedia | undefined, key: string): string {
  const slot = BY_KEY.get(key);
  if (!slot) throw new Error(`unknown landing media slot: ${key}`);
  return media?.[key] ?? slot.src;
}

/** Shorthand for the landing and try-on components, which name files rather than slot keys. */
export function landingSrc(media: LandingMedia | undefined, name: string): string {
  return mediaSrc(media, `landing/${name}`);
}
export function studioSrc(media: LandingMedia | undefined, name: string): string {
  return mediaSrc(media, `studio/${name}`);
}

/**
 * The home hero's selfie → scene pair with any replaced stills. A replaced scene drops the looping
 * film: it belongs to the old still, and playing it over the new one would show a different person.
 */
export function evidenceWithMedia(pair: EvidencePair, media: LandingMedia): EvidencePair {
  const before = media['studio-demo/reference-selfie'] ?? pair.before;
  const after = media['studio-demo/different-person'];
  if (after) return { before, after };
  return { ...pair, before };
}
