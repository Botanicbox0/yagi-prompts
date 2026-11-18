import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  compositeRegion,
  cropForEdit,
  decodeRgba,
  pasteZone,
  planRegionWindow,
  SEEDREAM_2K_SIZES,
  type RegionPlan,
} from '@/lib/brand-studio/region-edit';
import type { PixelRect } from '@/lib/brand-studio/region-edit';

/**
 * Region edit v2 (docs/BRAND-STUDIO-V6-PLAN.md "부분 수정 v2"): the edit model sees as much of the picture
 * as it can take at its own size, and only what changed near the customer's box is pasted back.
 */

const inside = (r: PixelRect, x: number, y: number) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
const contains = (outer: PixelRect, inner: PixelRect) =>
  inner.left >= outer.left && inner.top >= outer.top && inner.left + inner.width <= outer.left + outer.width && inner.top + inner.height <= outer.top + outer.height;
const ratio = (r: { width: number; height: number }) => r.width / r.height;

describe('paste zone', () => {
  it('grows each side by 40% of the shorter side of the box, at least 24 px, inside the picture', () => {
    // box 200 x 100 at (400, 300): grow by 40.
    expect(pasteZone({ width: 1000, height: 800 }, { left: 400, top: 300, width: 200, height: 100 })).toEqual({ left: 360, top: 260, width: 280, height: 180 });
    // box 30 x 20: 40% of 20 is 8, so 24.
    expect(pasteZone({ width: 1000, height: 800 }, { left: 100, top: 100, width: 30, height: 20 })).toEqual({ left: 76, top: 76, width: 78, height: 68 });
    // Clamped at the border.
    expect(pasteZone({ width: 1000, height: 800 }, { left: 0, top: 750, width: 100, height: 50 })).toEqual({ left: 0, top: 726, width: 124, height: 74 });
  });
});

describe('window selection', () => {
  it('uses the whole picture when the picture already has a supported aspect', () => {
    const plan = planRegionWindow({ width: 1280, height: 720 }, { x: 0.3, y: 0.4, w: 0.1, h: 0.1 });
    expect(plan.roi).toEqual({ left: 0, top: 0, width: 1280, height: 720 });
    expect(plan.aspect).toBe('16:9');
    expect(plan.work).toEqual({ width: 1280, height: 720 });
    expect(plan.downscale).toBe(1);
    expect(plan.select).toEqual({ left: 384, top: 288, width: 128, height: 72 });
    expect(plan.box).toEqual(pasteZone({ width: 1280, height: 720 }, plan.select!));
  });

  it('takes the largest supported window that holds the paste zone in an odd-shaped picture', () => {
    // 1000 x 834 is 6:5. 4:3 at full width (1000 x 750) is the largest supported rectangle inside it.
    const plan = planRegionWindow({ width: 1000, height: 834 }, { x: 0.3, y: 0.82, w: 0.12, h: 0.07 });
    expect(plan.aspect).toBe('4:3');
    expect(plan.roi.width).toBe(1000);
    expect(plan.roi.height).toBe(750);
    expect(contains(plan.roi, plan.box)).toBe(true);
    // The box is low in the picture: the window goes as low as the picture allows.
    expect(plan.roi.top).toBe(834 - 750);
    expect(plan.work).toEqual({ width: 1000, height: 750 });
  });

  it('centres an odd-shape window on the box as far as the picture allows', () => {
    // 1600 x 900 is 16:9 exactly, so pick a 5:2 picture (2000 x 800): the largest 21:9 window is 1867 x 800.
    const plan = planRegionWindow({ width: 2000, height: 800 }, { x: 0.45, y: 0.4, w: 0.1, h: 0.2 });
    expect(plan.aspect).toBe('21:9');
    expect(plan.roi.height).toBe(800);
    expect(Math.abs(ratio(plan.roi) - 21 / 9)).toBeLessThan(0.01);
    const cx = plan.select!.left + plan.select!.width / 2;
    expect(Math.abs(plan.roi.left + plan.roi.width / 2 - cx)).toBeLessThanOrEqual(1);
  });

  it('shrinks a huge picture to a window the model returns at 1:1', () => {
    // 6000 x 4500 (4:3): the model returns 2304 x 1728 for 4:3, so the window is that size around the box.
    const plan = planRegionWindow({ width: 6000, height: 4500 }, { x: 0.5, y: 0.5, w: 0.05, h: 0.05 });
    expect(plan.aspect).toBe('4:3');
    expect(plan.roi.width).toBe(SEEDREAM_2K_SIZES['4:3']![0]);
    expect(plan.roi.height).toBe(SEEDREAM_2K_SIZES['4:3']![1]);
    expect(plan.work).toEqual({ width: plan.roi.width, height: plan.roi.height });
    expect(plan.downscale).toBe(1);
    expect(contains(plan.roi, plan.box)).toBe(true);
  });

  it('accepts a downscale (and records it) when the box is larger than the 1:1 budget', () => {
    const plan = planRegionWindow({ width: 6000, height: 4500 }, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
    expect(plan.aspect).toBe('4:3');
    expect(plan.roi.width).toBeGreaterThan(2304);
    expect(contains(plan.roi, plan.box)).toBe(true);
    expect(plan.downscale).toBeLessThan(1);
    expect(plan.work.width).toBeLessThanOrEqual(2304);
    expect(plan.work.height).toBeLessThanOrEqual(1728);
    // Shrunk toward the zone: not the whole picture.
    expect(plan.roi.width).toBeLessThan(6000);
  });

  it('never enlarges a small picture on our side', () => {
    const plan = planRegionWindow({ width: 320, height: 240 }, { x: 0.4, y: 0.4, w: 0.1, h: 0.1 });
    expect(plan.roi).toEqual({ left: 0, top: 0, width: 320, height: 240 });
    expect(plan.work).toEqual({ width: 320, height: 240 });
  });

  it('falls back to the whole picture at the nearest aspect when no supported window holds the zone', () => {
    const plan = planRegionWindow({ width: 4000, height: 800 }, { x: 0.02, y: 0.2, w: 0.96, h: 0.6 });
    expect(plan.roi).toEqual({ left: 0, top: 0, width: 4000, height: 800 });
    expect(plan.aspect).toBe('21:9');
    expect(contains(plan.roi, plan.box)).toBe(true);
  });
});

/* ------------------------------------------------------------------ paste */

function pattern(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      data[i] = 60 + Math.round((x * 120) / width);
      data[i + 1] = 70 + Math.round((y * 110) / height);
      data[i + 2] = 90 + ((x * 3 + y * 5) % 40);
    }
  }
  return data;
}

