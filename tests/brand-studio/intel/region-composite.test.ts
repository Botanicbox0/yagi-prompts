import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  compositeRegion,
  cropForEdit,
  decodeRgba,
  defaultFeather,
  featherWeight,
  matchTone,
  measureImage,
  planRegion,
  type RegionPlan,
} from '@/lib/brand-studio/region-edit';
import { STUDIO_MODELS } from '@/lib/brand-studio/models';

const NANO = STUDIO_MODELS.find((m) => m.id === 'nano-banana-pro')!.aspects;

/** A textured test picture: gradients plus a deterministic pattern, so resampling is visible. */
function pattern(width: number, height: number, channels: 3 | 4 = 3): Buffer {
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = ((x * 7 + y * 13) % 97) + 80;
      if (channels === 4) data[i + 3] = x < width / 4 ? 0 : 255;
    }
  }
  return data;
}
async function png(width: number, height: number, channels: 3 | 4 = 3): Promise<Buffer> {
  return sharp(pattern(width, height, channels), { raw: { width, height, channels } }).png().toBuffer();
}

/** A stand-in for the edit model: brighten everything by `lift`, paint the middle quarter red. */
async function fakeEdit(crop: Uint8Array, lift = 30, paint = true): Promise<Buffer> {
  const { data, info } = await sharp(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      const middle = paint && Math.abs(x - info.width / 2) < info.width / 8 && Math.abs(y - info.height / 2) < info.height / 8;
      for (let c = 0; c < 3; c += 1) data[i + c] = middle ? (c === 0 ? 220 : 20) : Math.min(255, data[i + c]! + lift);
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}

function diffOutside(a: Buffer, b: Buffer, width: number, plan: RegionPlan, channels = 4): number {
  const { box } = plan;
  let changed = 0;
  for (let i = 0; i < a.length; i += channels) {
    const p = i / channels;
    const x = p % width;
    const y = Math.floor(p / width);
    const inBox = x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
    if (inBox) continue;
    for (let c = 0; c < channels; c += 1) if (a[i + c] !== b[i + c]) changed += 1;
  }
  return changed;
}

function countInside(a: Buffer, b: Buffer, width: number, plan: RegionPlan): number {
  const { box } = plan;
  let changed = 0;
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      const i = (y * width + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed += 1;
    }
  }
  return changed;
}

/** Mean of channel 0..2 over a band inside the box, past the feather. */
function innerBandMean(img: Buffer, width: number, plan: RegionPlan, from: number, to: number): number {
  const { box } = plan;
  let sum = 0;
  let n = 0;
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      const d = Math.min(x - box.left + 1, box.left + box.width - x, y - box.top + 1, box.top + box.height - y);
      if (d < from || d > to) continue;
      const i = (y * width + x) * 4;
      sum += img[i]! + img[i + 1]! + img[i + 2]!;
      n += 3;
    }
  }
  return sum / n;
}

async function roundTrip(original: Buffer, box = { x: 0.35, y: 0.3, w: 0.3, h: 0.35 }, lift = 30, paint = true) {
  const size = await measureImage(original);
  const plan = planRegion(size, box, NANO);
  const crop = await cropForEdit(original, plan);
  const edited = await fakeEdit(crop.bytes, lift, paint);
  const result = await compositeRegion({ original, edited, plan });
  const before = await decodeRgba(original);
  const after = await decodeRgba(result.bytes);
  return { plan, crop, result, before, after };
}

describe('cropForEdit', () => {
  it('returns a PNG at the work size', async () => {
    const original = await png(640, 480);
    const plan = planRegion({ width: 640, height: 480 }, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, NANO);
    const crop = await cropForEdit(original, plan);
    const meta = await sharp(crop.bytes).metadata();
    expect(crop.mime).toBe('image/png');
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([plan.work.width, plan.work.height]);
  });
});

