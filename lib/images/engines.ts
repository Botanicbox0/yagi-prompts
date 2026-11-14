/**
 * The IMAGE engines TWINGS renders with (founder decisions, 2026-09-06: "이미지 템플릿 엔진은
 * seedream5.0이랑 gpt image2으로 가자", "openai api key는 무조건 high만"; 2026-09-10: "gpt image2.5가
 * 나왔다고 해서 이것도 포함시켜야할 것 같은데"), and the one table every image surface reads: which
 * aspect ratios a template may be made in, what pixel size that means on each engine, which quality
 * tier it renders at, and roughly what one render costs.
 *
 * Sources:
 *   · Seedream 5.0 pro tutorial (docs.byteplus.com/en/docs/ModelArk/2582774, read 2026-09-06): model
 *     ids `dola-seedream-5-0-pro-260628` / `seedream-5-0-260128`; Pro tiers 1K · 1.5K · 2K, Lite tiers
 *     2K · 3K · 4K; explicit `WxH` allowed within [1280×720 … 2048×2048×1.1025] pixels and a
 *     1/16 … 16 aspect range; up to 10 reference images; result URL kept 24 h.
 *   · ModelArk pricing, re-read from the official page 2026-10-21
 *     (docs.byteplus.com/en/docs/modelark/model-pricing): Pro output $0.045/image up to 2.61 MP
 *     ("1.5K or lower"), $0.09 above — every 2K size below is 3.7–4.5 MP, so $0.09; Pro input: the
 *     FIRST reference image is free, $0.003 from the second; Lite `seedream-5-0-lite-260128` $0.035/image
 *     with free reference input. (2026-09-06 console notes had a 2.36 MP step and $0.003 on every
 *     reference — both corrected here.) The page also lists `dola-seedream-5-0-flash-260915` at
 *     $0.018/image; not wired.
 *   · OpenAI model pages + image guide (developers.openai.com, read 2026-09-10): `gpt-image-2.5-flare`
 *     ("fast, high-quality everyday image generation", OpenAI's default recommendation, higher
 *     quality than gpt-image-2 at up to 50% lower latency) and `gpt-image-2.5-sunburst` ("our most
 *     capable model for image generation and editing", for workflows where editing precision
 *     matters), both on generations + edits, quality low · medium · high · xhigh · max · auto,
 *     sizes `WxH` on the 16-pixel grid, 1:3 … 3:1, max edge 3840, 655,360 … 8,294,400 pixels. Same
 *     token prices as gpt-image-2: text in $5/M, image in $8/M, image out $30/M. `gpt-image-2`:
 *     quality low/medium/high, ≤ 3840×2160, edits up to 16 references, no `input_fidelity`.
 *
 * Quality (founder rule, "우리는 고품질로 파는거니까"): every OpenAI engine renders at the highest tier
 * that keeps a render under a dollar — `high` on gpt-image-2 (its top), the table below on 2.5 —
 * and no request can lower it.
 *
 * Which figures are official (OpenAI pricing + image guide, re-read 2026-10-21): gpt-image-2 `high`
 * is the published $0.211 for 1024² ($0.165 for 1024×1536), so `0.21` below is the official figure
 * at its square size and conservative for the portrait ones. The two 2.5 models publish ONLY token
 * rates (image in $8/M, image out $30/M, text in $5/M) and no per-image table, so their `usdPerRender`
 * cannot be read off a page: sunburst is measured (2026-09-10 smoke, 4:5 with a reference photo,
 * docs/TEMPLATES-IA.md §7) and flare is still an estimate. Replace either with the `usage` of a real
 * render once one is recorded.
 *
 * Why 4:5 is the default: Instagram's feed has been a 4:5 grid since 2025, so a 4:5 render fills a
 * phone without a crop — the founder's "인스타그램에 올리기 좋은 비율" (2026-09-06). 9:16 is for
 * stories and reels covers, 1:1 for the old square, 16:9 for a landscape share.
 *
 * R2 (docs/PLATFORM-2.0.md §7.3, §9, §18, 2026-10-24) adds two providers for maker recipes:
 *   · Google Gemini "Nano Banana 2.1" (`gemini-nano-banana-2.1`, lib/images/gemini.ts): official 2K
 *     pixel table per aspect (ai.google.dev image-generation guide, read 2026-10-24), $0.0504 per
 *     2K image, up to 10 object + 4 character references.
 *   · Kling (lib/kling/*): a video engine whose model is configuration (3.0 Omni today, 4.0 when
 *     it opens) — see `VIDEO_ENGINES` below.
 * Neither is in the maker list (lib/recipes/schema.ts `MAKER_ENGINE_IDS`) until its real-person
 * smoke has run; the admin picker for studio templates sees them at once.
 */

