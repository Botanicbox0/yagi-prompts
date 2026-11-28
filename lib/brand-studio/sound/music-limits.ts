/**
 * Music limits and the quote a screen shows (docs/BRAND-SOUND-STUDIO.md §3.4, §7.4). Client-safe: the composer
 * reads the same numbers the server reserves with (./music-jobs.ts), so the figure on the button is the charge.
 */
import { creditsOf } from '../credits';
import { usageKrw } from '../usage-rate';
import { musicEngine, musicEngineOfModel, type MusicEngine, type MusicModelId, type MusicRequest } from './engine';

/** Our own limits, under the engine's (§7.4). */
export const MUSIC_LIMITS = { promptMax: 1000, titleMax: 80 } as const;

/** The quote in won for one request (one press), from the engine's price and the studio's usage rule. */
export function musicQuoteKrw(request: Pick<MusicRequest, 'mode' | 'careful'>, engine: MusicEngine = musicEngine({})): number {
  return usageKrw(engine.quoteUsd({ mode: request.mode, careful: request.careful, prompt: '', vocal: false }), 'audio');
}

/** The same quote in credits (what the button says). */
export function musicQuoteCredits(request: Pick<MusicRequest, 'mode' | 'careful'>, engine?: MusicEngine): number {
  return creditsOf(musicQuoteKrw(request, engine));
}

/** The quote in won for a chosen music model (`MusicModelId`); throws on an unknown model id. */
export function musicQuoteForModel(modelId: MusicModelId, request: Pick<MusicRequest, 'mode' | 'careful'>): number {
  const engine = musicEngineOfModel(modelId);
  if (!engine) throw new Error(`unknown music model: ${String(modelId)}`);
  return musicQuoteKrw(request, engine);
}
