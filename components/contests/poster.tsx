import { posterRatio } from '@/components/ui/poster-seed';
import { splitPrize } from './prize';

/**
 * The contest poster stand-in — §14.2's "poster-led card", when there is not yet a poster.
 *
 * A separate composition from the prompts one, not a variant of it, because a contest poster says a
 * different thing: the BRAND is the kicker (someone is hosting this) and the PRIZE is the second
 * line (that is what is on offer). It is deliberately louder than the prompt tile — a contest card
 * is an invitation, and an invitation that looks like a placeholder does not get accepted.
 *
 * Deterministic from the slug, like every poster on the site: the listing is static, so the same
 * contest must compose identically on every build and in every render worker. What is deterministic
 * is now the RATIO only — the M9 design review (finding 1) took the hash off the typography and off
 * the rules, because a decoration placed by a hash is a decoration that cannot be designed.
 */

/**
 * The title, as lines.
 *
 * §5.2: "display lines manually broken". The author breaks the title in the admin editor (a
 * three-row textarea, so a break is a decision) and every authored line is set — the previous
 * version took the first three WORDS and silently discarded the rest, which turned "YAGI PROMPTS
 * LAUNCH FILM CONTEST" into "YAGI PROMPTS LAUNCH".
 *
 * A title with no authored break is chunked into at most three balanced lines rather than
 * truncated: a poster still needs a stack, but nothing may be thrown away to get one.
 */
export function posterTitleLines(title: string, max = 3): string[] {
  const authored = title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (authored.length > 1) return authored;

  const words = (authored[0] ?? '').split(/\s+/).filter((word) => word !== '');
  if (words.length <= 1) return words;

  const perLine = Math.ceil(words.length / Math.min(max, words.length));
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(' '));
  return lines;
}

/**
 * The outline is the poster's one typographic flourish, and it lands on the LAST line — the
 * semantic one ("CONTEST", "공모전"). The hash used to pick a line at random, which on the launch
 * poster hollowed out the studio's own name (M9 design review, finding 1).
 */
function outlineStyle(): { WebkitTextStroke: string; color: string } {
  // Explicit ink rather than `currentColor`: the poster is always black, and `currentColor` on a
  // transparent fill resolves to transparent.
  return { WebkitTextStroke: '1px #ffffff', color: 'transparent' };
}

export function ContestPoster({
  title,
  slug,
  brand,
  prize,
  prizeLabel,
  ratio,
  /**
   * `wide` is the full-bleed hero variant, and it is a different COMPOSITION rather than a bigger
   * one (M9 design review, finding 1).
   *
   * Three tiers, each with its own grid, padding and type step:
   *   · **≥1024** — 12 columns, 56px padding. Title spans 1–8 at clamp(4.75rem, 9vw, 8.5rem)/0.82;
   *     the prize panel takes 9–12 behind a structural left hairline, which lands the rule at
   *     exactly 66.67% of the frame because it IS the column boundary.
   *   · **640–1023** — 8 columns, 32px padding, 64px title / 48px prize.
   *   · **<640** — one column, 24px padding, 48px title, and the prize as a bottom row separated by
   *     a hairline. The hero's own box goes 4:5 here (`hero.tsx`): a landscape band at phone width
   *     is 90px of black with type in it.
   *
   * The grid is declared on the FRAME and the padding on the CELLS, so the column boundary is a real
   * geometric line rather than a percentage that happens to look close to one.
   */
  wide = false,
}: {
  title: string;
  slug: string;
  brand: string;
  /** The authored prize string; the composition splits it (`prize.ts`). */
  prize?: string;
  /** "Prize" / "상금" — the poster has no dictionary of its own. */
  prizeLabel?: string;
  ratio?: string;
  wide?: boolean;
}) {
  const lines = posterTitleLines(title);
  const { total, payouts } = splitPrize(prize ?? '');

  if (wide) {
    return (
      <div
        data-poster="contest"
        // §5.1/finding 2: a black panel is a DARK SURFACE. Without this the accent inside it
        // resolves to the light-surface #0000EE, which measures 2.23:1 on black.
        data-theme="dark"
        className="relative grid h-full w-full grid-cols-1 grid-rows-[1fr_auto] bg-black text-white sm:grid-cols-8 sm:grid-rows-1 lg:grid-cols-12"
      >
        <div className="flex flex-col justify-end p-6 sm:col-span-5 sm:p-8 lg:col-span-8 lg:p-14">
          {lines.map((line, index) => (
            <span
              key={`${index}-${line}`}
              data-poster-line={index === lines.length - 1 ? 'final' : 'body'}
              className="font-display text-contest-poster font-black uppercase"
              style={index === lines.length - 1 ? outlineStyle() : undefined}
            >
              {line}
            </span>
          ))}
        </div>

        {/* The structural line: a real border on the panel, at the column boundary. */}
        <div className="flex flex-col justify-between gap-8 border-t border-hairline p-6 sm:col-span-3 sm:border-t-0 sm:border-l sm:p-8 lg:col-span-4 lg:p-14">
          <div className="flex items-start justify-between gap-3">
            <span className="font-label text-[0.75rem] tracking-[0.14em] uppercase opacity-70">
              {brand}
            </span>
            <span aria-hidden className="bg-accent mt-0.5 block h-3 w-3 shrink-0" />
          </div>

          {total !== '' && (
            <div>
              {prizeLabel && (
                <p className="text-accent font-label text-[0.75rem] tracking-[0.14em] uppercase">
                  {prizeLabel}
                </p>
              )}
              <p className="mt-3 font-display text-contest-poster-prize font-black uppercase">
                {total}
              </p>
              {payouts.length > 0 && (
                <ul className="mt-4 flex flex-col gap-1 font-mono text-[0.75rem] opacity-70">
                  {payouts.map((payout) => (
                    <li key={payout}>{payout}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-poster="contest"
      data-theme="dark"
      className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-black p-5 text-white sm:p-6"
      style={{ aspectRatio: ratio ?? posterRatio(slug) }}
    >
      {/* One hairline, on the same 2/3 line the hero poster's panel sits on — a fixed grid line
          rather than the two hash-placed rules this used to carry. */}
      <span aria-hidden className="bg-hairline absolute inset-y-0 left-2/3 w-px" />

      {/* The brand kicker belongs to the HERO only. On a card the phase and D-day chips are
          absolutely positioned over this exact corner, and the card prints the brand in its own
          boxed chip — so printing it here would collide with a chip AND repeat itself. */}
      <div className="relative flex items-start justify-end">
        <span aria-hidden className="bg-accent mt-1 block h-2 w-2 shrink-0" />
      </div>

      <div className="relative flex flex-col gap-3 pb-1">
        <div className="flex flex-col">
          {lines.map((line, index) => (
            <span
              key={`${index}-${line}`}
              data-poster-line={index === lines.length - 1 ? 'final' : 'body'}
              className="font-display text-contest-card font-black uppercase"
              style={index === lines.length - 1 ? outlineStyle() : undefined}
            >
              {line}
            </span>
          ))}
        </div>
        {total !== '' && (
          <span className="font-mono text-[0.75rem] tracking-[0.04em] opacity-70">{total}</span>
        )}
      </div>
    </div>
  );
}
