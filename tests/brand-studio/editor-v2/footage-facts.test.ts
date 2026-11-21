import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { containerStats, gatherBoxes, readTiming, timingOfFile } from '@/lib/brand-studio/editor-v2/container';
import { measuredFromTiming } from '@/lib/brand-studio/editor-v2/fps';
import { MAX_RANGE_REQUESTS, MAX_WHOLE_BYTES, RANGE_CHUNK, RangeRefused, rangedSource, type RangeAnswer } from '@/lib/brand-studio/editor-v2/ranged-source';
import { mapLimit } from '@/lib/brand-studio/editor-v2/fps';
import { box, concat, ftyp, mdat, moof, moov, type TrackSpec } from './mp4-bytes';

/**
 * Spec E addendum, C1: a clip's frame facts come from its own file, read with Range requests for the
 * boxes that hold them only. Production found clips added in a covered window never got a rate (measuring
 * by playback needs the screen); reading boxes does not.
 */
const VIDEO: TrackSpec = { handler: 'vide', timescale: 12288, durations: Array.from({ length: 240 }, () => 512) };
const TAIL_MOOV = concat(ftyp(), mdat(3_000_000), moov({ tracks: [VIDEO] }));

/** A server over `bytes`: `ranges` answers 206 (or 416 past the end), otherwise the whole file with 200. */
function server(bytes: Uint8Array, ranges: boolean) {
  const asked: Array<[number, number]> = [];
  let streamed = 0;
  let cancelled = false;
  const request = async (start: number, end: number): Promise<RangeAnswer> => {
    asked.push([start, end]);
    if (ranges) {
      if (start >= bytes.length) return new Response(null, { status: 416 });
      const last = Math.min(bytes.length, end + 1) - 1;
      return new Response(bytes.slice(start, last + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${last}/${bytes.length}` } });
    }
    const chunk = 16 * 1024;
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= bytes.length) return controller.close();
        const part = bytes.slice(at, at + chunk);
        at += part.length;
        streamed += part.length;
        controller.enqueue(part);
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(body, { status: 200 });
  };
  return { request, asked, streamed: () => streamed, cancelled: () => cancelled };
}

describe('reading only the boxes, through Range requests', () => {
  it('moov at the end: two requests, a few KB, the same answer as the whole file', async () => {
    const host = server(TAIL_MOOV, true);
    const source = rangedSource(host.request);
    const found = await gatherBoxes(source);
    if ('failure' in found) throw new Error(found.failure);
    expect(readTiming(found)).toEqual(await timingOfFile(TAIL_MOOV));
    expect(host.asked).toHaveLength(2);
    expect(source.stats().received).toBeLessThan(80 * 1024);
    expect(source.stats().mode).toBe('range');
  });

  it('a server that ignores Range (200, the whole file): read only until the moov is complete, then stopped', async () => {
    const head = concat(ftyp(), moov({ tracks: [VIDEO] }));
    const bytes = concat(head, mdat(3_000_000));
    const host = server(bytes, false);
    const source = rangedSource(host.request);
    const found = await gatherBoxes(source);
    if ('failure' in found) throw new Error(found.failure);
    source.close();
    expect(readTiming(found).ok).toBe(true);
    expect(source.stats().mode).toBe('whole');
    expect(host.streamed()).toBeLessThan(64 * 1024);
    expect(host.cancelled()).toBe(true);
  });

  it('a server that refuses (403) is an error the caller turns into "could not read"', async () => {
    const source = rangedSource(async () => new Response(null, { status: 403 }));
    await expect(source.read(0, 16)).rejects.toBeInstanceOf(RangeRefused);
  });

  it('past the end (416) reads as the end of the file', async () => {
    const host = server(concat(ftyp(), moov({ tracks: [VIDEO] })), true);
    const source = rangedSource(host.request, 8);
    expect((await source.read(10_000_000, 16)).length).toBe(0);
  });

  it('review round 2: a server that sends the whole file is read no further than the byte ceiling (64 MiB)', async () => {
    expect(MAX_WHOLE_BYTES).toBe(64 * 1024 * 1024);
    // The moov sits after 3 MB of media; with a 1 MiB ceiling the reader stops, cancels and fails.
    const host = server(TAIL_MOOV, false);
    const source = rangedSource(host.request, RANGE_CHUNK, 1024 * 1024);
    expect(await gatherBoxes(source)).toEqual({ failure: 'too-large' });
    expect(host.streamed()).toBeLessThanOrEqual(1024 * 1024 + 16 * 1024);
    expect(host.cancelled()).toBe(true);
    // Under the ceiling the same server is read as before.
    expect('failure' in (await gatherBoxes(rangedSource(server(TAIL_MOOV, false).request, RANGE_CHUNK, 4 * 1024 * 1024)))).toBe(false);
  });

  it('review round 2: a 206 for another range than the one asked for is refused; one that does not show its range is read', async () => {
    const bytes = concat(ftyp(), moov({ tracks: [VIDEO] }));
    const elsewhere = rangedSource(async (start, end) => new Response(bytes.slice(start + 100, end + 101), { status: 206, headers: { 'Content-Range': `bytes ${start + 100}-${end + 100}/${bytes.length}` } }));
    await expect(elsewhere.read(0, 16)).rejects.toBeInstanceOf(RangeRefused);
    // A media domain that does not expose Content-Range to the page: the bytes are taken as asked.
    const hidden = rangedSource(async (start, end) => new Response(bytes.slice(start, end + 1), { status: 206 }));
    const found = await gatherBoxes(hidden);
    expect('failure' in found).toBe(false);
  });
});

describe('review round 2: a file that cannot be read for good is not fetched again in the same visit', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());
  const text = new TextEncoder().encode('not a video at all, just some words to fill sixty-four bytes long');

  it('not an MP4 (and the other permanent answers): one fetch, remembered', async () => {
    const fetch = vi.fn(async (_url: string, init: { headers: { Range: string } }) => {
      const [start, end] = init.headers.Range.slice(6).split('-').map(Number) as [number, number];
      return new Response(text.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${Math.min(end, text.length - 1)}/${text.length}` } });
    });
    vi.stubGlobal('fetch', fetch);
    const { readFootage } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect((await readFootage('/media/a.webm')).answer).toEqual({ ok: false, reason: 'not-mp4' });
    expect((await readFootage('/media/a.webm')).answer).toEqual({ ok: false, reason: 'not-mp4' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a refused request or a network error may pass: asked again', async () => {
    const refused = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', refused);
    const { readFootage } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect((await readFootage('/media/b.mp4')).answer).toEqual({ ok: false, reason: 'broken' });
    await readFootage('/media/b.mp4');
    expect(refused).toHaveBeenCalledTimes(2);
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', offline);
    await readFootage('/media/c.mp4');
    await readFootage('/media/c.mp4');
    expect(offline).toHaveBeenCalledTimes(2);
  });
});

