import { describe, expect, it } from 'vitest';
import { fixtureDoc } from '@/lib/brand-studio/editor-v2/fixture';
import {
  LOOK_DETAILS,
  NEUTRAL_DETAIL,
  balanceDetail,
  balanceLooks,
  colorFindings,
  filmTarget,
  gradeMatrix,
  isNeutral,
  statsFromPixels,
  type FrameStats,
} from '@/lib/brand-studio/editor-v2/model';

const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

const px = (rgb: readonly number[]) => statsFromPixels([rgb[0]!, rgb[1]!, rgb[2]!, 255]);

/** Applies a 4×5 matrix (feColorMatrix order) to an RGB colour in 0..1; reports whether any channel clipped. */
function applyMatrix(m: readonly number[], rgb: readonly [number, number, number]) {
  let clipped = false;
  const out = [0, 1, 2].map((row) => {
    const value = m[row * 5]! * rgb[0] + m[row * 5 + 1]! * rgb[1] + m[row * 5 + 2]! * rgb[2] + m[row * 5 + 3]! * 1 + m[row * 5 + 4]!;
    if (value < 0 || value > 1) clipped = true;
    return Math.min(1, Math.max(0, value));
  });
  return { out, clipped };
}

describe('statsFromPixels', () => {
  it('measures grey, warm and saturated buffers', () => {
    const grey = statsFromPixels([128, 128, 128, 255, 128, 128, 128, 255]);
    expect(grey.luma).toBeCloseTo(128 / 255, 3);
    expect(grey.warmth).toBe(0);
    expect(grey.saturation).toBe(0);

    const warm = px([200, 120, 60]);
    expect(warm.warmth).toBeGreaterThan(0.2);
    const cool = px([60, 120, 200]);
    expect(cool.warmth).toBeLessThan(-0.2);

    const red = px([255, 0, 0]);
    expect(red.saturation).toBe(1);
    expect(red.luma).toBeCloseTo(0.2126, 3);
    expect(px([0, 0, 0])).toEqual({ luma: 0, warmth: 0, saturation: 0 });
  });

  it('returns the middle for an empty buffer and ignores a trailing partial pixel', () => {
    expect(statsFromPixels([])).toEqual({ luma: 0.5, warmth: 0, saturation: 0 });
    expect(statsFromPixels([10, 20])).toEqual({ luma: 0.5, warmth: 0, saturation: 0 });
    expect(statsFromPixels([128, 128, 128, 255, 255, 0])).toEqual(px([128, 128, 128]));
  });
});

describe('filmTarget', () => {
  it('takes the median luma and the mean warmth and saturation', () => {
    const stats: FrameStats[] = [
      { luma: 0.2, warmth: 0.1, saturation: 0.2 },
      { luma: 0.9, warmth: -0.1, saturation: 0.4 },
      { luma: 0.5, warmth: 0.3, saturation: 0.6 },
    ];
    expect(filmTarget(stats)).toEqual({ luma: 0.5, warmth: 0.1, saturation: 0.4 });
    expect(filmTarget(stats.slice(0, 2)).luma).toBeCloseTo(0.55, 3);
    expect(filmTarget([])).toEqual({ luma: 0.5, warmth: 0, saturation: 0.3 });
  });
});

