import { describe, expect, it } from 'vitest';
import {
  BREAKPOINTS,
  coveringCircleDiameter,
  isSettled,
  lerp,
  NAV_HEIGHT,
  pickSectionTheme,
  probeRootMargin,
  RAIL_LERP,
  RAIL_TOP_OFFSET,
  railTargetY,
} from '@/lib/motion/geometry';

/**
 * The numbers behind the §5.3 moves. The DOM half (IntersectionObserver, rAF, GSAP) is verified in
 * the browser; everything here is arithmetic that has an exact right answer, so it is pinned.
 */

describe('tier boundaries (§4 / §5.3)', () => {
  it('matches the plan verbatim', () => {
    expect(BREAKPOINTS.scenes).toBe(1024); // pins, scrubs, circular wipe
    expect(BREAKPOINTS.rail).toBe(1440); // ad rail tier
    expect(BREAKPOINTS.navOverlay).toBe(768); // overlay menu below this
    expect(NAV_HEIGHT).toBe(64);
    expect(RAIL_LERP).toBeCloseTo(0.08); // §3.6 "spring interpolation (~0.08 lerp)"
  });
});

describe('spring (§3.6 lagged follow)', () => {
  it('closes the gap by exactly the lerp factor each frame', () => {
    expect(lerp(0, 100, 0.08)).toBeCloseTo(8);
    expect(lerp(8, 100, 0.08)).toBeCloseTo(15.36);
    expect(lerp(100, 100, 0.08)).toBe(100);
  });

  it('converges rather than oscillating', () => {
    let current = 0;
    for (let i = 0; i < 200; i += 1) current = lerp(current, 640, RAIL_LERP);
    expect(current).toBeCloseTo(640, 3);
  });

  it('reports settled below half a pixel so the rAF loop can stop', () => {
    expect(isSettled(100, 100.4)).toBe(true);
    expect(isSettled(100, 101)).toBe(false);
  });
});

describe('rail follow target (§3.6)', () => {
  const railHeight = 400;
  const topOffset = RAIL_TOP_OFFSET;

  it('rides with the anchor before it reaches the nav', () => {
    expect(
      railTargetY({ anchorTop: 800, anchorBottom: 4000, railHeight, topOffset }),
    ).toBe(800);
  });

  it('parks under the nav while inside the anchor', () => {
    expect(railTargetY({ anchorTop: -1200, anchorBottom: 2400, railHeight, topOffset })).toBe(
      topOffset,
    );
  });

  it('slides back out with the anchor bottom at the end', () => {
    // anchorBottom 300 ⇒ the last position that still fits a 400px rail is -100.
    expect(railTargetY({ anchorTop: -5000, anchorBottom: 300, railHeight, topOffset })).toBe(-100);
  });

  it('never renders above its own anchor when the anchor is shorter than the rail', () => {
    const y = railTargetY({ anchorTop: 50, anchorBottom: 250, railHeight, topOffset });
    expect(y).toBe(50);
  });
});

describe('probe line (§4 section-state-driven theme)', () => {
  it('shrinks the observer root to a 1px band at the probe', () => {
    expect(probeRootMargin(32, 900)).toBe('-32px 0px -867px 0px');
    // 32 + 1 + 867 = 900 — the band is exactly one pixel tall.
  });

  it('stays valid at the edges rather than producing a negative-height root', () => {
    expect(probeRootMargin(0, 900)).toBe('-0px 0px -899px 0px');
    expect(probeRootMargin(2000, 900)).toBe('-899px 0px -0px 0px');
    expect(probeRootMargin(32, 0)).toBe('-0px 0px -0px 0px');
  });
});

describe('theme resolution', () => {
  it('takes the last section in document order that still crosses the line', () => {
    expect(
      pickSectionTheme([
        { theme: 'dark', order: 0 },
        { theme: 'light', order: 3 },
      ]),
    ).toBe('light');
  });

  it('ignores junk values and falls back when nothing crosses', () => {
    expect(pickSectionTheme([{ theme: 'chartreuse', order: 9 }])).toBe('light');
    expect(pickSectionTheme([], 'dark')).toBe('dark');
    expect(pickSectionTheme([{ theme: null, order: 0 }], 'dark')).toBe('dark');
  });
});

describe('circular wipe geometry (§5.3-2)', () => {
  it('covers the strip corner to corner', () => {
    // A 3-4-5 triangle: a 300×400 strip needs a 500px diameter, plus the 2px safety margin.
    expect(coveringCircleDiameter(300, 400)).toBe(502);
    expect(coveringCircleDiameter(1512, 405)).toBe(1568);
  });
});
