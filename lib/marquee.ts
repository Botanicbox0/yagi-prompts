/**
 * PLAN §5.3-5 — "KLING · VEO · COMFYUI · ELEVENLABS · ...", 40s linear loop, pause on hover.
 *
 * The strip prefers the REAL tools and models the catalog references, so it stays honest as the
 * library grows, and tops up from a house list so a thin (or empty) catalog still reads as a
 * ticker rather than three lonely words.
 */

/** The names §5.3 names, plus the rest of the stack the studio actually runs. */
export const HOUSE_MARQUEE_ITEMS = [
  'KLING',
  'VEO',
  'COMFYUI',
  'ELEVENLABS',
  'SEEDANCE',
  'NANO BANANA',
  'FLUX',
  'RUNWAY',
  'WAN',
  'TOPAZ',
  'FFMPEG',
  'HIGGSFIELD',
  'SEEDREAM',
  'HYPERFRAMES',
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
