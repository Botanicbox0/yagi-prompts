/**
 * The arithmetic behind the §5.3 moves, kept pure so it can be unit-tested without a DOM.
 *
 * The client components in `components/motion/*` and `components/ad/*` own the browser APIs
 * (IntersectionObserver, rAF, GSAP); everything that can be reasoned about as numbers lives here.
 */

/** PLAN §4 / §5.3 tier boundaries. One place, so the CSS and the JS cannot drift apart. */
export const BREAKPOINTS = {
  /** §5.3-1/2/4: pins, scrubs and the circular wipe exist at ≥1024 only. */
  scenes: 1024,
  /** §3.6 / §4: the ad rail tier. Below this, one inline banner instead. */
  rail: 1440,
  /** §4: the nav collapses into an overlay menu below this. */
  navOverlay: 768,
} as const;

/** §4: the fixed top bar is 64px tall. */
export const NAV_HEIGHT = 64;

/** §3.6: "~0.08 lerp" — the rail trails the scroll, then settles. */
export const RAIL_LERP = 0.08;

/** Distance below the nav the rail parks at once it is following. */
export const RAIL_TOP_OFFSET = NAV_HEIGHT + 40;

export function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/** Below half a pixel the spring is visually done; stop burning frames. */
export function isSettled(current: number, target: number, epsilon = 0.5): boolean {
  return Math.abs(target - current) < epsilon;
}

export interface RailFollowInput {
  /** Anchor element top, in viewport coordinates. */
  anchorTop: number;
  /** Anchor element bottom, in viewport coordinates. */
  anchorBottom: number;
  railHeight: number;
  /** Where the rail parks once the anchor has scrolled under the nav. */
  topOffset: number;
}

/**
 * Where the fixed rail *wants* to be this frame, in viewport coordinates.
 *
 *   · before the anchor reaches the nav → ride with the anchor's top
 *   · while inside the anchor           → park at `topOffset`
 *   · near the anchor's end             → slide back out with the anchor's bottom
 *
 * The spring in `AdRail` chases this value at `RAIL_LERP`, which is what produces the lag.
 */
export function railTargetY({
  anchorTop,
  anchorBottom,
  railHeight,
  topOffset,
}: RailFollowInput): number {
  const parked = Math.max(anchorTop, topOffset);
  const lastPossible = anchorBottom - railHeight;
  return Math.max(anchorTop, Math.min(parked, lastPossible));
}

/**
 * `rootMargin` that shrinks the IntersectionObserver root to a 1px band at `probeY`.
 *
 * That band is the probe line: whichever section crosses it owns the theme (§4 —
 * "section-state-driven, IntersectionObserver flips data-theme, no mix-blend-mode").
 */
export function probeRootMargin(probeY: number, viewportHeight: number): string {
  const clampedTop = Math.max(0, Math.min(probeY, Math.max(0, viewportHeight - 1)));
  const bottom = Math.max(0, viewportHeight - clampedTop - 1);
  return `-${clampedTop}px 0px -${bottom}px 0px`;
}

export type SectionTheme = 'light' | 'dark';

export function isSectionTheme(value: unknown): value is SectionTheme {
  return value === 'light' || value === 'dark';
}

/**
 * Pick the theme from a probe-line observer callback. Entries arrive unordered and only for
 * elements whose intersection CHANGED, so the caller keeps a running map; this resolves the
 * winner from that map by document order (the last still-intersecting section wins, which is the
 * one that most recently crossed the line while scrolling down).
 */
export function pickSectionTheme(
  intersecting: ReadonlyArray<{ theme: string | null | undefined; order: number }>,
  fallback: SectionTheme = 'light',
): SectionTheme {
  let best: { theme: SectionTheme; order: number } | null = null;
  for (const entry of intersecting) {
    if (!isSectionTheme(entry.theme)) continue;
    if (best === null || entry.order > best.order) {
      best = { theme: entry.theme, order: entry.order };
    }
  }
  return best?.theme ?? fallback;
}

/** Diameter that guarantees a centred circle covers a `w × h` strip corner to corner. */
export function coveringCircleDiameter(width: number, height: number): number {
  return Math.ceil(Math.hypot(width, height)) + 2;
}
