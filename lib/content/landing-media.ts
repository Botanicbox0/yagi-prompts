/**
 * Landing media slots — every image the marketing pages show from `public/`, by name, so the founder
 * can replace one from `/admin/landing-media` without a deploy (2026-10-29: "wix처럼 편하게 수정").
 *
 * A slot is one file wherever it appears: replacing `studio/smoke-1` changes the mood library tile,
 * the search demo cell and the memory thumbnail together, the way the file did. The default is the
 * file in `public/`; an override is a row in `landing_media` pointing at a `public-content` object
 * (lib/content/landing-media-server.ts). Videos and their posters are not slots: a new poster over an
 * old film would show one thing and play another.
 *
 * This module is imported by client components, so it holds data and pure lookups only.
 */
import type { EvidencePair } from './slots';

export type LandingMediaPage = 'brands' | 'home';
export type LandingMediaGroup =
  | 'heroBottles'
  | 'moodFolders'
  | 'moodLibrary'
  | 'pipeline'
  | 'vto'
  | 'feed'
  | 'service'
  | 'homeHero';

export interface LandingMediaSlot {
  /** `<area>/<file name without extension>`, e.g. `studio/p-amber-1`. */
  key: string;
  page: LandingMediaPage;
  group: LandingMediaGroup;
  /** The file in `public/` shown until an override exists. */
  src: string;
  /** Shape the page shows it in; uploads keep their own shape, the admin tile uses this one. */
  ratio: string;
  /** Longest useful width on the page; uploads are scaled down to it, never up. */
  width: number;
  /** Cut-outs (bottles, folders) keep their transparency. */
  alpha?: boolean;
}

/** Override URLs by slot key; a slot that is absent shows its default. */
export type LandingMedia = Readonly<Record<string, string>>;

export const NO_LANDING_MEDIA: LandingMedia = Object.freeze({});

const MOODS = ['amber', 'drape', 'smoke', 'cream', 'flora', 'botanic', 'mono', 'red'] as const;
const LIBRARY = [
  'smoke-1', 'smoke-2', 'smoke-3', 'smoke-4',
  'cream-1', 'cream-2', 'cream-3', 'cream-4',
  'flora-1', 'flora-2', 'flora-3', 'flora-4',
  'botanic-1', 'botanic-2', 'botanic-3', 'botanic-4', 'botanic-5', 'botanic-6',
  'mono-1', 'mono-2', 'mono-3', 'mono-4', 'mono-5',
  'red-2', 'red-3',
] as const;
const FEED = ['feed-mirror', 'feed-wrist', 'feed-cafe', 'feed-taxi', 'feed-bed', 'feed-street', 'feed-desk', 'feed-gym'] as const;

function studio(name: string, group: LandingMediaGroup, ratio: string, width: number, alpha?: true): LandingMediaSlot {
  return { key: `studio/${name}`, page: 'brands', group, src: `/reel/studio/${name}.webp`, ratio, width, ...(alpha ? { alpha } : {}) };
}

export const LANDING_MEDIA_SLOTS: readonly LandingMediaSlot[] = [
  // Brand landing, in page order.
  ...MOODS.map((mood) => studio(`bottle-${mood}`, 'heroBottles', 'free', 520, true)),
  ...MOODS.map((mood) => studio(`folder-${mood}`, 'moodFolders', '1:1', 240, true)),
  ...MOODS.flatMap((mood) => [studio(`p-${mood}-1`, 'moodLibrary', '4:5', 1200), studio(`p-${mood}-2`, 'moodLibrary', '4:5', 900)]),
  ...LIBRARY.map((name) => studio(name, 'moodLibrary', '4:5', 900)),
  ...['x-drape', 'x-botanic', 'x-mono'].map((name) => studio(name, 'pipeline', '4:5', 720)),
  studio('vto-garment', 'vto', '1:1', 720),
  ...['vto-look-front', 'vto-look-upper', 'vto-look-side'].map((name) => studio(name, 'vto', '3:4', 720)),
  studio('vto-free-amber', 'vto', '3:4', 720),
  studio('vto-free-alley', 'vto', '9:16', 720),
  studio('vto-free-mirror', 'vto', '9:16', 720),
  studio('vto-free-sofa', 'vto', '3:4', 720),
  studio('vto-free-drape', 'vto', '3:4', 720),
  ...FEED.map((name) => studio(name, 'feed', '9:16', 540)),
  // The campaign service half of /brands: formula, moat and service-example pictures (not film posters).
  { key: 'brands/production-paris', page: 'brands', group: 'service', src: '/reel/brands/production-paris.jpg', ratio: '16:9', width: 1280 },
  { key: 'brands/y2k-flip-phone', page: 'brands', group: 'service', src: '/reel/brands/y2k-flip-phone.jpg', ratio: '9:16', width: 720 },
  { key: 'brands/morphic-september-01', page: 'brands', group: 'service', src: '/reel/brands/morphic-september-01.jpg', ratio: '4:3', width: 960 },
  { key: 'brands/city-fashion', page: 'brands', group: 'service', src: '/reel/brands/city-fashion.jpg', ratio: '4:3', width: 1280 },
  // Shared by both landings: the selfie → scene pair (home hero, brand formula and moat).
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

/** Shorthand for the studio components, which name files rather than slot keys. */
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