import type { TemplateMedium } from '@/lib/prompts/schemas';

/** Order is the admin picker's order: the recommended default first. */
export const IMAGE_ENGINE_IDS = ['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-2.5-sunburst', 'seedream-5.5', 'seedream-5.0-lite', 'nano-banana-2.1', 'nano-banana-pro'] as const;
export type ImageEngineId = (typeof IMAGE_ENGINE_IDS)[number];

export const VIDEO_ENGINE_IDS = ['seedance-2.0', 'seedance-2.5', 'kling-omni'] as const;
export type VideoEngineId = (typeof VIDEO_ENGINE_IDS)[number];

export type EngineId = ImageEngineId | VideoEngineId;

/** Who answers the call — the value stored on render_jobs.provider (migration 0061). */
export type EngineProvider = 'openai' | 'modelark' | 'google' | 'kling';

/** The OpenAI third of the image table, the Google engine, and the Seedream rest. */
export type OpenAiEngineId = 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst' | 'gpt-image-2';
export type GoogleEngineId = 'nano-banana-2.1' | 'nano-banana-pro';
export type SeedreamEngineId = Exclude<ImageEngineId, OpenAiEngineId | GoogleEngineId>;

export interface VideoEngine {
  id: VideoEngineId;
  label: string;
  provider: 'modelark' | 'kling';
}

/** The video engines by name. ModelArk's model table is lib/ark/models.ts; Kling's is lib/kling/models.ts. */
export const VIDEO_ENGINES: Record<VideoEngineId, VideoEngine> = {
  'seedance-2.0': { id: 'seedance-2.0', label: 'SEEDANCE 2.0', provider: 'modelark' },
  'seedance-2.5': { id: 'seedance-2.5', label: 'SEEDANCE 2.5', provider: 'modelark' },
  // The label names no version on purpose: which Kling model answers is `KLING_VIDEO_MODEL`.
  'kling-omni': { id: 'kling-omni', label: 'KLING OMNI', provider: 'kling' },
};

/** The `quality` vocabulary of the OpenAI images API (2.5 added xhigh · max · auto). */
export type GptImageQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

export function isImageEngine(value: unknown): value is ImageEngineId {
  return typeof value === 'string' && (IMAGE_ENGINE_IDS as readonly string[]).includes(value);
}
export function isVideoEngine(value: unknown): value is VideoEngineId {
  return typeof value === 'string' && (VIDEO_ENGINE_IDS as readonly string[]).includes(value);
}
export function isEngineId(value: unknown): value is EngineId {
  return isImageEngine(value) || isVideoEngine(value);
}
export function isOpenAiEngine(value: unknown): value is OpenAiEngineId {
  return isImageEngine(value) && IMAGE_ENGINES[value].provider === 'openai';
}
export function isGoogleEngine(value: unknown): value is GoogleEngineId {
  return isImageEngine(value) && IMAGE_ENGINES[value].provider === 'google';
}
export function isKlingEngine(value: unknown): value is 'kling-omni' {
  return isVideoEngine(value) && VIDEO_ENGINES[value].provider === 'kling';
}

/** The provider behind an engine — the one rule `needsIdentity` and the job row read. */
export function engineProvider(id: EngineId): EngineProvider {
  return isImageEngine(id) ? IMAGE_ENGINES[id].provider : VIDEO_ENGINES[id].provider;
}

/** The engines a template of this medium may name, first = default for a new template. */
export function enginesForMedium(medium: TemplateMedium): readonly EngineId[] {
  return medium === 'image' ? IMAGE_ENGINE_IDS : VIDEO_ENGINE_IDS;
}

/**
 * Images: GPT Image 2.5 Flare (founder, 2026-10-24). The organisation check that used to answer 403
 * passed: the 2026-10-24 smoke rendered a 1024×1280 xhigh image from a real selfie and kept the face
 * (`npm run image:smoke -- --engine gpt-image-2.5-flare --photo …`). GPT Image 2 stays selectable
 * for the rows that already name it.
 */
