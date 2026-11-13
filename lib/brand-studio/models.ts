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
}

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
 * GPT Image 2.6 price per image, identical for Flare and Sunburst: the account lane's `estimate_cost`
 * (2026-11-11) in account credits, 1 credit = US$0.01 of list price. No reference surcharge.
 */
const GPT_IMAGE_26_CENTS: Readonly<Record<StudioImageQuality, Readonly<Record<string, number>>>> = {
  low: { '1K': 3, '2K': 6, '4K': 9 },
  medium: { '1K': 5, '2K': 9, '4K': 15 },
  high: { '1K': 6, '2K': 11, '4K': 18 },
};

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
    endpoints: { textToImage: 'text-to-image', edit: 'image-editing' },
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
  {
    id: 'seedream-5-flash',
    medium: 'image',
    label: 'Seedream 5.0 Flash',
    hintKey: 'seedreamFlash',
    availability: 'live',
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
    // Superseded by Seedream 5.5 (2026-11-14); kept as `retired` for historical job/cost lookup.
    id: 'seedream-5-pro',
    medium: 'image',
    label: 'Seedream 5.0 Pro',
    hintKey: 'seedreamPro',
    availability: 'retired',
    promptProfile: 'seedream',
    safetyChecker: true,
    api: { alias: 'bytedance/seedream-5.0-pro' },
    mcp: { model: 'seedream-5-pro' },
    aspects: SEEDREAM_ASPECTS,
    resolutions: ['1K', '2K'],
    defaultResolution: '2K',
    maxReferences: 10,
    regionEdit: false,
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

export function studioModel(id: string): StudioModel | null {
  return (STUDIO_MODELS as readonly StudioModel[]).find((m) => m.id === id) ?? null;
}

/** Models a screen may offer: live ones only, in registry order. */
export function selectableModels(medium?: StudioMedium): StudioModel[] {
  return (STUDIO_MODELS as readonly StudioModel[]).filter(
    (m) => m.availability === 'live' && (medium === undefined || m.medium === medium),
  );
}

/** Live image models a partial edit may run on, in registry order. */
export function regionEditModels(): StudioImageModel[] {
  return selectableModels('image').filter((m): m is StudioImageModel => m.medium === 'image' && m.regionEdit);
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

/** Provider list price for one image, in USD (Sunra price cards, 2026-11-10). */
export function estimateImageUsd(input: {
  model: StudioModelId | string;
  resolution: string;
  /** Reference images sent with an edit (0 for text-to-image). */
  references: number;
  /** Models with `qualities` only; their default when absent. */
  quality?: string | null;
}): number {
  const refs = Math.max(0, input.references);
  switch (input.model) {
    case 'seedream-5-pro': {
      const base = input.resolution === '1K' ? 0.045 : 0.09;
      return base + Math.max(0, refs - 1) * 0.004;
    }
    case 'seedream-5.5': {
      // Sunra price cards (2026-11-14): $0.020 at 1K/1.5K or $0.035 at 2K, plus $0.008 per input image.
      const base = input.resolution === '1K' || input.resolution === '1.5K' ? 0.02 : 0.035;
      return Math.round((base + refs * 0.008) * 1000) / 1000;
    }
    case 'seedream-5-flash':
      return 0.027;
    case 'nano-banana-pro':
      return input.resolution === '4K' ? 0.24 : 0.134;
    case 'gpt-image-2.6-flare':
    case 'gpt-image-2.6-sunburst': {
      // The account lane's per-image credits (1 credit = US$0.01), used for both lanes. The API lane
      // settles post-calculated ("$1 x upstream units", a $4.00 hold per request): the first live API
      // run must be compared against this estimate before it is trusted.
      const quality = (STUDIO_IMAGE_QUALITIES as readonly string[]).includes(input.quality ?? '') ? (input.quality as StudioImageQuality) : 'medium';
      const table = GPT_IMAGE_26_CENTS[quality];
      return (table[input.resolution] ?? table['1K']!) / 100;
    }
    default:
      return 0.134;
  }
}

/** Pixel budget Seedance spends per frame at each resolution (independent of the aspect ratio). */
const SEEDANCE_PIXELS: Record<StudioVideoResolution, number> = {
  '480p': 409_920, // 854 x 480
  '720p': 921_600, // 1280 x 720
  '1080p': 2_073_600, // 1920 x 1080
};
const SEEDANCE_FPS = 24;
/** USD per million tokens: [without an input video, with one]. */
const SEEDANCE_USD_PER_M: Record<StudioVideoResolution, readonly [number, number]> = {
  '480p': [10.7, 6.4],
  '720p': [10.7, 6.4],
  '1080p': [11.7, 7.0],
};
/** Settlement is by actual usage and has come in above the plain formula; reserve with headroom. */
const SEEDANCE_HEADROOM = 1.25;

/**
 * Estimated provider cost of one Seedance 2.5 run, in USD.
 * tokens = pixels x fps x seconds / 1024. With a reference video the input seconds are billed too
 * (at least ceil(output x 2/3)), at the lower with-video rate.
 */
export function estimateVideoUsd(input: {
  resolution: StudioVideoResolution;
  /** Output seconds; for an edit that follows the source, pass the source length. */
  seconds: number;
  /** Seconds of reference video attached, 0 when none. */
  referenceVideoSeconds: number;
}): number {
  const seconds = Math.max(1, input.seconds);
  const withVideo = input.referenceVideoSeconds > 0;
  const billedInput = withVideo ? Math.max(input.referenceVideoSeconds, Math.ceil((seconds * 2) / 3)) : 0;
  const tokens = (SEEDANCE_PIXELS[input.resolution] * SEEDANCE_FPS * (seconds + billedInput)) / 1024;
  const rate = SEEDANCE_USD_PER_M[input.resolution][withVideo ? 1 : 0];
  return (tokens / 1_000_000) * rate * SEEDANCE_HEADROOM;
}
