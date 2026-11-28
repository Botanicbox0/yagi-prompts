import { ARK_MODELS, isArkModelKey, supportedResolutions, type ArkModelKey } from '@/lib/ark/models';
import { quoteArkVideo } from '@/lib/ark/pricing';
import { VIDEO_ASPECTS, type VideoEngineId } from '@/lib/images/engines';
import { KLING_MODELS, clampKlingDuration, estimateKlingUsd, isKlingModelKey, klingModelFromEnv, type KlingModelKey } from '@/lib/kling/models';
import { SUNRA_TOPUP_FEE_MULTIPLIER } from '@/lib/sunra/fees';
import {
  MAGI2_MAX_REFERENCE_IMAGES,
  MAGI2_MAX_SECONDS,
  MAGI2_MIN_SECONDS,
  MAGI2_RATIOS,
  MAGI2_RESOLUTIONS,
  estimateMagi2Usd,
} from '@/lib/sunra/magi2';

/**
 * One view over the video model tables (ModelArk's lib/ark/models.ts, Kling's
 * lib/kling/models.ts, Sunra MAGI-2's lib/sunra/magi2.ts): which model a video ENGINE id renders on
 * for a runtime, what it can do, and what one task costs at list price. Everything that used to read
 * ModelArk's table directly (the resolution picker, the cost floor, the recipe rules, the admin
 * editor) reads this instead, so adding a video provider is a row here and an adapter — not a branch
 * in every caller.
 */

export type Magi2ModelKey = 'magi-2';
export type VideoModelKey = ArkModelKey | KlingModelKey | Magi2ModelKey;
export type VideoResolution = '480p' | '720p' | '1080p' | '4k';

export class UnknownVideoEngineError extends Error {
  constructor(readonly engine: string) {
    super(`unknown video engine: ${engine}`);
    this.name = 'UnknownVideoEngineError';
  }
}

export function isMagi2Model(model: unknown): model is Magi2ModelKey {
  return model === 'magi-2';
}

export function isVideoModelKey(value: unknown): value is VideoModelKey {
  return typeof value === 'string' && (isArkModelKey(value) || isKlingModelKey(value) || isMagi2Model(value));
}

export function isKlingModel(model: VideoModelKey): model is KlingModelKey {
  return isKlingModelKey(model);
}

/**
 * Which ModelArk model a Seedance engine id renders on for a runtime. Seedance 2.0 stops at 15
 * seconds per task, so a longer template moves to 2.5 (one task) — the rule `startVideoRender` applies.
 * A `null` engine resolves to the default (`seedance-2.0`); any other unknown id throws.
 */
export function arkModelForVideo(engine: string | null, seconds: number): { model: ArkModelKey; seconds: number } {
  if (engine !== null && engine !== 'seedance-2.0' && engine !== 'seedance-2.5') {
    throw new UnknownVideoEngineError(engine);
  }
  const wanted: ArkModelKey = engine === 'seedance-2.5' ? 'seedance-2.5' : 'seedance-2.0';
  const model: ArkModelKey = seconds > ARK_MODELS[wanted].maxDurationSeconds ? 'seedance-2.5' : wanted;
  const spec = ARK_MODELS[model];
  return { model, seconds: Math.min(spec.maxDurationSeconds, Math.max(spec.minDurationSeconds, Math.round(seconds))) };
}

/**
 * The model ANY video engine id renders on, and the whole seconds it will be asked for. `null`
 * resolves to Seedance 2.0 (the product default); `kling-omni` is whichever Kling model the
 * deployment configured; `magi-2` renders on `magi-2`. Unknown non-null ids throw.
 */
