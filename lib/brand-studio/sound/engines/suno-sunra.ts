/**
 * Suno v6 on Sunra's API lane (docs/BRAND-SOUND-STUDIO.md §3.1, founder decision 2026-11-20). Read from the
 * Sunra catalogue and its per-endpoint input schemas on 2026-11-20 (docs/research/brand-sound-studio-2026-11-20/
 * suno-via-sunra.md):
 *
 *   inspire-mode  { prompt ≤ 3,000, instrumental }                                  $0.10 a request
 *   custom-mode   { title ≤ 80, style ≤ 1,000, lyrics ≤ 5,000, instrumental, max_mode }  $0.10, Max Mode $0.20
 *
 * No length, language, tempo, key, seed or reference-audio input. Account lane: none (`mcp: null`), so the router
 * keeps it on the API lane.
 *
 * What the paid smoke test showed (2026-11-20, nine calls): a request returned two songs (never assumed: however
 * many come back are stored, the request is charged once, §3.4); `duration` and `lyrics` come back empty (lengths
 * are measured from the files, names are ours, the lyrics shown are the ones sent); a failed request also comes
 * back `COMPLETED` with `success: false` (../../provider/sunra-api.ts); the charge is `billing.amount`; files are
 * 48 kHz MP3 with a comment tag, stored as delivered. Short lyrics gave a 22 s song, instrumentals about 3.5 min.
 * The legacy `extend` failed and the engine-side `clip` never answered (19 minutes): neither is offered.
 */
import type { MusicEngine, MusicRequest } from '../engine';

const ALIAS = 'suno/suno-v6';
const LIMITS = { prompt: 3000, style: 1000, title: 80, lyrics: 5000 } as const;

class MusicRequestError extends Error {
  constructor(readonly reason: string) {
    super(`music request: ${reason}`);
    this.name = 'MusicRequestError';
  }
}

function clean(text: string | undefined, max: number, what: string): string {
  const value = (text ?? '').trim();
  if (value.length > max) throw new MusicRequestError(`${what} over ${max} characters`);
  return value;
}

/** Lyrics go as marked (../lyrics.ts `markLyrics`): never trimmed, so the customer's first and last lines keep their spaces. */
function asWritten(text: string | undefined, max: number): string {
  const value = text ?? '';
  if (!value.trim()) return '';
  if (value.length > max) throw new MusicRequestError(`lyrics over ${max} characters`);
  return value;
}

export function makeSunoEngine(id: string, modelId: 'suno-v6' | 'suno-v6-wild', alias: string): MusicEngine {
  return {
    id,
    model: { id: modelId, mcp: null },
    capabilities: {
      lengthInput: false,
      vocals: true,
      lyrics: true,
      careful: true,
      // The legacy extend failed on a v6 clip in the smoke test: the length tool is ours alone (SS4).
      extend: false,
      inpaint: false,
      stems: false,
      limits: LIMITS,
    },
    quoteUsd(request: MusicRequest): number {
      return request.mode === 'custom' && request.careful ? 0.2 : 0.1;
    },
    request(request: MusicRequest) {
      if (request.mode === 'describe') {
        const prompt = clean(request.prompt, LIMITS.prompt, 'prompt');
        if (!prompt) throw new MusicRequestError('empty prompt');
        return { endpoint: `${alias}/inspire-mode`, body: { prompt, instrumental: !request.vocal } };
      }
      const title = clean(request.title, LIMITS.title, 'title');
      const style = clean(request.prompt, LIMITS.style, 'style');
      if (!title || !style) throw new MusicRequestError('custom mode needs a title and a style');
      // Instrumental (with or without Max Mode): no lyrics are sent, whatever the request carried.
      const lyrics = request.vocal ? asWritten(request.lyrics, LIMITS.lyrics) : '';
      return {
        endpoint: `${alias}/custom-mode`,
        body: { title, style, lyrics, instrumental: !request.vocal, max_mode: request.careful === true },
      };
    },
  };
}

export const sunoV6Sunra: MusicEngine = makeSunoEngine('suno-v6-sunra', 'suno-v6', ALIAS);

export const sunoV6WildSunra: MusicEngine = makeSunoEngine('suno-v6-wild-sunra', 'suno-v6-wild', 'suno/suno-v6-wild');

export { MusicRequestError };
