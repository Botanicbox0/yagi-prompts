/**
 * Client-safe automatic scene-cut detector for Brand Studio Video Composer (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * - Browser path: samples downscaled `64x36` frames on an offscreen `<canvas>`, computes normalized RGB
 *   histograms + BT.709 luminance + frame-to-frame motion delta, and picks shot boundaries with adaptive
 *   Chi-square / L1 distance and local robust Z-score peak picking.
 * - Server / CLI path: parses FFmpeg `scdet` (`lavfi.scd.time` / `lavfi.scd.score`) stderr logs with the
 *   same minimum shot duration enforcement.
 *
 * Client-safe: zero Node, filesystem, or database imports.
 */
import { corsMediaUrl } from '../cors-media-url';

export interface FrameHistogramSample {
  timeSec: number;
  hist: readonly number[];
  lumaMean: number;
  motionDelta?: number;
}

export interface DetectedCut {
  timeSec: number;
  confidence: number;
  delta: number;
}

const DEFAULT_HIST_BINS = 16;
const DEFAULT_THRESHOLD = 0.22;
const DEFAULT_MIN_SHOT_SEC = 0.6;
const DEFAULT_SAMPLE_FPS = 5;
const DEFAULT_MAX_DURATION_SEC = 180;
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundTenth(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

/**
 * Computes a normalized 3-channel RGB histogram (`3 * bins`, summing to `1.0`) and BT.709 `lumaMean` (`0..1`)
 * from an RGBA byte buffer.
 */
export function computeRgbaHistogram(
  rgba: Uint8ClampedArray | Uint8Array,
  bins = DEFAULT_HIST_BINS,
): { hist: number[]; lumaMean: number } {
  const safeBins = Math.max(4, Math.min(64, Math.trunc(bins) || DEFAULT_HIST_BINS));
  const totalBins = safeBins * 3;
  const hist = new Array<number>(totalBins).fill(0);
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount <= 0) {
    return { hist, lumaMean: 0 };
  }

  let lumaSum = 0;
  const scale = safeBins / 256;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;

    const rBin = Math.min(safeBins - 1, Math.floor(r * scale));
    const gBin = Math.min(safeBins - 1, Math.floor(g * scale));
    const bBin = Math.min(safeBins - 1, Math.floor(b * scale));

    hist[rBin]! += 1;
    hist[safeBins + gBin]! += 1;
    hist[safeBins * 2 + bBin]! += 1;

    lumaSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  const normDenom = pixelCount * 3;
  for (let k = 0; k < totalBins; k += 1) {
    hist[k] = hist[k]! / normDenom;
  }

  return {
    hist,
    lumaMean: round3(clamp01(lumaSum / pixelCount)),
  };
}

function normalizeHistogram(hist: readonly number[]): number[] {
  let sum = 0;
  for (let i = 0; i < hist.length; i += 1) {
    const v = hist[i]!;
    if (Number.isFinite(v) && v > 0) sum += v;
  }
  if (sum <= 0) {
    return hist.map(() => 0);
  }
  return hist.map((v) => (Number.isFinite(v) && v > 0 ? v / sum : 0));
}

/**
 * Detects hard cuts and rapid scene transitions from frame histogram samples using:
 * 1. Symmetrized Chi-square + L1 (Total Variation) histogram distance
 * 2. BT.709 luminance jump + optional frame motion delta
 * 3. Adaptive local robust Z-score (median/MAD) peak picking with `minShotSec` suppression.
 */
