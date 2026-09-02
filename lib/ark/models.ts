/**
 * BytePlus ModelArk — the Seedance model table TWINGS renders with (founder decision, 2026-09-02:
 * "ModelArk 직결 + 실인물 자산 라이브러리 가자").
 *
 * Every number here is transcribed from the ModelArk pricing page and the Seedance 2.x tutorials
 * (docs.byteplus.com, "Last updated: August 31, 2026"), and they exist as DATA rather than as prose
 * in a doc because two product decisions hang on them:
 *
 *   · the engine a style renders on decides whether the $4 / $7 price points survive — Seedance 2.5
 *     at 720p costs $3.47 for the 15-second interview and $6.93 for the 30-second prom film, which
 *     is the sale price. Seedance 2.0 at 720p costs $2.25 and $4.50. The estimate below is what the
 *     admin surface shows next to a render button, so nobody presses it blind;
 *   · Seedance 2.0 tops out at 15 seconds per task, so a 30-second style on 2.0 is two tasks and an
 *     extension, while 2.5 does it in one. `maxDurationSeconds` is what the planner reads.
 *
 * Per-second prices are the page's own "USD per second" figures for a 16:9 output WITHOUT video
 * input; a reference video roughly doubles token consumption (the input duration is billed too),
 * and a failed task is not billed at all. Treat the estimate as ±10%: the authoritative figure is
 * `usage.completion_tokens` on the finished task.
 */

export const ARK_MODELS = {
  'seedance-2.5': {
    id: 'dreamina-seedance-2-5-260628',
    label: 'Seedance 2.5',
    minDurationSeconds: 4,
    maxDurationSeconds: 30,
    /** USD per output second, 16:9, no video input. */
    usdPerSecond: { '480p': 0.103, '720p': 0.231, '1080p': 0.569 },
    maxReferenceAssets: 50,
  },
  'seedance-2.0': {
    id: 'dreamina-seedance-2-0-260128',
    label: 'Seedance 2.0',
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    usdPerSecond: { '480p': 0.07, '720p': 0.15, '1080p': 0.37, '4k': 0.78 },
    maxReferenceAssets: 12,
  },
  'seedance-2.0-fast': {
    id: 'dreamina-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast',
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    usdPerSecond: { '480p': 0.06, '720p': 0.12 },
    maxReferenceAssets: 12,
  },
  'seedance-2.0-mini': {
    id: 'dreamina-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 Mini',
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    usdPerSecond: { '480p': 0.04, '720p': 0.08 },
    maxReferenceAssets: 12,
  },
} as const;

export type ArkModelKey = keyof typeof ARK_MODELS;
export type ArkResolution = '480p' | '720p' | '1080p' | '4k';
export type ArkRatio = '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | 'adaptive';

export const ARK_RATIOS: readonly ArkRatio[] = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'];

/** The output `video_url` on a finished task expires; anything worth keeping is copied before this. */
export const ARK_VIDEO_URL_TTL_HOURS = 24;

export function isArkModelKey(value: string): value is ArkModelKey {
  return Object.prototype.hasOwnProperty.call(ARK_MODELS, value);
}

export function supportedResolutions(model: ArkModelKey): ArkResolution[] {
  return Object.keys(ARK_MODELS[model].usdPerSecond) as ArkResolution[];
}

export type EstimateProblem = 'duration-too-long' | 'duration-too-short' | 'resolution-unsupported';

export type RenderEstimate =
  | { ok: true; usd: number; seconds: number; model: ArkModelKey; resolution: ArkResolution }
  | { ok: false; problem: EstimateProblem; model: ArkModelKey };

/**
 * What one task will cost, before it is created. Cents-precise rounding, because the number is
 * shown beside a price and "$2.2499999" beside "$4" reads as a bug.
 */
export function estimateRenderUsd(input: {
  model: ArkModelKey;
  resolution: ArkResolution;
  seconds: number;
}): RenderEstimate {
  const spec = ARK_MODELS[input.model];
  const rate = (spec.usdPerSecond as Partial<Record<ArkResolution, number>>)[input.resolution];
  if (rate === undefined) return { ok: false, problem: 'resolution-unsupported', model: input.model };
  if (input.seconds > spec.maxDurationSeconds) {
    return { ok: false, problem: 'duration-too-long', model: input.model };
  }
  if (input.seconds < spec.minDurationSeconds) {
    return { ok: false, problem: 'duration-too-short', model: input.model };
  }
  return {
    ok: true,
    usd: Math.round(rate * input.seconds * 100) / 100,
    seconds: input.seconds,
    model: input.model,
    resolution: input.resolution,
  };
}

/**
 * How many tasks a style needs on a given engine. Seedance 2.0 renders at most 15 seconds per
 * task, so a 30-second film is a 15-second task plus an extension task; 2.5 is one task.
 */
export function tasksForDuration(model: ArkModelKey, seconds: number): number {
  return Math.max(1, Math.ceil(seconds / ARK_MODELS[model].maxDurationSeconds));
}
