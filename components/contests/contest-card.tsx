import type { ContestCard as ContestCardData } from '@/lib/contests/catalog';
import { contestHref } from '@/lib/contests/links';
import { contestTiming, type ContestPhase } from '@/lib/contests/phase';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { ContestPoster } from './poster';
import { hostKindLabel, phaseLabel, prizeKindLabel, type ContestLabels } from './labels';
import { posterRatio } from '@/components/ui/poster-seed';

/**
 * PLAN §14.2 — the contest card: "poster-led, brand chip + phase chip + D-day label
 * (server-rendered)".
 *
 * Server-rendered is the operative word and it is a decision, not a shortcut: a client-side
 * countdown would tick, which on a `[static + tag]` page means the first paint disagrees with the
 * cached HTML and the layout shifts under the reader. The chip is computed once, from the same
 * `now` the rail split used, and it counts whole UTC days for the reasons `lib/contests/phase.ts`
 * spells out.
 *
 * Structure mirrors `components/prompts/prompt-card.tsx` — the same border, the same §5.3-6 hover,
 * the same stretched-link pattern — because a reader moving between the two tabs should not feel
 * they changed sites. What differs is what the card SAYS: a prompt card credits an author, a
 * contest card names a brand and a clock.
 */
export function ContestCardView({
  card,
  locale,
  labels,
  now,
}: {
  card: ContestCardData;
  locale: string;
  labels: ContestLabels;
  /** Injectable clock so a phase chip is testable without waiting for a deadline. */
  now: Date | number;
}) {
  const timing = contestTiming(card, now);
  const ratio =
    card.poster?.w && card.poster.h ? `${card.poster.w} / ${card.poster.h}` : posterRatio(card.slug);

  const title = localize(card.title, locale);
  const summary = localize(card.summary, locale);
  const prizeTotal = localize(card.prizeTotal, locale);

  const dateLine = dateLineFor(card, timing.phase, locale, labels);

  return (
    <article
      data-contest-card={card.slug}
      data-phase={timing.phase}
      className="card group relative flex h-full flex-col border border-hairline"
    >
      <div className="relative border-b border-hairline">
        <div className="card__media overflow-hidden" style={{ aspectRatio: ratio }}>
          {card.poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader
            <img
              src={card.poster.src}
              alt={labels.posterAlt}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <ContestPoster
              title={title}
              slug={card.slug}
              host={card.hostName}
              prize={prizeTotal}
              prizeLabel={prizeKindLabel(labels, card.prizeKind)}
              ratio={ratio}
            />
          )}
        </div>

        {/**
         * §14.2's chip row, at the sizes the M9 design review set (finding 6).
         *
         * 12px rather than 11px — below 12 an Anton SC cap at 0.12em tracking stops being a chip and
         * becomes texture — and one weight per phase rather than one style with a colour swapped:
         * OPEN is solid (it is the only actionable state), UPCOMING is the inverse (a promise, in
         * the page's own ink), CLOSED is quiet (black, at 70%).
         */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span
            data-phase-chip={timing.phase}
            className={[
              'px-2 py-1 font-label text-[0.75rem] leading-none tracking-[0.12em] uppercase',
              timing.phase === 'open'
                ? // A solid chip carries its own surface, so it keeps the plan's #0000EE against
                  // white text (9.40:1) rather than the dark-surface tone-map (finding 2).
                  'bg-blue text-white'
                : timing.phase === 'upcoming'
                  ? 'bg-white text-black'
                  : 'bg-black/70 text-white opacity-70',
            ].join(' ')}
          >
            {phaseLabel(labels, timing.phase)}
          </span>
          {timing.phase === 'closed' ? (
            card.winnerCount > 0 && (
              <span
                data-winners-marker
                className="border border-white/35 bg-black/70 px-2 py-1 font-label text-[0.75rem] leading-none tracking-[0.12em] text-white uppercase"
              >
                {interpolate(labels.winnersAnnounced, { count: String(card.winnerCount) })}
              </span>
            )
          ) : timing.dDay ? (
            <span
              data-dday
              className="border border-white/35 bg-black/70 px-2 py-1 font-mono text-[0.75rem] leading-none tracking-[0.08em] text-white"
            >
              {timing.dDay}
            </span>
          ) : null}
        </div>

        {/* The host, BOXED and on the poster where it belongs — it is the "who is asking", and as
            10.4px unboxed text in the meta line it read as a caption for the title. The KIND rides
            beside the name (2026-08-15) because "PLATFORM" next to a name a reader has never seen
            is the difference between a contest they understand and one they scroll past. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-start gap-2 p-3">
          <span
            data-host-chip
            className="border border-white/35 bg-black/70 px-2 py-1 font-label text-[0.75rem] leading-none tracking-[0.12em] text-white uppercase"
          >
            {card.hostName}
          </span>
          <span
            data-host-kind={card.hostKind}
            className="border border-white/25 px-2 py-1 font-label text-[0.75rem] leading-none tracking-[0.12em] text-white/75 uppercase"
          >
            {hostKindLabel(labels, card.hostKind)}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-accent font-label text-[0.75rem] tracking-[0.12em] uppercase">
          {dateLine}
        </p>

        <h3 className="font-display text-[clamp(1.35rem,2vw,1.85rem)] leading-[0.95] font-black uppercase">
          <a
            href={contestHref(locale, card.slug)}
            className="whitespace-pre-line after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </a>
        </h3>

        <p className="text-[0.9375rem] leading-relaxed opacity-70">{summary}</p>

        {/**
         * The prize LEADS the footer (2026-08-15). It used to sit in 12.8px mono beside the entry
         * count — the one fact that decides whether a reader opens the card, set at the size of a
         * caption. Now the kind is the label and the figure is display type, so a card can be read
         * at a glance as "credits, 50,000" or "cash, $5,000" without opening anything.
         */}
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3">
          <div className="min-w-0">
            <p
              data-prize-kind={card.prizeKind}
              className="font-label text-[0.7rem] tracking-[0.12em] uppercase opacity-45"
            >
              {prizeKindLabel(labels, card.prizeKind)}
            </p>
            <p
              data-prize-total
              className="mt-1 truncate font-display text-[clamp(1.45rem,2.3vw,2rem)] leading-[0.9] font-black uppercase"
            >
              {prizeTotal}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[0.7rem] opacity-55">
            {card.entryCount === 0
              ? labels.entryCountEmpty
              : interpolate(labels.entryCount, { count: String(card.entryCount) })}
          </span>
        </div>
      </div>
    </article>
  );
}

/** One date line per phase — the one that is actually about to happen. */
function dateLineFor(
  card: Pick<ContestCardData, 'startsAt' | 'deadlineAt'>,
  phase: ContestPhase,
  locale: string,
  labels: ContestLabels,
): string {
  if (phase === 'upcoming') {
    const date = formatDate(card.startsAt, locale);
    return date ? interpolate(labels.opensLabel, { date }) : labels.phaseUpcoming;
  }
  const date = formatDate(card.deadlineAt, locale);
  if (!date) return phase === 'closed' ? labels.phaseClosed : labels.phaseOpen;
  return interpolate(phase === 'closed' ? labels.closedLabel : labels.deadlineLabel, { date });
}
