/**
 * Multi-scale context-ring alignment, residual gate, and edge-aware diff mask for region edits
 * (docs/BRAND-STUDIO-REGION-LAYERS.md §1–§4, docs/design/IDENTITY.md §6-4-3).
 *
 * Pure TypeScript + `sharp` (no OpenCV/WASM):
 * 1. `alignEditedRoi` estimates anisotropic scale `(sx, sy)` and translation `(dx, dy)` strictly on
 *    the outer context ring (`plan.roi \ plan.box`, falling back to an inner border band only when
 *    `roi` equals `box`), warps `edited` to `plan.roi.width × plan.roi.height` with Catmull-Rom
 *    bicubic sampling, and checks the post-tone-match outer-ring MAE (`ringResidual`).
 * 2. `computeDiffMask` builds a smooth `0..255` alpha mask inside `plan.box` (guaranteed `0` outside),
 *    widening the feather along box edges where `original` has strong Sobel structural contours and
 *    focusing on changed pixels for local logo/text edits while falling back to a smooth inset feather
 *    for whole-box replacements or subtle global detail edits.
 */
import sharp from 'sharp';
import { decodeRgba, SHARP_INPUT, type RgbaImage } from './pixels';
import type { PixelRect, RegionPlan } from './plan';

/** Post-tone-match outer-ring MAE (0..255) above which an edit is rejected as misaligned. */
export const MAX_RING_RESIDUAL = 22;

const PYRAMID_SIZES = [128, 256, 512] as const;
const PYRAMID_SIGMAS = [1.8, 1.5, 1.2] as const;
const MAX_RING_SAMPLES = 3600;
const MIN_OUTER_RING_PIXELS = 32;
const SCALE_MIN = 0.86;
const SCALE_MAX = 1.14;
const SHIFT_MAX = 0.14;

export interface AlignTransform {
  sx: number;
  sy: number;
  /** Normalized shift in ROI width/height fractions (multiply by `roi.width` / `roi.height` for pixels). */
  dx: number;
  dy: number;
}

export interface AlignedRoiResult {
  /** RGB buffer (`width * height * 3`) warped to `plan.roi`. */
  alignedRoi: Buffer;
  channels: 3;
  width: number;
  height: number;
  transform: AlignTransform;
  /** Normalized MAE (0..255) on the outer context ring after linear tone matching. */
  ringResidual: number;
  misaligned: boolean;
}

export interface ToneParams {
  gain: [number, number, number];
  offset: [number, number, number];
}

interface PyramidLevel {
  width: number;
  height: number;
  gray: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
}

interface RingSample {
  /** Normalized offset from ROI center in `[-0.5, 0.5]`. */
  u: number;
  v: number;
  rI: number;
  rGx: number;
  rGy: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function smoothstep01(d: number, f: number): number {
  if (f <= 0 || d > f) return 1;
  const t = d / (f + 1);
  return t * t * (3 - 2 * t);
}

function baseFeatherFor(box: PixelRect, requested?: number): number {
  const short = Math.min(box.width, box.height);
  const wanted = requested === undefined ? Math.max(4, Math.round(short * 0.03)) : Math.max(0, Math.round(requested));
  return Math.max(0, Math.min(wanted, Math.floor((short - 1) / 2)));
}

async function ensureRgba(input: RgbaImage | Uint8Array): Promise<RgbaImage> {
  if (input instanceof Uint8Array) return decodeRgba(input);
  return input;
}

/** Extracts `plan.roi` from `src` flattened over `#ffffff`, matching `cropForEdit`. */
function extractFlattenedRoiRgb(src: RgbaImage, roi: PixelRect): Buffer {
  const out = Buffer.allocUnsafe(roi.width * roi.height * 3);
  for (let y = 0; y < roi.height; y += 1) {
    const sy = roi.top + y;
    for (let x = 0; x < roi.width; x += 1) {
      const sx = roi.left + x;
      const si = (sy * src.width + sx) * 4;
      const di = (y * roi.width + x) * 3;
      const a = src.hasAlpha ? src.data[si + 3]! : 255;
      if (a === 255) {
        out[di] = src.data[si]!;
        out[di + 1] = src.data[si + 1]!;
        out[di + 2] = src.data[si + 2]!;
      } else if (a === 0) {
        out[di] = 255;
        out[di + 1] = 255;
        out[di + 2] = 255;
      } else {
        const inv = 255 - a;
        out[di] = Math.round((src.data[si]! * a + 255 * inv) / 255);
        out[di + 1] = Math.round((src.data[si + 1]! * a + 255 * inv) / 255);
        out[di + 2] = Math.round((src.data[si + 2]! * a + 255 * inv) / 255);
      }
    }
  }
  return out;
}

async function buildPyramidLevel(
  rgb: Buffer,
  srcW: number,
  srcH: number,
  channels: number,
  targetLong: number,
  sigma: number,
): Promise<PyramidLevel> {
  const long = Math.max(srcW, srcH);
  const scale = Math.min(1, targetLong / Math.max(1, long));
  const width = Math.max(8, Math.round(srcW * scale));
  const height = Math.max(8, Math.round(srcH * scale));
  let pipe = sharp(rgb, { raw: { width: srcW, height: srcH, channels: channels as 3 | 4 } }).resize(width, height, {
    fit: 'fill',
    kernel: 'lanczos3',
  });
  if (sigma >= 0.3 && width >= 4 && height >= 4) pipe = pipe.blur(sigma);
  const { data, info } = await pipe.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const c = info.channels;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; p < w * h; p += 1, i += c) {
    gray[p] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const ym = Math.max(0, y - 1) * w;
    const yc = y * w;
    const yp = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x += 1) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      gx[yc + x] = (gray[yc + xp]! - gray[yc + xm]!) * 0.5;
      gy[yc + x] = (gray[yp + x]! - gray[ym + x]!) * 0.5;
    }
  }
  return { width: w, height: h, gray, gx, gy };
}

