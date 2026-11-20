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
export function usageKrw(usd: number, medium: StudioMedium | 'audio'): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const f = STUDIO_USAGE_FACTORS;
  // Music and sound effects take the image factor for now (docs/BRAND-SOUND-STUDIO.md §3.4, provisional).
  const factor = medium === 'image' || medium === 'audio' ? f.imageMarkup : 1 + f.videoMargin;
  return Math.ceil((usd * f.krwPerUsd * factor) / STUDIO_CREDIT_KRW - 1e-9) * STUDIO_CREDIT_KRW;
}

/**
 * What a finished run takes: the amount it was quoted and reserved at, for the results that came out.
 * The figure on the button is the figure taken, whichever lane ran it and whatever the provider settled
 * at afterwards; the provider's charge is recorded as cost and nothing else (docs/BRAND-STUDIO-V2.md §9).
 * A result that failed takes nothing, so two pictures out of four take half the quote.
 */
export function settledUsageKrw(estimateKrw: number, planned: number, ready: number): number {
  if (!Number.isFinite(estimateKrw) || estimateKrw <= 0 || ready <= 0) return 0;
  const slots = Math.max(1, planned);
  return Math.round((estimateKrw * Math.min(ready, slots)) / slots);
}

/** Seconds in tenths, the precision a screen sees (`StudioAssetView.seconds`), so both sides round alike. */
/**
 * A music request is one charge (docs/BRAND-SOUND-STUDIO.md §3.4): the quote when at least one version was
 * stored, nothing when none was. The number of versions never changes it.
 */
export function musicUsageKrw(estimateKrw: number, ready: number): number {
  if (!Number.isFinite(estimateKrw) || estimateKrw <= 0 || ready <= 0) return 0;
  return estimateKrw;
}

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
 * The length a run that follows its reference video (`duration: -1`) is priced at: the reference's length
 * rounded up, 4 to 30 s (Sunra CLI help for `create_video.duration`; quoted free 2026-11-18: an 11.1 s source
 * is 12 s out, a 20.07 s one 21 s). Only Seedance 2.5 takes -1. The studio refuses longer references itself.
 */
export const FOLLOW_SOURCE_SECONDS = { min: 4, max: 30 } as const;

/**
 * A run with a reference video. An edit, or a new take with no length of its own, follows the source
 * (`FOLLOW_SOURCE_SECONDS`); a new take otherwise uses the seconds asked for. The source is billed for at
 * least one second. A blueprint run never attaches the video (docs/BRAND-STUDIO-V3.md §6), so it is billed
 * as a plain video run at a length of its own, inside the model's range, from the tenths a screen shows
 * (as reference-video.ts `remakeSeconds` plans it).
 *
 * The source is priced from its exact length (`referenceMs`, the stored `duration_ms`) whenever the caller
 * has it: every clip we generate is 24n + 1 frames (5.04 s, 15.04 s), which the tenths show as 5.0 and 15.0
 * while the provider counts 6 and 16 s out. Only without it does the tenths value stand in.
 */
export function remixRunUsd(input: {
  model: Pick<StudioVideoModel, 'minSeconds' | 'maxSeconds' | 'defaultSeconds'>;
  resolution: string;
  method: StudioRemixMethod;
  seconds: number | null;
  /** The reference video's length as a screen shows it (tenths), or null when it was never measured. */
  referenceSeconds: number | null;
  /** The reference video's exact length in milliseconds, when known; it wins over `referenceSeconds`. */
  referenceMs?: number | null;
}): { usd: number; outputSeconds: number } {
  const { model } = input;
  const shown = tenthsOfSeconds(input.referenceSeconds);
  const asked = input.method === 'edit' ? null : input.seconds;
  if (input.method === 'blueprint') {
    const tenths = shown ?? tenthsOfSeconds(exactSeconds(input.referenceMs));
    const outputSeconds = asked ?? Math.min(model.maxSeconds, Math.max(model.minSeconds, Math.round(tenths ?? model.defaultSeconds)));
    return { usd: videoRunUsd({ resolution: input.resolution, seconds: outputSeconds }), outputSeconds };
  }
  const ref = exactSeconds(input.referenceMs) ?? shown;
  const followed = Math.min(FOLLOW_SOURCE_SECONDS.max, Math.max(FOLLOW_SOURCE_SECONDS.min, Math.ceil((ref ?? model.defaultSeconds) - 1e-6)));
  const outputSeconds = asked ?? followed;
  const usd = estimateVideoUsd({
    resolution: billedResolution(input.resolution),
    seconds: outputSeconds,
    // The input is billed for its real length, not a whole number of seconds (a 15,042 ms source is 15.042 s).
    referenceVideoSeconds: Math.max(1, ref ?? outputSeconds),
  });
  return { usd, outputSeconds };
}

/** Exact seconds from a stored length in milliseconds; null when there is none worth trusting. */
export function exactSeconds(ms: number | null | undefined): number | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms / 1000 : null;
}
