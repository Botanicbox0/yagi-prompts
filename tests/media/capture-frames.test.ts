import { afterEach, describe, expect, it } from 'vitest';
import { captureFrames, openCaptureSessions } from '@/lib/media/capture-frames';
import { corsMediaUrl } from '@/lib/media/cors-media-url';
import { corsMediaUrl as brandCorsMediaUrl } from '@/lib/brand-studio/cors-media-url';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — the shared frame capture behind the template page's keyframe strip and fixed
 * strip: one hidden `<video>` per clip, a timeout on every seek, and a cross-origin file loaded under its own cache
 * entry (`?cors=1`, lib/media/cors-media-url.ts) so the canvas is not tainted. Any failure gives `null` for that frame
 * (the callers keep their fallback). Tested against a fake DOM: the node test runner has none.
 */

type Listener = () => void;

interface FakeVideoOptions {
  /** 'load' fires loadedmetadata, 'error' fires error, 'never' stays silent. */
  meta?: 'load' | 'error' | 'never';
  width?: number;
  height?: number;
  duration?: number;
  /** Seek targets that never answer (the per-seek timeout must catch them). */
  stuckAt?: number[];
}

class FakeVideo {
  muted = false;
  playsInline = false;
  preload = '';
  crossOrigin: string | null = null;
  videoWidth = 0;
  videoHeight = 0;
  duration = Number.NaN;
  readyState = 0;
  removed = false;
  loads = 0;
  seeks: number[] = [];
  srcHistory: string[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private current = 0;
  private srcValue = '';
  constructor(private readonly opts: FakeVideoOptions) {}
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  private emit(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  get src() {
    return this.srcValue;
  }
  set src(value: string) {
    this.srcValue = value;
    this.srcHistory.push(value);
    const meta = this.opts.meta ?? 'load';
    setTimeout(() => {
      if (meta === 'load') {
        this.videoWidth = this.opts.width ?? 640;
        this.videoHeight = this.opts.height ?? 360;
        this.duration = this.opts.duration ?? 10;
        this.readyState = 1;
        this.emit('loadedmetadata');
      } else if (meta === 'error') this.emit('error');
    }, 1);
  }
  get currentTime() {
    return this.current;
  }
  set currentTime(value: number) {
    this.current = value;
    this.seeks.push(value);
    if ((this.opts.stuckAt ?? []).includes(value)) return;
    setTimeout(() => {
      this.readyState = 2;
      this.emit('seeked');
    }, 1);
  }
  removeAttribute(name: string) {
    if (name === 'src') {
      this.srcValue = '';
      this.removed = true;
    }
  }
  load() {
    this.loads += 1;
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  drawn: number | null = null;
  constructor(private readonly taint: boolean) {}
  getContext() {
    return { drawImage: (video: FakeVideo) => void (this.drawn = video.currentTime) };
  }
  toDataURL(type: string, quality: number) {
    if (this.taint) throw new Error('SecurityError: tainted canvas');
    return `data:${type};q=${quality};t=${this.drawn};${this.width}x${this.height}`;
  }
}

function fakeDoc(opts: FakeVideoOptions & { taint?: boolean } = {}) {
  const videos: FakeVideo[] = [];
  const canvases: FakeCanvas[] = [];
  return {
    videos,
    canvases,
    doc: {
      createElement(tag: string) {
        if (tag === 'video') {
          const v = new FakeVideo(opts);
          videos.push(v);
          return v;
        }
        const c = new FakeCanvas(opts.taint === true);
        canvases.push(c);
        return c;
      },
    } as unknown as Document,
  };
}

const PAGE = 'https://twings.app';
const MEDIA = 'https://media.twings.app/content/prompt/abc/clip.mp4';

afterEach(() => {
  expect(openCaptureSessions()).toBe(0);
});

describe('captureFrames', () => {
  it('loads a cross-origin clip under its own cache entry, anonymously, and draws each frame', async () => {
    const { doc, videos } = fakeDoc({ width: 720, height: 1280, duration: 11 });
    const frames = await captureFrames(MEDIA, [1, 3.5], { doc, pageOrigin: PAGE });
    expect(videos).toHaveLength(1);
    expect(videos[0]!.src).toBe('');
    expect(videos[0]!.removed).toBe(true);
    expect(videos[0]!.crossOrigin).toBe('anonymous');
    expect(videos[0]!.muted).toBe(true);
    expect(videos[0]!.seeks).toEqual([1, 3.5]);
    expect(frames).toEqual(['data:image/jpeg;q=0.72;t=1;160x284', 'data:image/jpeg;q=0.72;t=3.5;160x284']);
  });

  it('records the cors address it loaded', async () => {
    const { doc, videos } = fakeDoc();
    await captureFrames(MEDIA, [1], { doc, pageOrigin: PAGE });
    expect(videos[0]!.srcHistory).toEqual([`${MEDIA}?cors=1`]);
    expect(videos[0]!.srcHistory[0]).toBe(corsMediaUrl(MEDIA, PAGE));
  });

  it('loads a same-origin clip as it is, without CORS mode', async () => {
    const { doc, videos } = fakeDoc();
    const frames = await captureFrames('/media/clip.mp4', [2], { doc, pageOrigin: PAGE });
    expect(videos[0]!.srcHistory).toEqual(['/media/clip.mp4']);
    expect(videos[0]!.crossOrigin).toBeNull();
    expect(frames[0]).toMatch(/^data:image\/jpeg/);
  });

  it('keeps the frame just before the end and the strip’s old minimum height', async () => {
    const { doc, videos } = fakeDoc({ width: 1920, height: 400, duration: 6 });
    const frames = await captureFrames(MEDIA, [-2, 99], { doc, pageOrigin: PAGE });
    expect(videos[0]!.seeks[0]).toBe(0);
    expect(videos[0]!.seeks[1]).toBeCloseTo(5.95, 5);
    expect(frames[0]).toContain('160x90');
  });

  it('gives null for a seek that times out and still captures the rest', async () => {
    const { doc } = fakeDoc({ stuckAt: [2] });
    const frames = await captureFrames(MEDIA, [1, 2, 3], { doc, pageOrigin: PAGE, seekTimeoutMs: 20 });
    expect(frames[0]).toMatch(/t=1;/);
    expect(frames[1]).toBeNull();
    expect(frames[2]).toMatch(/t=3;/);
  });

  it('gives all null on a tainted canvas (the fallback stays)', async () => {
    const { doc, videos } = fakeDoc({ taint: true });
    expect(await captureFrames(MEDIA, [1, 2, 3], { doc, pageOrigin: PAGE })).toEqual([null, null, null]);
    expect(videos[0]!.seeks).toEqual([1]);
  });

  it('gives all null when the clip errors, never loads, or has no picture', async () => {
    expect(await captureFrames(MEDIA, [1, 2], { doc: fakeDoc({ meta: 'error' }).doc, pageOrigin: PAGE })).toEqual([null, null]);
    expect(await captureFrames(MEDIA, [1], { doc: fakeDoc({ meta: 'never' }).doc, pageOrigin: PAGE, loadTimeoutMs: 20 })).toEqual([null]);
    expect(await captureFrames(MEDIA, [1], { doc: fakeDoc({ width: 0, height: 0 }).doc, pageOrigin: PAGE })).toEqual([null]);
  });

  it('shares one probe per clip between callers and seeks a time once', async () => {
    const { doc, videos } = fakeDoc();
    const [a, b] = await Promise.all([
      captureFrames(MEDIA, [1, 4], { doc, pageOrigin: PAGE }),
      captureFrames(MEDIA, [4, 6], { doc, pageOrigin: PAGE }),
    ]);
    expect(videos).toHaveLength(1);
    expect(videos[0]!.seeks).toEqual([1, 4, 6]);
    expect(a[1]).toBe(b[0]);
    expect(b[1]).toMatch(/t=6;/);
  });

  it('stops after an abort and releases the probe', async () => {
    const { doc, videos } = fakeDoc();
    const controller = new AbortController();
    const pending = captureFrames(MEDIA, [1, 2, 3], { doc, pageOrigin: PAGE, signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual([null, null, null]);
    expect(videos.every((v) => v.removed)).toBe(true);
    const late = new AbortController();
    const second = captureFrames(MEDIA, [1, 2, 3], { doc, pageOrigin: PAGE, signal: late.signal });
    // Abort while the first seek is in flight.
    while (videos.length < 2 || videos[1]!.seeks.length < 1) await new Promise((resolve) => setTimeout(resolve, 0));
    late.abort();
    const frames = await second;
    expect(frames.filter(Boolean).length).toBeLessThan(3);
    expect(videos.every((v) => v.removed)).toBe(true);
  });

  it('returns nothing to do for no times or no address', async () => {
    const { doc, videos } = fakeDoc();
    expect(await captureFrames(MEDIA, [], { doc, pageOrigin: PAGE })).toEqual([]);
    expect(await captureFrames('', [1], { doc, pageOrigin: PAGE })).toEqual([null]);
    expect(videos).toHaveLength(0);
  });
});

describe('corsMediaUrl', () => {
  it('moved to lib/media and is still exported from the brand studio path', () => {
    expect(brandCorsMediaUrl).toBe(corsMediaUrl);
  });
});
