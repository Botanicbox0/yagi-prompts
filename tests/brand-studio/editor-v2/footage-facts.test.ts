import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gatherBoxes, readTiming, timingOfFile } from '@/lib/brand-studio/editor-v2/container';
import { measuredFromTiming } from '@/lib/brand-studio/editor-v2/fps';
import { RangeRefused, rangedSource, type RangeAnswer } from '@/lib/brand-studio/editor-v2/ranged-source';
import { concat, ftyp, mdat, moov, type TrackSpec } from './mp4-bytes';

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
      return new Response(bytes.slice(start, Math.min(bytes.length, end + 1)), { status: 206 });
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
  });

  /**
   * A fake video of 97 pictures at 24 fps in a container that runs to 4.308 s (its sound is longer), the
   * WebM the real-screen check uses. Playing reports frames k/24; a seek reports the picture shown there.
   * `endedOnSeek`: fire `ended` before `seeked` when a seek reaches the end (the order the review feared;
   * Chromium measured: no `ended` at all for a paused seek to the end, see measure-fps.ts).
   */
  function fakeVideo(endedOnSeek: boolean) {
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
      duration: 4.308,
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
        for (let k = 0; k < 13; k += 1) {
          await Promise.resolve();
          present(k / 24);
        }
      },
      set currentTime(at: number) {
        time = at;
        queueMicrotask(() => {
          const shown = Math.min(96, Math.floor(at * 24 + 1e-9)) / 24;
          if (endedOnSeek && at >= 4.308 - 1e-9) fire('ended');
          fire('seeked');
          present(shown);
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
});
