/**
 * What a run takes from the monthly allowance (docs/BRAND-STUDIO-V2.md §9), as one implementation the
 * server reserves with (./plan.ts) and the prompt dock shows before a press ("약 ₩283").
 *
 * Usage (KRW) = provider cost (USD) x the existing exchange rate x (1 + the existing brand margin),
 * rounded up to a whole credit per result. The provider cost is the billed amount (`billedUsd` in
 * models.ts: the list price rounded up to the cent). The three factors are the existing constants `COST_ASSUMPTIONS.krwPerUsd` (lib/twings/cost-model.ts),
 * `BRAND_IMAGE_MARKUP.target` and `BRAND_VIDEO_MARGIN.target` (lib/brands/production/pricing.ts). Those
 * modules pull in env-reading code, so the values are restated here and
 * tests/brand-studio/server/estimate.test.ts fails the moment they drift apart. No new price lives here.
 *
 * Client-safe on purpose: no db, no env, no server imports (`npm run security:client`).
 *
 * A screen shows the result as credits (lib/brand-studio/credits.ts), never as money.
 * Per-model prices live in `estimateImageUsd` (models.ts); a model with `qualities` is priced at the
 * quality asked for (its default when none was).
 */
import {
  DEFAULT_REGION_EDIT_MODEL,
  REGION_V2_MODEL,
  estimateImageUsd,
  estimateVideoUsd,
  studioModel,
  type StudioImageModel,
  type StudioMedium,
  type StudioVideoModel,
  type StudioVideoResolution,
} from './models';
import type { StudioRemixMethod } from './contracts';
import { STUDIO_CREDIT_KRW } from './credits';

export const STUDIO_USAGE_FACTORS = {
  krwPerUsd: 1400,
  imageMarkup: 1.12,
  videoMargin: 0.11,
} as const;

/**
 * Usage of one result, in KRW. Counted in whole credits (rounded up), the unit every screen shows: a run
 * that reads "8 credits" takes 80 KRW of the allowance, so the amounts on the results add up to what the
 * balance lost. Call it once per result (one picture, one video), never on a sum of several.
 */
export function usageKrw(usd: number, medium: StudioMedium): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const f = STUDIO_USAGE_FACTORS;
  const factor = medium === 'image' ? f.imageMarkup : 1 + f.videoMargin;
  return Math.ceil((usd * f.krwPerUsd * factor) / STUDIO_CREDIT_KRW - 1e-9) * STUDIO_CREDIT_KRW;
}

/** Seconds in tenths, the precision a screen sees (`StudioAssetView.seconds`), so both sides round alike. */
export function tenthsOfSeconds(seconds: number | null): number | null {
  return seconds === null || !Number.isFinite(seconds) ? null : Math.round(seconds * 10) / 10;
}

export interface ImageRunInput {
  model: string;
  resolution: string;
  references: number;
  count: number;
  quality?: string | null;
  /** Only read by the models billed by shape (GPT Image). */
  aspect?: string | null;
}

export function imageRunUsd(input: ImageRunInput): number {
  return (
    estimateImageUsd({ model: input.model, resolution: input.resolution, references: input.references, quality: input.quality ?? null, aspect: input.aspect ?? null }) *
    input.count
  );
}

/** Usage of a picture run, in KRW: each picture counted on its own (`usageKrw`), times the count. */
export function imageRunKrw(input: ImageRunInput): number {
  return usageKrw(imageRunUsd({ ...input, count: 1 }), 'image') * input.count;
}

/**
 * The model a partial edit runs on: the picked one when it edits well, else the registry default. With
 * region edit v2 (`v2`, flag `BRAND_STUDIO_REGION_V2`) always `REGION_V2_MODEL`, whatever was picked.
 */
export function regionEditModel(id: string, v2 = false): StudioImageModel {
  if (v2) return studioModel(REGION_V2_MODEL) as StudioImageModel;
  const picked = studioModel(id);
  return (picked && picked.medium === 'image' && picked.availability === 'live' && picked.regionEdit ? picked : studioModel(DEFAULT_REGION_EDIT_MODEL)) as StudioImageModel;
}

/**
 * A partial edit is one edit call at 2K (or the model's default), the picture itself counting as a
 * reference. `v2`: on `REGION_V2_MODEL`, which has no quality choice (a `quality` passed is ignored).
 */
export function regionEditRun(id: string, references: number, quality?: string | null, v2 = false): { model: StudioImageModel; resolution: string; usd: number } {
  const model = regionEditModel(id, v2);
  const resolution = (model.resolutions as readonly string[]).includes('2K') ? '2K' : model.defaultResolution;
  return { model, resolution, usd: estimateImageUsd({ model: model.id, resolution, references: references + 1, quality: quality ?? null }) };
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
 * uses the seconds asked for. The source is billed for at least one second. A blueprint run never
 * attaches the video (docs/BRAND-STUDIO-V3.md §6), so it is billed as a plain video run.
 */
export function remixRunUsd(input: {
  model: Pick<StudioVideoModel, 'minSeconds' | 'maxSeconds' | 'defaultSeconds'>;
  resolution: string;
  method: StudioRemixMethod;
  seconds: number | null;
  /** The reference video's length, or null when it was never measured. */
  referenceSeconds: number | null;
}): { usd: number; outputSeconds: number } {
  const { model } = input;
  const ref = tenthsOfSeconds(input.referenceSeconds);
  const asked = input.method === 'edit' ? null : input.seconds;
  const outputSeconds = asked ?? Math.min(model.maxSeconds, Math.max(model.minSeconds, Math.round(ref ?? model.defaultSeconds)));
  if (input.method === 'blueprint') return { usd: videoRunUsd({ resolution: input.resolution, seconds: outputSeconds }), outputSeconds };
  const usd = estimateVideoUsd({
    resolution: billedResolution(input.resolution),
    seconds: outputSeconds,
    // The input is billed for its real length, not a whole number of seconds (a 14.1 s source is 14.1 s).
    referenceVideoSeconds: Math.max(1, ref ?? outputSeconds),
  });
  return { usd, outputSeconds };
}
