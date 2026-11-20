/**
 * Suno v6 on Sunra's API lane (docs/BRAND-SOUND-STUDIO.md §3.1, founder decision 2026-11-20). Read from the
 * Sunra catalogue and its per-endpoint input schemas on 2026-11-20 (docs/research/brand-sound-studio-2026-11-20/
 * suno-via-sunra.md):
 *
 *   inspire-mode  { prompt ≤ 3,000, instrumental }                                  $0.10 a request
 *   custom-mode   { title ≤ 80, style ≤ 1,000, lyrics ≤ 5,000, instrumental, max_mode }  $0.10, Max Mode $0.20
 *
 * No length, language, tempo, key, seed or reference-audio input. How many clips one request returns is not
 * written down (the paid smoke test counts it); the studio stores however many come back and charges the
 * request once (§3.4). Account lane: none (`mcp: null`), so the router keeps it on the API lane.
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

export const sunoV6Sunra: MusicEngine = {
  id: 'suno-v6-sunra',
  model: { id: 'suno-v6', mcp: null },
  capabilities: {
    lengthInput: false,
    vocals: true,
    lyrics: true,
    careful: true,
    // The extend endpoint exists only under the legacy v5.5 name and is unconfirmed for v6 clips (§3.1).
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
      return { endpoint: `${ALIAS}/inspire-mode`, body: { prompt, instrumental: !request.vocal } };
    }
    const title = clean(request.title, LIMITS.title, 'title');
    const style = clean(request.prompt, LIMITS.style, 'style');
    if (!title || !style) throw new MusicRequestError('custom mode needs a title and a style');
    // Instrumental (with or without Max Mode): no lyrics are sent, whatever the request carried.
    const lyrics = request.vocal ? clean(request.lyrics, LIMITS.lyrics, 'lyrics') : '';
    return {
      endpoint: `${ALIAS}/custom-mode`,
      body: { title, style, lyrics, instrumental: !request.vocal, max_mode: request.careful === true },
    };
  },
};

export { MusicRequestError };
