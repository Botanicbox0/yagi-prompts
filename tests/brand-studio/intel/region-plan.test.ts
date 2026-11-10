import { describe, expect, it } from 'vitest';
import { STUDIO_MODELS } from '@/lib/brand-studio/models';
import { boxToPixels, parseAspect, planRegion, type RegionPlan } from '@/lib/brand-studio/region-edit';

const LISTS = Object.fromEntries(STUDIO_MODELS.map((m) => [m.id, m.aspects])) as Record<string, readonly string[]>;
const SEEDREAM = LISTS['seedream-5-pro']!;
const NANO = LISTS['nano-banana-pro']!;
const SEEDANCE = LISTS['seedance-2.5']!;

function checkInvariants(image: { width: number; height: number }, plan: RegionPlan) {
  const { roi, box, work } = plan;
  for (const r of [roi, box]) {
    expect(Number.isInteger(r.left) && Number.isInteger(r.top) && Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(image.width);
    expect(r.top + r.height).toBeLessThanOrEqual(image.height);
  }
  expect(box.left).toBeGreaterThanOrEqual(roi.left);
  expect(box.top).toBeGreaterThanOrEqual(roi.top);
  expect(box.left + box.width).toBeLessThanOrEqual(roi.left + roi.width);
  expect(box.top + box.height).toBeLessThanOrEqual(roi.top + roi.height);
  const long = Math.max(work.width, work.height);
  expect(long).toBeGreaterThanOrEqual(Math.min(1536, Math.max(roi.width, roi.height)));
  expect(long).toBeLessThanOrEqual(4096);
  expect(long).toBeGreaterThanOrEqual(Math.min(4096, Math.max(roi.width, roi.height)));
  expect(Math.abs(work.width / work.height / parseAspect(plan.aspect)! - 1)).toBeLessThan(0.01);
}

function padding(plan: RegionPlan) {
  const { roi, box } = plan;
  return {
    left: (box.left - roi.left) / box.width,
    right: (roi.left + roi.width - box.left - box.width) / box.width,
    top: (box.top - roi.top) / box.height,
    bottom: (roi.top + roi.height - box.top - box.height) / box.height,
  };
}

describe('boxToPixels', () => {
  it('covers the box without float drift', () => {
    expect(boxToPixels({ width: 1000, height: 1000 }, { x: 0.3, y: 0.1, w: 0.3, h: 0.2 })).toEqual({ left: 300, top: 100, width: 300, height: 200 });
  });
  it('keeps a tiny box at least one pixel', () => {
    expect(boxToPixels({ width: 10, height: 10 }, { x: 0.99, y: 0.99, w: 0.02, h: 0.02 })).toEqual({ left: 9, top: 9, width: 1, height: 1 });
  });
});

describe('planRegion — table', () => {
  const image = { width: 2000, height: 1500 };

  it('centre box: least-waste aspect, ≥15 % context on every side, enlarged to 2048', () => {
    const plan = planRegion(image, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, NANO); // 400 × 300 box → 4:3
    checkInvariants(image, plan);
    expect(plan.aspect).toBe('4:3');
    expect(plan.box).toEqual({ left: 800, top: 600, width: 400, height: 300 });
    for (const side of Object.values(padding(plan))) expect(side).toBeGreaterThanOrEqual(0.149);
    expect(plan.work).toEqual({ width: 2048, height: 1536 });
  });

  it('corner box: the crop stays inside, context on the open sides', () => {
    const plan = planRegion(image, { x: 0, y: 0, w: 0.1, h: 0.1 }, SEEDREAM);
    checkInvariants(image, plan);
    expect(plan.roi.left).toBe(0);
    expect(plan.roi.top).toBe(0);
    const p = padding(plan);
    expect(p.right).toBeGreaterThanOrEqual(0.29);
    expect(p.bottom).toBeGreaterThanOrEqual(0.29);
  });

  it('near-full box with no fitting aspect: whole picture, nearest aspect', () => {
    const square = { width: 1000, height: 1000 };
    const plan = planRegion(square, { x: 0.01, y: 0.01, w: 0.98, h: 0.98 }, ['16:9', '9:16', '4:3']);
    expect(plan.roi).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
    expect(plan.aspect).toBe('4:3');
    expect(plan.work).toEqual({ width: 2048, height: 1536 });
  });

  it('near-full box with a matching aspect uses it and shrinks the margin', () => {
    const square = { width: 1000, height: 1000 };
    const plan = planRegion(square, { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, NANO);
    checkInvariants(square, plan);
    expect(plan.aspect).toBe('1:1');
    expect(plan.roi).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
  });

  it('tall box picks the tallest fitting aspect', () => {
    const square = { width: 1000, height: 1000 };
    const plan = planRegion(square, { x: 0.45, y: 0.1, w: 0.1, h: 0.8 }, SEEDANCE);
    checkInvariants(square, plan);
    expect(plan.aspect).toBe('9:16');
  });

  it('wide box picks 21:9 when 16:9 would leave the picture', () => {
    const wide = { width: 2000, height: 1000 };
    const plan = planRegion(wide, { x: 0.05, y: 0.45, w: 0.9, h: 0.1 }, SEEDREAM);
    checkInvariants(wide, plan);
    expect(plan.aspect).toBe('21:9');
  });

  it('a very small box still plans', () => {
    const small = { width: 100, height: 100 };
    const plan = planRegion(small, { x: 0.5, y: 0.5, w: 0.02, h: 0.02 }, NANO);
    checkInvariants(small, plan);
    expect(plan.box.width).toBe(2);
    expect(plan.work.width).toBeGreaterThanOrEqual(1536);
  });

  it('a huge crop is sent at most at 4096 on the long side', () => {
    const huge = { width: 6000, height: 4000 };
    const plan = planRegion(huge, { x: 0, y: 0, w: 1, h: 1 }, NANO);
    checkInvariants(huge, plan);
    expect(plan.aspect).toBe('3:2');
    expect(plan.work).toEqual({ width: 4096, height: 2731 });
  });

  it('a mid-size crop keeps its own size', () => {
    const img = { width: 4000, height: 3000 };
    const plan = planRegion(img, { x: 0.3, y: 0.3, w: 0.35, h: 0.35 }, NANO);
    checkInvariants(img, plan);
    expect(Math.max(plan.work.width, plan.work.height)).toBe(Math.max(plan.roi.width, plan.roi.height));
  });
});

describe('planRegion — invariants across aspect lists and boxes', () => {
  const images = [
    { width: 1024, height: 1024 },
    { width: 2048, height: 1152 },
    { width: 1152, height: 2048 },
    { width: 3000, height: 2000 },
    { width: 640, height: 480 },
  ];
  const boxes = [
    { x: 0.42, y: 0.42, w: 0.16, h: 0.16 },
    { x: 0, y: 0, w: 0.3, h: 0.3 },
    { x: 0.7, y: 0.75, w: 0.3, h: 0.25 },
    { x: 0.1, y: 0.02, w: 0.05, h: 0.9 },
    { x: 0.02, y: 0.4, w: 0.96, h: 0.08 },
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0.5, y: 0.5, w: 0.02, h: 0.02 },
  ];
  for (const [name, list] of Object.entries({ seedream: SEEDREAM, nano: NANO, seedance: SEEDANCE })) {
    it(`${name}: every plan keeps the box inside the crop and the crop inside the picture`, () => {
      for (const image of images) {
        for (const b of boxes) {
          const plan = planRegion(image, b, list);
          checkInvariants(image, plan);
          expect(list).toContain(plan.aspect);
        }
      }
    });
  }
});
