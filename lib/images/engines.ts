/**
 * The IMAGE engines TWINGS renders with (founder decision, 2026-09-06: "이미지 템플릿 엔진은
 * seedream5.0이랑 gpt image2으로 가자", and "openai api key는 무조건 high만"), and the one table
 * every image surface reads: which aspect ratios a template may be made in, what pixel size that
 * means on each engine, and roughly what one render costs.
 *
 * Sources (all read 2026-09-06):
 *   · Seedream 5.0 pro tutorial (docs.byteplus.com/en/docs/ModelArk/2582774): model ids
 *     `dola-seedream-5-0-pro-260628` / `seedream-5-0-260128`; Pro tiers 1K · 1.5K · 2K, Lite tiers
 *     2K · 3K · 4K; explicit `WxH` allowed within [1280×720 … 2048×2048×1.1025] pixels and a
 *     1/16 … 16 aspect range; up to 10 reference images; result URL kept 24 h; "1.5K has the same
 *     price as 1K and provides better image generation quality".
 *   · ModelArk console pricing (2026-09-06): Pro output $0.045/image up to 2.36 MP, $0.09 above;
 *     input reference image $0.003 each; Lite $0.035/image.
 *   · OpenAI images API reference: gpt-image-2 accepts arbitrary `WIDTHxHEIGHT` (multiples of 16,
 *     1:3 … 3:1, max 3840×2160); quality low/medium/high; edits take up to 16 reference images
 *     with `input_fidelity: high`. Token prices: text in $5/M, image in $8/M, image out $30/M —
 *     a 1024² high render lands around $0.21 before any reference image.
 *
 * Why 4:5 is the default: Instagram's feed has been a 4:5 grid since 2025, so a 4:5 render fills a
 * phone without a crop — the founder's "인스타그램에 올리기 좋은 비율" (2026-09-06). 9:16 is for
 * stories and reels covers, 1:1 for the old square, 16:9 for a landscape share.
 */

import type { TemplateMedium } from '@/lib/prompts/schemas';

export const IMAGE_ENGINE_IDS = ['seedream-5.0-pro', 'seedream-5.0-lite', 'gpt-image-2'] as const;
export type ImageEngineId = (typeof IMAGE_ENGINE_IDS)[number];

export const VIDEO_ENGINE_IDS = ['seedance-2.0', 'seedance-2.5'] as const;
export type VideoEngineId = (typeof VIDEO_ENGINE_IDS)[number];

export type EngineId = ImageEngineId | VideoEngineId;
export const ENGINE_IDS: readonly EngineId[] = [...VIDEO_ENGINE_IDS, ...IMAGE_ENGINE_IDS];

export function isImageEngine(value: unknown): value is ImageEngineId {
  return typeof value === 'string' && (IMAGE_ENGINE_IDS as readonly string[]).includes(value);
}
export function isVideoEngine(value: unknown): value is VideoEngineId {
  return typeof value === 'string' && (VIDEO_ENGINE_IDS as readonly string[]).includes(value);
}
export function isEngineId(value: unknown): value is EngineId {
  return isImageEngine(value) || isVideoEngine(value);
}

/** The engines a template of this medium may name, first = default for a new template. */
export function enginesForMedium(medium: TemplateMedium): readonly EngineId[] {
  return medium === 'image' ? IMAGE_ENGINE_IDS : VIDEO_ENGINE_IDS;
}

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
// image engines: ids, sizes, money
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
  /** Rough USD for one render at the size above, before reference images. */
  usdPerRender: number;
  /** Rough USD added per reference image (the visitor's photo is one). */
  usdPerReference: number;
  /** The most reference images one request may carry. */
  maxReferenceImages: number;
}

/**
 * Seedream 5.0 Pro at the 1.5K tier: same price as 1K, better quality, and every size below stays
 * under the 2.36 MP price step. 4:5 is not in ModelArk's example table, so it is spelled as an
 * explicit `WxH` inside the documented pixel window.
 */
const SEEDREAM_15K: Record<ImageAspect, ImageSize> = {
  '4:5': { width: 1344, height: 1680 },
  '1:1': { width: 1536, height: 1536 },
  '9:16': { width: 1152, height: 2048 },
  // 1344×1792 would cross the 2.36 MP price step; 1296×1728 keeps 3:4 exactly and stays under it.
  '3:4': { width: 1296, height: 1728 },
  '16:9': { width: 2048, height: 1152 },
};

/** Seedream 5.0 Lite starts at 2K; these are the 2K mappings from the same table (4:5 explicit). */
const SEEDREAM_2K: Record<ImageAspect, ImageSize> = {
  '4:5': { width: 1728, height: 2160 },
  '1:1': { width: 2048, height: 2048 },
  '9:16': { width: 1584, height: 2816 },
  '3:4': { width: 1776, height: 2368 },
  '16:9': { width: 2816, height: 1584 },
};

/** GPT Image 2 at `quality: high` — multiples of 16, sized like the 1024-class the price examples use. */
const GPT_IMAGE_HIGH: Record<ImageAspect, ImageSize> = {
  '4:5': { width: 1024, height: 1280 },
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 864, height: 1536 },
  '3:4': { width: 1024, height: 1360 },
  '16:9': { width: 1536, height: 864 },
};

export const IMAGE_ENGINES: Record<ImageEngineId, ImageEngine> = {
  'seedream-5.0-pro': {
    id: 'seedream-5.0-pro',
    label: 'SEEDREAM 5.0 PRO',
    provider: 'modelark',
    model: 'dola-seedream-5-0-pro-260628',
    sizes: SEEDREAM_15K,
    usdPerRender: 0.045,
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
  'gpt-image-2': {
    id: 'gpt-image-2',
    label: 'GPT IMAGE 2',
    provider: 'openai',
    model: 'gpt-image-2',
    sizes: GPT_IMAGE_HIGH,
    // High quality only (founder, 2026-09-06). ≈$0.21 for a 1024² high render; the rest scale.
    usdPerRender: 0.21,
    // One high-fidelity reference photo is roughly 2–3k image input tokens at $8/M, rounded up.
    usdPerReference: 0.03,
    maxReferenceImages: 16,
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
