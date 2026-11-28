/**
 * MiniMax Music 3.0 on Sunra's API lane (`minimax/minimax-music3/text-to-music`).
 *
 * Schema (`oapi-minimax_minimax-music3.json`):
 *   text-to-music  { prompt: 1..2000, duration: int 1..75 (default 60), is_instrumental, lyrics?: 1..3500 }  $0.16 a song
 *
 * One 44.1 kHz 16-bit stereo WAV per request, flat $0.16 regardless of duration. Account lane: none (`mcp: null`).
 * Instrumental requests omit `lyrics` (`is_instrumental: true`); vocal requests require non-blank `lyrics`
 * (`is_instrumental: false`). Max Mode (`careful`), `seed`, `num_inference_steps` and `guidance_scale` are not sent.
 *
 * Client-safe: no env, no db, no fetch.
 */
import type { MusicEngine, MusicRequest } from '../engine';
import { MusicRequestError } from './suno-sunra';

const ENDPOINT = 'minimax/minimax-music3/text-to-music';
const DURATION_RANGE = { min: 1, max: 75 } as const;
const DEFAULT_DURATION_SECONDS = 60;
const LIMITS = { prompt: 2000, style: 2000, title: 80, lyrics: 3500 } as const;

export const minimaxMusic3Sunra: MusicEngine = {
  id: 'minimax-music3-sunra',
  model: { id: 'minimax-music-3', mcp: null },
  capabilities: {
    lengthInput: DURATION_RANGE,
    vocals: true,
    lyrics: true,
    careful: false,
    extend: false,
    inpaint: false,
    stems: false,
    limits: LIMITS,
  },
  quoteUsd(): number {
    return 0.16;
  },
  request(request: MusicRequest) {
    if (request.careful) throw new MusicRequestError('careful mode is not supported on MiniMax Music 3.0');
    const prompt = (request.prompt ?? '').trim();
    if (!prompt) throw new MusicRequestError('empty prompt');
    if (prompt.length > LIMITS.prompt) throw new MusicRequestError(`prompt over ${LIMITS.prompt} characters`);

    const rawDuration = request.durationSeconds === undefined ? DEFAULT_DURATION_SECONDS : request.durationSeconds;
    if (!Number.isFinite(rawDuration)) throw new MusicRequestError('invalid duration');
    const duration = Math.min(DURATION_RANGE.max, Math.max(DURATION_RANGE.min, Math.round(rawDuration)));

    if (!request.vocal) {
      return {
        endpoint: ENDPOINT,
        body: { prompt, duration, is_instrumental: true },
      };
    }

    const lyrics = request.lyrics ?? '';
    if (!/\S/.test(lyrics)) throw new MusicRequestError('vocal mode needs lyrics');
    if (lyrics.length > LIMITS.lyrics) throw new MusicRequestError(`lyrics over ${LIMITS.lyrics} characters`);

    return {
      endpoint: ENDPOINT,
      body: { prompt, lyrics, duration, is_instrumental: false },
    };
  },
};

export { MusicRequestError };
