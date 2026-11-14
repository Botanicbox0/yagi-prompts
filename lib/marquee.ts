/**
 * PLAN §5.3-5 — the strip under the catalogue: 40s linear loop, pause on hover.
 *
 * The strip prefers what the catalog actually references (the engine label, the use cases the
 * templates carry), and tops up from a house list so a thin catalog still reads as a ticker rather
 * than three lonely words. Founder, 2026-09-11: the house list names only what TWINGS actually
 * runs and ships — the engines, the aspects, the lengths, the destinations. No tool the studio
 * does not use is allowed on the front door.
 */

/** What the studio actually runs and delivers. Engines first; the rest is the shape of a film. */
export const HOUSE_MARQUEE_ITEMS = [
  'SEEDANCE 2.5',
  'SEEDREAM 5.5',
  'GPT IMAGE 2',
  '9:16',
  '16:9',
  '1:1',
  '4:5',
  '15S',
  '30S',
  '720P',
  'REELS',
  'SHORTS',
  'STORIES',
  'TWINGS',
] as const;

export const MARQUEE_MAX_ITEMS = 14;
/** §5.3-5: a 40s linear loop. */
export const MARQUEE_DURATION_SECONDS = 40;

export interface MarqueeSource {
  tools: readonly string[];
  models: readonly string[];
}

/**
 * Catalog names first (de-duplicated case-insensitively), house names after, capped.
 * Everything is upper-cased: the strip is set in the display face, which is uppercase by design.
 */
export function marqueeItems(
  source: MarqueeSource,
  max: number = MARQUEE_MAX_ITEMS,
  house: readonly string[] = HOUSE_MARQUEE_ITEMS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const value = raw.trim().toUpperCase();
    if (value.length === 0 || seen.has(value) || out.length >= max) return;
    seen.add(value);
    out.push(value);
  };

  for (const name of [...source.models, ...source.tools]) push(name);
  for (const name of house) push(name);

  return out;
}
