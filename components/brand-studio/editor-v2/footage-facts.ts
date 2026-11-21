'use client';

import { corsMediaUrl } from '@/lib/brand-studio/cors-media-url';
import { gatherBoxes, readTiming, type FoundBoxes, type TimingAnswer } from '@/lib/brand-studio/editor-v2/container';
import { rangedSource, type RangeRequest } from '@/lib/brand-studio/editor-v2/ranged-source';

/**
 * Editing studio v2 — a clip's own file, read in pieces (spec E addendum, C1; spec F, F2): only the boxes
 * that hold its timing, fetched with Range requests (lib/brand-studio/editor-v2/ranged-source.ts), read by
 * lib/brand-studio/editor-v2/container.ts; and, for the export's decoder path, the byte ranges that hold the
 * pictures it needs (lib/brand-studio/editor-v2/sample-bytes.ts). Independent of the screen: a covered
 * window reads it as fast as a front one. The second editor file that makes a request (export-film.ts is
 * the first); it asks only for the clip's own address, the way the export reads the same file for its sound.
 */
export interface FootageRead {
  answer: TimingAnswer;
  /** The boxes read (the export's decoder path indexes the samples from them); `null` when none were. */
  found: FoundBoxes | null;
  /** How it went, for the checks: requests made, bytes received, whether the server honoured Range. */
  requests: number;
  received: number;
  mode: 'range' | 'whole' | null;
  ms: number;
}

const cache = new Map<string, Promise<FootageRead>>();

/** Asks the clip's own file for bytes `start` to `end` (inclusive). The one request this file makes. */
export function footageBytes(srcUrl: string): RangeRequest {
  return (start, end) => fetch(corsMediaUrl(srcUrl), { headers: { Range: `bytes=${start}-${end}` }, credentials: 'same-origin' });
}

export function readFootage(srcUrl: string): Promise<FootageRead> {
  const hit = cache.get(srcUrl);
  if (hit) return hit;
  const started = performance.now();
  const source = rangedSource(footageBytes(srcUrl));
  let found: FoundBoxes | null = null;
  const run = gatherBoxes(source)
    .then((boxes): TimingAnswer => {
      if ('failure' in boxes) return { ok: false, reason: boxes.failure };
      found = boxes;
      return readTiming(boxes);
    })
    .catch((): TimingAnswer => ({ ok: false, reason: 'broken' }))
    .then((answer) => {
      source.close();
      const { requests, received, mode } = source.stats();
      // A file that could not be read is asked again on the next visit (a passing network fault).
      if (!answer.ok) cache.delete(srcUrl);
      return { answer, found, requests, received, mode, ms: Math.round(performance.now() - started) };
    });
  cache.set(srcUrl, run);
  return run;
}