describe('the frame facts the editor keeps', () => {
  it('a readable file gives rate, frame count and spacing; nothing measured by playback', async () => {
    expect(measuredFromTiming(await timingOfFile(TAIL_MOOV))).toEqual({ fps: 24, frames: 240, counted: true });
  });

  it('variable spacing is kept as a fact', async () => {
    const uneven = concat(ftyp(), moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [...Array(20).fill(512), ...Array(20).fill(410), 512] }] }));
    expect(measuredFromTiming(await timingOfFile(uneven))).toMatchObject({ variable: true });
  });

  it('a file that cannot be read, or has no picture: measured by playback instead', async () => {
    expect(measuredFromTiming({ ok: false, reason: 'not-mp4' })).toBeNull();
    expect(measuredFromTiming(await timingOfFile(concat(ftyp(), moov({ tracks: [{ handler: 'soun', timescale: 48000, durations: [1024, 1024] }] }))))).toBeNull();
  });
});

describe('measureSource reads the file first (a covered window cannot measure by playback)', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/components/brand-studio/editor-v2/footage-facts');
  });

  it('a readable file: its facts, and no video element is made', async () => {
    const created: string[] = [];
    vi.stubGlobal('document', { visibilityState: 'visible', createElement: (tag: string) => (created.push(tag), {}) });
    vi.stubGlobal('performance', { now: () => 0 });
    const answer = await timingOfFile(TAIL_MOOV);
    vi.doMock('@/components/brand-studio/editor-v2/footage-facts', () => ({ readFootage: async () => ({ answer, requests: 2, received: 70_000, mode: 'range', ms: 3 }) }));
    const { measureSource } = await import('@/components/brand-studio/editor-v2/measure-fps');
    expect(await measureSource('/clip.mp4', 10)).toEqual({ fps: 24, frames: 240, counted: true });
    expect(created).toEqual([]);
  });
});