describe('compositeRegion — the invariant', () => {
  it('leaves every pixel outside the box identical and changes pixels inside', async () => {
    const { plan, result, before, after } = await roundTrip(await png(640, 480));
    expect(result.mime).toBe('image/png');
    expect([result.width, result.height]).toEqual([640, 480]);
    expect((await sharp(result.bytes).metadata()).format).toBe('png');
    expect(diffOutside(before.data, after.data, 640, plan)).toBe(0);
    expect(countInside(before.data, after.data, 640, plan)).toBeGreaterThan(plan.box.width * plan.box.height * 0.05);
  });

  it('tone matching pulls a brightened edit back toward the original near the box edge', async () => {
    const original = await png(640, 480);
    const { plan, before, after } = await roundTrip(original, undefined, 30, false);
    const feather = defaultFeather(plan.box);
    const from = feather + 2;
    const to = feather + 12;
    const orig = innerBandMean(before.data, 640, plan, from, to);
    const out = innerBandMean(after.data, 640, plan, from, to);
    expect(Math.abs(out - orig)).toBeLessThan(4); // the raw edit was 30 levels brighter
  });

  it('matchTone moves the ring mean of the edit to the original', async () => {
    const original = await png(400, 300);
    const plan = planRegion({ width: 400, height: 300 }, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, NANO);
    const src = await decodeRgba(original);
    const roi = await sharp(src.data, { raw: { width: 400, height: 300, channels: 4 } }).extract(plan.roi).removeAlpha().raw().toBuffer();
    const edit = Buffer.from(roi.map((v) => Math.min(255, v + 40)));
    const tone = matchTone(src, { data: edit, channels: 3 }, plan, 6);
    for (let c = 0; c < 3; c += 1) {
      expect(tone.gain[c]).toBeGreaterThanOrEqual(0.8);
      expect(tone.gain[c]).toBeLessThanOrEqual(1.25);
    }
    // apply to one ring pixel just outside the box and compare the means
    let o = 0;
    let e = 0;
    let n = 0;
    for (let x = plan.box.left; x < plan.box.left + plan.box.width; x += 1) {
      const y = plan.box.top - 3;
      const oi = (y * 400 + x) * 4;
      const ei = ((y - plan.roi.top) * plan.roi.width + (x - plan.roi.left)) * 3;
      for (let c = 0; c < 3; c += 1) {
        o += src.data[oi + c]!;
        e += Math.min(255, edit[ei + c]! * tone.gain[c]! + tone.offset[c]!);
        n += 1;
      }
    }
    expect(Math.abs(o / n - e / n)).toBeLessThan(3);
  });

  it('feather lies inside the box: weight rises from the edge and is 1 past it', () => {
    const f = defaultFeather({ left: 0, top: 0, width: 400, height: 300 });
    expect(f).toBe(9);
    expect(featherWeight(1, f)).toBeGreaterThan(0);
    expect(featherWeight(1, f)).toBeLessThan(featherWeight(5, f));
    expect(featherWeight(f, f)).toBeLessThan(1);
    expect(featherWeight(f + 1, f)).toBe(1);
    expect(defaultFeather({ left: 0, top: 0, width: 5, height: 5 })).toBe(2);
    expect(defaultFeather({ left: 0, top: 0, width: 2, height: 2 })).toBe(0);
  });
});

describe('compositeRegion — inputs', () => {
  it('applies EXIF orientation: plans and pastes on the upright picture', async () => {
    const raw = pattern(300, 200);
    const jpeg = await sharp(raw, { raw: { width: 300, height: 200, channels: 3 } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await measureImage(jpeg)).toEqual({ width: 200, height: 300 });
    const { plan, result, before, after } = await roundTrip(jpeg);
    expect([result.width, result.height]).toEqual([200, 300]);
    expect(diffOutside(before.data, after.data, 200, plan)).toBe(0);
  });

  it('keeps transparency exactly and outside pixels identical', async () => {
    const original = await png(320, 240, 4);
    const { plan, result, before, after } = await roundTrip(original, { x: 0.1, y: 0.2, w: 0.4, h: 0.4 });
    expect((await sharp(result.bytes).metadata()).hasAlpha).toBe(true);
    expect(diffOutside(before.data, after.data, 320, plan)).toBe(0);
    for (let i = 3; i < before.data.length; i += 4) expect(after.data[i]).toBe(before.data[i]);
  });

  it('reads CMYK and 16-bit inputs as 8-bit sRGB', async () => {
    const raw = pattern(240, 180);
    const cmyk = await sharp(raw, { raw: { width: 240, height: 180, channels: 3 } }).toColourspace('cmyk').jpeg().toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe('cmyk');
    const deep = await sharp(raw, { raw: { width: 240, height: 180, channels: 3 } }).toColourspace('rgb16').png().toBuffer();
    expect((await sharp(deep).metadata()).depth).toBe('ushort');
    for (const file of [cmyk, deep]) {
      const { plan, result, before, after } = await roundTrip(file);
      const meta = await sharp(result.bytes).metadata();
      expect(meta.depth).toBe('uchar');
      expect(meta.channels).toBe(3);
      expect(diffOutside(before.data, after.data, 240, plan)).toBe(0);
    }
  });

  it('handles a box of a few pixels', async () => {
    const original = await png(200, 200);
    const { plan, before, after } = await roundTrip(original, { x: 0.5, y: 0.5, w: 0.02, h: 0.02 }, 60);
    expect(plan.box.width).toBe(4);
    expect(diffOutside(before.data, after.data, 200, plan)).toBe(0);
    expect(countInside(before.data, after.data, 200, plan)).toBeGreaterThan(0);
  });

  it('whole-picture fallback (no fitting aspect) still only touches the box', async () => {
    const original = await png(500, 500);
    const plan = planRegion({ width: 500, height: 500 }, { x: 0.02, y: 0.02, w: 0.96, h: 0.5 }, ['21:9', '9:16']);
    expect(plan.roi).toEqual({ left: 0, top: 0, width: 500, height: 500 });
    const crop = await cropForEdit(original, plan);
    const result = await compositeRegion({ original, edited: await fakeEdit(crop.bytes), plan });
    const before = await decodeRgba(original);
    const after = await decodeRgba(result.bytes);
    expect(diffOutside(before.data, after.data, 500, plan)).toBe(0);
  });

  it('refuses a plan made for another picture', async () => {
    const original = await png(100, 100);
    const plan = planRegion({ width: 400, height: 400 }, { x: 0.5, y: 0.5, w: 0.3, h: 0.3 }, NANO);
    await expect(cropForEdit(original, plan)).rejects.toThrow('region_plan_mismatch');
    await expect(compositeRegion({ original, edited: original, plan })).rejects.toThrow('region_plan_mismatch');
  });
});
