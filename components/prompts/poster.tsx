import { posterHash, posterRatio, posterWords, POSTER_RATIOS } from '@/components/ui/poster-seed';

/**
 * The typographic poster — PLAN §13.3-4: "text-only cards get a typographic poster in the design
 * language".
 *
 * It stands in for a missing (or not-yet-served) still, and it is deliberately NOT a grey box: two
 * inks, one accent, the display face at poster scale, and a deterministic composition derived from
 * the slug so the same prompt always looks like itself.
 *
 * M9 moved the deterministic primitives (`posterHash`, `posterRatio`, `posterWords`) into
 * `components/ui/poster-seed.ts` so the §14 contest poster can share them; the composition below is
 * unchanged, and the two exports the rest of the app imports from here are re-exported so nothing
 * downstream had to move with them.
 */

export { POSTER_RATIOS, posterRatio };

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
  const seed = posterHash(slug);
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
