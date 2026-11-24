/**
 * Brand studio model registry (docs/BRAND-STUDIO-V2.md §4).
 *
 * One entry per model a brand can pick in the prompt bar. Everything a screen or a service needs to
 * know about a model lives here: the legal controls, how each provider lane names it, which prompt
 * profile the enhancer uses and what a run costs. A new model is one entry, never a new screen.
 *
 * Client-safe on purpose (no env, no db, no fetch): the prompt bar imports it directly.
 * Provider facts were read from the Sunra catalogue on 2026-11-10 (GET api.sunra.ai/v1/models and the
 * per-endpoint price cards); re-check with `npm run studio:catalog` before changing a number.
 */

export type StudioMedium = 'image' | 'video';

/** Where a job runs. Never shown to a customer. */
export const STUDIO_LANES = ['sunra_api', 'sunra_mcp'] as const;
export type StudioLane = (typeof STUDIO_LANES)[number];

/** Which house style the enhancer writes in (lib/brand-studio/enhancer). */
export type StudioPromptProfile = 'seedream' | 'nano-banana' | 'gpt-image' | 'seedance';

/**
 * `live`: selectable. `awaiting_provider`: declared so the day the provider lists it only this flag
 * changes; hidden from every screen and refused by the API until then. `retired`: superseded by a
 * newer version; kept for historical job/cost lookup, hidden from every screen and refused for new jobs.
 */
export type StudioModelAvailability = 'live' | 'awaiting_provider' | 'retired';

interface StudioModelBase {
  id: string;
  /** The product name the customer sees on the model chip. */
  label: string;
  /** One short line on what it is good at. Keys into messages (brandStudio.models.<hintKey>). */
  hintKey: string;
  availability: StudioModelAvailability;
  /**
   * `false`: still runs (an earlier run can be made again, history and prices resolve) but no screen offers
   * it for a new run. Absent means listed.
   */
  listed?: boolean;
  promptProfile: StudioPromptProfile;
  /** True when the upstream endpoints carry `enable_safety_checker` (always forced `true`). */
  safetyChecker?: boolean;
  /** Sunra API: `POST /v1/queue/{alias}/{endpoint}`. */
  api: { alias: string };
  /** Sunra account lane (MCP `create_image` / `create_video` model id), or null when it has none. */
  mcp: { model: string } | null;
}

export interface StudioImageModel extends StudioModelBase {
  medium: 'image';
  aspects: readonly string[];
  resolutions: readonly string[];
  defaultResolution: string;
  /** Reference images an edit call accepts (the picture being edited counts as one). */
  maxReferences: number;
  /** True when the model follows "change only this" well enough for the region edit default. */
  regionEdit: boolean;
  endpoints: { textToImage: string; edit: string };
  /**
   * Models that take exact pixels (`width` / `height`) instead of `aspect_ratio` + `resolution`: the
   * size for each resolution and aspect the screen offers. Absent for the aspect-ratio models.
   */
  pixels?: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>>;
  /** Rendering qualities the customer may pick (GPT Image); absent for models without the choice. */
  qualities?: readonly StudioImageQuality[];
  defaultQuality?: StudioImageQuality;
  /** True when `background: 'auto' | 'transparent' | 'opaque'` is supported (PNG on transparent). */
  supportsTransparentBackground?: boolean;
  /**
   * GPT Image 2.6: `reasoning_effort` (low | medium | high; OpenAI calls it complexity) on both lanes, same price
   * at every level (provider/complexity.ts). Absent for models without it.
   */
  supportsReasoningEffort?: boolean;
  /** GPT Image 2.6: `markup` (a transparent overlay marking the area to edit), API lane only; not wired yet (provider/markup.ts). */
  supportsMarkup?: boolean;
}

/** Background mode for image generation models that support cutout output (Seedream 5.5). */
export const STUDIO_IMAGE_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const;
export type StudioImageBackground = (typeof STUDIO_IMAGE_BACKGROUNDS)[number];

/** Rendering quality of the models that offer one (both lanes call the field `quality`). */
export const STUDIO_IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type StudioImageQuality = (typeof STUDIO_IMAGE_QUALITIES)[number];