describe('gradeMatrix', () => {
  it('is the identity for a neutral detail or strength 0', () => {
    // `-0` and `0` are the same filter value (String(-0) === '0'), so compare numerically.
    const numeric = (m: number[]) => m.map((v) => v + 0);
    expect(numeric(gradeMatrix(NEUTRAL_DETAIL))).toEqual(IDENTITY);
    expect(numeric(gradeMatrix(LOOK_DETAILS.film, 0))).toEqual(IDENTITY);
    expect(numeric(gradeMatrix(LOOK_DETAILS.film, -2))).toEqual(IDENTITY);
    expect(isNeutral(NEUTRAL_DETAIL)).toBe(true);
    expect(isNeutral(LOOK_DETAILS.brand)).toBe(false);
  });

  it('always has twenty numbers ending in an untouched alpha row', () => {
    for (const detail of [NEUTRAL_DETAIL, ...Object.values(LOOK_DETAILS)]) {
      for (const strength of [0, 0.3, 1, 2]) {
        const m = gradeMatrix(detail, strength);
        expect(m).toHaveLength(20);
        expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
        expect(m.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('gives equal R, G and B rows for the mono look', () => {
    const m = gradeMatrix(LOOK_DETAILS.mono);
    expect(m.slice(0, 5)).toEqual(m.slice(5, 10));
    expect(m.slice(5, 10)).toEqual(m.slice(10, 15));
  });

  it('moves a frame towards the target luma and warmth', () => {
    const colours: Array<[number, number, number]> = [
      [60, 40, 30],
      [200, 210, 240],
      [100, 100, 100],
      [80, 140, 70],
      [150, 110, 90],
      [30, 35, 60],
    ];
    const targets = [
      { luma: 0.45, warmth: 0.03 },
      { luma: 0.6, warmth: -0.04 },
      { luma: 0.3, warmth: 0.08 },
    ];
    let checked = 0;
    for (const colour of colours) {
      const stats = px(colour);
      for (const t of targets) {
        // Saturation held at the frame's own value: this checks exposure and temperature.
        const target: FrameStats = { ...t, saturation: stats.saturation };
        const m = gradeMatrix(balanceDetail(stats, target));
        const { out, clipped } = applyMatrix(m, [colour[0] / 255, colour[1] / 255, colour[2] / 255]);
        const after = px(out.map((v) => Math.round(v * 255)));
        const lumaBefore = Math.abs(stats.luma - target.luma);
        const lumaAfter = Math.abs(after.luma - target.luma);
        const warmBefore = Math.abs(stats.warmth - target.warmth);
        const warmAfter = Math.abs(after.warmth - target.warmth);
        if (clipped) continue;
        checked += 1;
        expect(lumaAfter, `luma ${colour} → ${t.luma}`).toBeLessThanOrEqual(lumaBefore + 0.01);
        expect(warmAfter, `warmth ${colour} → ${t.warmth}`).toBeLessThanOrEqual(warmBefore + 0.01);
        if (lumaBefore > 0.03) expect(lumaAfter).toBeLessThan(lumaBefore);
        if (warmBefore > 0.03) expect(warmAfter).toBeLessThan(warmBefore);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('balanceDetail stays inside its ranges and leaves contrast alone', () => {
    const d = balanceDetail({ luma: 0.01, warmth: -0.5, saturation: 0.05 }, { luma: 0.9, warmth: 0.5, saturation: 0.9 });
    expect(d).toEqual({ exposure: 1, contrast: 0, temperature: 1, saturation: 0.5 });
    expect(balanceDetail({ luma: 0, warmth: 0, saturation: 0 }, { luma: 0.5, warmth: 0, saturation: 0.3 })).toEqual(NEUTRAL_DETAIL);
  });
});

describe('colorFindings and balanceLooks', () => {
  const project = fixtureDoc((id) => id).project;
  const src = project.clips.map((clip) => clip.srcUrl);
  const statsFor = (values: Array<Partial<FrameStats>>) =>
    Object.fromEntries(values.map((v, i) => [src[i]!, { luma: 0.5, warmth: 0, saturation: 0.3, ...v }]));

  it('finds the dark cut', () => {
    const stats = statsFor([{}, {}, { luma: 0.3 }, {}]);
    expect(colorFindings(project, stats, {})).toEqual([{ kind: 'dark_cut', clipId: 'cut-3', clipNumber: 3 }]);
  });

  it('finds mixed temperature', () => {
    const stats = statsFor([{ warmth: 0 }, { warmth: 0.1 }, {}, {}]);
    expect(colorFindings(project, stats, {})).toEqual([
      { kind: 'mixed_temperature', clipIds: ['cut-1', 'cut-2', 'cut-3', 'cut-4'] },
    ]);
  });

  it('says nothing with fewer than two measured cuts', () => {
    expect(colorFindings(project, {}, {})).toEqual([]);
    expect(colorFindings(project, { [src[2]!]: { luma: 0.05, warmth: 0.4, saturation: 0.3 } }, {})).toEqual([]);
  });

  it('leaves out cuts that already carry a look', () => {
    const stats = statsFor([{}, {}, { luma: 0.3, warmth: 0.2 }, {}]);
    const looks = { 'cut-3': { source: 'auto' as const, detail: NEUTRAL_DETAIL, strength: 1 } };
    expect(colorFindings(project, stats, looks)).toEqual([]);
  });

  it('balanceLooks only touches the requested, measured cuts', () => {
    const stats = statsFor([{ luma: 0.3 }, { luma: 0.6 }, {}]);
    const target = { luma: 0.5, warmth: 0, saturation: 0.3 };
    const looks = balanceLooks(project, ['cut-2', 'cut-4'], stats, target, 'match', 'cut 1');
    // cut-4 has no measurement, so only cut-2 gets a look.
    expect(Object.keys(looks)).toEqual(['cut-2']);
    expect(looks['cut-2']).toEqual({
      source: 'match',
      reference: 'cut 1',
      strength: 1,
      detail: balanceDetail(stats[src[1]!]!, target),
    });
    const auto = balanceLooks(project, ['cut-1'], stats, target, 'auto');
    expect(Object.keys(auto)).toEqual(['cut-1']);
    expect(auto['cut-1']).not.toHaveProperty('reference');
  });
});