function collectRingSamples(level: PyramidLevel, plan: RegionPlan): { samples: RingSample[]; stdI: number; meanGrad: number } {
  const { roi, box } = plan;
  const w = level.width;
  const h = level.height;
  const bx0 = (box.left - roi.left) / roi.width;
  const by0 = (box.top - roi.top) / roi.height;
  const bx1 = (box.left + box.width - roi.left) / roi.width;
  const by1 = (box.top + box.height - roi.top) / roi.height;

  const outerPixels = roi.width * roi.height - box.width * box.height;
  const useOuter = outerPixels >= MIN_OUTER_RING_PIXELS;
  const bandFrac = 0.12;

  const candidates: number[] = [];
  for (let y = 0; y < h; y += 1) {
    const fy = (y + 0.5) / h;
    for (let x = 0; x < w; x += 1) {
      const fx = (x + 0.5) / w;
      const inBox = fx >= bx0 && fx <= bx1 && fy >= by0 && fy <= by1;
      if (useOuter) {
        if (!inBox) candidates.push(y * w + x);
      } else if (inBox) {
        const dFrac = Math.min(
          (fx - bx0) / Math.max(1e-6, bx1 - bx0),
          (bx1 - fx) / Math.max(1e-6, bx1 - bx0),
          (fy - by0) / Math.max(1e-6, by1 - by0),
          (by1 - fy) / Math.max(1e-6, by1 - by0),
        );
        if (dFrac <= bandFrac) candidates.push(y * w + x);
      }
    }
  }

  const stride = Math.max(1, Math.floor(candidates.length / MAX_RING_SAMPLES));
  const samples: RingSample[] = [];
  let sum = 0;
  let sum2 = 0;
  let gradSum = 0;
  for (let i = 0; i < candidates.length; i += stride) {
    const idx = candidates[i]!;
    const x = idx % w;
    const y = Math.floor(idx / w);
    const rI = level.gray[idx]!;
    const rGx = level.gx[idx]!;
    const rGy = level.gy[idx]!;
    sum += rI;
    sum2 += rI * rI;
    gradSum += Math.abs(rGx) + Math.abs(rGy);
    samples.push({
      u: (x + 0.5) / w - 0.5,
      v: (y + 0.5) / h - 0.5,
      rI,
      rGx,
      rGy,
    });
  }
  const n = Math.max(1, samples.length);
  const mean = sum / n;
  const stdI = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const meanGrad = gradSum / n;
  return { samples, stdI, meanGrad };
}

