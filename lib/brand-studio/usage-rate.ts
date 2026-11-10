/**
 * What a run takes from the monthly allowance (docs/BRAND-STUDIO-V2.md §9), as one implementation the
 * server reserves with (./plan.ts) and the prompt dock shows before a press ("약 ₩283").
 *
 * Usage (KRW) = provider cost (USD) x the existing exchange rate x (1 + the existing brand margin).
 * The three factors are the existing constants `COST_ASSUMPTIONS.krwPerUsd` (lib/twings/cost-model.ts),
 * `BRAND_IMAGE_MARKUP.target` and `BRAND_VIDEO_MARGIN.target` (lib/brands/production/pricing.ts). Those
 * modules pull in env-reading code, so the values are restated here and
 * tests/brand-studio/server/estimate.test.ts fails the moment they drift apart. No new price lives here.
 *
 * Client-safe on purpose: no db, no env, no server imports (`npm run security:client`).
 */
import {
  DEFAULT_REGION_EDIT_MODEL,
  estimateImageUsd,
  estimateVideoUsd,
  studioModel,
  type StudioImageModel,
  type StudioMedium,
  type StudioVideoModel,
  type StudioVideoResolution,
} from './models';

export const STUDIO_USAGE_FACTORS = {
  krwPerUsd: 1400,
  imageMarkup: 1.12,
  videoMargin: 0.11,
} as const;

export function usageKrw(usd: number, medium: StudioMedium): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const f = STUDIO_USAGE_FACTORS;
  const factor = medium === 'image' ? f.imageMarkup : 1 + f.videoMargin;
  return Math.ceil(usd * f.krwPerUsd * factor - 1e-9);
}

/** Seconds in tenths, the precision a screen sees (`StudioAssetView.seconds`), so both sides round alike. */
export function tenthsOfSeconds(seconds: number | null): number | null {
  return seconds === null || !Number.isFinite(seconds) ? null : Math.round(seconds * 10) / 10;
}

export function imageRunUsd(input: { model: string; resolution: string; references: number; count: number }): number {
  return estimateImageUsd({ model: input.model, resolution: input.resolution, references: input.references }) * input.count;
}

/** The model a partial edit runs on: the picked one when it edits well, else the registry default. */
export function regionEditModel(id: string): StudioImageModel {
  const picked = studioModel(id);
  return (picked && picked.medium === 'image' && picked.availability === 'live' && picked.regionEdit ? picked : studioModel(DEFAULT_REGION_EDIT_MODEL)) as StudioImageModel;
}

/** A partial edit is one edit call at 2K (or the model's default), the picture itself counting as a reference. */
export function regionEditRun(id: string, references: number): { model: StudioImageModel; resolution: string; usd: number } {
  const model = regionEditModel(id);
  const resolution = (model.resolutions as readonly string[]).includes('2K') ? '2K' : model.defaultResolution;
  return { model, resolution, usd: estimateImageUsd({ model: model.id, resolution, references: references + 1 }) };
}

/** `draft` is billed as the 480p pass it is. */
export function billedResolution(resolution: string): StudioVideoResolution {
  return resolution === 'draft' ? '480p' : (resolution as StudioVideoResolution);
}

export function videoRunUsd(input: { resolution: string; seconds: number }): number {
  return estimateVideoUsd({ resolution: billedResolution(input.resolution), seconds: input.seconds, referenceVideoSeconds: 0 });
}

/**
 * A run with a reference video. An edit follows the source length (clamped to the model); a new take
 * uses the seconds asked for. The source is billed for at least one second.
 */
export function remixRunUsd(input: {
  model: Pick<StudioVideoModel, 'minSeconds' | 'maxSeconds' | 'defaultSeconds'>;
  resolution: string;
  method: 'edit' | 'reference';
  seconds: number | null;
  /** The reference video's length, or null when it was never measured. */
  referenceSeconds: number | null;
}): { usd: number; outputSeconds: number } {
  const { model } = input;
  const ref = tenthsOfSeconds(input.referenceSeconds);
  const asked = input.method === 'edit' ? null : input.seconds;
  const outputSeconds = asked ?? Math.min(model.maxSeconds, Math.max(model.minSeconds, Math.round(ref ?? model.defaultSeconds)));
  const usd = estimateVideoUsd({
    resolution: billedResolution(input.resolution),
    seconds: outputSeconds,
    referenceVideoSeconds: Math.max(1, Math.round(ref ?? outputSeconds)),
  });
  return { usd, outputSeconds };
}
