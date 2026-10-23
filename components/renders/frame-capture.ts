/**
 * One frame of the finished film, drawn in the owner's browser (docs/TEMPLATES-IA.md §12 "공유
 * 카드": their frame). Vercel functions have no ffmpeg, so this is where a film gets its share
 * image: wait for the metadata, seek to `POSTER_AT_SECONDS`, draw onto a canvas no longer than
 * `POSTER_MAX_EDGE` on its long side, and encode a JPEG under `POSTER_MAX_BYTES`, stepping the
 * quality down if it has to. Anything that goes wrong — a codec the browser cannot decode, a tainted
 * canvas, iOS refusing to load a muted film it is not playing — resolves `null`; the share card then
 * keeps the template's poster, as it did before.
 *
 * DOM-free signatures (`FrameSource`, `FrameCanvas`) so the tests drive it with fakes.
 */

export const POSTER_AT_SECONDS = 0.5;
export const POSTER_MAX_EDGE = 1080;
export const POSTER_MAX_BYTES = 300_000;
const QUALITIES = [0.82, 0.7, 0.58, 0.46] as const;
const TIMEOUT_MS = 15_000;

export interface FrameSource {
  readyState: number;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  addEventListener(type: 'loadedmetadata' | 'seeked' | 'error', listener: () => void, options?: { once?: boolean }): void;
}

export interface FrameCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): { drawImage(source: unknown, x: number, y: number, w: number, h: number): void } | null;
  toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void;
}

/** The canvas size: the frame's own, scaled down (never up) so the long edge fits. */
export function posterSize(width: number, height: number, maxEdge = POSTER_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function once(source: FrameSource, type: 'loadedmetadata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    source.addEventListener(type, () => resolve(), { once: true });
    source.addEventListener('error', () => reject(new Error('media error')), { once: true });
  });
}

function encode(canvas: FrameCanvas, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    } catch {
      // A cross-origin frame without CORS taints the canvas: toBlob throws SecurityError.
      resolve(null);
    }
  });
}

async function draw(source: FrameSource, makeCanvas: () => FrameCanvas): Promise<Blob | null> {
  if (source.readyState < 1) await once(source, 'loadedmetadata');
  if (!source.videoWidth || !source.videoHeight) return null;
  const at = Number.isFinite(source.duration) && source.duration > 0 ? Math.min(POSTER_AT_SECONDS, source.duration / 2) : POSTER_AT_SECONDS;
  const seeked = once(source, 'seeked');
  source.currentTime = at;
  await seeked;

  const canvas = makeCanvas();
  const size = posterSize(source.videoWidth, source.videoHeight);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.drawImage(source, 0, 0, size.width, size.height);
  for (const quality of QUALITIES) {
    const blob = await encode(canvas, quality);
    if (blob === null) return null;
    if (blob.size > 0 && blob.size <= POSTER_MAX_BYTES) return blob;
  }
  return null;
}

export async function captureFrame(source: FrameSource, makeCanvas: () => FrameCanvas, timeoutMs = TIMEOUT_MS): Promise<Blob | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return await Promise.race([draw(source, makeCanvas).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Send the frame; any refusal or network failure is silent (the card keeps the template poster). */
export async function uploadFrame(renderId: string, blob: Blob, doFetch: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await doFetch(`/api/renders/${renderId}/poster`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: blob,
      credentials: 'same-origin',
    });
    return response.status === 201 || response.status === 204;
  } catch {
    return false;
  }
}
