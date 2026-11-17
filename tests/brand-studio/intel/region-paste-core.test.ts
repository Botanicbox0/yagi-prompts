import { describe, expect, it } from 'vitest';
import { computeChangeMask, type PixelRect, type RegionPlan } from '@/lib/brand-studio/region-edit';

/**
 * Region edit v2 paste-back on a sharp, grainy subject (production 2026-11-17, perfume bottle): the
 * engine re-renders the whole subject with small differences everywhere (thin outline shifts, highlight
 * changes). Only the real content change in the customer's box is pasted; outlines, weak noise and
 * strong changes that sit mostly outside the box stay the original.
 */

const W = 400;
const H = 300;
// The customer's box and the paste zone around it (40% of the short side = 40 px).
const SELECT: PixelRect = { left: 150, top: 100, width: 100, height: 100 };
const ZONE: PixelRect = { left: 110, top: 60, width: 180, height: 180 };
const PLAN: RegionPlan = { roi: { left: 0, top: 0, width: W, height: H }, box: ZONE, select: SELECT, aspect: '4:3', work: { width: W, height: H } };
const TONE = { gain: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] };

function picture(): Buffer {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      data[i] = 90 + Math.round((x * 40) / W);
      data[i + 1] = 100 + Math.round((y * 30) / H);
      data[i + 2] = 110;
      data[i + 3] = 255;
    }
  }
  return data;
}

type Paint = { rect: PixelRect; add: number };

/** The window the model returned: the original with `add` added to every channel inside each rect. */
function edited(src: Buffer, paints: Paint[]): Buffer {
  const out = Buffer.alloc(W * H * 3);
  for (let p = 0; p < W * H; p += 1) for (let c = 0; c < 3; c += 1) out[p * 3 + c] = src[p * 4 + c]!;
  for (const { rect, add } of paints) {
    for (let y = rect.top; y < rect.top + rect.height; y += 1) {
      for (let x = rect.left; x < rect.left + rect.width; x += 1) {
        for (let c = 0; c < 3; c += 1) out[(y * W + x) * 3 + c] = Math.max(0, Math.min(255, out[(y * W + x) * 3 + c]! + add));
      }
    }
  }
  return out;
}

function run(paints: Paint[]) {
  const src = picture();
  return computeChangeMask({
    original: { data: src, width: W, height: H, hasAlpha: false },
    alignedRoi: edited(src, paints),
    channels: 3,
    plan: PLAN,
    tone: TONE,
  });
}

/** Mask value at a picture pixel (0 outside the zone). */
const at = (mask: Uint8Array, x: number, y: number) =>
  x < ZONE.left || y < ZONE.top || x >= ZONE.left + ZONE.width || y >= ZONE.top + ZONE.height ? 0 : mask[(y - ZONE.top) * ZONE.width + (x - ZONE.left)]!;

describe('paste back keeps the content change, not the re-render around it', () => {
  it('pastes only the strong change in the box, not thin outlines, weak noise or a strong change elsewhere', () => {
    const r = run([
      // The new logo: a strong change in the middle of the box.
      { rect: { left: 175, top: 125, width: 50, height: 50 }, add: 80 },
      // The bottle's outline drawn one pixel over: thin and strong, inside and outside the box.
      { rect: { left: 120, top: 70, width: 1, height: 160 }, add: 50 },
      { rect: { left: 160, top: 110, width: 1, height: 80 }, add: 50 },
      { rect: { left: 120, top: 220, width: 160, height: 1 }, add: 50 },
      // Weak re-render noise linking the outline, the logo and a second strong change.
      { rect: { left: 121, top: 145, width: 54, height: 10 }, add: 14 },
      { rect: { left: 225, top: 160, width: 50, height: 60 }, add: 14 },
      // A strong change outside the box (a highlight on the neck): not pasted.
      { rect: { left: 255, top: 205, width: 25, height: 25 }, add: 70 },
    ]);
    expect(r.changeFound).toBe(true);
    expect(at(r.mask, 200, 150)).toBe(255);
    expect(at(r.mask, 175, 125)).toBeGreaterThan(0);
    // Outlines, the far end of the noise band, and the strong change outside the box stay the original.
    expect(at(r.mask, 120, 90)).toBe(0);
    expect(at(r.mask, 120, 150)).toBe(0);
    expect(at(r.mask, 160, 112)).toBe(0);
    expect(at(r.mask, 200, 220)).toBe(0);
    expect(at(r.mask, 140, 150)).toBe(0);
    expect(at(r.mask, 267, 217)).toBe(0);
    expect(at(r.mask, 250, 190)).toBe(0);
    // About the logo's size, not the zone.
    expect(r.pasted).toBeLessThan(0.15);
    expect(r.reachesEdge).toBe(false);
  });

  it('drops a strong change that only grazes the box from outside', () => {
    const r = run([
      { rect: { left: 175, top: 150, width: 30, height: 30 }, add: 80 },
      // 45 x 40, five columns inside the box (11%).
      { rect: { left: 245, top: 110, width: 45, height: 40 }, add: 80 },
    ]);
    expect(r.changeFound).toBe(true);
    expect(at(r.mask, 190, 165)).toBe(255);
    expect(at(r.mask, 270, 130)).toBe(0);
    expect(at(r.mask, 247, 130)).toBe(0);
  });

  it('keeps a change that grows out of the box and reports when it runs into an inner zone side', () => {
    // A tulip taller than the teapot: from the zone's top edge (60) down into the box.
    const r = run([{ rect: { left: 185, top: 60, width: 30, height: 120 }, add: 80 }]);
    expect(r.changeFound).toBe(true);
    expect(at(r.mask, 200, 150)).toBe(255);
    expect(at(r.mask, 200, 75)).toBe(255);
    expect(at(r.mask, 200, 61)).toBeGreaterThan(0);
    expect(r.reachesEdge).toBe(true);
  });

  it('falls back to the box itself when the change stays below the core level', () => {
    const r = run([{ rect: { left: 150, top: 100, width: 100, height: 100 }, add: 16 }]);
    expect(r.changeFound).toBe(false);
    expect(at(r.mask, 200, 150)).toBe(255);
    expect(at(r.mask, 140, 150)).toBe(0);
    expect(at(r.mask, 200, 205)).toBe(0);
    expect(r.reachesEdge).toBe(false);
  });
});
