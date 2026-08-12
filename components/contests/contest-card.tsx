import type { ContestCard as ContestCardData } from '@/lib/contests/catalog';
import { contestHref } from '@/lib/contests/links';
import { contestTiming, type ContestPhase } from '@/lib/contests/phase';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { ContestPoster } from './poster';
import { phaseLabel, type ContestLabels } from './labels';
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
  const prize = localize(card.prize, locale);

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
              brand={card.brandName}
              prize={prize}
              ratio={ratio}
            />
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span
            data-phase-chip={timing.phase}
            className={[
              'px-2 py-1 font-label text-[0.6875rem] leading-none tracking-[0.12em] uppercase',
              timing.phase === 'open'
                ? 'bg-accent text-white'
                : 'border border-white/35 bg-black/70 text-white',
            ].join(' ')}
          >
            {phaseLabel(labels, timing.phase)}
          </span>
          {timing.dDay && timing.phase !== 'closed' && (
            <span
              data-dday
              className="border border-white/35 bg-black/70 px-2 py-1 font-mono text-[0.6875rem] leading-none tracking-[0.08em] text-white"
            >
              {timing.dDay}
            </span>
          )}
          {timing.phase === 'closed' && card.winnerCount > 0 && (
            <span
              data-winners-marker
              className="border border-white/35 bg-black/70 px-2 py-1 font-label text-[0.6875rem] leading-none tracking-[0.12em] text-white uppercase"
            >
              {labels.winnersAnnounced}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3 font-label text-[0.65rem] tracking-[0.12em] uppercase">
          <span data-brand-chip className="opacity-60">
            {card.brandName}
          </span>
          <span className="text-accent">{dateLine}</span>
        </div>

        <h3 className="font-display text-[clamp(1.35rem,2vw,1.85rem)] leading-[0.95] font-black uppercase">
          <a
            href={contestHref(locale, card.slug)}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </a>
        </h3>

        <p className="text-[0.9375rem] leading-relaxed opacity-70">{summary}</p>

        <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-t border-hairline pt-3">
          <span className="font-mono text-[0.8rem]">
            <span className="opacity-45">{labels.prizeLabel} · </span>
            {prize}
          </span>
          <span className="font-mono text-[0.7rem] opacity-55">
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