function sampleBilinear(arr: Float32Array, w: number, h: number, fx: number, fy: number): number {
  const x = clamp(fx * w - 0.5, 0, w - 1);
  const y = clamp(fy * h - 0.5, 0, h - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const r0 = arr[y0 * w + x0]! * (1 - tx) + arr[y0 * w + x1]! * tx;
  const r1 = arr[y1 * w + x0]! * (1 - tx) + arr[y1 * w + x1]! * tx;
  return r0 * (1 - ty) + r1 * ty;
}

function evaluateTransform(
  samples: readonly RingSample[],
  edit: PyramidLevel,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
): number {
  const nTotal = samples.length;
  if (nTotal === 0) return 0;

  let valid = 0;
  let sumR = 0;
  let sumR2 = 0;
  let sumE = 0;
  let sumE2 = 0;
  let sumRE = 0;
  let gradDiff = 0;
  let gradNorm = 0;
  // Scale ratio between edit pyramid coordinates and ref pyramid coordinates for gradient comparison.
  const gxScale = sx;
  const gyScale = sy;

  for (let i = 0; i < nTotal; i += 1) {
    const s = samples[i]!;
    const ue = 0.5 + sx * s.u + dx;
    const ve = 0.5 + sy * s.v + dy;
    if (ue < 0.002 || ue > 0.998 || ve < 0.002 || ve > 0.998) continue;
    const eI = sampleBilinear(edit.gray, edit.width, edit.height, ue, ve);
    const eGx = sampleBilinear(edit.gx, edit.width, edit.height, ue, ve) * gxScale;
    const eGy = sampleBilinear(edit.gy, edit.width, edit.height, ue, ve) * gyScale;
    valid += 1;
    sumR += s.rI;
    sumR2 += s.rI * s.rI;
    sumE += eI;
    sumE2 += eI * eI;
    sumRE += s.rI * eI;
    gradDiff += Math.abs(s.rGx - eGx) + Math.abs(s.rGy - eGy);
    gradNorm += Math.abs(s.rGx) + Math.abs(s.rGy) + Math.abs(eGx) + Math.abs(eGy);
  }

  if (valid < Math.max(8, Math.floor(nTotal * 0.4))) return Number.POSITIVE_INFINITY;

  const mr = sumR / valid;
  const me = sumE / valid;
  const vr = Math.max(0, sumR2 / valid - mr * mr);
  const ve = Math.max(0, sumE2 / valid - me * me);
  const cov = sumRE / valid - mr * me;

  // Zero-mean normalized correlation distance (0 = identical up to linear gain/offset, 1 = uncorrelated).
  const denom = Math.sqrt(vr * ve);
  const znccDist = denom > 2 ? 1 - clamp(cov / denom, -1, 1) : Math.abs(mr - me) / 255;
  const gradTerm = gradDiff / (gradNorm + valid * 4);
  const reg = 0.0025 * ((sx - 1) * (sx - 1) + (sy - 1) * (sy - 1) + dx * dx + dy * dy);
  return znccDist * 0.55 + gradTerm * 0.45 + reg;
}

function refineAtLevel(
  samples: readonly RingSample[],
  edit: PyramidLevel,
  initial: AlignTransform,
  steps: ReadonlyArray<{ stepS: number; stepD: number; radius: number }>,
  bounds: { sMin: number; sMax: number; dMax: number },
): AlignTransform {
  let { sx, sy, dx, dy } = initial;
  let best = evaluateTransform(samples, edit, sx, sy, dx, dy);

  for (const { stepS, stepD, radius } of steps) {
    for (let pass = 0; pass < 2; pass += 1) {
      // 1) 2D translation search around current (dx, dy)
      let nextDx = dx;
      let nextDy = dy;
      for (let iy = -radius; iy <= radius; iy += 1) {
        const cy = clamp(dy + iy * stepD, -bounds.dMax, bounds.dMax);
        for (let ix = -radius; ix <= radius; ix += 1) {
          const cx = clamp(dx + ix * stepD, -bounds.dMax, bounds.dMax);
          const loss = evaluateTransform(samples, edit, sx, sy, cx, cy);
          if (loss < best) {
            best = loss;
            nextDx = cx;
            nextDy = cy;
          }
        }
      }
      dx = nextDx;
      dy = nextDy;

      // 2) 2D scale search around current (sx, sy)
      let nextSx = sx;
      let nextSy = sy;
      for (let iy = -radius; iy <= radius; iy += 1) {
        const csy = clamp(sy + iy * stepS, bounds.sMin, bounds.sMax);
        for (let ix = -radius; ix <= radius; ix += 1) {
          const csx = clamp(sx + ix * stepS, bounds.sMin, bounds.sMax);
          const loss = evaluateTransform(samples, edit, csx, csy, dx, dy);
          if (loss < best) {
            best = loss;
            nextSx = csx;
            nextSy = csy;
          }
        }
      }
      sx = nextSx;
      sy = nextSy;
    }
  }
  return { sx, sy, dx, dy };
}

function parabolicStep(
  evalAt: (delta: number) => number,
  centerLoss: number,
  h: number,
): number {
  const lm = evalAt(-h);
  const lp = evalAt(h);
  if (!Number.isFinite(lm) || !Number.isFinite(lp)) return 0;
  const denom = lm - 2 * centerLoss + lp;
  if (denom <= 1e-9) return 0;
  return clamp((0.5 * h * (lm - lp)) / denom, -h, h);
}

function subpixelParabolicRefine(
  samples: readonly RingSample[],
  edit: PyramidLevel,
  cur: AlignTransform,
  pixelH: { hx: number; hy: number; hs: number },
  bounds: { sMin: number; sMax: number; dMax: number },
): AlignTransform {
  let { sx, sy, dx, dy } = cur;
  let best = evaluateTransform(samples, edit, sx, sy, dx, dy);

  for (let round = 0; round < 2; round += 1) {
    const scale = round === 0 ? 1 : 0.4;
    const hx = pixelH.hx * scale;
    const hy = pixelH.hy * scale;
    const hs = pixelH.hs * scale;

    const ddx = parabolicStep((d) => evaluateTransform(samples, edit, sx, sy, clamp(dx + d, -bounds.dMax, bounds.dMax), dy), best, hx);
    if (ddx !== 0) {
      const cand = clamp(dx + ddx, -bounds.dMax, bounds.dMax);
      const loss = evaluateTransform(samples, edit, sx, sy, cand, dy);
      if (loss < best) {
        dx = cand;
        best = loss;
      }
    }

    const ddy = parabolicStep((d) => evaluateTransform(samples, edit, sx, sy, dx, clamp(dy + d, -bounds.dMax, bounds.dMax)), best, hy);
    if (ddy !== 0) {
      const cand = clamp(dy + ddy, -bounds.dMax, bounds.dMax);
      const loss = evaluateTransform(samples, edit, sx, sy, dx, cand);
      if (loss < best) {
        dy = cand;
        best = loss;
      }
    }

    const dsx = parabolicStep((d) => evaluateTransform(samples, edit, clamp(sx + d, bounds.sMin, bounds.sMax), sy, dx, dy), best, hs);
    if (dsx !== 0) {
      const cand = clamp(sx + dsx, bounds.sMin, bounds.sMax);
      const loss = evaluateTransform(samples, edit, cand, sy, dx, dy);
      if (loss < best) {
        sx = cand;
        best = loss;
      }
    }

    const dsy = parabolicStep((d) => evaluateTransform(samples, edit, sx, clamp(sy + d, bounds.sMin, bounds.sMax), dx, dy), best, hs);
    if (dsy !== 0) {
      const cand = clamp(sy + dsy, bounds.sMin, bounds.sMax);
      const loss = evaluateTransform(samples, edit, sx, cand, dx, dy);
      if (loss < best) {
        sy = cand;
        best = loss;
      }
    }
  }
  return { sx, sy, dx, dy };
}

/** Catmull-Rom cubic weight (a = -0.5). Exact [0, 1, 0, 0] at t = 0 so integer samples never blur. */
function cubicWeight(t: number, out: Float64Array): void {
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = -0.5 * t + t2 - 0.5 * t3;
  out[1] = 1 - 2.5 * t2 + 1.5 * t3;
  out[2] = 0.5 * t + 2 * t2 - 1.5 * t3;
  out[3] = -0.5 * t2 + 0.5 * t3;
}

function warpRgbBicubic(
  editData: Buffer,
  editW: number,
  editH: number,
  editC: number,
  outW: number,
  outH: number,
  transform: AlignTransform,
): Buffer {
  const out = Buffer.allocUnsafe(outW * outH * 3);
  const wx = new Float64Array(4);
  const wy = new Float64Array(4);
  const { sx, sy, dx, dy } = transform;

  for (let y = 0; y < outH; y += 1) {
    const v = (y + 0.5) / outH - 0.5;
    const ve = 0.5 + sy * v + dy;
    const fy = clamp(ve * editH - 0.5, 0, editH - 1);
    const iy = Math.floor(fy);
    cubicWeight(fy - iy, wy);
    const y0 = clamp(iy - 1, 0, editH - 1) * editW;
    const y1 = clamp(iy, 0, editH - 1) * editW;
    const y2 = clamp(iy + 1, 0, editH - 1) * editW;
    const y3 = clamp(iy + 2, 0, editH - 1) * editW;

    for (let x = 0; x < outW; x += 1) {
      const u = (x + 0.5) / outW - 0.5;
      const ue = 0.5 + sx * u + dx;
      const fx = clamp(ue * editW - 0.5, 0, editW - 1);
      const ix = Math.floor(fx);
      cubicWeight(fx - ix, wx);
      const x0 = clamp(ix - 1, 0, editW - 1);
      const x1 = clamp(ix, 0, editW - 1);
      const x2 = clamp(ix + 1, 0, editW - 1);
      const x3 = clamp(ix + 2, 0, editW - 1);

      const di = (y * outW + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const r0 =
          editData[(y0 + x0) * editC + c]! * wx[0]! +
          editData[(y0 + x1) * editC + c]! * wx[1]! +
          editData[(y0 + x2) * editC + c]! * wx[2]! +
          editData[(y0 + x3) * editC + c]! * wx[3]!;
        const r1 =
          editData[(y1 + x0) * editC + c]! * wx[0]! +
          editData[(y1 + x1) * editC + c]! * wx[1]! +
          editData[(y1 + x2) * editC + c]! * wx[2]! +
          editData[(y1 + x3) * editC + c]! * wx[3]!;
        const r2 =
          editData[(y2 + x0) * editC + c]! * wx[0]! +
          editData[(y2 + x1) * editC + c]! * wx[1]! +
          editData[(y2 + x2) * editC + c]! * wx[2]! +
          editData[(y2 + x3) * editC + c]! * wx[3]!;
        const r3 =
          editData[(y3 + x0) * editC + c]! * wx[0]! +
          editData[(y3 + x1) * editC + c]! * wx[1]! +
          editData[(y3 + x2) * editC + c]! * wx[2]! +
          editData[(y3 + x3) * editC + c]! * wx[3]!;
        const val = r0 * wy[0]! + r1 * wy[1]! + r2 * wy[2]! + r3 * wy[3]!;
        out[di + c] = Math.round(clamp(val, 0, 255));
      }
    }
  }
  return out;
}

function fitLinearToneOnRing(refRgb: Buffer, alignedRgb: Buffer, plan: RegionPlan, ringWidth: number): ToneParams {
  const { roi, box } = plan;
  const bx0 = box.left - roi.left;
  const by0 = box.top - roi.top;
  const bx1 = bx0 + box.width;
  const by1 = by0 + box.height;

  const collect = (outside: boolean) => {
    const o = [0, 0, 0];
    const e = [0, 0, 0];
    const o2 = [0, 0, 0];
    const e2 = [0, 0, 0];
    let n = 0;
    const x0 = Math.max(0, bx0 - (outside ? ringWidth : 0));
    const x1 = Math.min(roi.width, bx1 + (outside ? ringWidth : 0));
    const y0 = Math.max(0, by0 - (outside ? ringWidth : 0));
    const y1 = Math.min(roi.height, by1 + (outside ? ringWidth : 0));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const inBox = x >= bx0 && x < bx1 && y >= by0 && y < by1;
        if (outside === inBox) continue;
        if (!outside) {
          const d = Math.min(x - bx0, bx1 - 1 - x, y - by0, by1 - 1 - y);
          if (d >= ringWidth) continue;
        }
        const idx = (y * roi.width + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          const ov = refRgb[idx + c]!;
          const ev = alignedRgb[idx + c]!;
          o[c]! += ov;
          e[c]! += ev;
          o2[c]! += ov * ov;
          e2[c]! += ev * ev;
        }
        n += 1;
      }
    }
    return { o, e, o2, e2, n };
  };

  let stats = collect(true);
  if (stats.n < 16) stats = collect(false);
  const tone: ToneParams = { gain: [1, 1, 1], offset: [0, 0, 0] };
  if (stats.n === 0) return tone;
  for (let c = 0; c < 3; c += 1) {
    const mo = stats.o[c]! / stats.n;
    const me = stats.e[c]! / stats.n;
    const so = Math.sqrt(Math.max(0, stats.o2[c]! / stats.n - mo * mo));
    const se = Math.sqrt(Math.max(0, stats.e2[c]! / stats.n - me * me));
    const gain = so >= 4 && se >= 4 ? clamp(so / se, 0.8, 1.25) : 1;
    tone.gain[c] = gain;
    tone.offset[c] = clamp(mo - gain * me, -40, 40);
  }
  return tone;
}

