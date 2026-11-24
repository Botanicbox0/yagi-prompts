import { corsMediaUrl } from './cors-media-url';

/**
 * Frames captured from a clip in the browser, as small JPEG data URLs (docs/PERSONAL-STUDIO.md §3.4.4, T1a): the
 * template page's keyframe strip and its "what this template decides" row both read their thumbnails here.
 *
 * - One hidden `<video>` per clip. Callers that ask for frames of the same clip at the same time share it, their
 *   requests run one after another, and a time already drawn is not seeked again.
 * - A cross-origin file is loaded with `crossOrigin = 'anonymous'` under its own cache entry (`?cors=1`,
 *   `./cors-media-url.ts`). The page's player has already cached the plain address without CORS headers; reusing it
 *   would fail the CORS check or taint the canvas.
 * - Every wait has a timeout (metadata, then each seek). A failed seek gives `null` for that time; a tainted canvas, a
 *   load error or a clip without a picture gives `null` for every time. Callers keep their own fallback for `null`.
 * - The frame is the strip's old one: 160 px wide, the clip's height ratio (at least 90 px), JPEG quality 0.72, a
 *   time clamped to [0, duration − 0.05].
 *
 * Client-only at call time (it creates elements), but importing it is safe anywhere.
 */

export interface CaptureFramesOptions {
  /** Thumbnail width in CSS pixels. */
  width?: number;
  /** Lowest thumbnail height (a very wide clip still gets a readable frame). */
  minHeight?: number;
  quality?: number;
  loadTimeoutMs?: number;
  seekTimeoutMs?: number;
  signal?: AbortSignal;
  /** The page's origin; defaults to `location.origin`. */
  pageOrigin?: string | null;
  /** The document to create elements in; defaults to `document` (tests pass a fake). */
  doc?: Pick<Document, 'createElement'>;
}

const DEFAULTS = { width: 160, minHeight: 90, quality: 0.72, loadTimeoutMs: 8000, seekTimeoutMs: 4000 } as const;
/** How far before the end a frame is taken, so a seek to the end still lands on a picture. */
const END_GUARD = 0.05;

interface Session {
  video: HTMLVideoElement;
  /** Resolves true once the clip's metadata is in (and it has a picture), false on error or timeout. */
  ready: Promise<boolean>;
  /** The last queued run; the next one starts after it. */
  queue: Promise<unknown>;
  users: number;
  /** Drawn frames by `width:time`. `null` = that seek failed. */
  frames: Map<string, string | null>;
  /** The canvas was tainted once: every later frame would be too. */
  tainted: boolean;
}

const sessions = new Map<string, Session>();

/** Open probes right now (tests check nothing is left behind). */
export function openCaptureSessions(): number {
  return sessions.size;
}

function originOf(pageOrigin: string | null | undefined): string | null {
  if (pageOrigin !== undefined) return pageOrigin;
  return typeof location === 'undefined' ? null : location.origin;
}

function crossOrigin(url: string, pageOrigin: string | null): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return new URL(url).origin !== pageOrigin;
  } catch {
    return false;
  }
}

function waitFor(video: HTMLVideoElement, ok: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener(ok, onOk);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onError = () => finish(false);
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener(ok, onOk);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);
  });
}

function open(address: string, cors: boolean, doc: Pick<Document, 'createElement'>, loadTimeoutMs: number): Session {
  const video = doc.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  if (cors) video.crossOrigin = 'anonymous';
  const ready = waitFor(video, 'loadedmetadata', loadTimeoutMs).then((ok) => ok && video.videoWidth > 0 && video.videoHeight > 0);
  video.src = address;
  return { video, ready, queue: Promise.resolve(), users: 0, frames: new Map(), tainted: false };
}

function close(address: string, session: Session): void {
  if (sessions.get(address) === session) sessions.delete(address);
  try {
    session.video.removeAttribute('src');
    session.video.load();
  } catch {
    // A detached element that will not reload is already released.
  }
}

async function run(session: Session, times: readonly number[], opts: Required<Pick<CaptureFramesOptions, 'width' | 'minHeight' | 'quality' | 'seekTimeoutMs'>> & Pick<CaptureFramesOptions, 'signal' | 'doc'>): Promise<Array<string | null>> {
  const out: Array<string | null> = times.map(() => null);
  if (opts.signal?.aborted || !(await session.ready) || session.tainted) return out;
  const { video } = session;
  const w = opts.width;
  const h = Math.max(opts.minHeight, Math.round((w * video.videoHeight) / video.videoWidth));
  const canvas = (opts.doc ?? document).createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return out;

  for (let i = 0; i < times.length; i += 1) {
    if (opts.signal?.aborted || session.tainted) break;
    const t = times[i]!;
    const key = `${w}:${Math.round(t * 100)}`;
    if (session.frames.has(key)) {
      out[i] = session.frames.get(key) ?? null;
      continue;
    }
    const target = Math.min(Math.max(0, t), Math.max(0, (video.duration || t) - END_GUARD));
    const seeked = waitFor(video, 'seeked', opts.seekTimeoutMs, opts.signal);
    try {
      video.currentTime = target;
    } catch {
      session.frames.set(key, null);
      continue;
    }
    if (!(await seeked)) {
      if (!opts.signal?.aborted) session.frames.set(key, null);
      continue;
    }
    try {
      ctx.drawImage(video, 0, 0, w, h);
      const url = canvas.toDataURL('image/jpeg', opts.quality);
      session.frames.set(key, url);
      out[i] = url;
    } catch {
      // A tainted canvas (the file came without CORS headers): no frame from this clip can be read.
      session.tainted = true;
    }
  }
  return out;
}

/** Captures one frame per time from `src`; `null` where a frame could not be read. Never throws. */
export async function captureFrames(src: string, times: readonly number[], options: CaptureFramesOptions = {}): Promise<Array<string | null>> {
  if (times.length === 0) return [];
  const doc = options.doc ?? (typeof document === 'undefined' ? null : document);
  if (!src || !doc || options.signal?.aborted) return times.map(() => null);

  const pageOrigin = originOf(options.pageOrigin);
  const address = corsMediaUrl(src, pageOrigin);
  let session = sessions.get(address);
  if (!session) {
    session = open(address, crossOrigin(address, pageOrigin), doc, options.loadTimeoutMs ?? DEFAULTS.loadTimeoutMs);
    sessions.set(address, session);
  }
  const current = session;
  current.users += 1;
  const opts = {
    width: options.width ?? DEFAULTS.width,
    minHeight: options.minHeight ?? DEFAULTS.minHeight,
    quality: options.quality ?? DEFAULTS.quality,
    seekTimeoutMs: options.seekTimeoutMs ?? DEFAULTS.seekTimeoutMs,
    signal: options.signal,
    doc,
  };
  const result = current.queue.then(
    () => run(current, times, opts),
    () => run(current, times, opts),
  );
  current.queue = result.catch(() => undefined);
  try {
    return await result;
  } catch {
    return times.map(() => null);
  } finally {
    current.users -= 1;
    if (current.users === 0) close(address, current);
  }
}
