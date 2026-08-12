/**
 * The typographic poster — PLAN §13.3-4: "text-only cards get a typographic poster in the design
 * language".
 *
 * It stands in for a missing (or not-yet-served) still, and it is deliberately NOT a grey box: two
 * inks, one accent, the display face at poster scale, and a deterministic composition derived from
 * the slug so the same prompt always looks like itself. That determinism matters twice — a static
 * page must render identically on every build, and a masonry column only reads as masonry if the
 * heights are stable between server and client.
 *
 * Every value below comes from the slug hash. Nothing random, nothing time-based.
 */

/** FNV-1a, 32-bit — small, stable, and dependency-free. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * §13.2 masonry: the rail wants columns of unequal height, and with no real media there is nothing
 * to get that from. Four ratios, picked by hash, give the wall its rhythm without ever changing
 * between renders. Real media overrides this with its own intrinsic ratio.
 */
export const POSTER_RATIOS = ['4 / 5', '1 / 1', '3 / 4', '16 / 10'] as const;

export function posterRatio(seed: string): string {
  return POSTER_RATIOS[hash(seed) % POSTER_RATIOS.length]!;
}

/** Two or three words of the title, uppercased — a poster, not a paragraph. */
function posterWords(title: string): string[] {
  const words = title
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}\-]/gu, ''))
    .filter((word) => word.length > 0);
  return words.slice(0, 3);
}

export function TypographicPoster({
  title,
  slug,
  kicker,
  ratio,
}: {
  title: string;
  slug: string;
  /** The model chip's text — the one fact every card states (§13.3-3). */
  kicker: string;
  ratio?: string;
}) {
  const words = posterWords(title);
  const seed = hash(slug);
  // Which word gets the outline treatment, and where the accent block sits: both from the hash.
  const outlined = seed % Math.max(words.length, 1);

  return (
    <div
      data-poster="typographic"
      className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-black p-4 text-white sm:p-5"
      style={{ aspectRatio: ratio ?? posterRatio(slug) }}
    >
      <span aria-hidden className="absolute inset-y-0 left-1/3 w-px bg-line-dark" />
      <span aria-hidden className="absolute inset-x-0 top-2/3 h-px bg-line-dark" />

      <div className="relative flex items-start justify-between gap-3">
        <span className="font-label text-[0.65rem] tracking-[0.14em] uppercase opacity-70">
          {kicker}
        </span>
        <span aria-hidden className="bg-accent mt-1 block h-2 w-2 shrink-0" />
      </div>

      <div className="relative flex flex-col pb-1">
        {words.map((word, index) => (
          <span
            key={`${index}-${word}`}
            className="font-display text-[clamp(1.75rem,7vw,3.25rem)] leading-[0.86] font-black tracking-tight uppercase"
            // Explicit ink rather than `currentColor` — the poster is always black, and
            // `currentColor` on a transparent fill resolves to transparent (see reel-poster.tsx).
            style={
              index === outlined
                ? { WebkitTextStroke: '1px #ffffff', color: 'transparent' }
                : undefined
            }
          >
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}