export function videoModelForEngine(engine: string | null, seconds: number, env?: Record<string, string | undefined>): { model: VideoModelKey; seconds: number } {
  if (engine === null || engine === 'seedance-2.0' || engine === 'seedance-2.5') {
    return arkModelForVideo(engine, seconds);
  }
  if (engine === 'kling-omni') {
    const model = klingModelFromEnv(env);
    return { model, seconds: clampKlingDuration(model, seconds) };
  }
  if (engine === 'magi-2') {
    return {
      model: 'magi-2',
      seconds: Math.min(MAGI2_MAX_SECONDS, Math.max(MAGI2_MIN_SECONDS, Math.round(seconds))),
    };
  }
  throw new UnknownVideoEngineError(engine);
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

const MAGI2_PRODUCT_ASPECTS = VIDEO_ASPECTS.filter((aspect) =>
  (MAGI2_RATIOS as readonly string[]).includes(aspect),
);

/** What a maker's step on this engine may ask for — the recipe rules and the editor read it. */
export function videoEngineSpec(engine: VideoEngineId, env?: Record<string, string | undefined>): VideoEngineSpec {
  if (engine === 'kling-omni') {
    const model = klingModelFromEnv(env);
    const spec = KLING_MODELS[model];
    return { model, label: spec.label, minDurationSeconds: spec.minDurationSeconds, maxDurationSeconds: spec.maxDurationSeconds, aspects: spec.aspects, resolutions: spec.resolutions, maxReferenceImages: spec.maxReferenceImages };
  }
  if (engine === 'magi-2') {
    return {
      model: 'magi-2',
      label: 'MAGI-2',
      minDurationSeconds: MAGI2_MIN_SECONDS,
      maxDurationSeconds: MAGI2_MAX_SECONDS,
      aspects: MAGI2_PRODUCT_ASPECTS,
      resolutions: [...MAGI2_RESOLUTIONS],
      maxReferenceImages: MAGI2_MAX_REFERENCE_IMAGES,
    };
  }
  if (engine === 'seedance-2.0' || engine === 'seedance-2.5') {
    const spec = ARK_MODELS[engine];
    // The engine's own range: a 2.0 step longer than 15 s is refused rather than silently moved to 2.5.
    return { model: engine, label: spec.label, minDurationSeconds: spec.minDurationSeconds, maxDurationSeconds: spec.maxDurationSeconds, aspects: null, resolutions: supportedResolutions(engine), maxReferenceImages: spec.maxReferenceAssets };
  }
  throw new UnknownVideoEngineError(String(engine));
}

export function videoResolutions(model: VideoModelKey): VideoResolution[] {
  if (isKlingModel(model)) return [...KLING_MODELS[model].resolutions];
  if (isMagi2Model(model)) return [...MAGI2_RESOLUTIONS];
  if (isArkModelKey(model)) return supportedResolutions(model);
  throw new UnknownVideoEngineError(String(model));
}

export interface VideoQuoteInput {
  model: VideoModelKey;
  resolution: '480p' | '720p' | '1080p';
  seconds: number;
  aspect: string;
}

/**
 * List price for one task. ModelArk is token-exact (pixels × 24 fps × seconds); Kling is a flat
 * per-second rate; MAGI-2 is $0.08/s × Sunra's 5% top-up fee (`1.05`). `null` when the model cannot
 * do the ask; throws `UnknownVideoEngineError` for unknown model keys.
 */
export function quoteVideo(input: VideoQuoteInput): { providerUsd: number; providerTokens: number | null } | null {
  if (isKlingModel(input.model)) {
    if (input.resolution === '480p') return null;
    const usd = estimateKlingUsd({ model: input.model, resolution: input.resolution, seconds: input.seconds });
    return usd === null ? null : { providerUsd: usd, providerTokens: null };
  }
  if (isMagi2Model(input.model)) {
    if (input.resolution !== '1080p') return null;
    if (!Number.isInteger(input.seconds) || input.seconds < MAGI2_MIN_SECONDS || input.seconds > MAGI2_MAX_SECONDS) {
      return null;
    }
    if (!(MAGI2_RATIOS as readonly string[]).includes(input.aspect)) return null;
    const providerUsd = Math.round(estimateMagi2Usd(input.seconds) * SUNRA_TOPUP_FEE_MULTIPLIER * 10_000) / 10_000;
    return { providerUsd, providerTokens: null };
  }
  if (isArkModelKey(input.model)) {
    const quote = quoteArkVideo({ model: input.model, resolution: input.resolution, seconds: input.seconds, aspect: input.aspect });
    return quote === null ? null : { providerUsd: quote.providerUsd, providerTokens: quote.providerTokens };
  }
  throw new UnknownVideoEngineError(String(input.model));
}

/** The model label beside a render button: "Seedance 2.5", "Kling 3.0 Omni", "MAGI-2". */
export function videoModelLabel(model: VideoModelKey): string {
  if (isKlingModel(model)) return KLING_MODELS[model].label;
  if (isMagi2Model(model)) return 'MAGI-2';
  if (isArkModelKey(model)) return ARK_MODELS[model].label;
  throw new UnknownVideoEngineError(String(model));
}
