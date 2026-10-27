import { ARK_MODELS, supportedResolutions, type ArkModelKey } from '@/lib/ark/models';
import { quoteArkVideo } from '@/lib/ark/pricing';
import type { VideoEngineId } from '@/lib/images/engines';
import { KLING_MODELS, clampKlingDuration, estimateKlingUsd, isKlingModelKey, klingModelFromEnv, type KlingModelKey } from '@/lib/kling/models';

/**
 * One view over the two video model tables (ModelArk's lib/ark/models.ts, Kling's
 * lib/kling/models.ts): which model a video ENGINE id renders on for a runtime, what it can do,
 * and what one task costs at list price. Everything that used to read ModelArk's table directly
 * (the resolution picker, the cost floor, the recipe rules, the admin editor) reads this instead,
 * so adding a video provider is a row here and an adapter — not a branch in every caller.
 */

export type VideoModelKey = ArkModelKey | KlingModelKey;
export type VideoResolution = '480p' | '720p' | '1080p' | '4k';

export function isVideoModelKey(value: unknown): value is VideoModelKey {
  return typeof value === 'string' && (Object.prototype.hasOwnProperty.call(ARK_MODELS, value) || isKlingModelKey(value));
}

export function isKlingModel(model: VideoModelKey): model is KlingModelKey {
  return isKlingModelKey(model);
}

/**
 * Which ModelArk model a Seedance engine id renders on for a runtime. Seedance 2.0 stops at 15
 * seconds per task, so a longer template moves to 2.5 (one task) — the rule `startVideoRender` applies.
 */
export function arkModelForVideo(engine: string | null, seconds: number): { model: ArkModelKey; seconds: number } {
  const wanted: ArkModelKey = engine === 'seedance-2.5' ? 'seedance-2.5' : 'seedance-2.0';
  const model: ArkModelKey = seconds > ARK_MODELS[wanted].maxDurationSeconds ? 'seedance-2.5' : wanted;
  const spec = ARK_MODELS[model];
  return { model, seconds: Math.min(spec.maxDurationSeconds, Math.max(spec.minDurationSeconds, Math.round(seconds))) };
}

/**
 * The model ANY video engine id renders on, and the whole seconds it will be asked for. An unknown
 * or null engine is Seedance 2.0 (the product default); `kling-omni` is whichever Kling model the
 * deployment configured.
 */
export function videoModelForEngine(engine: string | null, seconds: number, env?: Record<string, string | undefined>): { model: VideoModelKey; seconds: number } {
  if (engine === 'kling-omni') {
    const model = klingModelFromEnv(env);
    return { model, seconds: clampKlingDuration(model, seconds) };
  }
  return arkModelForVideo(engine, seconds);
}

export interface VideoEngineSpec {
  /** The model this engine currently renders on. */
  model: VideoModelKey;
  label: string;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  /** The aspects the API accepts, or null when it takes every one the product offers. */
  aspects: readonly string[] | null;
  resolutions: readonly VideoResolution[];
  maxReferenceImages: number;
}

/** What a maker's step on this engine may ask for — the recipe rules and the editor read it. */
export function videoEngineSpec(engine: VideoEngineId, env?: Record<string, string | undefined>): VideoEngineSpec {
  if (engine === 'kling-omni') {
    const model = klingModelFromEnv(env);
    const spec = KLING_MODELS[model];
    return { model, label: spec.label, minDurationSeconds: spec.minDurationSeconds, maxDurationSeconds: spec.maxDurationSeconds, aspects: spec.aspects, resolutions: spec.resolutions, maxReferenceImages: spec.maxReferenceImages };
  }
  const spec = ARK_MODELS[engine];
  // The engine's own range: a 2.0 step longer than 15 s is refused rather than silently moved to 2.5.
  return { model: engine, label: spec.label, minDurationSeconds: spec.minDurationSeconds, maxDurationSeconds: spec.maxDurationSeconds, aspects: null, resolutions: supportedResolutions(engine), maxReferenceImages: spec.maxReferenceAssets };
}

export function videoResolutions(model: VideoModelKey): VideoResolution[] {
  return isKlingModel(model) ? [...KLING_MODELS[model].resolutions] : supportedResolutions(model);
}

export interface VideoQuoteInput {
  model: VideoModelKey;
  resolution: '720p' | '1080p';
  seconds: number;
  aspect: string;
}

/**
 * List price for one task. ModelArk is token-exact (pixels × 24 fps × seconds); Kling is a flat
 * per-second rate, so it carries no token figure. `null` when the model cannot do the ask.
 */
export function quoteVideo(input: VideoQuoteInput): { providerUsd: number; providerTokens: number | null } | null {
  if (isKlingModel(input.model)) {
    const usd = estimateKlingUsd({ model: input.model, resolution: input.resolution, seconds: input.seconds });
    return usd === null ? null : { providerUsd: usd, providerTokens: null };
  }
  const quote = quoteArkVideo({ model: input.model, resolution: input.resolution, seconds: input.seconds, aspect: input.aspect });
  return quote === null ? null : { providerUsd: quote.providerUsd, providerTokens: quote.providerTokens };
}

/** The model label beside a render button: "Seedance 2.5", "Kling 3.0 Omni". */
export function videoModelLabel(model: VideoModelKey): string {
  return isKlingModel(model) ? KLING_MODELS[model].label : ARK_MODELS[model].label;
}