const W = 400;
const H = 300;
const original = () => sharp(pattern(W, H), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();

/** A stand-in model: returns the window with the given rectangles (window coordinates) painted. */
async function fakeWindowEdit(plan: RegionPlan, src: Buffer, paint: Array<{ rect: PixelRect; rgb: [number, number, number] }>, scale = 1): Promise<Buffer> {
  const crop = (await cropForEdit(src, plan)).bytes;
  const { data, info } = await sharp(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const { rect, rgb } of paint) {
    for (let y = rect.top - plan.roi.top; y < rect.top - plan.roi.top + rect.height; y += 1) {
      for (let x = rect.left - plan.roi.left; x < rect.left - plan.roi.left + rect.width; x += 1) {
        const i = (y * info.width + x) * 3;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
      }
    }
  }
  const out = sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } });
  return (scale === 1 ? out : out.resize(info.width * scale, info.height * scale, { kernel: 'lanczos3' })).png().toBuffer();
}

async function pasteRun(box: { x: number; y: number; w: number; h: number }, paint: Array<{ rect: PixelRect; rgb: [number, number, number] }>, scale = 1) {
  const src = await original();
  const plan = planRegionWindow({ width: W, height: H }, box);
  const edited = await fakeWindowEdit(plan, src, paint, scale);
  const result = await compositeRegion({ original: src, edited, plan });
  return { plan, result, out: await decodeRgba(result.bytes), orig: await decodeRgba(src) };
}

function samePixel(a: { data: Buffer; width: number }, b: { data: Buffer; width: number }, x: number, y: number): boolean {
  const i = (y * a.width + x) * 4;
  return a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2];
}

