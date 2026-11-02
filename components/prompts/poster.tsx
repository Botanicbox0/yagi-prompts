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

/**
 * Type size in container widths, so a word never breaks however narrow the card is (a 9:16 card in a
 * film row can be under 100px wide). The longest word sets it, measured with Hangul at 1em and Latin
 * at about 0.62em, and the line count keeps a wide card's words inside its height.
 */
export function posterFontSize(words: readonly string[]): string {
  const widest = Math.max(1, ...words.map((word) => [...word].reduce((sum, char) => sum + (/[\u3131-\uD79D]/.test(char) ? 1 : 0.62), 0)));
  const cqw = Math.min(64 / widest, 40 / Math.max(words.length, 1));
  return `min(${cqw.toFixed(2)}cqw, 3.25rem)`;
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
  const seed = posterHash(slug);
  // Which word gets the outline treatment, and where the accent block sits: both from the hash.
  const outlined = seed % Math.max(words.length, 1);
  const fontSize = posterFontSize(words);

  return (
    <div
      data-poster="typographic"
      className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-black p-3 text-white [container-type:inline-size]"
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
            className="font-display whitespace-nowrap"
            // Explicit ink rather than `currentColor` — the poster is always black, and
            // `currentColor` on a transparent fill resolves to transparent (see reel-poster.tsx).
            style={
              index === outlined
                ? { fontSize, WebkitTextStroke: '1px #ffffff', color: 'transparent' }
                : { fontSize }
            }
          >
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}