export function defaultEngine(medium: TemplateMedium): EngineId {
  return medium === 'image' ? 'gpt-image-2.5-flare' : 'seedance-2.0';
}

/** The chip text for an engine — the image table's label, or the video table's. */
export function engineLabel(id: EngineId): string {
  return isImageEngine(id) ? IMAGE_ENGINES[id].label : VIDEO_ENGINES[id].label;
}

/** Map superseded legacy engine ids (DB rows / historical templates) to their current replacement. */
export function normalizeLegacyEngineId(engine: string | null): string | null {
  if (engine === 'seedream-5.0-pro' || engine === 'seedream-5-pro') return 'seedream-5.5';
  return engine;
}

/** A row's engine, or its medium's default when none was chosen (or an unknown id was stored). */
export function resolveEngine(engine: string | null, medium: TemplateMedium): EngineId {
  const normalized = normalizeLegacyEngineId(engine);
  return isEngineId(normalized) ? normalized : defaultEngine(medium);
}

// ---------------------------------------------------------------------------
// aspect ratios
// ---------------------------------------------------------------------------

/** The ratios a visitor may pick. Order is the picker's order. */
export const IMAGE_ASPECTS = ['4:5', '1:1', '9:16', '3:4', '16:9'] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];
/** Instagram feed (4:5) — see the header note. */
export const DEFAULT_IMAGE_ASPECT: ImageAspect = '4:5';

export const VIDEO_ASPECTS = ['9:16', '16:9', '1:1', '4:3', '3:4'] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];
export const DEFAULT_VIDEO_ASPECT: VideoAspect = '9:16';

export type Aspect = ImageAspect | VideoAspect;

export function isImageAspect(value: unknown): value is ImageAspect {
  return typeof value === 'string' && (IMAGE_ASPECTS as readonly string[]).includes(value);
}
export function isVideoAspect(value: unknown): value is VideoAspect {
  return typeof value === 'string' && (VIDEO_ASPECTS as readonly string[]).includes(value);
}

export function aspectsForMedium(medium: TemplateMedium): readonly Aspect[] {
  return medium === 'image' ? IMAGE_ASPECTS : VIDEO_ASPECTS;
}

export function defaultAspect(medium: TemplateMedium): Aspect {
  return medium === 'image' ? DEFAULT_IMAGE_ASPECT : DEFAULT_VIDEO_ASPECT;
}

// ---------------------------------------------------------------------------
// image engines: ids, sizes, quality, money
// ---------------------------------------------------------------------------

export interface ImageSize {
  width: number;
  height: number;
}

export type SeedreamResolutionTier = '1K' | '1.5K' | '2K';

export interface ImageEngine {
  id: ImageEngineId;
  label: string;
  provider: 'modelark' | 'openai' | 'google';
  /** The wire model id. */
  model: string;
  /** Pixel size per aspect at the default resolution — every entry is valid on that engine by construction. */
  sizes: Record<ImageAspect, ImageSize>;
  /** Optional multi-tier pixel table (Seedream 5.5 supports 1K, 1.5K, 2K). */
  sizesByResolution?: Readonly<Record<SeedreamResolutionTier, Record<ImageAspect, ImageSize>>>;
  /** Supported resolution tiers when more than one tier is offered. */
  resolutions?: readonly SeedreamResolutionTier[];
  /** True when `background: 'auto' | 'transparent' | 'opaque'` is supported (PNG when transparent). */
  supportsTransparentBackground?: boolean;
  /** OpenAI engines only: the one quality tier this engine renders at. Nothing can lower it. */
  quality?: GptImageQuality;
  /** Rough USD for one render at the size above, before reference images. */
  usdPerRender: number;
  /** Rough USD added per BILLED reference image (the visitor's photo is one). */
  usdPerReference: number;
  /** References the provider does not bill. */
  freeReferenceImages?: number;
  /** The most reference images one request may carry. */
  maxReferenceImages: number;
}

/**
 * Seedream 5.5 (dola-seedream-5-5-261028) 2K pixel sizes per aspect. Every size is a multiple of 16
 * inside ModelArk's documented pixel window (1280x720 .. 4.62 MP), matching Sunra 2K output.
 */
const SEEDREAM_2K: Record<ImageAspect, ImageSize> = {
  '4:5': { width: 1728, height: 2160 },
  '1:1': { width: 2048, height: 2048 },
  '9:16': { width: 1584, height: 2816 },
  '3:4': { width: 1776, height: 2368 },
  '16:9': { width: 2816, height: 1584 },
};

