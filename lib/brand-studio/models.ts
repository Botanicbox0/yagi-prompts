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
export type StudioPromptProfile = 'seedream' | 'nano-banana' | 'seedance';

/**
 * `live`: selectable. `awaiting_provider`: declared so the day the provider lists it only this flag
 * changes; hidden from every screen and refused by the API until then.
 */
export type StudioModelAvailability = 'live' | 'awaiting_provider';

interface StudioModelBase {
  id: string;
  /** The product name the customer sees on the model chip. */
  label: string;
  /** One short line on what it is good at. Keys into messages (brandStudio.models.<hintKey>). */
  hintKey: string;
  availability: StudioModelAvailability;
  promptProfile: StudioPromptProfile;
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
}

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
  supportsDraft: boolean;
  endpoints: { text: string; image: string; reference: string; finalize: string };
}

export type StudioModel = StudioImageModel | StudioVideoModel;
export type StudioVideoResolution = '480p' | '720p' | '1080p';

const SEEDREAM_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const;
const GEMINI_PRO_ASPECTS = ['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9', '21:9'] as const;
const SEEDANCE_ASPECTS = ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'] as const;

export const STUDIO_MODELS = [
  {
    id: 'seedream-5-pro',
    medium: 'image',
    label: 'Seedream 5.0 Pro',
    hintKey: 'seedreamPro',
    availability: 'live',
    promptProfile: 'seedream',
    api: { alias: 'bytedance/seedream-5.0-pro' },
    mcp: { model: 'seedream-5-pro' },
    aspects: SEEDREAM_ASPECTS,
    resolutions: ['1K', '2K'],
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
    // ByteDance announced it on 2026-11-09. Sunra listed it on neither lane on 2026-11-10, so the alias
    // and the controls below are the 5.0 Pro shape and must be re-read from the catalogue before `live`.
    id: 'seedream-5.5',
    medium: 'image',
    label: 'Seedream 5.5',
    hintKey: 'seedream55',
    availability: 'awaiting_provider',
    promptProfile: 'seedream',
    api: { alias: 'bytedance/seedream-5.5' },
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

export const DEFAULT_IMAGE_MODEL: StudioModelId = 'seedream-5-pro';
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

/* ------------------------------------------------------------------ cost */

/** Provider list price for one image, in USD (Sunra price cards, 2026-11-10). */
export function estimateImageUsd(input: {
  model: StudioModelId | string;
  resolution: string;
  /** Reference images sent with an edit (0 for text-to-image). */
  references: number;
}): number {
  const refs = Math.max(0, input.references);
  switch (input.model) {
    case 'seedream-5-pro':
    case 'seedream-5.5': {
      const base = input.resolution === '1K' ? 0.045 : 0.09;
      return base + Math.max(0, refs - 1) * 0.004;
    }
    case 'seedream-5-flash':
      return 0.027;
    case 'nano-banana-pro':
      return input.resolution === '4K' ? 0.24 : 0.134;
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