export interface StudioVideoModel extends StudioModelBase {
  medium: 'video';
  aspects: readonly string[];
  resolutions: readonly StudioVideoResolution[];
  defaultResolution: StudioVideoResolution;
  /** Seconds a customer may ask for. The provider allows up to 30; the studio caps lower for cost. */
  minSeconds: number;
  maxSeconds: number;
  defaultSeconds: number;
  maxReferenceImages: number;
  maxReferenceVideos: number;
  /** Seconds a reference video may run (an explicit edit needs at least `editMin`). */
  referenceVideoSeconds: { min: number; editMin: number; max: number };
  /** Width x height a reference video must fall within, and the shortest side allowed (provider limits). */
  referenceVideoPixels: { min: number; max: number; minSide: number };
  supportsDraft: boolean;
  endpoints: { text: string; image: string; reference: string; finalize: string };
}

export type StudioModel = StudioImageModel | StudioVideoModel;
export type StudioVideoResolution = '480p' | '720p' | '1080p';

const SEEDREAM_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const;
const GEMINI_PRO_ASPECTS = ['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9', '21:9'] as const;
const SEEDANCE_ASPECTS = ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'] as const;
/**
 * GPT Image 2.6: the account lane takes `aspect_ratio` + `resolution` (1K / 2K / 4K) + `quality`; the
 * API lane takes exact `width` / `height` (16–3840 each, OpenAPI document) + `quality`. Aspects and tiers
 * are the account lane's `list_models` answer (2026-11-11). Sizes are the ones Sunra's documentation
 * lists for the GPT Image family (docs.sunra.ai, "gpt-image-2 and gpt-image-2.5 token pricing"; width and
 * height swapped is the same request). Sizes the documentation does not list are marked "derived": the
 * same tier's long edge (1K 1536, 2K 2048) or pixel count (4K ≈ 8.2 MP), multiples of 16, ratio within 1%.
 */
const GPT_IMAGE_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const;
const GPT_IMAGE_PIXELS = {
  '1K': {
    '1:1': [1024, 1024],
    '3:2': [1536, 1024],
    '2:3': [1024, 1536],
    '16:9': [1360, 768],
    '9:16': [768, 1360],
    '4:3': [1536, 1152], // derived
    '3:4': [1152, 1536], // derived
  },
  '2K': {
    '1:1': [2048, 2048],
    '4:3': [2048, 1536],
    '3:4': [1536, 2048],
    '16:9': [2048, 1152],
    '9:16': [1152, 2048],
    '3:2': [2048, 1360], // derived
    '2:3': [1360, 2048], // derived
  },
  '4K': {
    '1:1': [2880, 2880],
    '3:4': [2448, 3264],
    '4:3': [3264, 2448],
    '9:16': [2160, 3840],
    '16:9': [3840, 2160],
    '3:2': [3504, 2336], // derived
    '2:3': [2336, 3504], // derived
  },
} as const satisfies Record<string, Record<(typeof GPT_IMAGE_ASPECTS)[number], readonly [number, number]>>;

/**
 * GPT Image 2.6 price per image in account credits (1 credit = US$0.01), identical for Flare and
 * Sunburst: the account lane's `estimate_cost` for every quality, tier and aspect ratio (2026-11-18).
 * The model is billed by tokens, and a square picture takes the most: each row is
 * [1:1, 4:3 or 3:4, 3:2 or 2:3, 16:9 or 9:16].
 *
 * Unlike the other models this one cannot be quoted to the credit before it runs: the prompt's own
 * tokens and each reference's size are billed too. A reference is counted as one credit, which the
 * quotes show is what one adds or one more than it adds; a very long prompt can add one credit.
 */
const GPT_IMAGE_26_CENTS: Readonly<Record<StudioImageQuality, Readonly<Record<string, readonly [number, number, number, number]>>>> = {
  low: { '1K': [3, 2, 2, 2], '2K': [6, 4, 4, 3], '4K': [9, 7, 6, 5] },
  medium: { '1K': [5, 4, 3, 3], '2K': [9, 7, 6, 6], '4K': [15, 11, 10, 8] },
  high: { '1K': [6, 4, 4, 3], '2K': [11, 8, 8, 7], '4K': [18, 14, 12, 10] },
};
const GPT_IMAGE_REFERENCE_CENTS = 1;

/** Which column of `GPT_IMAGE_26_CENTS` an aspect ratio reads; an unknown or absent one reads as square (the most). */
function gptImageShape(aspect: string | null | undefined): 0 | 1 | 2 | 3 {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? '');
  if (!m) return 0;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!(a > 0) || !(b > 0)) return 0;
  const long = Math.max(a, b) / Math.min(a, b);
  return long < 1.15 ? 0 : long < 1.42 ? 1 : long < 1.64 ? 2 : 3;
}