/** Seedream 5.5 multi-tier pixel sizes: 1K (~1.0MP <= 2.61MP), 1.5K (~2.3MP <= 2.61MP), and 2K (~4.1MP <= 4.62MP). */
export const SEEDREAM_55_SIZES: Readonly<Record<SeedreamResolutionTier, Record<ImageAspect, ImageSize>>> = {
  '1K': {
    '4:5': { width: 960, height: 1200 },
    '1:1': { width: 1024, height: 1024 },
    '9:16': { width: 720, height: 1280 },
    '3:4': { width: 864, height: 1152 },
    '16:9': { width: 1280, height: 720 },
  },
  '1.5K': {
    '4:5': { width: 1280, height: 1600 },
    '1:1': { width: 1536, height: 1536 },
    '9:16': { width: 1152, height: 2048 },
    '3:4': { width: 1344, height: 1792 },
    '16:9': { width: 2048, height: 1152 },
  },
  '2K': SEEDREAM_2K,
};

/**
 * Gemini's own 2K pixel sizes per aspect (image-generation guide, "Aspect ratios and image sizes"
 * table for Nano Banana 2.1, read 2026-10-24). The API takes `aspect_ratio` + `image_size`, not
 * `WxH`; this table is what those two words resolve to, so the floor and the result page know.
 */
const NANO_BANANA_2K: Record<ImageAspect, ImageSize> = {
  '4:5': { width: 1856, height: 2304 },
  '1:1': { width: 2048, height: 2048 },
  '9:16': { width: 1536, height: 2752 },
  '3:4': { width: 1792, height: 2400 },
  '16:9': { width: 2752, height: 1536 },
};

/**
 * The OpenAI sizes — multiples of 16, sized like the 1024-class the price examples use. Shared by
 * gpt-image-2 and both 2.5 models (every entry sits inside 2.5's 655,360 … 8,294,400-pixel window
 * and under gpt-image-2's 3840×2160 ceiling).
 */
const GPT_IMAGE_SIZES: Record<ImageAspect, ImageSize> = {
  '4:5': { width: 1024, height: 1280 },
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 864, height: 1536 },
  '3:4': { width: 1024, height: 1360 },
  '16:9': { width: 1536, height: 864 },
};

export const IMAGE_ENGINES: Record<ImageEngineId, ImageEngine> = {
  'gpt-image-2.5-flare': {
    id: 'gpt-image-2.5-flare',
    label: 'GPT IMAGE 2.5 FLARE',
    provider: 'openai',
    model: 'gpt-image-2.5-flare',
    sizes: GPT_IMAGE_SIZES,
    quality: 'xhigh',
    // Measured 2026-10-24 (smoke, 1024×1280 xhigh): text-only $0.0813 (2,702 output tokens at $30/M +
    // 46 text tokens), one reference selfie $0.0929 (1,450 image input tokens at $8/M ≈ $0.012).
    // Cheaper than gpt-image-2 high despite the higher tier — the token count, not the tier, sets the bill.
    usdPerRender: 0.082,
    usdPerReference: 0.012,
    maxReferenceImages: 16,
  },
  'gpt-image-2.5-sunburst': {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT IMAGE 2.5 SUNBURST',
    provider: 'openai',
    model: 'gpt-image-2.5-sunburst',
    sizes: GPT_IMAGE_SIZES,
    quality: 'max',
    usdPerRender: 0.6,
    usdPerReference: 0.03,
    maxReferenceImages: 16,
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    label: 'GPT IMAGE 2',
    provider: 'openai',
    model: 'gpt-image-2',
    sizes: GPT_IMAGE_SIZES,
    // `high` is gpt-image-2's top tier (founder, 2026-09-06). ≈$0.21 for a 1024² render; the rest scale.
    quality: 'high',
    usdPerRender: 0.21,
    // One reference photo is roughly 2–3k image input tokens at $8/M, rounded up.
    usdPerReference: 0.03,
    maxReferenceImages: 16,
  },
  'seedream-5.5': {
    id: 'seedream-5.5',
    label: 'SEEDREAM 5.5',
    provider: 'modelark',
    model: 'dola-seedream-5-5-261028',
    sizes: SEEDREAM_2K,
    sizesByResolution: SEEDREAM_55_SIZES,
    resolutions: ['1K', '1.5K', '2K'],
    supportsTransparentBackground: true,
    // 2K: $0.035/image ($0.020 at 1K/1.5K <= 2.61MP), plus $0.008 per input reference image.
    usdPerRender: 0.035,
    usdPerReference: 0.008,
    freeReferenceImages: 0,
    maxReferenceImages: 10,
  },
  'seedream-5.0-lite': {
    id: 'seedream-5.0-lite',
    label: 'SEEDREAM 5.0 LITE',
    provider: 'modelark',
    model: 'seedream-5-0-260128',
    sizes: SEEDREAM_2K,
    // Official: $0.035/image, reference input free.
    usdPerRender: 0.035,
    usdPerReference: 0,
    maxReferenceImages: 10,
  },
  'nano-banana-2.1': {
    id: 'nano-banana-2.1',
    label: 'NANO BANANA 2.1',
    provider: 'google',
    model: 'gemini-nano-banana-2.1',
    sizes: NANO_BANANA_2K,
    // Official (Gemini API pricing, 2026-10-24): $0.0336 per 1K image, $0.0504 per 2K, $0.113 per
    // 4K; we render 2K. Image input is $1.50 per million tokens and a reference is ≈1,120 tokens,
    // so ≈$0.0017 each — rounded up. `gemini.ts` books the exact usage when the API reports it.
    usdPerRender: 0.0504,
    usdPerReference: 0.002,
    // 10 object references + 4 character references (the guide's table for Nano Banana 2.1).
    maxReferenceImages: 14,
  },
  // Studio templates only (lib/recipes/schema.ts `STUDIO_RECIPE_ENGINE_IDS`; founder, 2026-11-01).
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    label: 'NANO BANANA PRO',
    provider: 'google',
    model: 'gemini-3-pro-image',
    // Same 2K pixel table as 2.1. Official: $0.134 per 1K/2K image (docs/PLATFORM-2.0.md §9.2).
    sizes: NANO_BANANA_2K,
    usdPerRender: 0.134,
    usdPerReference: 0.002,
    // 6 object + 5 character + 3 style references.
    maxReferenceImages: 14,
  },
};