export function detectSceneCutsFromFrameSamples(
  samples: readonly FrameHistogramSample[],
  opts?: { threshold?: number; minShotSec?: number },
): DetectedCut[] {
  if (samples.length < 2) return [];

  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const minShotSec = Math.max(0.1, opts?.minShotSec ?? DEFAULT_MIN_SHOT_SEC);

  const ordered = [...samples].sort((a, b) => a.timeSec - b.timeSec);
  const usesByteLuma = ordered.some((s) => s.lumaMean > 1.5);
  const normHists = ordered.map((s) => normalizeHistogram(s.hist));
  const normLumas = ordered.map((s) =>
    clamp01(usesByteLuma ? s.lumaMean / 255 : s.lumaMean),
  );

  interface TransitionMetric {
    rawTimeSec: number;
    delta: number;
  }

  const transitions: TransitionMetric[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const prevHist = normHists[i - 1]!;
    const currHist = normHists[i]!;
    const len = Math.max(prevHist.length, currHist.length);

    let chiSq = 0;
    let l1 = 0;
    for (let k = 0; k < len; k += 1) {
      const a = prevHist[k] ?? 0;
      const b = currHist[k] ?? 0;
      const diff = a - b;
      const denom = a + b;
      if (denom > 1e-9) {
        chiSq += (diff * diff) / denom;
      }
      l1 += Math.abs(diff);
    }
    chiSq = clamp01(0.5 * chiSq);
    const tv = clamp01(0.5 * l1);
    const lumaJump = clamp01(Math.abs(normLumas[i]! - normLumas[i - 1]!));
    const motion = ordered[i]!.motionDelta;

    const combined =
      motion !== undefined && Number.isFinite(motion)
        ? 0.48 * chiSq + 0.24 * tv + 0.18 * lumaJump + 0.1 * clamp01(motion)
        : 0.52 * chiSq + 0.28 * tv + 0.2 * lumaJump;

    transitions.push({
      rawTimeSec: ordered[i]!.timeSec,
      delta: round3(clamp01(combined)),
    });
  }

  const startTimeSec = ordered[0]!.timeSec;
  const accepted: Array<{ rawTimeSec: number; cut: DetectedCut }> = [];

  for (let idx = 0; idx < transitions.length; idx += 1) {
    const curr = transitions[idx]!;
    if (curr.delta < threshold) continue;

    const prevDelta = idx > 0 ? transitions[idx - 1]!.delta : -1;
    const nextDelta = idx + 1 < transitions.length ? transitions[idx + 1]!.delta : -1;
    // Local peak condition (tie breaks on the earlier frame)
    if (curr.delta < prevDelta || curr.delta < nextDelta) continue;
    if (idx > 0 && curr.delta === prevDelta) continue;

    const windowStart = Math.max(0, idx - 8);
    const windowEnd = Math.min(transitions.length - 1, idx + 8);
    const baseline: number[] = [];
    for (let w = windowStart; w <= windowEnd; w += 1) {
      if (w === idx) continue;
      baseline.push(transitions[w]!.delta);
    }

    let zScore = curr.delta / 0.05;
    if (baseline.length > 0) {
      const med = medianOf(baseline);
      const absDevs = baseline.map((v) => Math.abs(v - med));
      const robustStd = Math.max(0.015, 1.4826 * medianOf(absDevs));
      zScore = (curr.delta - med) / robustStd;
    }

    if (zScore < 1.8) continue;
    if (curr.rawTimeSec - startTimeSec < minShotSec - 1e-6) continue;

    const confidence = round3(
      Math.min(
        0.99,
        Math.max(
          0.15,
          0.55 * Math.min(1, curr.delta / Math.max(0.1, threshold * 2.1)) +
            0.45 * Math.min(1, zScore / 6),
        ),
      ),
    );

    const candidate: DetectedCut = {
      timeSec: roundTenth(curr.rawTimeSec),
      confidence,
      delta: curr.delta,
    };

    const prevAccepted = accepted[accepted.length - 1];
    if (!prevAccepted) {
      accepted.push({ rawTimeSec: curr.rawTimeSec, cut: candidate });
      continue;
    }

    if (curr.rawTimeSec - prevAccepted.rawTimeSec < minShotSec - 1e-6) {
      if (curr.delta > prevAccepted.cut.delta) {
        accepted[accepted.length - 1] = { rawTimeSec: curr.rawTimeSec, cut: candidate };
      }
      continue;
    }

    accepted.push({ rawTimeSec: curr.rawTimeSec, cut: candidate });
  }

  return accepted.map((entry) => entry.cut);
}

function seekVideoElement(video: HTMLVideoElement, targetSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const clamped = Math.max(0, targetSec);
    if (Math.abs(video.currentTime - clamped) < 0.005 && video.readyState >= 2) {
      resolve();
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, 1500);

    const onSeeked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('video_seek_failed'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    try {
      video.currentTime = clamped;
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error('video_seek_failed'));
    }
  });
}

/**
 * Loads a hidden `<video muted playsInline crossOrigin="anonymous">` in the browser, seeks across
 * frames at `sampleFps` (default `5` fps) onto a `64x36` offscreen `<canvas>`, and detects scene cuts.
 */
