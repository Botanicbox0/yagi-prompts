/**
 * Crop out, and paste back, a region edit (IDENTITY §6-4-3 with sharp only).
 *
 * The paste follows the hand method in Video-Creator's local-fix script, simplified to what a
 * server can do without OpenCV: scale the edit back to the crop, correct its overall tone from the
 * ring around the customer's box, and blend it in with a feather that lies entirely inside the box.
 * Every pixel outside the box is copied from the original untouched — that is the invariant the
 * tests check on raw buffers. Not done here: sub-pixel alignment of a shifted edit (ECC) and the
 * low-frequency tone transfer of the hand script, which would also undo an intended colour change.
 */
import sharp from 'sharp';
import { decodeRgba, encodePng, SHARP_INPUT, type RgbaImage } from './pixels';
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

export async function compositeRegion(input: {
  original: Uint8Array;
  edited: Uint8Array;
  plan: RegionPlan;
  feather?: number;
}): Promise<{ bytes: Uint8Array; mime: 'image/png'; width: number; height: number }> {
  const { plan } = input;
  const src = await decodeRgba(input.original);
  assertPlan(src, plan);
  const { roi, box } = plan;

  const edit = await sharp(input.edited, SHARP_INPUT)
    .rotate()
    .toColourspace('srgb')
    .flatten({ background: '#ffffff' })
    .resize(roi.width, roi.height, { fit: 'fill', kernel: 'lanczos3' })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  const channels = edit.info.channels;
  if (channels < 3 || edit.info.width !== roi.width || edit.info.height !== roi.height) {
    throw new Error('region_edit_decode');
  }

  const feather = defaultFeather(box, input.feather);
  const ringWidth = Math.max(2, Math.round(Math.min(box.width, box.height) * 0.06));
  const tone = matchTone(src, { data: edit.data, channels }, plan, ringWidth);

  const out = Buffer.from(src.data);
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      const d = Math.min(x - box.left + 1, box.left + box.width - x, y - box.top + 1, box.top + box.height - y);
      const m = featherWeight(d, feather);
      const oi = (y * src.width + x) * 4;
      const ei = ((y - roi.top) * roi.width + (x - roi.left)) * channels;
      for (let c = 0; c < 3; c += 1) {
        const e = Math.min(255, Math.max(0, edit.data[ei + c]! * tone.gain[c]! + tone.offset[c]!));
        out[oi + c] = Math.round(src.data[oi + c]! * (1 - m) + e * m);
      }
      // Alpha stays the original's: an edit changes colour, not where the picture is transparent.
    }
  }

  const bytes = await encodePng({ data: out, width: src.width, height: src.height, hasAlpha: src.hasAlpha });
  return { bytes, mime: 'image/png', width: src.width, height: src.height };
}
