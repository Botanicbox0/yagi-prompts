/**
 * Which text model writes lyrics (docs/BRAND-SOUND-STUDIO.md §12.3, §8-10). Not decided yet: the founder is reading
 * the blind comparison of five Gemini-family models. So the model is one server setting, checked against the five
 * that were compared, and every music run records which model wrote its lyrics (`params.music.lyricsBy`), so the
 * choice can change without a code change and old runs still say what they were made with.
 *
 * Default: `gemini-4-argon`, the doc's answer for "if it has to be decided now" (§8-10: steadiest in the blind read,
 * five firsts and one last). A value outside the list is ignored (the default is used) rather than sent anywhere.
 */
import { studioGeminiConfig, type GeminiConfig } from '../enhancer/gemini';

export const LYRICS_MODELS = ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-4-neon'] as const;
export type LyricsModel = (typeof LYRICS_MODELS)[number];
export const LYRICS_DEFAULT_MODEL: LyricsModel = 'gemini-4-argon';
export const LYRICS_MODEL_ENV = 'BRAND_SOUND_LYRICS_MODEL';

export function isLyricsModel(value: unknown): value is LyricsModel {
  return typeof value === 'string' && (LYRICS_MODELS as readonly string[]).includes(value);
}

/** The model this environment writes lyrics with. */
export function lyricsModelOf(env: Record<string, string | undefined>): LyricsModel {
  const picked = env[LYRICS_MODEL_ENV]?.trim();
  return isLyricsModel(picked) ? picked : LYRICS_DEFAULT_MODEL;
}

/** The studio's Gemini key and base URL with the lyrics model; null when no key is set. */
export function lyricsGeminiConfig(env: Record<string, string | undefined>): GeminiConfig | null {
  const base = studioGeminiConfig(env);
  return base ? { ...base, model: lyricsModelOf(env) } : null;
}
