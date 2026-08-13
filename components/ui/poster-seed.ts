/**
 * The deterministic primitives behind every typographic poster on the site.
 *
 * M6 introduced them inside `components/prompts/poster.tsx` for the §13.3-4 text-only card; M9
 * needs the same determinism for contest posters (§14.2), and a second copy of an FNV hash is a
 * second thing that can drift. So the *primitives* moved here and the two compositions stayed
 * where they belong — a prompt poster is a card tile, a contest poster is a full-bleed hero, and
 * they should not be one component with a mode flag.
 *
 * The determinism itself is the load-bearing property, twice over: a static page must render
 * identically on every build, and a masonry column only reads as masonry if the heights are stable
 * between server and client. Nothing here is random and nothing is time-based.
 */

/** FNV-1a, 32-bit — small, stable, and dependency-free. */
export function posterHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Four ratios, picked by hash, give a wall of posters its rhythm without ever changing between
 * renders. Real media overrides this with its own intrinsic ratio.
 */
export const POSTER_RATIOS = ['4 / 5', '1 / 1', '3 / 4', '16 / 10'] as const;

export function posterRatio(seed: string): string {
  return POSTER_RATIOS[posterHash(seed) % POSTER_RATIOS.length]!;
}

/** Two or three words of a title, punctuation stripped — a poster, not a paragraph. */
export function posterWords(title: string, max = 3): string[] {
  return title
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}\-]/gu, ''))
    .filter((word) => word.length > 0)
    .slice(0, max);
}
