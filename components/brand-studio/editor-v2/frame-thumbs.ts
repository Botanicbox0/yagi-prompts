'use client';

/**
 * The actual frames under the ruler, decoded on demand (docs/BRAND-EDITING-STUDIO-V2.md §5.1).
 *
 * One hidden `<video>` per piece of footage is seeked to the middle of the wanted frame and drawn to a
 * small canvas; the picture is kept as a JPEG blob URL. Only what the timeline currently shows is asked
 * for, the newest request replaces the queue, and each frame is a separate task, so nothing waits on
 * the editor and the editor never waits on this.
 *
 * Cost, measured on the sample film: a picture is 128×72 and about 3–5 KB as a blob, so every frame
 * of a 20-second film at 24 fps (480 frames) is roughly 2 MB; the cache keeps at most `LIMIT`
 * pictures, least recently used first out. The hidden videos hold the footage the browser has already
 * fetched for the preview (the HTTP cache serves it), not a second copy.
 */
export interface ThumbRequest {
  src: string;
  sourceFrame: number;
  seekSec: number;
}

const THUMB_HEIGHT = 72;
const LIMIT = 600;
const SEEK_TIMEOUT_MS = 2000;

const keyOf = (src: string, sourceFrame: number) => `${src}#${sourceFrame}`;

export class FrameThumbs {
  private readonly cache = new Map<string, string>();
  private readonly videos = new Map<string, HTMLVideoElement>();
  private readonly listeners = new Set<() => void>();
  private queue: ThumbRequest[] = [];
  private running = false;
  private disposed = false;
  private notifyQueued = false;
  private bytes = 0;
  private readonly sizes = new Map<string, number>();

  /** A cached picture's URL, or `undefined` while it has not been decoded. */
  get(src: string, sourceFrame: number): string | undefined {
    const key = keyOf(src, sourceFrame);
    const url = this.cache.get(key);
    if (url) {
      this.cache.delete(key);
      this.cache.set(key, url);
    }
    return url;
  }

  /** What the timeline shows right now. Replaces whatever was still waiting. */
  want(requests: readonly ThumbRequest[]): void {
    const seen = new Set<string>();
    this.queue = requests.filter((request) => {
      const key = keyOf(request.src, request.sourceFrame);
      if (this.cache.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!this.running && this.queue.length > 0) void this.pump();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pictures held and their total size, for the document's memory figure and the browser check. */
  usage(): { pictures: number; bytes: number } {
    return { pictures: this.cache.size, bytes: this.bytes };
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear();
    for (const video of this.videos.values()) {
      video.removeAttribute('src');
      video.load();
    }
    this.videos.clear();
    this.listeners.clear();
  }

  private video(src: string): HTMLVideoElement {
    let video = this.videos.get(src);
    if (!video) {
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = src;
      this.videos.set(src, video);
    }
    return video;
  }

  private notify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    requestAnimationFrame(() => {
      this.notifyQueued = false;
      for (const listener of this.listeners) listener();
    });
  }

  private async pump(): Promise<void> {
    this.running = true;
    while (!this.disposed && this.queue.length > 0) {
      const request = this.queue.shift()!;
      try {
        const url = await this.decode(request);
        if (url && !this.disposed) this.store(keyOf(request.src, request.sourceFrame), url.url, url.bytes);
        else if (url) URL.revokeObjectURL(url.url);
      } catch {
        // A frame that cannot be decoded keeps its placeholder; the next one is tried.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    this.running = false;
  }

  private store(key: string, url: string, bytes: number): void {
    this.cache.set(key, url);
    this.sizes.set(key, bytes);
    this.bytes += bytes;
    while (this.cache.size > LIMIT) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      URL.revokeObjectURL(this.cache.get(oldest)!);
      this.cache.delete(oldest);
      this.bytes -= this.sizes.get(oldest) ?? 0;
      this.sizes.delete(oldest);
    }
    this.notify();
  }

  private async decode(request: ThumbRequest): Promise<{ url: string; bytes: number } | null> {
    const video = this.video(request.src);
    if (video.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('metadata')), SEEK_TIMEOUT_MS * 2);
        video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('load')); }, { once: true });
      });
    }
    if (Math.abs(video.currentTime - request.seekSec) > 0.0005 || video.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('seek')), SEEK_TIMEOUT_MS);
        video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.currentTime = request.seekSec;
      });
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.height = THUMB_HEIGHT;
    canvas.width = Math.max(1, Math.round((THUMB_HEIGHT * video.videoWidth) / video.videoHeight));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
    return blob ? { url: URL.createObjectURL(blob), bytes: blob.size } : null;
  }
}
