'use client';

import { corsMediaUrl } from '@/lib/brand-studio/cors-media-url';
import { ByteLimit, ReadLimit, gatherBoxes, readTiming, type TimingAnswer } from '@/lib/brand-studio/editor-v2/container';
import { rangedSource, readFailureOf } from '@/lib/brand-studio/editor-v2/ranged-source';
import { gatherIndexBoxes, readSampleIndex, type IndexAnswer } from '@/lib/brand-studio/editor-v2/sample-index';

export { FRAGMENTED_INDEX_REQUESTS } from '@/lib/brand-studio/editor-v2/sample-index';

/**
 * Editing studio v2 — a clip's frame facts read from its own file (spec E addendum, C1): only the boxes
 * that hold its timing, fetched with Range requests (lib/brand-studio/editor-v2/ranged-source.ts), read by
 * lib/brand-studio/editor-v2/container.ts. Independent of the screen: a covered window reads it as fast
 * as a front one. The second editor file that makes a request (export-film.ts is the first); it asks only
 * for the clip's own address, the way the export reads the same file for its sound.
 *
 * For the export's decoder path (spec F) it also reads the picture track's sample index
 * (`readPictureIndex`, lib/brand-studio/editor-v2/sample-index.ts) and, through `footageBytes`, the byte
 * ranges that hold the pictures (lib/brand-studio/editor-v2/sample-bytes.ts): the same one request, for the
 * same address.
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
/** Files whose last read answered that they are not there (404 / 410, audit A4). */
const gone = new Set<string>();

/**
 * Whether the clip's file answered, the last time it was read, that it is not there (404 / 410): its cut
 * gets "the file cannot be found" instead of "the frame rate has not been read yet" (audit A4).
 */
export function footageGone(srcUrl: string): boolean {
  return gone.has(srcUrl);
}

/**
 * Asks the clip's own file for bytes `start` to `end` (inclusive). The one request this file makes. `signal`
 * (the export's run reads, spec G B1) aborts it.
 */
export function footageBytes(srcUrl: string) {
  return (start: number, end: number, signal?: AbortSignal) => fetch(corsMediaUrl(srcUrl), { headers: { Range: `bytes=${start}-${end}` }, credentials: 'same-origin', signal });
}

export function readFootage(srcUrl: string): Promise<FootageRead> {
  const hit = cache.get(srcUrl);
  if (hit) return hit;
  const started = performance.now();
  const source = rangedSource(footageBytes(srcUrl));
  const run = gatherBoxes(source)
    .then((found): TimingAnswer => ('failure' in found ? { ok: false, reason: found.failure } : readTiming(found)))
    .catch((error: unknown): TimingAnswer => ({ ok: false, reason: readFailureOf(error) }))
    .then((answer) => {
      source.close();
      const { requests, received, mode } = source.stats();
      // Only a failure that may pass is asked again (`broken`: a refused request, a network error, a file
      // cut off; `gone`: an asset that may come back); the file's own answers (not an MP4, an edit list the
      // export cannot follow, too large …) are remembered for the visit and not fetched again (review
      // round 2 of part E).
      if (!answer.ok && (answer.reason === 'broken' || answer.reason === 'gone')) cache.delete(srcUrl);
      if (!answer.ok && answer.reason === 'gone') gone.add(srcUrl);
      else gone.delete(srcUrl);
      return { answer, requests, received, mode, ms: Math.round(performance.now() - started) };
    });
  cache.set(srcUrl, run);
  return run;
}

/**
 * The most top-level boxes walked for a picture index (a fragmented file has two per fragment): with fragments
 * smaller than a read, several fit one request and this is what ends the walk; otherwise the request budget does
 * (sample-index.ts `FRAGMENTED_INDEX_REQUESTS`). Past either the source is taken by seeking.
 */
const INDEX_MAX_BOXES = 2000;

export type IndexRead = IndexAnswer & { requests: number; received: number };

const indexCache = new Map<string, Promise<IndexRead>>();

/**
 * The picture track's sample index (spec F, F1), read by range. The file's own answers are kept for the visit,
 * failures included (spec G, B9: not an MP4, broken boxes, a codec or layout the index does not take, past its
 * request or byte budget): they would come out the same again. A failure that may pass (a refused request, a
 * network error) is `network` and read again next time; within one export it is read once
 * (`exportIndexReads`).
 */
export function readPictureIndex(srcUrl: string): Promise<IndexRead> {
  const hit = indexCache.get(srcUrl);
  if (hit) return hit;
  const source = rangedSource(footageBytes(srcUrl));
  const run = gatherIndexBoxes(source, INDEX_MAX_BOXES)
    .then((found): IndexAnswer => ('failure' in found ? { ok: false, reason: 'unreadable' } : readSampleIndex(found)))
    .catch((error: unknown): IndexAnswer => (error instanceof ReadLimit || error instanceof ByteLimit ? { ok: false, reason: 'unreadable' } : { ok: false, reason: 'network' }))
    .then((answer) => {
      source.close();
      const { requests, received } = source.stats();
      if (!answer.ok && answer.reason === 'network') indexCache.delete(srcUrl);
      return { ...answer, requests, received };
    });
  indexCache.set(srcUrl, run);
  return run;
}

/** The picture index as one export reads it: every answer, a network failure too, once per file (spec G, B9). */
export function exportIndexReads(): (srcUrl: string) => Promise<IndexRead> {
  const seen = new Map<string, Promise<IndexRead>>();
  return (srcUrl) => {
    let read = seen.get(srcUrl);
    if (!read) {
      read = readPictureIndex(srcUrl);
      seen.set(srcUrl, read);
    }
    return read;
  };
}