function measureOuterRingResidual(
  refRgb: Buffer,
  alignedRgb: Buffer,
  plan: RegionPlan,
  transform: AlignTransform,
  tone: ToneParams,
): number {
  const { roi, box } = plan;
  const outerPixels = roi.width * roi.height - box.width * box.height;
  // Whole-picture fallback (roi === box): there is no unchanged outer ring to reject on.
  if (outerPixels < MIN_OUTER_RING_PIXELS) return 0;

  const bx0 = box.left - roi.left;
  const by0 = box.top - roi.top;
  const bx1 = bx0 + box.width;
  const by1 = by0 + box.height;
  let diffSum = 0;
  let count = 0;

  for (let y = 0; y < roi.height; y += 1) {
    const v = (y + 0.5) / roi.height - 0.5;
    const ve = 0.5 + transform.sy * v + transform.dy;
    if (ve < 0 || ve > 1) continue;
    for (let x = 0; x < roi.width; x += 1) {
      if (x >= bx0 && x < bx1 && y >= by0 && y < by1) continue;
      const u = (x + 0.5) / roi.width - 0.5;
      const ue = 0.5 + transform.sx * u + transform.dx;
      if (ue < 0 || ue > 1) continue;
      const idx = (y * roi.width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const corrected = clamp(alignedRgb[idx + c]! * tone.gain[c]! + tone.offset[c]!, 0, 255);
        diffSum += Math.abs(refRgb[idx + c]! - corrected);
      }
      count += 3;
    }
  }
  return count > 0 ? diffSum / count : 0;
}

