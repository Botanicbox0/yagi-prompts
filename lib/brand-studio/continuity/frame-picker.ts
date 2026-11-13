/**
 * Client-safe tail keyframe scorer and browser sampler for next-scene continuity.
 *
 * Strictly zero Node, filesystem, or database imports (`security:client` clean).
 */
import type { ContinuityKeyframeCandidate } from './contracts';

export interface FrameQualityBreakdown {
  sharpness: number;
  exposure: number;
  motionSettle: number;
  recency: number;
  totalScore: number;
  isBlackoutOrBlown: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Computes sharpness (edge contrast gradient), balanced mid-key exposure (avoiding fade-to-black
 * or blown flash frames at clip tails), inter-frame settle score, and recency weight from RGBA pixels.
 */
export function scoreRgbaFrameQuality(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts?: { prevRgba?: Uint8ClampedArray | Uint8Array; recency?: number },
): FrameQualityBreakdown {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w < 2 || h < 2 || rgba.length < w * h * 4) {
    return {
      sharpness: 0,
      exposure: 0,
      motionSettle: 0,
      recency: clamp01(opts?.recency ?? 0),
      totalScore: 0,
      isBlackoutOrBlown: true,
    };
  }

  const pixelCount = w * h;
  const luma = new Float32Array(pixelCount);
  let lumaSum = 0;

  for (let i = 0; i < pixelCount; i += 1) {
    const p = i * 4;
    const y = (0.2126 * rgba[p]! + 0.7152 * rgba[p + 1]! + 0.0722 * rgba[p + 2]!) / 255;
    luma[i] = y;
    lumaSum += y;
  }

  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const idx = y * w + x;
      const center = luma[idx]!;
      const secondDiff = Math.abs(
        luma[idx - 1]! + luma[idx + 1]! + luma[idx - w]! + luma[idx + w]! - 4 * center,
      );
      edgeSum += secondDiff;
      edgeCount += 1;
    }
  }

  const meanLuma = lumaSum / pixelCount;
  const sharpness = clamp01(edgeCount > 0 ? (edgeSum / edgeCount) * 8.5 : 0);
  const isBlackoutOrBlown = meanLuma < 0.06 || meanLuma > 0.94;
  // Smooth bell favoring clean 0.35..0.68 exposure and rejecting blackout/flash frames
  const exposure = isBlackoutOrBlown
    ? 0.08
    : clamp01(1 - Math.abs(meanLuma - 0.48) * 1.45);

  let motionSettle = 0.75;
  if (opts?.prevRgba && opts.prevRgba.length >= pixelCount * 4) {
    let diffSum = 0;
    for (let i = 0; i < pixelCount; i += 1) {
      const p = i * 4;
      const prevY =
        (0.2126 * opts.prevRgba[p]! +
          0.7152 * opts.prevRgba[p + 1]! +
          0.0722 * opts.prevRgba[p + 2]!) /
        255;
      diffSum += Math.abs(luma[i]! - prevY);
    }
    const motionDelta = clamp01((diffSum / pixelCount) * 3.2);
    motionSettle = clamp01(1 - motionDelta * 0.9);
  }

  const recency = clamp01(opts?.recency ?? 0.5);
  const totalScore = isBlackoutOrBlown
    ? round3(0.05 * sharpness + 0.05 * recency)
    : round3(sharpness * 0.44 + exposure * 0.28 + motionSettle * 0.16 + recency * 0.12);

  return {
    sharpness: round3(sharpness),
    exposure: round3(exposure),
    motionSettle: round3(motionSettle),
    recency: round3(recency),
    totalScore,
    isBlackoutOrBlown,
  };
}

/**
 * Chooses the cleanest visual anchor frame among tail candidates for extending into the next shot.
 */
export function pickBestContinuationFrameIndex(
  candidates: readonly ContinuityKeyframeCandidate[],
): number {
  if (candidates.length === 0) return 0;

  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    const recency = candidates.length > 1 ? i / (candidates.length - 1) : 1;
    const blackoutPenalty = c.exposure < 0.15 ? 0.15 : 1;
    const computed =
      c.qualityScore !== undefined
        ? clamp01(c.qualityScore) * blackoutPenalty
        : (clamp01(c.sharpness) * 0.44 +
            clamp01(c.exposure) * 0.28 +
            clamp01(1 - clamp01(c.motionDelta) * 0.9) * 0.16 +
            recency * 0.12) *
          blackoutPenalty;

    if (computed > bestScore) {
      bestScore = computed;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * Extracts `sampleCount` candidate frames from the tail window of a clip inside the browser
 * (`min(2.0s, span * 0.45)`) and computes per-frame quality metrics. Safe no-op in SSR/Node.
 */
export async function extractContinuityFramesInBrowser(
  videoUrl: string,
  trimStartSec: number,
  trimEndSec: number,
  sampleCount = 4,
): Promise<ContinuityKeyframeCandidate[]> {
  if (typeof document === 'undefined' || !videoUrl) return [];

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('continuity_video_timeout')), 8_000);
      video.addEventListener(
        'loadeddata',
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          window.clearTimeout(timer);
          reject(new Error('continuity_video_load_failed'));
        },
        { once: true },
      );
      video.src = videoUrl;
    });

    const naturalDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : trimEndSec;
    const endSec = Math.max(0.2, Math.min(naturalDur - 0.08, trimEndSec));
    const startSec = Math.max(0, Math.min(endSec - 0.2, trimStartSec));
    const span = Math.max(0.2, endSec - startSec);
    const tailWindow = Math.min(2.0, span * 0.45);
    const tailStart = Math.max(startSec, endSec - tailWindow);
    const count = Math.max(1, Math.min(6, Math.trunc(sampleCount)));

    const vw = video.videoWidth || 320;
    const vh = video.videoHeight || 180;
    const scale = Math.min(1, 320 / Math.max(vw, vh));
    const cw = Math.max(32, Math.round(vw * scale));
    const ch = Math.max(32, Math.round(vh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    const out: ContinuityKeyframeCandidate[] = [];
    let prevRgba: Uint8ClampedArray | undefined;

    for (let i = 0; i < count; i += 1) {
      const ratio = count === 1 ? 1 : i / (count - 1);
      const ts = Math.round((tailStart + tailWindow * ratio) * 100) / 100;
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => resolve(), 900);
        video.addEventListener(
          'seeked',
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        try {
          video.currentTime = ts;
        } catch {
          window.clearTimeout(timer);
          resolve();
        }
      });

      ctx.drawImage(video, 0, 0, cw, ch);
      const rgba = ctx.getImageData(0, 0, cw, ch).data;
      const metrics = scoreRgbaFrameQuality(rgba, cw, ch, { prevRgba, recency: ratio });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      out.push({
        timestampSec: ts,
        dataUrl,
        width: cw,
        height: ch,
        sharpness: metrics.sharpness,
        exposure: metrics.exposure,
        motionDelta: round3(1 - metrics.motionSettle),
        qualityScore: metrics.totalScore,
      });
      prevRgba = new Uint8ClampedArray(rgba);
    }

    return out;
  } catch {
    return [];
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