/** An image further than this from a set's aspect is the wrong file. */
export const ASPECT_TOLERANCE = 0.02;
export function imageFitsAspect(width: number, height: number, aspect: ImageAspect): boolean {
  const [w, h] = aspect.split(':').map(Number) as [number, number];
  return Math.abs(width / height - w / h) / (w / h) <= ASPECT_TOLERANCE;
}

export function imageSizeFor(engine: ImageEngineId, aspect: ImageAspect, resolution: SeedreamResolutionTier = '2K'): ImageSize {
  const spec = IMAGE_ENGINES[engine];
  if (spec.sizesByResolution) return spec.sizesByResolution[resolution][aspect];
  return spec.sizes[aspect];
}

/** `WxH` the way both APIs spell it. */
export function sizeString(size: ImageSize): string {
  return `${size.width}x${size.height}`;
}

export function estimateImageUsd(engine: ImageEngineId, referenceImages = 1, resolution: SeedreamResolutionTier = '2K'): number {
  const spec = IMAGE_ENGINES[engine];
  const renderUsd = engine === 'seedream-5.5' && (resolution === '1K' || resolution === '1.5K') ? 0.02 : spec.usdPerRender;
  const billed = Math.max(0, referenceImages - (spec.freeReferenceImages ?? 0));
  return Math.round((renderUsd + spec.usdPerReference * billed) * 1000) / 1000;
}

/** ModelArk's explicit-size window for Seedream image generation (pixels and aspect), from the tutorial. */
export const SEEDREAM_PIXELS_MIN = 1280 * 720;
export const SEEDREAM_PIXELS_MAX = Math.floor(2048 * 2048 * 1.1025);
/** Seedream's $0.045 → $0.09 price step for the Pro model — "≤ 2.61 million pixels" (official, 2026-10-21). */
export const SEEDREAM_PRO_CHEAP_PIXELS_MAX = 2_610_000;
/** OpenAI's stated ceiling for gpt-image-2 and its multiple-of-16 rule. */
export const GPT_IMAGE_MAX = { width: 3840, height: 2160 } as const;
/** GPT Image 2.5's stated window: max edge 3840, 655,360 … 8,294,400 pixels, 1:3 … 3:1, 16-pixel grid. */
export const GPT_IMAGE_25 = { maxEdge: 3840, minPixels: 655_360, maxPixels: 8_294_400 } as const;