export const STUDIO_MODELS = [
  {
    id: 'seedream-5.5',
    medium: 'image',
    label: 'Seedream 5.5',
    hintKey: 'seedream55',
    availability: 'live',
    promptProfile: 'seedream',
    api: { alias: 'bytedance/seedream-5.5' },
    mcp: { model: 'seedream-5.5' },
    aspects: SEEDREAM_ASPECTS,
    resolutions: ['1K', '1.5K', '2K'],
    defaultResolution: '2K',
    maxReferences: 10,
    regionEdit: false,
    supportsTransparentBackground: true,
    endpoints: { textToImage: 'text-to-image', edit: 'image-editing' },
  },
  // GPT Image 2.6. API lane (catalogue, 2026-11-11): `openai/gpt-image-2.6-{flare,sunburst}`, endpoints
  // text-to-image / image-editing, `width`/`height`/`quality`/`n`, edits take `images` (up to 16).
  // Account lane (`list_models`, 2026-11-11): ids `gpt-image-2.6-flare` / `-sunburst`, the aspects and
  // tiers below, qualities low/medium/high, 16 references, image editing. Flare is the fast tier; Sunburst
  // the precision tier for detailed edits (slower, same price).
  {
    id: 'gpt-image-2.6-flare',
    medium: 'image',
    label: 'GPT Image 2.6 Flare',
    hintKey: 'gptImageFlare',
    availability: 'live',
    promptProfile: 'gpt-image',
    api: { alias: 'openai/gpt-image-2.6-flare' },
    mcp: { model: 'gpt-image-2.6-flare' },
    aspects: GPT_IMAGE_ASPECTS,
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '1K',
    maxReferences: 16,
    regionEdit: true,
    endpoints: { textToImage: 'text-to-image', edit: 'image-editing' },
    pixels: GPT_IMAGE_PIXELS,
    qualities: STUDIO_IMAGE_QUALITIES,
    defaultQuality: 'medium',
    supportsReasoningEffort: true,
    supportsMarkup: true,
  },
  {
    id: 'gpt-image-2.6-sunburst',
    medium: 'image',
    label: 'GPT Image 2.6 Sunburst',
    hintKey: 'gptImageSunburst',
    availability: 'live',
    promptProfile: 'gpt-image',
    api: { alias: 'openai/gpt-image-2.6-sunburst' },
    mcp: { model: 'gpt-image-2.6-sunburst' },
    aspects: GPT_IMAGE_ASPECTS,
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '1K',
    maxReferences: 16,
    regionEdit: true,
    endpoints: { textToImage: 'text-to-image', edit: 'image-editing' },
    pixels: GPT_IMAGE_PIXELS,
    qualities: STUDIO_IMAGE_QUALITIES,
    defaultQuality: 'medium',
    supportsReasoningEffort: true,
    supportsMarkup: true,
  },
  {
    id: 'nano-banana-pro',
    medium: 'image',
    label: 'Nano Banana Pro',
    hintKey: 'nanoBananaPro',
    availability: 'live',
    promptProfile: 'nano-banana',
    api: { alias: 'google/gemini-3-pro-image' },
    mcp: { model: 'nano-banana-pro' },
    aspects: GEMINI_PRO_ASPECTS,
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '2K',
    maxReferences: 10,
    regionEdit: true,
    endpoints: { textToImage: 'text-to-image', edit: 'image-editing' },
  },
  // Nano Banana 2.1 (founder 2026-11-19: "nano banana2.1을 그럼 공개하자"). API lane: public OpenAPI document
  // (oapi.sunra.ai, read 2026-11-19): `google/gemini-nano-banana-2.1` text-to-image / image-editing, images up to
  // 14, resolution 1K|2K|4K, 14 aspects (the 10 the studio's Gemini aspects already show are offered; 1:4, 4:1, 1:8
  // and 8:1 are left out), `thinking_level` minimal|medium|high (left at the upstream default, medium) and
  // `enable_web_search` (never sent). Account lane (`get_model_schema`, 2026-11-19): id `nano-banana-2.1`, the same
  // aspects and tiers, 14 references, web search off by default. Google: up to 10 object and 4 character images.
  {
    id: 'nano-banana-2.1',
    medium: 'image',
    label: 'Nano Banana 2.1',
    hintKey: 'nanoBanana21',
    availability: 'live',
    promptProfile: 'nano-banana',
    api: { alias: 'google/gemini-nano-banana-2.1' },
    mcp: { model: 'nano-banana-2.1' },
    aspects: GEMINI_PRO_ASPECTS,
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '2K',
    maxReferences: 14,
    // Partial edits run on Seedream 5.5 only (founder 2026-11-17); not offered for the flag-off region edit either.
    regionEdit: false,
    endpoints: { textToImage: 'text-to-image', edit: 'image-editing' },
  },
  // Seedream 5.0 Flash: no longer offered for a new run (2026-11-15). It stays `live` so an earlier run can be
  // made again and its history, credits and price still resolve.
  {
    id: 'seedream-5-flash',
    medium: 'image',
    label: 'Seedream 5.0 Flash',
    hintKey: 'seedreamFlash',
    availability: 'live',
    listed: false,
    promptProfile: 'seedream',
    safetyChecker: true,
    api: { alias: 'bytedance/seedream-5.0-flash' },
    mcp: null,
    aspects: SEEDREAM_ASPECTS,
    resolutions: ['1K', '2K'],
    defaultResolution: '2K',
    maxReferences: 10,
    regionEdit: false,
    endpoints: { textToImage: 'text-to-image', edit: 'image-editing' },
  },
  {
    id: 'seedance-2.5',
    medium: 'video',
    label: 'Seedance 2.5',
    hintKey: 'seedance25',
    availability: 'live',
    promptProfile: 'seedance',
    api: { alias: 'bytedance/seedance-2.5' },
    mcp: { model: 'seedance-2.5' },
    aspects: SEEDANCE_ASPECTS,
    resolutions: ['480p', '720p', '1080p'],
    defaultResolution: '720p',
    minSeconds: 4,
    maxSeconds: 15,
    defaultSeconds: 5,
    maxReferenceImages: 9,
    maxReferenceVideos: 1,
    referenceVideoSeconds: { min: 2, editMin: 4, max: 30 },
    referenceVideoPixels: { min: 407_696, max: 8_295_044, minSide: 300 },
    supportsDraft: true,
    endpoints: {
      text: 'text-to-video',
      image: 'image-to-video',
      reference: 'reference-to-video',
      finalize: 'draft-to-video',
    },
  },
] as const satisfies readonly StudioModel[];

