'use client';

import { corsMediaUrl } from '@/lib/brand-studio/cors-media-url';
import { gatherBoxes, readTiming, type TimingAnswer } from '@/lib/brand-studio/editor-v2/container';
import { rangedSource } from '@/lib/brand-studio/editor-v2/ranged-source';

/**
 * Editing studio v2 — a clip's frame facts read from its own file (spec E addendum, C1): only the boxes
 * that hold its timing, fetched with Range requests (lib/brand-studio/editor-v2/ranged-source.ts), read by
 * lib/brand-studio/editor-v2/container.ts. Independent of the screen: a covered window reads it as fast
 * as a front one. The second editor file that makes a request (export-film.ts is the first); it asks only
 * for the clip's own address, the way the export reads the same file for its sound.
 */
export interface FootageRead {
  answer: TimingAnswer;
  /** How it went, for the checks: requests made, bytes received, whether the server honoured Range. */
  requests: number;
  received: number;
  mode: 'range' | 'whole' | null;
  ms: number;
}

const cache = new Map<string, Promise<FootageRead>>();

export function readFootage(srcUrl: string): Promise<FootageRead> {
  const hit = cache.get(srcUrl);
  if (hit) return hit;
  const started = performance.now();
  const source = rangedSource((start, end) =>
    fetch(corsMediaUrl(srcUrl), { headers: { Range: `bytes=${start}-${end}` }, credentials: 'same-origin' }),
  );
  const run = gatherBoxes(source)
    .then((found): TimingAnswer => ('failure' in found ? { ok: false, reason: found.failure } : readTiming(found)))
    .catch((): TimingAnswer => ({ ok: false, reason: 'broken' }))
    .then((answer) => {
      source.close();
      const { requests, received, mode } = source.stats();
      // Only a failure that may pass is asked again (`broken`: a refused request, a network error, a file
      // cut off); the file's own answers (not an MP4, an edit list the export cannot follow, too large …)
      // are remembered for the visit and not fetched again (review round 2 of part E).
      if (!answer.ok && answer.reason === 'broken') cache.delete(srcUrl);
      return { answer, requests, received, mode, ms: Math.round(performance.now() - started) };
    });
  cache.set(srcUrl, run);
  return run;
}
