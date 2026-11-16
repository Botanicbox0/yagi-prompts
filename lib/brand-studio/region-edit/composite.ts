/**
 * Crop out, and paste back, a region edit (IDENTITY §6-4-3 with sharp only).
 *
 * The paste follows the hand method in Video-Creator's local-fix script, simplified to what a
 * server can do without OpenCV: scale the edit back to the crop, correct its overall tone from the
 * ring around the customer's box, and blend it in with a feather that lies entirely inside the box. A
 * box side on the picture's border gets no feather (align.ts `computeDiffMask`): nothing lies beyond it.
 * Every pixel outside the box is copied from the original untouched — that is the invariant the
 * tests check on raw buffers. Not done here: sub-pixel alignment of a shifted edit (ECC) and the
 * low-frequency tone transfer of the hand script, which would also undo an intended colour change.
 */
import sharp from 'sharp';
import { alignEditedRoi, computeDiffMask, type AlignTransform } from './align';
import { computeChangeMask } from './paste';
import { widestZone } from './window';
import { decodeRgba, encodePng, type RgbaImage } from './pixels';
import type { PixelRect, RegionPlan } from './plan';

/** Gain and offset limits for the tone match: correct drift, never repaint. */
const GAIN_MIN = 0.8;
const GAIN_MAX = 1.25;
const OFFSET_MAX = 40;
/** Below this spread (in levels) the ring is flat and only an offset is fitted. */
const FLAT_SPREAD = 4;
const RING_MIN_PIXELS = 16;

function inside(outer: { width: number; height: number }, r: PixelRect): boolean {
  return (
    Number.isInteger(r.left) && Number.isInteger(r.top) && r.width >= 1 && r.height >= 1 &&
    r.left >= 0 && r.top >= 0 && r.left + r.width <= outer.width && r.top + r.height <= outer.height
  );
}

function assertPlan(image: { width: number; height: number }, plan: RegionPlan): void {
  const boxInRoi =
    plan.box.left >= plan.roi.left && plan.box.top >= plan.roi.top &&
    plan.box.left + plan.box.width <= plan.roi.left + plan.roi.width &&
    plan.box.top + plan.box.height <= plan.roi.top + plan.roi.height;
  if (!inside(image, plan.roi) || !inside(image, plan.box) || !boxInRoi) throw new Error('region_plan_mismatch');
  if (plan.select) {
    const s = plan.select;
    const selectInBox =
      s.left >= plan.box.left && s.top >= plan.box.top &&
      s.left + s.width <= plan.box.left + plan.box.width && s.top + s.height <= plan.box.top + plan.box.height;
    if (!inside(image, s) || !selectInBox) throw new Error('region_plan_mismatch');
  }
  if (plan.work.width < 1 || plan.work.height < 1) throw new Error('region_plan_mismatch');
}

/** The crop the edit model receives: the ROI, transparency flattened on white, enlarged to `work`. */
export async function cropForEdit(original: Uint8Array, plan: RegionPlan): Promise<{ bytes: Uint8Array; mime: 'image/png' }> {
  const src = await decodeRgba(original);
  assertPlan(src, plan);
  const bytes = await sharp(src.data, { raw: { width: src.width, height: src.height, channels: 4 } })
    .extract(plan.roi)
    .flatten({ background: '#ffffff' })
    .resize(plan.work.width, plan.work.height, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 6 })
    .toBuffer();
  return { bytes, mime: 'image/png' };
}

export interface Tone {
  gain: [number, number, number];
  offset: [number, number, number];
}

/**
 * Per-channel gain and offset that bring the edit's ring to the original's: the gain matches the
 * spread, the offset then matches the mean (a plain brightness drift becomes a pure offset, a colour
 * cast a gain). Both are clamped. The ring is the band just outside the box inside the crop (what
 * the model should not have changed); when the box touches the crop's edge, the band just inside
 * the box is used instead. `edit` is RGB(A), `channels` wide, the size of the ROI.
 */