export async function alignEditedRoi(input: {
  original: RgbaImage | Uint8Array;
  edited: Uint8Array;
  plan: RegionPlan;
}): Promise<AlignedRoiResult> {
  const { plan } = input;
  const src = await ensureRgba(input.original);
  const { roi, box } = plan;
  const rw = roi.width;
  const rh = roi.height;

  const editDecoded = await sharp(input.edited, SHARP_INPUT)
    .rotate()
    .toColourspace('srgb')
    .flatten({ background: '#ffffff' })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  const editW = editDecoded.info.width;
  const editH = editDecoded.info.height;
  const editC = editDecoded.info.channels;
  if (editC < 3 || editW < 1 || editH < 1) throw new Error('region_edit_decode');

  const refRoiRgb = extractFlattenedRoiRgb(src, roi);
  const ringWidth = Math.max(2, Math.round(Math.min(box.width, box.height) * 0.06));

  let transform: AlignTransform = { sx: 1, sy: 1, dx: 0, dy: 0 };

  // Very tiny ROIs (< 16 px) have too few pixels for pyramid alignment; keep identity warp.
  if (rw >= 16 && rh >= 16 && editW >= 16 && editH >= 16) {
    const refLevels = await Promise.all(
      PYRAMID_SIZES.map((size, idx) => buildPyramidLevel(refRoiRgb, rw, rh, 3, size, PYRAMID_SIGMAS[idx]!)),
    );
    const editLevels = await Promise.all(
      PYRAMID_SIZES.map((size, idx) => buildPyramidLevel(editDecoded.data, editW, editH, editC, size, PYRAMID_SIGMAS[idx]!)),
    );

    const ring0 = collectRingSamples(refLevels[0]!, plan);
    const flatRing = ring0.stdI < 1.2 && ring0.meanGrad < 0.8;

    if (!flatRing && ring0.samples.length >= 16) {
      const editRatio = editW / editH;
      const workRatio = plan.work.width / Math.max(1, plan.work.height);
      const roiRatio = rw / rh;
      const aspectDrift = Math.max(Math.abs(Math.log(editRatio / workRatio)), Math.abs(Math.log(editRatio / roiRatio)));
      const bounds = {
        sMin: aspectDrift > 0.12 ? 0.58 : SCALE_MIN,
        sMax: aspectDrift > 0.12 ? 1.72 : SCALE_MAX,
        dMax: SHIFT_MAX,
      };

      // Coarse global search on Level 0 (128px)
      let bestLoss = evaluateTransform(ring0.samples, editLevels[0]!, 1, 1, 0, 0);
      let best: AlignTransform = { sx: 1, sy: 1, dx: 0, dy: 0 };

      const seeds: Array<[number, number]> = [];
      for (let s = 0.88; s <= 1.1201; s += 0.03) seeds.push([s, s]);
      if (aspectDrift > 0.03) {
        seeds.push(
          [clamp(roiRatio / editRatio, bounds.sMin, bounds.sMax), 1],
          [1, clamp(editRatio / roiRatio, bounds.sMin, bounds.sMax)],
          [clamp(workRatio / editRatio, bounds.sMin, bounds.sMax), 1],
          [1, clamp(editRatio / workRatio, bounds.sMin, bounds.sMax)],
        );
      }

      for (const [csx, csy] of seeds) {
        for (let dy = -0.12; dy <= 0.1201; dy += 0.02) {
          for (let dx = -0.12; dx <= 0.1201; dx += 0.02) {
            const loss = evaluateTransform(ring0.samples, editLevels[0]!, csx, csy, dx, dy);
            if (loss < bestLoss) {
              bestLoss = loss;
              best = { sx: csx, sy: csy, dx, dy };
            }
          }
        }
      }

      best = refineAtLevel(
        ring0.samples,
        editLevels[0]!,
        best,
        [
          { stepS: 0.015, stepD: 0.01, radius: 2 },
          { stepS: 0.008, stepD: 0.004, radius: 2 },
        ],
        bounds,
      );

      // Medium refinement on Level 1 (256px)
      const ring1 = collectRingSamples(refLevels[1]!, plan);
      best = refineAtLevel(
        ring1.samples,
        editLevels[1]!,
        best,
        [
          { stepS: 0.006, stepD: 0.003, radius: 2 },
          { stepS: 0.0025, stepD: 0.0012, radius: 2 },
        ],
        bounds,
      );

      // Fine & sub-pixel parabolic refinement on Level 2 (512px)
      const ring2 = collectRingSamples(refLevels[2]!, plan);
      const pxX = 1 / Math.max(64, rw);
      const pxY = 1 / Math.max(64, rh);
      best = refineAtLevel(
        ring2.samples,
        editLevels[2]!,
        best,
        [
          { stepS: 0.0015, stepD: Math.max(pxX, pxY), radius: 2 },
          { stepS: 0.0006, stepD: Math.max(pxX, pxY) * 0.5, radius: 2 },
        ],
        bounds,
      );
      best = subpixelParabolicRefine(
        ring2.samples,
        editLevels[2]!,
        best,
        { hx: pxX * 0.75, hy: pxY * 0.75, hs: 0.0008 },
        bounds,
      );

      const idLoss = evaluateTransform(ring2.samples, editLevels[2]!, 1, 1, 0, 0);
      const alignedLoss = evaluateTransform(ring2.samples, editLevels[2]!, best.sx, best.sy, best.dx, best.dy);
      if (alignedLoss < idLoss - 1e-5) {
        transform = best;
      }
    }
  }

  const alignedRoi =
    transform.sx === 1 && transform.sy === 1 && transform.dx === 0 && transform.dy === 0 && editW === rw && editH === rh && editC === 3
      ? Buffer.from(editDecoded.data)
      : warpRgbBicubic(editDecoded.data, editW, editH, editC, rw, rh, transform);

  const tone = fitLinearToneOnRing(refRoiRgb, alignedRoi, plan, ringWidth);
  const ringResidual = measureOuterRingResidual(refRoiRgb, alignedRoi, plan, transform, tone);
  const misaligned = ringResidual > MAX_RING_RESIDUAL;

  return {
    alignedRoi,
    channels: 3,
    width: rw,
    height: rh,
    transform,
    ringResidual,
    misaligned,
  };
}