describe('paste back', () => {
  // select: 100 x 90 at (150, 105); zone grows 36 px each side → (114, 69) 172 x 162.
  const BOX = { x: 150 / W, y: 105 / H, w: 100 / W, h: 90 / H };

  it('changes no pixel outside the paste zone, even where the model changed things', async () => {
    const { plan, out, orig } = await pasteRun(BOX, [
      { rect: { left: 170, top: 120, width: 60, height: 60 }, rgb: [230, 30, 30] },
      // The model also repainted a far corner: never pasted.
      { rect: { left: 330, top: 10, width: 60, height: 60 }, rgb: [20, 20, 230] },
    ]);
    let changedOutside = 0;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (!inside(plan.box, x, y) && !samePixel(out, orig, x, y)) changedOutside += 1;
    expect(changedOutside).toBe(0);
  });

  it('keeps pixels the model did not change inside the zone exactly as they were', async () => {
    const { plan, out, orig } = await pasteRun(BOX, [{ rect: { left: 180, top: 130, width: 30, height: 30 }, rgb: [230, 30, 30] }]);
    // Far enough from the painted square (beyond its dilation and feather), still inside the zone.
    let changedFar = 0;
    let checked = 0;
    for (let y = plan.box.top; y < plan.box.top + plan.box.height; y += 1) {
      for (let x = plan.box.left; x < plan.box.left + plan.box.width; x += 1) {
        const dx = Math.max(180 - x, x - 209, 0);
        const dy = Math.max(130 - y, y - 159, 0);
        if (Math.max(dx, dy) < 24) continue;
        checked += 1;
        if (!samePixel(out, orig, x, y)) changedFar += 1;
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(changedFar).toBe(0);
  });

  it('keeps a change that grows past the box whole while it stays inside the zone', async () => {
    // A tulip taller than the teapot: the paint runs 25 px above the customer's box.
    const tall = { left: 185, top: 80, width: 30, height: 90 };
    const { plan, out } = await pasteRun(BOX, [{ rect: tall, rgb: [230, 30, 30] }]);
    expect(tall.top).toBeLessThan(plan.select!.top);
    expect(contains(plan.box, tall)).toBe(true);
    let wrong = 0;
    for (let y = tall.top; y < tall.top + tall.height; y += 1) {
      for (let x = tall.left; x < tall.left + tall.width; x += 1) {
        const i = (y * W + x) * 4;
        if (Math.abs(out.data[i]! - 230) > 1 || Math.abs(out.data[i + 1]! - 30) > 1 || Math.abs(out.data[i + 2]! - 30) > 1) wrong += 1;
      }
    }
    expect(wrong).toBe(0);
  });

  it('widens the zone once when a change runs past its edge, up to the box’s longer side', async () => {
    // A flat box (120 x 40): the zone grows 24 px, the tulip rises 60 px above the box.
    const flat = { x: 140 / W, y: 160 / H, w: 120 / W, h: 40 / H };
    const tulip = { left: 185, top: 100, width: 20, height: 90 };
    const { plan, out, orig, result } = await pasteRun(flat, [{ rect: tulip, rgb: [230, 30, 30] }]);
    expect(tulip.top).toBeLessThan(plan.box.top);
    expect(result.box).toBeDefined();
    expect(result.box!.top).toBeLessThanOrEqual(tulip.top - 8);
    expect(result.box!.top).toBeGreaterThanOrEqual(plan.select!.top - Math.max(plan.select!.width, plan.select!.height));
    let wrong = 0;
    for (let y = tulip.top; y < tulip.top + tulip.height; y += 1) {
      for (let x = tulip.left; x < tulip.left + tulip.width; x += 1) if (out.data[(y * W + x) * 4] !== 230) wrong += 1;
    }
    expect(wrong).toBe(0);
    let changedOutside = 0;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (!inside(result.box!, x, y) && !samePixel(out, orig, x, y)) changedOutside += 1;
    expect(changedOutside).toBe(0);
    const mask = await sharp(result.maskPng!).metadata();
    expect([mask.width, mask.height]).toEqual([result.box!.width, result.box!.height]);
  });

  it('does not paste a change that is not connected to the box', async () => {
    const stray = { left: 117, top: 200, width: 20, height: 20 }; // inside the zone, below-left of the box
    const { plan, out, orig } = await pasteRun(BOX, [
      { rect: { left: 180, top: 130, width: 40, height: 40 }, rgb: [230, 30, 30] },
      { rect: stray, rgb: [20, 200, 20] },
    ]);
    expect(contains(plan.box, stray)).toBe(true);
    for (let y = stray.top; y < stray.top + stray.height; y += 1) {
      for (let x = stray.left; x < stray.left + stray.width; x += 1) expect(samePixel(out, orig, x, y)).toBe(true);
    }
  });

  it('gives a zone side on the picture border no feather', async () => {
    // Box on the left border; the paint fills it up to the border.
    const { plan, out, result } = await pasteRun({ x: 0, y: 100 / H, w: 80 / W, h: 100 / H }, [{ rect: { left: 0, top: 110, width: 60, height: 80 }, rgb: [230, 30, 30] }]);
    expect(plan.box.left).toBe(0);
    for (let y = 120; y < 180; y += 1) {
      const i = (y * W) * 4;
      expect(out.data[i]).toBe(230);
      expect(out.data[i + 1]).toBe(30);
    }
    // The mask is full at the border column and empty at the zone's inner (right) edge.
    const mask = await decodeRgba(result.maskPng!);
    const row = 150 - plan.box.top;
    expect(mask.data[(row * mask.width) * 4 + 3]).toBe(255);
    expect(mask.data[(row * mask.width + mask.width - 1) * 4 + 3]).toBeLessThan(40);
  });

  it('pastes a result returned at twice the size and keeps outside pixels identical', async () => {
    const { plan, out, orig, result } = await pasteRun(BOX, [{ rect: { left: 175, top: 125, width: 50, height: 50 }, rgb: [230, 30, 30] }], 2);
    expect(result.misaligned).toBe(false);
    let changedOutside = 0;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (!inside(plan.box, x, y) && !samePixel(out, orig, x, y)) changedOutside += 1;
    expect(changedOutside).toBe(0);
    // The middle of the painted square is the paint.
    const i = (150 * W + 200) * 4;
    expect(out.data[i]).toBeGreaterThan(215);
    expect(out.data[i + 2]).toBeLessThan(45);
  });

  it('stores the patch and mask at the size of the paste zone', async () => {
    const { plan, result } = await pasteRun(BOX, [{ rect: { left: 180, top: 130, width: 30, height: 30 }, rgb: [230, 30, 30] }]);
    const mask = await sharp(result.maskPng!).metadata();
    const patch = await sharp(result.patchPng!).metadata();
    expect([mask.width, mask.height]).toEqual([plan.box.width, plan.box.height]);
    expect([patch.width, patch.height]).toEqual([plan.box.width, plan.box.height]);
  });
});
