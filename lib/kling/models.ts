/**
 * Kling (Kuaishou) — the video model table TWINGS renders with (docs/PLATFORM-2.0.md §7.3, §9.1,
 * §18 R2: "Kling 3.0 Omni 지금 · 4.0 열리면 전환").
 *
 * The numbers are transcribed from the official docs, read 2026-10-24:
 *   · kling.ai/document-api/api/video/3-0-omni/video-omni — `POST /omni-video/kling-3.0-omni`,
 *     duration 3…15 s, resolution 720p/1080p/4k, aspect 16:9 · 9:16 · 1:1, reference images and
 *     multi-image elements ≤ 7 without a reference video, image ≤ 50 MB, 300 px min edge, ratio
 *     1:2.5 … 2.5:1, results kept 30 days.
 *   · kling.ai/document-api/api/video/4-0/video-omni — `POST /omni-video/kling-4.0` (same body
 *     shape), duration 3…30 s, 720p/1080p, aspect 21:9 · 16:9 · 9:16 · 1:1 · adaptive, keyframes
 *     ≤ 10, references in all ≤ 15. "Fully available on October 28" — early access until then.
 *   · kling.ai/dev/pricing, as recorded in PLATFORM-2.0 §9.1: 3.0 Omni 720p $0.084 silent /
 *     $0.112 with audio, 1080p $0.112 / $0.14; 4.0 720p $0.157, 1080p $0.235 (per output second).
 *
 * Which model a render uses is CONFIGURATION, not code (the founder's ask): `KLING_VIDEO_MODEL`
 * picks a key below (default 3.0 Omni), and `KLING_VIDEO_MODEL_ID` can override the path segment
 * if the 4.0 string published on the 28th differs from the preview docs. Nothing else changes when
 * 4.0 opens. We always ask for native audio, so the audio rates are the ones carried here.
 */

export const KLING_MODELS = {
  'kling-3.0-omni': {
    /** The path segment of the create endpoint: `POST {base}/omni-video/{id}`. */
    id: 'kling-3.0-omni',
    label: 'Kling 3.0 Omni',
    minDurationSeconds: 3,
    maxDurationSeconds: 15,
    /** The `settings.aspect_ratio` enum. 4:3 / 3:4 are not offered — a recipe step naming them is refused. */
    aspects: ['16:9', '9:16', '1:1'],
    /** 4k exists on the API but is not sold (no price row, no resolution choice). */
    resolutions: ['720p', '1080p'],
    /** USD per output second WITH native audio (`settings.audio = native`). */
    usdPerSecond: { '720p': 0.112, '1080p': 0.14 },
    /** Reference images + multi-image elements, no reference video. */
    maxReferenceImages: 7,
  },
  'kling-4.0': {
    id: 'kling-4.0',
    label: 'Kling 4.0',
    minDurationSeconds: 3,
    maxDurationSeconds: 30,
    aspects: ['21:9', '16:9', '9:16', '1:1'],
    resolutions: ['720p', '1080p'],
    /** The pricing page lists one rate per resolution for 4.0 (no silent/audio split). */
    usdPerSecond: { '720p': 0.157, '1080p': 0.235 },
    /** Keyframes ≤ 10; everything (images, videos, elements, voices) ≤ 15. */
    maxReferenceImages: 10,
  },
} as const;

export type KlingModelKey = keyof typeof KLING_MODELS;
export type KlingResolution = '720p' | '1080p';
export type KlingAspect = '21:9' | '16:9' | '9:16' | '1:1';

export const DEFAULT_KLING_MODEL: KlingModelKey = 'kling-3.0-omni';

export function isKlingModelKey(value: unknown): value is KlingModelKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KLING_MODELS, value);
}

/**
 * The model the deployment renders Kling jobs on. An unknown `KLING_VIDEO_MODEL` falls back to the
 * default rather than failing a job — the admin surface shows which one is active.
 */
export function klingModelFromEnv(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env): KlingModelKey {
  const wanted = env.KLING_VIDEO_MODEL?.trim();
  return isKlingModelKey(wanted) ? wanted : DEFAULT_KLING_MODEL;
}

/** The create endpoint's path segment: the table's id unless `KLING_VIDEO_MODEL_ID` overrides it. */
export function klingModelId(model: KlingModelKey, env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env): string {
  const override = env.KLING_VIDEO_MODEL_ID?.trim();
  return override && /^[a-z0-9.-]{1,40}$/i.test(override) ? override : KLING_MODELS[model].id;
}

export function klingResolutions(model: KlingModelKey): KlingResolution[] {
  return [...KLING_MODELS[model].resolutions];
}

/** Seconds the model accepts, as a whole number inside its range (the API takes an integer enum). */
export function clampKlingDuration(model: KlingModelKey, seconds: number): number {
  const spec = KLING_MODELS[model];
  return Math.min(spec.maxDurationSeconds, Math.max(spec.minDurationSeconds, Math.round(seconds)));
}

/** List price for one task — the `billing[]` on the finished task is authoritative when it carries USD. */
export function estimateKlingUsd(input: { model: KlingModelKey; resolution: KlingResolution; seconds: number }): number | null {
  const spec = KLING_MODELS[input.model];
  const rate = (spec.usdPerSecond as Partial<Record<KlingResolution, number>>)[input.resolution];
  if (rate === undefined || !Number.isInteger(input.seconds)) return null;
  if (input.seconds < spec.minDurationSeconds || input.seconds > spec.maxDurationSeconds) return null;
  return Math.round(rate * input.seconds * 10_000) / 10_000;
}
