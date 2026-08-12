import { posterHash, posterRatio, posterWords } from '@/components/ui/poster-seed';

/**
 * The contest poster stand-in — §14.2's "poster-led card", when there is not yet a poster.
 *
 * A separate composition from the prompts one, not a variant of it, because a contest poster says a
 * different thing: the BRAND is the kicker (someone is hosting this) and the PRIZE is the second
 * line (that is what is on offer). It is deliberately louder than the prompt tile — a contest card
 * is an invitation, and an invitation that looks like a placeholder does not get accepted.
 *
 * Deterministic from the slug, like every poster on the site: the listing is static, so the same
 * contest must compose identically on every build and in every render worker.
 */
export function ContestPoster({
  title,
  slug,
  brand,
  prize,
  ratio,
  /**
   * `wide` is the full-bleed hero variant.
   *
   * The difference is the type layout, and it is not cosmetic: three display words STACKED inside a
   * 21:9 band leaves two thirds of the frame empty and pushes the last line against the bottom
   * edge, while the same three words set on ONE line fill it. It also drops the aspect-ratio, since
   * in the hero the parent already owns the box and a second ratio on the child fights it.
   */
  wide = false,
}: {
  title: string;
  slug: string;
  brand: string;
  /** One short line — the page sets the real prize in display type further down. */
  prize?: string;
  ratio?: string;
  wide?: boolean;
}) {
  const words = posterWords(title, 3);
  const seed = posterHash(slug);
  const outlined = seed % Math.max(words.length, 1);

  return (
    <div
      data-poster="contest"
      className={[
        'relative flex h-full w-full flex-col justify-between overflow-hidden bg-black text-white',
        wide ? 'p-6 sm:p-10 lg:p-14' : 'p-5 sm:p-6',
      ].join(' ')}
      style={wide ? undefined : { aspectRatio: ratio ?? posterRatio(slug) }}
    >
      {/* Two hairlines, placed by the same hash, so no two posters share a grid. */}
      <span
        aria-hidden
        className="absolute inset-y-0 w-px bg-line-dark"
        style={{ left: `${28 + (seed % 24)}%` }}
      />
      <span
        aria-hidden
        className="absolute inset-x-0 h-px bg-line-dark"
        style={{ top: `${58 + ((seed >>> 8) % 18)}%` }}
      />

      <div className="relative flex items-start justify-between gap-3">
        {/* The brand kicker belongs to the HERO only. On a card the phase and D-day chips are
            absolutely positioned over this exact corner, and the card already names the brand in
            its own meta line — so printing it here would collide with a chip AND repeat itself. */}
        {wide ? (
          <span className="font-label text-[0.65rem] tracking-[0.14em] uppercase opacity-70">
            {brand}
          </span>
        ) : (
          <span aria-hidden />
        )}
        <span aria-hidden className="bg-accent mt-1 block h-2 w-2 shrink-0" />
      </div>

      <div className="relative flex flex-col gap-3 pb-1">
        <div className={wide ? 'flex flex-wrap items-baseline gap-x-[0.3em]' : 'flex flex-col'}>
          {words.map((word, index) => (
            <span
              key={`${index}-${word}`}
              className={[
                'font-display leading-[0.86] font-black tracking-tight uppercase',
                wide
                  ? 'text-[clamp(1.75rem,5.5vw,4.5rem)]'
                  : 'text-[clamp(1.75rem,6.5vw,3.5rem)]',
              ].join(' ')}
              // Explicit ink rather than `currentColor`: the poster is always black, and
              // `currentColor` on a transparent fill resolves to transparent.
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
        {prize && (
          <span className="font-mono text-[0.75rem] tracking-[0.04em] opacity-70">{prize}</span>
        )}
      </div>
    </div>
  );
}
