/**
 * The frame a mark sits on, with the mark drawn on it, for `revise.mark`. The viewer's `<video>` is loaded
 * without CORS, so it is never drawn to a canvas; like `lib/brand-studio/continuity/frame-picker.ts` an
 * offscreen `<video crossOrigin="anonymous">` is loaded once per clip, sought and drawn. Any failure
 * (tainted canvas, load error, timeout) answers null: the mark then simply has no label.
 */
import { corsMediaUrl } from "@/lib/brand-studio/cors-media-url";
import { frameSize, markPixels, type MarkGeometry } from "./revise-marks";

/** The contract allows 400,000 characters; stay clear of it. */
export const FRAME_CHARS_MAX = 380_000;

export interface FrameGrabber {
  capture(mark: MarkGeometry, colour: string): Promise<string | null>;
  dispose(): void;
}

function once(target: HTMLVideoElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    const done = () => {
      window.clearTimeout(timer);
      target.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, done);
      reject(new Error("load_failed"));
    };
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

function stroke(ctx: CanvasRenderingContext2D, mark: MarkGeometry, width: number, height: number, colour: string) {
  const px = markPixels(mark, width, height);
  const path = () => {
    ctx.beginPath();
    if (px.kind === "pin") ctx.arc(px.cx, px.cy, px.r, 0, Math.PI * 2);
    else ctx.rect(px.x, px.y, px.w, px.h);
  };
  ctx.lineJoin = "round";
  // A thin dark outline under the bright line so it reads on any picture.
  path();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.lineWidth = 6;
  ctx.stroke();
  path();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 4;
  ctx.stroke();
}

/** One offscreen copy of the clip, loaded on first use; captures run one after another. */
export function createFrameGrabber(url: string): FrameGrabber {
  let video: HTMLVideoElement | null = null;
  let ready: Promise<HTMLVideoElement> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const load = () => {
    if (ready) return ready;
    const element = document.createElement("video");
    element.muted = true;
    element.playsInline = true;
    element.crossOrigin = "anonymous";
    element.preload = "auto";
    video = element;
    ready = (async () => {
      const loaded = once(element, "loadeddata", 10_000);
      // Its own cache entry: the viewer already played this address without CORS (see corsMediaUrl).
      element.src = corsMediaUrl(url);
      await loaded;
      return element;
    })();
    ready.catch(() => {
      ready = null;
    });
    return ready;
  };

  async function grab(mark: MarkGeometry, colour: string): Promise<string | null> {
    if (typeof document === "undefined") return null;
    try {
      const element = await load();
      if (Math.abs(element.currentTime - mark.time) > 0.01) {
        const sought = once(element, "seeked", 4_000);
        element.currentTime = mark.time;
        await sought;
      }
      const media = { width: element.videoWidth, height: element.videoHeight };
      if (!media.width || !media.height) return null;
      let size = frameSize(media);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(element, 0, 0, size.width, size.height);
        stroke(ctx, mark, size.width, size.height, colour);
        for (const quality of [0.8, 0.65, 0.5]) {
          const url = canvas.toDataURL("image/jpeg", quality);
          if (!url.startsWith("data:image/jpeg;base64,")) return null;
          if (url.length < FRAME_CHARS_MAX) return url;
        }
        size = { width: Math.max(1, Math.round(size.width * 0.8)), height: Math.max(1, Math.round(size.height * 0.8)) };
      }
      return null;
    } catch {
      return null;
    }
  }

  return {
    capture(mark, colour) {
      const next = queue.then(() => grab(mark, colour));
      queue = next.catch(() => null);
      return next;
    },
    dispose() {
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
      video = null;
      ready = null;
    },
  };
}