/* ------------------------------------------------ diff & contour-aware mask */

function luminanceAt(src: RgbaImage, x: number, y: number): number {
  const cx = clamp(x, 0, src.width - 1);
  const cy = clamp(y, 0, src.height - 1);
  const i = (cy * src.width + cx) * 4;
  const a = src.hasAlpha ? src.data[i + 3]! : 255;
  const r = a === 255 ? src.data[i]! : (src.data[i]! * a + 255 * (255 - a)) / 255;
  const g = a === 255 ? src.data[i + 1]! : (src.data[i + 1]! * a + 255 * (255 - a)) / 255;
  const b = a === 255 ? src.data[i + 2]! : (src.data[i + 2]! * a + 255 * (255 - a)) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function sobelMagnitudeAt(src: RgbaImage, x: number, y: number): number {
  const nw = luminanceAt(src, x - 1, y - 1);
  const n = luminanceAt(src, x, y - 1);
  const ne = luminanceAt(src, x + 1, y - 1);
  const w = luminanceAt(src, x - 1, y);
  const e = luminanceAt(src, x + 1, y);
  const sw = luminanceAt(src, x - 1, y + 1);
  const s = luminanceAt(src, x, y + 1);
  const se = luminanceAt(src, x + 1, y + 1);
  const gx = -nw + ne - 2 * w + 2 * e - sw + se;
  const gy = -nw - 2 * n - ne + sw + 2 * s + se;
  return Math.hypot(gx, gy) * 0.25;
}

function smooth1D(values: Float32Array, radius: number): Float32Array {
  const n = values.length;
  if (n <= 1 || radius <= 0) return values;
  const out = new Float32Array(n);
  let sum = 0;
  let count = 0;
  for (let i = 0; i <= Math.min(n - 1, radius); i += 1) {
    sum += values[i]!;
    count += 1;
  }
  for (let i = 0; i < n; i += 1) {
    out[i] = sum / count;
    const addIdx = i + radius + 1;
    const subIdx = i - radius;
    if (addIdx < n) {
      sum += values[addIdx]!;
      count += 1;
    }
    if (subIdx >= 0) {
      sum -= values[subIdx]!;
      count -= 1;
    }
  }
  return out;
}

function dilate2D(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      let m = 0;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      for (let k = x0; k <= x1; k += 1) {
        const v = src[row + k]!;
        if (v > m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      let m = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      for (let k = y0; k <= y1; k += 1) {
        const v = tmp[k * w + x]!;
        if (v > m) m = v;
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

function boxBlur2D(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src;
  let cur = src;
  for (let pass = 0; pass < 2; pass += 1) {
    const tmp = new Float32Array(w * h);
    const next = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      let sum = 0;
      let count = 0;
      for (let x = 0; x <= Math.min(w - 1, radius); x += 1) {
        sum += cur[row + x]!;
        count += 1;
      }
      for (let x = 0; x < w; x += 1) {
        tmp[row + x] = sum / count;
        if (x + radius + 1 < w) {
          sum += cur[row + x + radius + 1]!;
          count += 1;
        }
        if (x - radius >= 0) {
          sum -= cur[row + x - radius]!;
          count -= 1;
        }
      }
    }
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let count = 0;
      for (let y = 0; y <= Math.min(h - 1, radius); y += 1) {
        sum += tmp[y * w + x]!;
        count += 1;
      }
      for (let y = 0; y < h; y += 1) {
        next[y * w + x] = sum / count;
        if (y + radius + 1 < h) {
          sum += tmp[(y + radius + 1) * w + x]!;
          count += 1;
        }
        if (y - radius >= 0) {
          sum -= tmp[(y - radius) * w + x]!;
          count -= 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Computes a soft `0..255` alpha mask of size `plan.box.width * plan.box.height` inside `plan.box`
 * (outside `plan.box` is strictly `0`).
 */
export async function computeDiffMask(input: {
  original: RgbaImage | Uint8Array;
  alignedRoi: Buffer | { data: Buffer; channels: number };
  plan: RegionPlan;
  feather?: number;
  tone?: ToneParams;
}): Promise<Uint8Array> {
  const src = await ensureRgba(input.original);
  const { roi, box } = input.plan;
  const bw = box.width;
  const bh = box.height;
  const short = Math.min(bw, bh);
  const baseF = baseFeatherFor(box, input.feather);

  const editBuf = Buffer.isBuffer(input.alignedRoi) ? input.alignedRoi : input.alignedRoi.data;
  const editC = Buffer.isBuffer(input.alignedRoi) ? 3 : input.alignedRoi.channels;

  const mask = new Uint8Array(bw * bh);
  if (bw <= 6 || bh <= 6) {
    for (let by = 0; by < bh; by += 1) {
      for (let bx = 0; bx < bw; bx += 1) {
        const d = Math.min(bx + 1, bw - bx, by + 1, bh - by);
        mask[by * bw + bx] = Math.round(smoothstep01(d, baseF) * 255);
      }
    }
    return mask;
  }

  // Sobel contour strength along the 4 edges of plan.box -> wider soft falloff where object edges cross box.
  const widenEdges = input.feather === undefined;
  const maxF = widenEdges
    ? Math.min(Math.floor((short - 1) / 2), Math.max(baseF, Math.round(short * 0.12)))
    : baseF;
  const edgeSmoothR = Math.max(3, Math.round(short * 0.04));

  const topGrad = new Float32Array(bw);
  const bottomGrad = new Float32Array(bw);
  for (let bx = 0; bx < bw; bx += 1) {
    topGrad[bx] = sobelMagnitudeAt(src, box.left + bx, box.top);
    bottomGrad[bx] = sobelMagnitudeAt(src, box.left + bx, box.top + bh - 1);
  }
  const leftGrad = new Float32Array(bh);
  const rightGrad = new Float32Array(bh);
  for (let by = 0; by < bh; by += 1) {
    leftGrad[by] = sobelMagnitudeAt(src, box.left, box.top + by);
    rightGrad[by] = sobelMagnitudeAt(src, box.left + bw - 1, box.top + by);
  }

  const topS = smooth1D(topGrad, edgeSmoothR);
  const bottomS = smooth1D(bottomGrad, edgeSmoothR);
  const leftS = smooth1D(leftGrad, edgeSmoothR);
  const rightS = smooth1D(rightGrad, edgeSmoothR);

  const edgeFeatherOf = (g: number) => {
    if (!widenEdges || maxF <= baseF) return baseF;
    const strength = clamp((g - 18) / 56, 0, 1);
    return baseF + strength * (maxF - baseF);
  };

  const envelope = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by += 1) {
    const fL = edgeFeatherOf(leftS[by]!);
    const fR = edgeFeatherOf(rightS[by]!);
    for (let bx = 0; bx < bw; bx += 1) {
      const fT = edgeFeatherOf(topS[bx]!);
      const fB = edgeFeatherOf(bottomS[bx]!);
      const wL = smoothstep01(bx + 1, fL);
      const wR = smoothstep01(bw - bx, fR);
      const wT = smoothstep01(by + 1, fT);
      const wB = smoothstep01(bh - by, fB);
      envelope[by * bw + bx] = Math.min(wL, wR, wT, wB);
    }
  }

  // Tone parameters so global brightness drift in unchanged background does not look like a local edit.
  const tone: ToneParams =
    input.tone ??
    (() => {
      const refRoiRgb = extractFlattenedRoiRgb(src, roi);
      const rgb3 =
        editC === 3
          ? editBuf
          : (() => {
              const b = Buffer.allocUnsafe(roi.width * roi.height * 3);
              for (let i = 0, p = 0; p < roi.width * roi.height; p += 1, i += editC) {
                b[p * 3] = editBuf[i]!;
                b[p * 3 + 1] = editBuf[i + 1]!;
                b[p * 3 + 2] = editBuf[i + 2]!;
              }
              return b;
            })();
      const ringW = Math.max(2, Math.round(short * 0.06));
      return fitLinearToneOnRing(refRoiRgb, rgb3, input.plan, ringW);
    })();

  const rawDiff = new Float32Array(bw * bh);
  let activeCount = 0;
  for (let by = 0; by < bh; by += 1) {
    const sy = box.top + by;
    const ry = sy - roi.top;
    for (let bx = 0; bx < bw; bx += 1) {
      const sx = box.left + bx;
      const rx = sx - roi.left;
      const oi = (sy * src.width + sx) * 4;
      const ei = (ry * roi.width + rx) * editC;
      const a = src.hasAlpha ? src.data[oi + 3]! : 255;
      let maxD = 0;
      let sumD = 0;
      for (let c = 0; c < 3; c += 1) {
        const origC = a === 255 ? src.data[oi + c]! : (src.data[oi + c]! * a + 255 * (255 - a)) / 255;
        const editVal = clamp(editBuf[ei + c]! * tone.gain[c]! + tone.offset[c]!, 0, 255);
        const d = Math.abs(editVal - origC);
        if (d > maxD) maxD = d;
        sumD += d;
      }
      const d = 0.5 * maxD + 0.5 * (sumD / 3);
      if (d >= 10) activeCount += 1;
      rawDiff[by * bw + bx] = clamp((d - 6) / 20, 0, 1);
    }
  }

  const changedRatio = activeCount / (bw * bh);
  // Fallback when diff is near-empty (subtle texture/brightness pass) or whole box changed (e.g. face swap).
  if (changedRatio < 0.015 || changedRatio > 0.72) {
    for (let i = 0; i < bw * bh; i += 1) {
      mask[i] = Math.round(clamp(envelope[i]! * 255, 0, 255));
    }
    return mask;
  }

  const rDilate = clamp(Math.round(short * 0.045), 2, 18);
  const rBlur = clamp(Math.round(short * 0.05), 3, 24);
  const dilated = dilate2D(rawDiff, bw, bh, rDilate);
  const smoothed = boxBlur2D(dilated, bw, bh, rBlur);

  for (let i = 0; i < bw * bh; i += 1) {
    mask[i] = Math.round(clamp(smoothed[i]! * envelope[i]! * 255, 0, 255));
  }
  return mask;
}

/** Alpha value (`0..255`) at full-picture coordinate `(x, y)`; guaranteed `0` outside `plan.box`. */
export function diffMaskAt(mask: Uint8Array, plan: RegionPlan, x: number, y: number): number {
  const { box } = plan;
  if (x < box.left || x >= box.left + box.width || y < box.top || y >= box.top + box.height) return 0;
  return mask[(y - box.top) * box.width + (x - box.left)] ?? 0;
}
