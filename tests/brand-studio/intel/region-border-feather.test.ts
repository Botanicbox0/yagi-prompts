import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { compositeRegion, cropForEdit, decodeRgba, planRegion, type RegionPlan } from '@/lib/brand-studio/region-edit';
import { computeDiffMask } from '@/lib/brand-studio/region-edit/align';
import type { RegionBox } from '@/lib/brand-studio/contracts';
import { STUDIO_MODELS } from '@/lib/brand-studio/models';

/**
 * A box side that lies on the picture's border gets no feather: there is nothing beyond it to blend
 * toward, so a feather there would leave a band of the ORIGINAL along the border (the grey placeholder
 * of "빈 곳 채우기", or the old picture for an ordinary partial edit that reaches the edge). Sides inside
 * the picture blend exactly as before, and a box with no side on the border is byte-identical to before.
 */
/** sha256 (first 16 hex) of the composite, the patch PNG and the mask PNG, taken before the change. */
const PINNED_A = ['5048f605b5223932', 'fdbe7f0cd6462b0c', '0970b012f0dd31de'];
const PINNED_B = ['21223995a6122680', '2a7294f904c46f2d', '86456e1a34273293'];
const PINNED_C = ['687ab4583f9b0c84', '39c8050fa050f848', 'bb4c4bb6db47d499'];
const PINNED_SMALL = '998ce26bdd48c0c7';
const NANO = STUDIO_MODELS.find((m) => m.id === 'nano-banana-pro')!.aspects;

function pattern(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = ((x * 7 + y * 13) % 97) + 80;
    }
  }
  return data;
}
const png = (width: number, height: number) => sharp(pattern(width, height), { raw: { width, height, channels: 3 } }).png().toBuffer();

/** Stand-in edit model: brighten by `lift`; with `paint`, the middle quarter goes red. */
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

async function run(size: { width: number; height: number }, box: RegionBox, lift = 30, paint = true) {
  const original = await png(size.width, size.height);
  const plan = planRegion(size, box, NANO);
  const edited = await fakeEdit((await cropForEdit(original, plan)).bytes, lift, paint);
  const result = await compositeRegion({ original, edited, plan });
  const mask = await decodeRgba(result.maskPng!);
  const out = await decodeRgba(result.bytes);
  const src = await decodeRgba(original);
  return { plan, result, mask, out, src };
}

const sha = (b: Uint8Array | Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);
/** Mask alpha at box pixel (bx, by). */
const alphaAt = (mask: { data: Buffer | Uint8Array; width: number }, bx: number, by: number) => mask.data[(by * mask.width + bx) * 4 + 3]!;

function changedOutside(a: { data: Buffer | Uint8Array; width: number }, b: { data: Buffer | Uint8Array }, plan: RegionPlan): number {
  const { box } = plan;
  let n = 0;
  for (let p = 0; p < a.data.length / 4; p += 1) {
    const x = p % a.width;
    const y = Math.floor(p / a.width);
    if (x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height) continue;
    for (let c = 0; c < 4; c += 1) if (a.data[p * 4 + c] !== b.data[p * 4 + c]) n += 1;
  }
  return n;
}

describe('interior boxes: byte-identical to before', () => {
  // Pinned against the paste-back before border sides lost their feather (same inputs, same bytes).
  const pinned: Array<{ name: string; size: { width: number; height: number }; box: RegionBox; lift: number; paint: boolean; hashes: string[] }> = [
    { name: 'whole box changed (envelope only)', size: { width: 400, height: 300 }, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, lift: 30, paint: false, hashes: PINNED_A },
    { name: 'part of the box changed (diff mask)', size: { width: 400, height: 300 }, box: { x: 0.2, y: 0.25, w: 0.5, h: 0.5 }, lift: 0, paint: true, hashes: PINNED_B },
    { name: 'a box one pixel from every edge', size: { width: 320, height: 240 }, box: { x: 1 / 320, y: 1 / 240, w: 318 / 320, h: 238 / 240 }, lift: 30, paint: false, hashes: PINNED_C },
  ];
  for (const c of pinned) {
    it(c.name, async () => {
      const { result } = await run(c.size, c.box, c.lift, c.paint);
      expect([sha(result.bytes), sha(result.patchPng!), sha(result.maskPng!)]).toEqual(c.hashes);
    });
  }

  it('small boxes too (the short path)', async () => {
    const src = await decodeRgba(await png(64, 48));
    const plan: RegionPlan = { roi: { left: 10, top: 10, width: 20, height: 20 }, box: { left: 12, top: 12, width: 6, height: 5 }, aspect: '1:1', work: { width: 20, height: 20 } };
    const roi = Buffer.alloc(20 * 20 * 3, 200);
    expect(sha(await computeDiffMask({ original: src, alignedRoi: roi, plan }))).toBe(PINNED_SMALL);
  });
});