export type StudioModelId = (typeof STUDIO_MODELS)[number]['id'];

export const DEFAULT_IMAGE_MODEL: StudioModelId = 'seedream-5.5';
export const DEFAULT_VIDEO_MODEL: StudioModelId = 'seedance-2.5';
/** The model a region edit uses unless the customer picked another one that allows it. */
export const DEFAULT_REGION_EDIT_MODEL: StudioModelId = 'nano-banana-pro';
/**
 * Region edit v2 (`BRAND_STUDIO_REGION_V2`): the one engine every partial edit runs on, whatever was
 * picked (founder, 2026-11-17: we choose the best engine, the customer is not given a picker). Chosen on
 * the 2026-11-16 bench: fewest pixels changed outside the target and the least face drift over chained
 * edits. The `regionEdit` flags above stay as they are for the flag-off studio.
 */
export const REGION_V2_MODEL: StudioModelId = 'seedream-5.5';

/** Normalize retired historical model ids (Seedream 5.0 Pro) to their active Seedream 5.5 successor. */
export function normalizeLegacyStudioModelId(id: string): string {
  if (id === 'seedream-5-pro' || id === 'seedream-5.0-pro') return 'seedream-5.5';
  return id;
}

export function studioModel(id: string): StudioModel | null {
  return (STUDIO_MODELS as readonly StudioModel[]).find((m) => m.id === id) ?? null;
}

/** Look up a model id, mapping legacy retired ids (`seedream-5-pro`) to `seedream-5.5` for rerun/history display. */
export function studioModelOrLegacy(id: string): StudioModel | null {
  return studioModel(id) ?? studioModel(normalizeLegacyStudioModelId(id));
}

/**
 * Models a screen may offer for a new run: live and listed ones, in registry order (the order the model
 * list shows: Seedream 5.5, GPT Image 2.6 Flare and Sunburst, Nano Banana Pro, Nano Banana 2.1).
 */
export function selectableModels(medium?: StudioMedium): StudioModel[] {
  return (STUDIO_MODELS as readonly StudioModel[]).filter(
    (m) => m.availability === 'live' && m.listed !== false && (medium === undefined || m.medium === medium),
  );
}

/** Live image models a partial edit may run on, in registry order. */
export function regionEditModels(): StudioImageModel[] {
  return selectableModels('image').filter((m): m is StudioImageModel => m.medium === 'image' && m.regionEdit);
}

