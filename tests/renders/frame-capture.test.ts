import { describe, expect, it, vi } from 'vitest';
import { POSTER_AT_SECONDS, POSTER_MAX_BYTES, captureFrame, posterSize, uploadFrame, type FrameCanvas, type FrameSource } from '@/components/renders/frame-capture';

/**
 * The owner's browser draws the share frame (no ffmpeg on Vercel). Driven here with a fake video
 * and a fake canvas: the size cap, the seek, the quality steps under 300KB, and silence on failure.
 */

function fakeVideo({ width = 1080, height = 1920, duration = 8, ready = false, fail = false } = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const fire = (type: string) => {
    const due = listeners.get(type) ?? [];
    listeners.delete(type);
    for (const listener of due) listener();
  };
  const seeks: number[] = [];
  const video: FrameSource & { seeks: number[] } = {
    readyState: ready ? 1 : 0, duration, videoWidth: width, videoHeight: height, seeks,
    get currentTime() { return seeks.at(-1) ?? 0; },
    set currentTime(value: number) { seeks.push(value); queueMicrotask(() => fire(fail ? 'error' : 'seeked')); },
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
  };
  if (!ready) queueMicrotask(() => { video.readyState = 1; fire('loadedmetadata'); });
  return video;
}

function fakeCanvas(sizes: number[], options: { taint?: boolean } = {}) {
  const drawn: Array<[number, number]> = [];
  const qualities: number[] = [];
  const canvas: FrameCanvas & { drawn: typeof drawn; qualities: number[] } = {
    width: 0, height: 0, drawn, qualities,
    getContext: () => ({ drawImage: (_source, _x, _y, w, h) => { drawn.push([w, h]); } }),
    toBlob(callback, type, quality) {
      if (options.taint) throw new DOMException('tainted', 'SecurityError');
      qualities.push(quality);
      const size = sizes[qualities.length - 1] ?? 0;
      callback(size ? new Blob([new Uint8Array(size)], { type }) : null);
    },
  };
  return canvas;
}

describe('the share-frame capture', () => {
  it('fits the long edge into 1080px and never scales up', () => {
    expect(posterSize(1080, 1920)).toEqual({ width: 608, height: 1080 });
    expect(posterSize(1920, 1080)).toEqual({ width: 1080, height: 608 });
    expect(posterSize(720, 900)).toEqual({ width: 720, height: 900 });
  });

  it('waits for the metadata, seeks to half a second and draws a capped frame', async () => {
    const video = fakeVideo();
    const canvas = fakeCanvas([120_000]);
    const blob = await captureFrame(video, () => canvas);
    expect(blob?.size).toBe(120_000);
    expect(blob?.type).toBe('image/jpeg');
    expect(video.seeks).toEqual([POSTER_AT_SECONDS]);
    expect([canvas.width, canvas.height]).toEqual([608, 1080]);
    expect(canvas.drawn).toEqual([[608, 1080]]);
  });

  it('seeks to the middle of a clip shorter than a second', async () => {
    const video = fakeVideo({ duration: 0.6, ready: true });
    await captureFrame(video, () => fakeCanvas([10_000]));
    expect(video.seeks).toEqual([0.3]);
  });

  it('steps the quality down until the JPEG fits under 300KB, and gives up past the last step', async () => {
    const canvas = fakeCanvas([POSTER_MAX_BYTES + 1, 400_000, 250_000]);
    expect((await captureFrame(fakeVideo(), () => canvas))?.size).toBe(250_000);
    expect(canvas.qualities).toHaveLength(3);
    expect(canvas.qualities).toEqual([...canvas.qualities].sort((a, b) => b - a));
    expect(await captureFrame(fakeVideo(), () => fakeCanvas([900_000, 800_000, 700_000, 600_000]))).toBeNull();
  });

  it('is silent about a codec error, a tainted canvas, a frame with no size, or a stall', async () => {
    expect(await captureFrame(fakeVideo({ fail: true }), () => fakeCanvas([1000]))).toBeNull();
    expect(await captureFrame(fakeVideo(), () => fakeCanvas([1000], { taint: true }))).toBeNull();
    expect(await captureFrame(fakeVideo({ width: 0, height: 0 }), () => fakeCanvas([1000]))).toBeNull();
    const stalled: FrameSource = { readyState: 0, duration: NaN, videoWidth: 0, videoHeight: 0, currentTime: 0, addEventListener() {} };
    expect(await captureFrame(stalled, () => fakeCanvas([1000]), 20)).toBeNull();
  });

  it('posts the JPEG to the owner route and swallows any refusal', async () => {
    const blob = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
    const ok = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await uploadFrame('r1', blob, ok as unknown as typeof fetch)).toBe(true);
    expect(ok).toHaveBeenCalledWith('/api/renders/r1/poster', expect.objectContaining({ method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob }));
    expect(await uploadFrame('r1', blob, (async () => new Response(null, { status: 204 })) as unknown as typeof fetch)).toBe(true);
    expect(await uploadFrame('r1', blob, (async () => new Response(null, { status: 503 })) as unknown as typeof fetch)).toBe(false);
    expect(await uploadFrame('r1', blob, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBe(false);
  });
});