describe('box sides on the picture border get no feather', () => {
  it('one side: the left column is fully replaced, the inner sides still blend', async () => {
    const { plan, mask, out, src, result } = await run({ width: 400, height: 300 }, { x: 0, y: 0.3, w: 0.4, h: 0.4 }, 100, false);
    expect(plan.box.left).toBe(0);
    const midY = Math.floor(plan.box.height / 2);
    expect(alphaAt(mask, 0, midY)).toBe(255);
    expect(alphaAt(mask, 1, midY)).toBe(255);
    // Inside sides keep their feather.
    expect(alphaAt(mask, plan.box.width - 1, midY)).toBeLessThan(255);
    expect(alphaAt(mask, Math.floor(plan.box.width / 2), 0)).toBeLessThan(255);
    // The border pixel is the edit (the stored patch pixel), not a blend with the original.
    const patch = await decodeRgba(result.patchPng!);
    const i = ((plan.box.top + midY) * src.width + 0) * 4;
    const pi = (midY * patch.width + 0) * 4;
    expect([out.data[i], out.data[i + 1], out.data[i + 2]]).toEqual([patch.data[pi], patch.data[pi + 1], patch.data[pi + 2]]);
    expect(out.data[i + 2]).not.toBe(src.data[i + 2]);
    expect(changedOutside(out, src, plan)).toBe(0);
  });

  it('a corner: both border sides are opaque up to the corner pixel', async () => {
    const { plan, mask, out, src } = await run({ width: 400, height: 300 }, { x: 0, y: 0, w: 0.4, h: 0.4 }, 100, false);
    expect(alphaAt(mask, 0, 0)).toBe(255);
    for (let b = 0; b < Math.floor(plan.box.width / 2); b += 1) expect(alphaAt(mask, b, 0)).toBe(255);
    for (let b = 0; b < Math.floor(plan.box.height / 2); b += 1) expect(alphaAt(mask, 0, b)).toBe(255);
    expect(alphaAt(mask, plan.box.width - 1, Math.floor(plan.box.height / 2))).toBeLessThan(255);
    expect(changedOutside(out, src, plan)).toBe(0);
  });

  it('a full-height strip on the right edge: three border sides opaque, the inner side blends', async () => {
    const { plan, mask, out, src } = await run({ width: 400, height: 300 }, { x: 0.7, y: 0, w: 0.3, h: 1 }, 100, false);
    expect(plan.box.left + plan.box.width).toBe(400);
    expect(plan.box.height).toBe(300);
    const w = plan.box.width;
    const h = plan.box.height;
    for (let by = 0; by < h; by += 1) expect(alphaAt(mask, w - 1, by)).toBe(255);
    for (let bx = Math.floor(w / 2); bx < w; bx += 1) {
      expect(alphaAt(mask, bx, 0)).toBe(255);
      expect(alphaAt(mask, bx, h - 1)).toBe(255);
    }
    expect(alphaAt(mask, 0, Math.floor(h / 2))).toBeLessThan(255);
    expect(changedOutside(out, src, plan)).toBe(0);
  });

  it('applies to the diff-mask path as well', async () => {
    // Half of the box changes (between the "nothing" and "everything" fallbacks), so the diff mask is used.
    const src = await decodeRgba(await png(200, 100));
    const plan: RegionPlan = { roi: { left: 0, top: 0, width: 200, height: 100 }, box: { left: 0, top: 20, width: 80, height: 60 }, aspect: '2:1', work: { width: 200, height: 100 } };
    const roi = Buffer.alloc(200 * 100 * 3);
    for (let p = 0; p < 200 * 100; p += 1) {
      const x = p % 200;
      const y = Math.floor(p / 200);
      const changed = x < 40 && y >= 20 && y < 80;
      for (let c = 0; c < 3; c += 1) roi[p * 3 + c] = Math.min(255, src.data[p * 4 + c]! + (changed ? 100 : 0));
    }
    const mask = await computeDiffMask({ original: src, alignedRoi: roi, plan });
    // Column 0 lies on the border: full weight there; the inner top side still blends.
    expect(mask[30 * 80 + 0]).toBe(255);
    expect(mask[0 * 80 + 10]).toBeLessThan(255);
  });
});
