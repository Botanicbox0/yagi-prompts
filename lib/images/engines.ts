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
 *   · ModelArk console pricing (2026-09-06): Pro output $0.045/image up to 2.36 MP, $0.09 above (we
 *     render Pro at 2K, so $0.09); input reference image $0.003 each; Lite $0.035/image.
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
 * and no request can lower it. The `usdPerRender` figures for 2.5 are measured, not read: the docs
 * publish no tokens-per-quality table (2026-09-10 smoke, 4:5 with a reference photo, see
 * docs/TEMPLATES-IA.md §7).
 *
 * Why 4:5 is the default: Instagram's feed has been a 4:5 grid since 2025, so a 4:5 render fills a
 * phone without a crop — the founder's "인스타그램에 올리기 좋은 비율" (2026-09-06). 9:16 is for
 * stories and reels covers, 1:1 for the old square, 16:9 for a landscape share.
 */

import type { TemplateMedium } from '@/lib/prompts/schemas';

/** Order is the admin picker's order: the recommended default first. */
export const IMAGE_ENGINE_IDS = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'seedream-5.0-pro', 'seedream-5.0-lite'] as const;
export type ImageEngineId = (typeof IMAGE_ENGINE_IDS)[number];

export const VIDEO_ENGINE_IDS = ['seedance-2.0', 'seedance-2.5'] as const;
export type VideoEngineId = (typeof VIDEO_ENGINE_IDS)[number];

export type EngineId = ImageEngineId | VideoEngineId;

/** The OpenAI half of the image table; the Seedream half is the rest. */
export type OpenAiEngineId = 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst' | 'gpt-image-2';
export type SeedreamEngineId = Exclude<ImageEngineId, OpenAiEngineId>;

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

/** The engines a template of this medium may name, first = default for a new template. */
export function enginesForMedium(medium: TemplateMedium): readonly EngineId[] {
  return medium === 'image' ? IMAGE_ENGINE_IDS : VIDEO_ENGINE_IDS;
}

/**
 * Images: GPT Image 2 until the OpenAI organisation is verified — the 2.5 models answer 403
 * ("Your organization must be verified to use the model", smoke 2026-09-10) until the founder
 * completes Verify Organization; flip this to 'gpt-image-2.5-flare' once a smoke passes.
 */
export function defaultEngine(medium: TemplateMedium): EngineId {
  return medium === 'image' ? 'gpt-image-2' : 'seedance-2.0';
}

/** The chip text for an engine — the image table's label, or the Seedance version spelled the same way. */
export function engineLabel(id: EngineId): string {
  if (isImageEngine(id)) return IMAGE_ENGINES[id].label;
  return id === 'seedance-2.5' ? 'SEEDANCE 2.5' : 'SEEDANCE 2.0';
}

/** A row's engine, or its medium's default when none was chosen (or an unknown id was stored). */
export function resolveEngine(engine: string | null, medium: TemplateMedium): EngineId {
  return isEngineId(engine) ? engine : defaultEngine(medium);
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

export interface ImageEngine {
  id: ImageEngineId;
  label: string;
  provider: 'modelark' | 'openai';
  /** The wire model id. */
  model: string;
  /** Pixel size per aspect — every entry is valid on that engine by construction (tests pin it). */
  sizes: Record<ImageAspect, ImageSize>;
  /** OpenAI engines only: the one quality tier this engine renders at. Nothing can lower it. */
  quality?: GptImageQuality;
  /** Rough USD for one render at the size above, before reference images. */
  usdPerRender: number;
  /** Rough USD added per reference image (the visitor's photo is one). */
  usdPerReference: number;
  /** The most reference images one request may carry. */
  maxReferenceImages: number;
}

/**
 * Seedream 5.0 Pro at the 2K tier (founder, 2026-09-06: "seedream 5.0pro는 2k로 품질 더 올려줘").
 * 2K sits above ModelArk's 2.36 MP price step, so a Pro render is $0.09 rather than $0.045 — the
 * price of the founder's quality call, carried in `usdPerRender` below. Sizes are ModelArk's own
 * 2K mappings; 4:5 is not in its table, so it is spelled as an explicit `WxH` inside the documented
 * pixel window (1728×2160 = 3.73 MP ≤ 4.62 MP).
 */
const SEEDREAM_PRO_2K: Record<ImageAspect, ImageSize> = {
  '4:5': { width: 1728, height: 2160 },
  '1:1': { width: 2048, height: 2048 },
  '9:16': { width: 1584, height: 2816 },
  '3:4': { width: 1776, height: 2368 },
  '16:9': { width: 2816, height: 1584 },
};

/** Seedream 5.0 Lite starts at 2K too — the same table. */
const SEEDREAM_2K = SEEDREAM_PRO_2K;

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
    // UNMEASURED: the 2026-09-10 smoke was refused (organisation not verified). Estimate from the
    // gpt-image-2 high figure scaled for a higher tier; replace with the smoke's usage once it runs.
    usdPerRender: 0.35,
    usdPerReference: 0.03,
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
  'seedream-5.0-pro': {
    id: 'seedream-5.0-pro',
    label: 'SEEDREAM 5.0 PRO',
    provider: 'modelark',
    model: 'dola-seedream-5-0-pro-260628',
    sizes: SEEDREAM_PRO_2K,
    // 2K: above the 2.36 MP step, so the $0.09 rate (console pricing, 2026-09-06).
    usdPerRender: 0.09,
    usdPerReference: 0.003,
    maxReferenceImages: 10,
  },
  'seedream-5.0-lite': {
    id: 'seedream-5.0-lite',
    label: 'SEEDREAM 5.0 LITE',
    provider: 'modelark',
    model: 'seedream-5-0-260128',
    sizes: SEEDREAM_2K,
    usdPerRender: 0.035,
    usdPerReference: 0.003,
    maxReferenceImages: 10,
  },
};

export function imageSizeFor(engine: ImageEngineId, aspect: ImageAspect): ImageSize {
  return IMAGE_ENGINES[engine].sizes[aspect];
}

/** `WxH` the way both APIs spell it. */
export function sizeString(size: ImageSize): string {
  return `${size.width}x${size.height}`;
}

export function estimateImageUsd(engine: ImageEngineId, referenceImages = 1): number {
  const spec = IMAGE_ENGINES[engine];
  return Math.round((spec.usdPerRender + spec.usdPerReference * referenceImages) * 1000) / 1000;
}

/** ModelArk's explicit-size window for Seedream image generation (pixels and aspect), from the tutorial. */
export const SEEDREAM_PIXELS_MIN = 1280 * 720;
export const SEEDREAM_PIXELS_MAX = Math.floor(2048 * 2048 * 1.1025);
/** Seedream's $0.045 → $0.09 price step for the Pro model. */
export const SEEDREAM_PRO_CHEAP_PIXELS_MAX = 2_360_000;
/** OpenAI's stated ceiling for gpt-image-2 and its multiple-of-16 rule. */
export const GPT_IMAGE_MAX = { width: 3840, height: 2160 } as const;
/** GPT Image 2.5's stated window: max edge 3840, 655,360 … 8,294,400 pixels, 1:3 … 3:1, 16-pixel grid. */
export const GPT_IMAGE_25 = { maxEdge: 3840, minPixels: 655_360, maxPixels: 8_294_400 } as const;
