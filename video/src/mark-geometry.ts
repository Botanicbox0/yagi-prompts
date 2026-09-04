/**
 * YAGI monogram — a "Y" whose arms are goat horns. Single colour, geometric, no outline.
 * The horns are generated from explicit outer/inner edge cubics, which is what lets them GROW on
 * screen (the outline is re-sampled per frame up to the current growth) instead of fading in
 * like a bitmap. Coordinates live in a 200 x 200 box. No JSX here: `scripts/export-mark.ts`
 * runs this file under plain Node to write the static brand SVGs.
 */
export const CREAM = '#E8E4DC';

type Vec = readonly [number, number];
type Cubic = readonly [Vec, Vec, Vec, Vec];
/** Both edges run base -> tip: `outer` leaves the stem's top corner, `inner` leaves the crotch. */
interface HornSpec {
  outer: Cubic;
  inner: Cubic;
}

export const STEM = { x: 79, y: 104, w: 42, h: 76 } as const;
const CROTCH: Vec = [100, 90];

// Locked geometry. The outer edge starts straight up from the stem corner (first control point
// directly above it), so horn and stem share a tangent and the silhouette has no shoulder.
export const LEFT: HornSpec = {
  outer: [[79, 104], [79, 56], [56, 44], [30, 10]],
  inner: [[100, 90], [92, 68], [86, 44], [30, 10]],
};
const mirror = (c: Cubic): Cubic => [
  [200 - c[0][0], c[0][1]],
  [200 - c[1][0], c[1][1]],
  [200 - c[2][0], c[2][1]],
  [200 - c[3][0], c[3][1]],
];
export const RIGHT: HornSpec = { outer: mirror(LEFT.outer), inner: mirror(LEFT.inner) };

const bez = (c: Cubic, t: number): Vec => {
  const u = 1 - t;
  return [
    u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0],
    u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1],
  ];
};

/** Outline of the horn drawn up to `grow` (0..1). The moving front is squeezed to a point. */
export const hornPath = (s: HornSpec, grow: number, n = 72): string => {
  if (grow <= 0.001) return '';
  const outer: Vec[] = [];
  const inner: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * grow;
    const o = bez(s.outer, t);
    const q = bez(s.inner, t);
    const front = grow < 1 ? Math.pow(Math.max(0, Math.min(1, (grow - t) / (0.35 * grow))), 0.75) : 1;
    const mx = (o[0] + q[0]) / 2;
    const my = (o[1] + q[1]) / 2;
    outer.push([mx + (o[0] - mx) * front, my + (o[1] - my) * front]);
    inner.push([mx + (q[0] - mx) * front, my + (q[1] - my) * front]);
  }
  // Close 3 units INTO the stem so rect and horn overlap: no anti-aliased seam at any size.
  const seat = STEM.y + 3;
  const base: Vec = s.outer[0][0] < 100 ? [STEM.x, seat] : [STEM.x + STEM.w, seat];
  const pts = [...outer, ...inner.reverse(), [CROTCH[0], seat] as Vec, base];
  return `M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L')}Z`;
};

// Static export for the brand kit (full mark, no animation).
export const markSvg = (color: string = CREAM): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="YAGI">` +
  `<g fill="${color}"><rect x="${STEM.x}" y="${STEM.y}" width="${STEM.w}" height="${STEM.h}"/>` +
  `<path d="${hornPath(LEFT, 1)}"/><path d="${hornPath(RIGHT, 1)}"/></g></svg>`;