export async function detectVideoSceneCutsInBrowser(
  videoUrl: string,
  opts?: {
    sampleFps?: number;
    threshold?: number;
    minShotSec?: number;
    maxDurationSec?: number;
  },
): Promise<DetectedCut[]> {
  if (typeof document === 'undefined' || !videoUrl) return [];

  const sampleFps = Math.max(1, Math.min(15, opts?.sampleFps ?? DEFAULT_SAMPLE_FPS));
  const maxDurationSec = Math.max(1, opts?.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('video_metadata_timeout')), 12_000);
      video.addEventListener(
        'loadedmetadata',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('video_load_failed'));
        },
        { once: true },
      );
      // Frames are read: its own cache entry on the media domain (see corsMediaUrl).
      video.src = corsMediaUrl(videoUrl);
    });

    const duration = Math.min(
      maxDurationSec,
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
    );
    if (duration <= 0.2) return [];

    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    const stepSec = 1 / sampleFps;
    const samples: FrameHistogramSample[] = [];
    let prevRgb: Uint8Array | null = null;

    for (let t = 0; t < duration - 0.02; t += stepSec) {
      await seekVideoElement(video, t);
      ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const rgba = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
      const { hist, lumaMean } = computeRgbaHistogram(rgba, DEFAULT_HIST_BINS);

      let motionDelta: number | undefined;
      const pixelCount = SAMPLE_WIDTH * SAMPLE_HEIGHT;
      const currRgb = new Uint8Array(pixelCount * 3);
      let diffSum = 0;
      for (let p = 0, s = 0; p < pixelCount; p += 1, s += 4) {
        const r = rgba[s]!;
        const g = rgba[s + 1]!;
        const b = rgba[s + 2]!;
        const dIdx = p * 3;
        currRgb[dIdx] = r;
        currRgb[dIdx + 1] = g;
        currRgb[dIdx + 2] = b;
        if (prevRgb) {
          diffSum +=
            Math.abs(r - prevRgb[dIdx]!) +
            Math.abs(g - prevRgb[dIdx + 1]!) +
            Math.abs(b - prevRgb[dIdx + 2]!);
        }
      }
      if (prevRgb) {
        motionDelta = round3(clamp01(diffSum / (pixelCount * 3 * 255)));
      }
      prevRgb = currRgb;

      samples.push({
        timeSec: round3(t),
        hist,
        lumaMean,
        ...(motionDelta !== undefined ? { motionDelta } : {}),
      });
    }

    return detectSceneCutsFromFrameSamples(samples, {
      threshold: opts?.threshold,
      minShotSec: opts?.minShotSec,
    });
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * Parses FFmpeg `scdet` filter output (`lavfi.scd.time:` / `lavfi.scd.score:`) into sorted,
 * deduplicated `DetectedCut[]` respecting `minShotSec`.
 */
export function parseFfmpegScdetOutput(
  stderrText: string,
  minShotSec = DEFAULT_MIN_SHOT_SEC,
): DetectedCut[] {
  if (!stderrText) return [];
  const safeMinShot = Math.max(0.1, minShotSec);
  const rawCuts: Array<{ rawTimeSec: number; score: number }> = [];

  let pendingScore: number | null = null;
  const lines = stderrText.split(/\r?\n/);

  for (const line of lines) {
    const scoreMatch = /lavfi\.scd\.score\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i.exec(line);
    const timeMatch = /lavfi\.scd\.time\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i.exec(line);

    if (scoreMatch && timeMatch) {
      const score = Number(scoreMatch[1]);
      const rawTimeSec = Number(timeMatch[1]);
      if (Number.isFinite(score) && Number.isFinite(rawTimeSec) && rawTimeSec > 0) {
        rawCuts.push({ rawTimeSec, score });
      }
      pendingScore = null;
      continue;
    }

    if (scoreMatch) {
      const score = Number(scoreMatch[1]);
      pendingScore = Number.isFinite(score) ? score : null;
      continue;
    }

    if (timeMatch) {
      const rawTimeSec = Number(timeMatch[1]);
      const score = pendingScore ?? 15;
      if (Number.isFinite(rawTimeSec) && rawTimeSec > 0) {
        rawCuts.push({ rawTimeSec, score });
      }
      pendingScore = null;
    }
  }

  rawCuts.sort((a, b) => a.rawTimeSec - b.rawTimeSec);

  const accepted: Array<{ rawTimeSec: number; score: number; cut: DetectedCut }> = [];
  for (const item of rawCuts) {
    if (item.rawTimeSec < safeMinShot - 1e-6) continue;
    const normalizedDelta = round3(
      clamp01(item.score > 1 ? item.score / 100 : item.score),
    );
    const confidence = round3(
      Math.min(0.99, Math.max(0.2, item.score > 1 ? item.score / 30 : item.score)),
    );
    const cut: DetectedCut = {
      timeSec: roundTenth(item.rawTimeSec),
      confidence,
      delta: normalizedDelta,
    };

    const prev = accepted[accepted.length - 1];
    if (!prev) {
      accepted.push({ rawTimeSec: item.rawTimeSec, score: item.score, cut });
      continue;
    }

    if (item.rawTimeSec - prev.rawTimeSec < safeMinShot - 1e-6) {
      if (item.score > prev.score) {
        accepted[accepted.length - 1] = { rawTimeSec: item.rawTimeSec, score: item.score, cut };
      }
      continue;
    }

    accepted.push({ rawTimeSec: item.rawTimeSec, score: item.score, cut });
  }

  return accepted.map((entry) => entry.cut);
}