describe('only these files make requests, each only for the film’s own media', () => {
  const dir = join(process.cwd(), 'components/brand-studio/editor-v2');
  it('footage-facts asks for the clip’s own address with a Range header, cookies on this site only', () => {
    const source = readFileSync(join(dir, 'footage-facts.ts'), 'utf8');
    expect(source.match(/\bfetch\(/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/fetch\(corsMediaUrl\(srcUrl\), \{ headers: \{ Range: `bytes=\$\{start\}-\$\{end\}` \}, credentials: 'same-origin' \}\)/);
    for (const banned of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', "method: 'POST'"]) expect(source.includes(banned), banned).toBe(false);
  });
});

describe('the playback fallback counts the last picture it is shown (review round 1 of part E, item 4)', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/components/brand-studio/editor-v2/footage-facts');
    vi.doUnmock('@/components/brand-studio/editor-v2/screen-refresh');
  });

  /**
   * A fake video of 97 pictures at 24 fps in a container that runs to 4.308 s (its sound is longer), the
   * WebM the real-screen check uses. Playing reports frames k/24; a seek reports the picture shown there.
   * `endedOnSeek`: fire `ended` before `seeked` when a seek reaches the end (the order the review feared;
   * Chromium measured: no `ended` at all for a paused seek to the end, see measure-fps.ts).
   */
  function fakeVideo(
    endedOnSeek: boolean,
    clock: (sec: number) => number = (sec) => sec,
    options: { duration?: number; pictures?: number; played?: readonly number[]; endsShown?: boolean } = {},
  ) {
    const { duration = 4.308, pictures = 97, played = Array.from({ length: 13 }, (_, k) => k), endsShown = true } = options;
    const listeners = new Map<string, Array<() => void>>();
    let callbacks: Array<(now: number, meta: { mediaTime: number }) => void> = [];
    let time = 0;
    const fire = (name: string) => {
      const list = listeners.get(name) ?? [];
      listeners.set(name, []);
      for (const run of list) run();
    };
    const present = (mediaTime: number) => {
      const due = callbacks;
      callbacks = [];
      for (const callback of due) callback(0, { mediaTime });
    };
    const video = {
      style: {},
      duration,
      muted: false,
      playsInline: false,
      preload: '',
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
      load: () => undefined,
      remove: () => undefined,
      pause: () => undefined,
      requestVideoFrameCallback(callback: (now: number, meta: { mediaTime: number }) => void) {
        callbacks.push(callback);
        return callbacks.length;
      },
      addEventListener(name: string, run: () => void) {
        listeners.set(name, [...(listeners.get(name) ?? []), run]);
      },
      async play() {
        for (const k of played) {
          await Promise.resolve();
          present(clock(k / 24));
        }
      },
      set currentTime(at: number) {
        time = at;
        // A seek whose picture never comes (the ends cannot be read): nothing at all.
        if (!endsShown) return;
        queueMicrotask(() => {
          const shown = Math.min(pictures - 1, Math.floor(at * 24 + 1e-9)) / 24;
          if (endedOnSeek && at >= duration - 1e-9) fire('ended');
          fire('seeked');
          present(clock(shown));
        });
      },
      get currentTime() {
        return time;
      },
      set src(_url: string) {
        queueMicrotask(() => fire('loadeddata'));
      },
    };
    return video;
  }

  it.each([false, true])('a 97-picture file whose container runs to 4.308 s counts 97 (ended before seeked: %s)', async (endedOnSeek) => {
    vi.stubGlobal('document', { visibilityState: 'visible', hidden: false, createElement: () => fakeVideo(endedOnSeek), body: { appendChild: () => undefined }, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal('performance', { now: () => 0 });
    vi.stubGlobal('window', { requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined, setInterval: () => 1, clearInterval: () => undefined });
    vi.doMock('@/components/brand-studio/editor-v2/footage-facts', () => ({ readFootage: async () => ({ answer: { ok: false, reason: 'not-mp4' }, requests: 1, received: 16, mode: 'range', ms: 1 }) }));
    const { measureSource } = await import('@/components/brand-studio/editor-v2/measure-fps');
    expect(await measureSource('/clip.webm', 4.308)).toEqual({ fps: 24, frames: 97 });
  });

  it('times kept to the millisecond (a WebM: 0, 42, 83 ms …) and a view that says 10 s: 24 fps, 97 pictures', async () => {
    const ms = (sec: number) => Math.round(sec * 1000) / 1000;
    vi.stubGlobal('document', { visibilityState: 'visible', hidden: false, createElement: () => fakeVideo(false, ms), body: { appendChild: () => undefined }, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal('performance', { now: () => 0 });
    vi.stubGlobal('window', { requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined, setInterval: () => 1, clearInterval: () => undefined });
    vi.doMock('@/components/brand-studio/editor-v2/footage-facts', () => ({ readFootage: async () => ({ answer: { ok: false, reason: 'not-mp4' }, requests: 1, received: 16, mode: 'range', ms: 1 }) }));
    const { measureSource } = await import('@/components/brand-studio/editor-v2/measure-fps');
    expect(await measureSource('/clip.webm', 10)).toEqual({ fps: 24, frames: 97 });
  });

  it('review round 2, N1: a 97-picture WebM of 4.042 s with a picture skipped in the window is 97 at 24, not 96 at 23.75', async () => {
    const ms = (sec: number) => Math.round(sec * 1000) / 1000;
    // Fourteen pictures played, the seventh not presented: thirteen steps over 542 ms read as 23.976 alone.
    const played = Array.from({ length: 14 }, (_, k) => k).filter((k) => k !== 6);
    vi.stubGlobal('document', { visibilityState: 'visible', hidden: false, createElement: () => fakeVideo(false, ms, { duration: 4.042, played }), body: { appendChild: () => undefined }, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal('performance', { now: () => 0 });
    vi.stubGlobal('window', { requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined, setInterval: () => 1, clearInterval: () => undefined });
    vi.doMock('@/components/brand-studio/editor-v2/footage-facts', () => ({ readFootage: async () => ({ answer: { ok: false, reason: 'not-mp4' }, requests: 1, received: 16, mode: 'range', ms: 1 }) }));
    const { measureSource } = await import('@/components/brand-studio/editor-v2/measure-fps');
    expect(await measureSource('/clip.webm', 4.042)).toEqual({ fps: 24, frames: 97 });
  });

  it('review round 2, item 4: the ends cannot be read, so nothing is known yet: null, nothing stored, measured again next visit', async () => {
    let made = 0;
    let readable = false;
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      hidden: false,
      createElement: () => (made++, fakeVideo(false, (sec) => sec, { endsShown: readable })),
      body: { appendChild: () => undefined },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal('performance', { now: () => 0 });
    // Each try's time limit runs out at once (a macrotask: after the dozen frames, during the ends).
    vi.doMock('@/components/brand-studio/editor-v2/screen-refresh', () => ({
      refreshReduced: () => false,
      screenTimer: (_limit: number, expire: () => void) => {
        const id = setTimeout(expire, 0);
        return () => clearTimeout(id);
      },
    }));
    vi.doMock('@/components/brand-studio/editor-v2/footage-facts', () => ({ readFootage: async () => ({ answer: { ok: false, reason: 'not-mp4' }, requests: 1, received: 16, mode: 'range', ms: 1 }) }));
    const first = await import('@/components/brand-studio/editor-v2/measure-fps');
    // Never the length rule's 103 (the container runs to 4.308 s) or 240 (a view that says 10 s).
    expect(await first.measureSource('/clip.webm', 10)).toBeNull();
    expect(made).toBe(2); // a first try and one longer try
    // Nothing frame-based is stored for it: the clip is one whose rate is not known.
    const { fromStored, toStored } = await import('@/lib/brand-studio/editor-v2/stored');
    const clip = { id: 'c', label: 'c', sourceKind: 'asset', assetId: 'a', srcUrl: '/clip.webm', thumbUrl: null, durationSec: 10, trimStartSec: 0, trimEndSec: 4, volume: 1, muted: false } as const;
    const project = { version: 1 as const, aspect: '9:16' as const, clips: [clip], captions: [], bgm: null };
    const film = fromStored(project, { '/clip.webm': null });
    expect(film.rateUnknown).toEqual(['c']);
    expect(toStored(film.sequence, project, { unmeasuredSources: ['/clip.webm'] }).clips[0]).not.toHaveProperty('frameV2');
    // The same visit does not try again; the next one does, and this time the ends can be read.
    expect(await first.measureSource('/clip.webm', 10)).toBeNull();
    expect(made).toBe(2);
    vi.resetModules();
    readable = true;
    const next = await import('@/components/brand-studio/editor-v2/measure-fps');
    expect(await next.measureSource('/clip.webm', 10)).toEqual({ fps: 24, frames: 97 });
    expect(made).toBe(3);
  });
});

describe('a ceiling on requests and on memory (review round 1 of part E, item 10)', () => {
  const fragmented = (fragments: number, mdatBytes: number) => {
    const movie = moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [] }], fragmented: { defaultDuration: { 1: 512 } } });
    const parts = [ftyp('iso5'), movie];
    for (let f = 0; f < fragments; f += 1) parts.push(moof(f + 1, [{ trackId: 1, base: f * 24 * 512, count: 24 }]), mdat(mdatBytes));
    return concat(...parts);
  };
  const count = async (bytes: Uint8Array) => {
    const host = server(bytes, true);
    const found = await gatherBoxes(rangedSource(host.request)).catch((error: unknown) => ({ failure: String(error) }));
    return { found, requests: host.asked.length };
  };

  it('an ordinary file: moov first in at most 2 requests, moov at the end in at most 3', async () => {
    expect((await count(concat(ftyp(), moov({ tracks: [VIDEO] }), mdat(3_000_000)))).requests).toBeLessThanOrEqual(2);
    expect((await count(TAIL_MOOV)).requests).toBeLessThanOrEqual(3);
  });

  it('a small fragmented file: the rest in one request, walked in memory (at most 3 in all)', async () => {
    const bytes = fragmented(40, 50_000);
    const { found, requests } = await count(bytes);
    expect(requests).toBeLessThanOrEqual(3);
    if ('failure' in found) throw new Error(String(found.failure));
    const answer = readTiming(found);
    expect(answer.ok && answer.timing.video!.frames).toBe(40 * 24);
  });

  it('a fragmented file over 64 MiB is not walked over the network: it fails after at most 2 requests (measured by playback instead)', async () => {
    const head = concat(ftyp('iso5'), moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [] }], fragmented: { defaultDuration: { 1: 512 } } }));
    const total = 100 * 1024 * 1024;
    const asked: Array<[number, number]> = [];
    const request = async (start: number, end: number): Promise<RangeAnswer> => {
      asked.push([start, end]);
      const last = Math.min(total, end + 1) - 1;
      const body = new Uint8Array(Math.min(last - start + 1, 128 * 1024));
      if (start < head.length) body.set(head.subarray(start, Math.min(head.length, start + body.length)));
      return new Response(body, { status: 206, headers: { 'Content-Range': `bytes ${start}-${start + body.length - 1}/${total}` } });
    };
    const found = await gatherBoxes(rangedSource(request));
    expect(found).toEqual({ failure: 'fragmented-too-large' });
    expect(asked.length).toBeLessThanOrEqual(2);
  });

  it('never more than 8 requests for one file, whatever its layout', async () => {
    // Twenty 100 KB boxes before the moov: each needs its own request.
    const bytes = concat(ftyp(), ...Array.from({ length: 20 }, () => box('free', new Uint8Array(100_000))), moov({ tracks: [VIDEO] }));
    const { found, requests } = await count(bytes);
    expect(requests).toBeLessThanOrEqual(MAX_RANGE_REQUESTS);
    expect(MAX_RANGE_REQUESTS).toBe(8);
    expect(found).toEqual({ failure: 'too-many-requests' });
  });

  it('a moov with many tracks expands only the two it uses; the sound track not at all', async () => {
    const big: TrackSpec = { handler: 'vide', timescale: 12288, durations: Array.from({ length: 2000 }, () => 512) };
    const sound: TrackSpec = { handler: 'soun', timescale: 48000, durations: Array.from({ length: 2000 }, () => 1024) };
    const tracks = [big, sound, ...Array.from({ length: 30 }, () => big), ...Array.from({ length: 30 }, () => sound)];
    const answer = await timingOfFile(concat(ftyp(), moov({ tracks }), mdat(8)));
    expect(answer.ok).toBe(true);
    expect(containerStats.expandedSamples).toBe(2000);
  });

  it('opening a film reads at most 4 sources at once', async () => {
    let running = 0;
    let most = 0;
    const done = await mapLimit(Array.from({ length: 12 }, (_, i) => i), 4, async (i) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return i * 2;
    });
    expect(done).toEqual(Array.from({ length: 12 }, (_, i) => i * 2));
    expect(most).toBe(4);
  });
});