export function matchTone(
  original: RgbaImage,
  edit: { data: Buffer; channels: number },
  plan: RegionPlan,
  ringWidth: number,
): Tone {
  const { roi, box } = plan;
  const sums = (outside: boolean) => {
    const o = [0, 0, 0];
    const e = [0, 0, 0];
    const o2 = [0, 0, 0];
    const e2 = [0, 0, 0];
    let n = 0;
    const x0 = Math.max(roi.left, box.left - (outside ? ringWidth : 0));
    const x1 = Math.min(roi.left + roi.width, box.left + box.width + (outside ? ringWidth : 0));
    const y0 = Math.max(roi.top, box.top - (outside ? ringWidth : 0));
    const y1 = Math.min(roi.top + roi.height, box.top + box.height + (outside ? ringWidth : 0));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const inBox = x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
        if (outside === inBox) continue;
        if (!outside) {
          const d = Math.min(x - box.left, box.left + box.width - 1 - x, y - box.top, box.top + box.height - 1 - y);
          if (d >= ringWidth) continue;
        }
        const oi = (y * original.width + x) * 4;
        const ei = ((y - roi.top) * roi.width + (x - roi.left)) * edit.channels;
        for (let c = 0; c < 3; c += 1) {
          const ov = original.data[oi + c]!;
          const ev = edit.data[ei + c]!;
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
  let ring = sums(true);
  if (ring.n < RING_MIN_PIXELS) ring = sums(false);
  const tone: Tone = { gain: [1, 1, 1], offset: [0, 0, 0] };
  if (ring.n === 0) return tone;
  for (let c = 0; c < 3; c += 1) {
    const mo = ring.o[c]! / ring.n;
    const me = ring.e[c]! / ring.n;
    const so = Math.sqrt(Math.max(0, ring.o2[c]! / ring.n - mo * mo));
    const se = Math.sqrt(Math.max(0, ring.e2[c]! / ring.n - me * me));
    const gain = so >= FLAT_SPREAD && se >= FLAT_SPREAD ? Math.min(GAIN_MAX, Math.max(GAIN_MIN, so / se)) : 1;
    tone.gain[c] = gain;
    tone.offset[c] = Math.min(OFFSET_MAX, Math.max(-OFFSET_MAX, mo - gain * me));
  }
  return tone;
}

/** Blend weight at distance `d` (1 = on the box edge) for a feather of `f` pixels: 0 → 1 inside. */
export function featherWeight(d: number, f: number): number {
  if (f <= 0 || d > f) return 1;
  const t = d / (f + 1);
  return t * t * (3 - 2 * t);
}

export function defaultFeather(box: PixelRect, requested?: number): number {
  const short = Math.min(box.width, box.height);
  const wanted = requested === undefined ? Math.max(4, Math.round(short * 0.03)) : Math.max(0, Math.round(requested));
  return Math.max(0, Math.min(wanted, Math.floor((short - 1) / 2)));
}

export interface CompositeRegionResult {
  bytes: Uint8Array;
  mime: 'image/png';
  width: number;
  height: number;
  patchPng?: Buffer;
  maskPng?: Buffer;
  misaligned?: boolean;
  ringResidual?: number;
  transform?: AlignTransform;
  /** Window plans only: false when nothing that changed touched the box and the box itself was pasted. */
  changeFound?: boolean;
  /** Window plans only: share of the paste zone pasted at full weight. */
  pasted?: number;
  /** Window plans only: the paste zone used (the patch and mask cover it); wider than `plan.box` when widened. */
  box?: PixelRect;
}

export async function compositeRegion(input: {
  original: Uint8Array;
  edited: Uint8Array;
  plan: RegionPlan;
  feather?: number;
}): Promise<CompositeRegionResult> {
  const src = await decodeRgba(input.original);
  assertPlan(src, input.plan);
  const roi = input.plan.roi;

  const aligned = await alignEditedRoi({ original: src, edited: input.edited, plan: input.plan });
  const toneFor = (p: RegionPlan) =>
    matchTone(src, { data: aligned.alignedRoi, channels: aligned.channels }, p, Math.max(2, Math.round(Math.min(p.box.width, p.box.height) * 0.06)));
  let plan = input.plan;
  let tone = toneFor(plan);
  // A window plan (region edit v2) pastes only what changed near the customer's box (./paste.ts);
  // a crop plan keeps the mask it always had.
  const changeFor = (p: RegionPlan, t: Tone) =>
    computeChangeMask({ original: src, alignedRoi: aligned.alignedRoi, channels: aligned.channels, plan: p, tone: t, feather: input.feather });
  let change = plan.select ? changeFor(plan, tone) : null;
  if (change?.reachesEdge) {
    // The change runs into the zone's edge: widen the zone once (up to the box's longer side) so a
    // change that grew past the box is not cut off.
    const wide = widestZone(src, plan);
    if (wide) {
      plan = { ...plan, box: wide };
      tone = toneFor(plan);
      change = changeFor(plan, tone);
    }
  }
  const { box } = plan;
  const mask = change
    ? change.mask
    : await computeDiffMask({
        original: src,
        alignedRoi: aligned.alignedRoi,
        plan,
        feather: input.feather,
        tone,
      });

  const out = Buffer.from(src.data);
  const patchCh = src.hasAlpha ? 4 : 3;
  const patchRaw = Buffer.allocUnsafe(box.width * box.height * patchCh);
  const maskRaw = Buffer.allocUnsafe(box.width * box.height * 4);

  for (let by = 0; by < box.height; by += 1) {
    const y = box.top + by;
    for (let bx = 0; bx < box.width; bx += 1) {
      const x = box.left + bx;
      const mi = by * box.width + bx;
      const alphaByte = mask[mi]!;
      const m = alphaByte / 255;
      const oi = (y * src.width + x) * 4;
      const ei = ((y - roi.top) * roi.width + (x - roi.left)) * aligned.channels;
      const pi = mi * patchCh;
      for (let c = 0; c < 3; c += 1) {
        const e = Math.min(255, Math.max(0, aligned.alignedRoi[ei + c]! * tone.gain[c]! + tone.offset[c]!));
        out[oi + c] = Math.round(src.data[oi + c]! * (1 - m) + e * m);
        patchRaw[pi + c] = Math.round(e);
      }
      if (patchCh === 4) {
        patchRaw[pi + 3] = src.data[oi + 3]!;
      }
      const mri = mi * 4;
      maskRaw[mri] = 255;
      maskRaw[mri + 1] = 255;
      maskRaw[mri + 2] = 255;
      maskRaw[mri + 3] = alphaByte;
      // Alpha stays the original's: an edit changes colour, not where the picture is transparent.
    }
  }

  const [bytes, patchPng, maskPng] = await Promise.all([
    encodePng({ data: out, width: src.width, height: src.height, hasAlpha: src.hasAlpha }),
    sharp(patchRaw, { raw: { width: box.width, height: box.height, channels: patchCh } })
      .png({ compressionLevel: 6 })
      .toBuffer(),
    sharp(maskRaw, { raw: { width: box.width, height: box.height, channels: 4 } })
      .png({ compressionLevel: 6 })
      .toBuffer(),
  ]);

  return {
    bytes,
    mime: 'image/png',
    width: src.width,
    height: src.height,
    patchPng,
    maskPng,
    misaligned: aligned.misaligned,
    ringResidual: aligned.ringResidual,
    transform: aligned.transform,
    ...(change ? { changeFound: change.changeFound, pasted: change.pasted, box: { ...box } } : {}),
  };
}