/** Region edit v2: the one model a partial edit runs on (a list of one, so no screen offers a choice). */
export function regionV2Models(): StudioImageModel[] {
  return [studioModel(REGION_V2_MODEL) as StudioImageModel];
}

/**
 * Width x height for a pixel-sized model (`pixels`), or null for the aspect-ratio models. An aspect
 * outside the table (a region crop's own shape) takes the listed size whose shape is closest.
 */
export function pixelSize(model: StudioImageModel, resolution: string, aspect: string): readonly [number, number] | null {
  if (!model.pixels) return null;
  const table = model.pixels[resolution] ?? model.pixels[model.defaultResolution];
  if (!table) return null;
  const exact = table[aspect];
  if (exact) return exact;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  const wanted = m ? Number(m[1]) / Number(m[2]) : 1;
  let best: readonly [number, number] | null = null;
  for (const size of Object.values(table)) {
    if (!best || Math.abs(Math.log(size[0] / size[1] / wanted)) < Math.abs(Math.log(best[0] / best[1] / wanted))) best = size;
  }
  return best;
}

/* ------------------------------------------------------------------ cost */

/**
 * What the provider bills for a price of `usd`. The account lane charges whole credits and one credit is
 * one US cent, so every result is rounded up to the cent: a $0.043 edit is 5 credits, a $0.134 picture 14
 * (Sunra usage history against production jobs, 2026-11-18). Estimates use this unit so the figure a
 * screen shows before a press is the one a finished run reports.
 */
export function billedUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd * 100 - 1e-6) / 100;
}

/**
 * What one image is billed, in USD: the Sunra price card (2026-11-14) rounded up to the cent (`billedUsd`).
 * `seedream-5-flash` has no account lane and keeps its exact list price.
 */
export function estimateImageUsd(input: {
  model: StudioModelId | string;
  resolution: string;
  /** Reference images sent with an edit (0 for text-to-image). */
  references: number;
  /** Models with `qualities` only; their default when absent. */
  quality?: string | null;
  /** Models billed by shape only (GPT Image); read as square, the most, when absent. */
  aspect?: string | null;
}): number {
  const refs = Math.max(0, input.references);
  const modelId = normalizeLegacyStudioModelId(input.model);
  switch (modelId) {
    case 'seedream-5.5': {
      // Sunra & ModelArk price cards (2026-11-14): $0.020 at 1K/1.5K or $0.035 at 2K, plus $0.008 per input image.
      const base = input.resolution === '1K' || input.resolution === '1.5K' ? 0.02 : 0.035;
      return billedUsd(Math.round((base + refs * 0.008) * 1000) / 1000);
    }
    case 'seedream-5-flash':
      return 0.027;
    case 'nano-banana-pro':
      return billedUsd(input.resolution === '4K' ? 0.24 : 0.134);
    case 'nano-banana-2.1':
      // Sunra price card (2026-11-19): $0.034 at 1K, $0.050 at 2K, $0.113 at 4K, whatever the references (web
      // search, +$0.015, is never sent). The account lane's `estimate_cost` gave 4 / 5 / 12 credits with 0, 1 and
      // 3 references (2026-11-19): the same figures rounded up to the cent.
      return billedUsd(input.resolution === '4K' ? 0.113 : input.resolution === '2K' ? 0.05 : 0.034);
    case 'gpt-image-2.6-flare':
    case 'gpt-image-2.6-sunburst': {
      // The account lane's per-image credits, used for both lanes. The API lane settles by tokens after the
      // run and has come in lower ($0.044 to $0.067 for these pictures on 2026-11-17).
      const quality = (STUDIO_IMAGE_QUALITIES as readonly string[]).includes(input.quality ?? '') ? (input.quality as StudioImageQuality) : 'medium';
      const table = GPT_IMAGE_26_CENTS[quality];
      const cents = (table[input.resolution] ?? table['1K']!)[gptImageShape(input.aspect)];
      return (cents + refs * GPT_IMAGE_REFERENCE_CENTS) / 100;
    }
    default:
      return billedUsd(0.134);
  }
}

/**
 * What one Seedance 2.5 run is billed, in USD. The estimator moved to lib/sunra/seedance.ts so the personal
 * Sunra lane prices with the same formula (docs/PERSONAL-STUDIO.md §5.1); this name stays for the studio.
 */
export { estimateSeedanceUsd as estimateVideoUsd } from '@/lib/sunra/seedance';
