import type { ShapedContest } from '@/lib/contests/access';
import { contestSubmitPath, contestsHref } from '@/lib/contests/links';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { Markdown } from '@/components/playbook/markdown';
import { RevealGrid } from '@/components/motion/reveal-grid';
import { TextSwap } from '@/components/ui/text-swap';
import { ContestEntryCard } from './entry-card';
import { ContestHero } from './hero';
import { ContestPoster } from './poster';
import { phaseLabel, placementLabel, type ContestLabels } from './labels';

/**
 * PLAN §14.2 — the contest detail page's sections.
 *
 * There is no gate anywhere in this file, and that is a fact about the surface rather than an
 * omission: a contest is marketing, its brief is a brief, and its approved entries were approved
 * for publication. `lib/contests/access.ts` has already decided both of the questions that exist
 * (is this contest published, is this entry approved), so everything here is a rendering decision
 * about an object that already contains exactly what a reader may have.
 */

const CTA_CLASS = 'inline-block border border-current px-5 py-2.5 font-label text-label uppercase';

// ---------------------------------------------------------------------------
// hero + title + brand strip
// ---------------------------------------------------------------------------

export function ContestHeader({
  contest,
  locale,
  labels,
}: {
  contest: ShapedContest;
  locale: string;
  labels: ContestLabels;
}) {
  const title = localize(contest.title, locale);
  const summary = localize(contest.summary, locale);
  const prize = localize(contest.prize, locale);

  return (
    <header>
      <ContestHero
        poster={contest.poster}
        video={contest.video}
        alt={labels.posterAlt}
        fallback={
          <ContestPoster
            wide
            title={title}
            slug={contest.slug}
            brand={contest.brandName}
            prize={prize}
          />
        }
      />

      <div className="band pt-10 lg:pt-14">
        {contest.preview && (
          <p
            data-contest-preview
            className="mb-8 border border-accent px-4 py-2.5 font-label text-eyebrow uppercase"
          >
            {labels.previewBadge}
          </p>
        )}

        {/* §14.2 brand strip — who is asking, and where they live. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-label text-eyebrow uppercase">
          <span className="opacity-50">{labels.hostedBy}</span>
          {contest.brandUrl ? (
            <a
              href={contest.brandUrl}
              rel="noreferrer"
              data-brand-link
              className="text-accent border-b border-current"
            >
              {contest.brandName}
            </a>
          ) : (
            <span data-brand-chip>{contest.brandName}</span>
          )}
        </div>

        <h1 className="mt-5 font-display text-title font-black uppercase">{title}</h1>
        <p className="mt-6 max-w-detail text-body opacity-70">{summary}</p>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// prize — "the money shot of the page"
// ---------------------------------------------------------------------------

/**
 * §14.2: "prize in display type (the money shot of the page)".
 *
 * The prize gets the largest type on the page and its own hairline-bounded band, because it is the
 * one fact that decides whether a reader keeps reading. Everything around it is deliberately quiet.
 */
export function ContestPrize({
  contest,
  locale,
  labels,
}: {
  contest: ShapedContest;
  locale: string;
  labels: ContestLabels;
}) {
  return (
    // Bottom rule only: the meta strip immediately above already closes with one, and two hairlines
    // 48px apart with nothing between them read as an empty row rather than as a band.
    <section data-contest-prize className="border-b border-hairline pt-10 pb-10 lg:pt-14 lg:pb-14">
      <p className="text-accent font-label text-eyebrow uppercase">{labels.prizeLabel}</p>
      <p className="mt-4 font-display text-[clamp(2.25rem,7vw,5rem)] leading-[0.9] font-black tracking-tight uppercase">
        {localize(contest.prize, locale)}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// meta strip
// ---------------------------------------------------------------------------

/** §14.2 — "phase, D-day or 결과, deadline date in locale format". Three facts, one line. */
export function ContestMeta({
  contest,
  locale,
  labels,
}: {
  contest: ShapedContest;
  locale: string;
  labels: ContestLabels;
}) {
  const { phase, dDay } = contest.timing;
  const opens = formatDate(contest.startsAt, locale);
  const closes = formatDate(contest.deadlineAt, locale);

  // Built as a list of already-resolved strings, blanks dropped: a meta strip with an empty slot in
  // it (a draft with no deadline, say) should be shorter, not have a gap in it.
  const items = [
    phaseLabel(labels, phase),
    phase === 'upcoming' && opens ? interpolate(labels.opensLabel, { date: opens }) : '',
    closes
      ? interpolate(phase === 'closed' ? labels.closedLabel : labels.deadlineLabel, { date: closes })
      : '',
    // §14.2: "D-day or 결과" — the countdown while it matters, the word after it stops.
    phase === 'closed' ? labels.resultsLabel : (dDay ?? ''),
  ].filter((value) => value !== '');

  return (
    <p
      data-contest-meta
      data-phase={phase}
      className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline pb-6 font-label text-eyebrow uppercase"
    >
      {items.map((value, index) => (
        <span key={`${index}-${value}`} className="flex items-center gap-6">
          {index > 0 && (
            <span aria-hidden className="opacity-25">
              /
            </span>
          )}
          <span className={index === 0 ? 'text-accent' : 'opacity-70'}>{value}</span>
        </span>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------------------
// the brief
// ---------------------------------------------------------------------------

/** §14.2 — "rules via the markdown renderer". The same renderer §6.1 `note` blocks use. */
export function ContestRules({
  contest,
  locale,
  labels,
}: {
  contest: ShapedContest;
  locale: string;
  labels: ContestLabels;
}) {
  if (contest.rules === null) return null;
  const source = localize(contest.rules, locale);
  if (source.trim() === '') return null;

  return (
    <section data-contest-rules className="mt-12 lg:mt-16">
      <h2 className="font-label text-label uppercase">{labels.rulesHeading}</h2>
      <div className="mt-6 max-w-detail">
        <Markdown source={source} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// winners + entries
// ---------------------------------------------------------------------------

/** §14.2 — "winners strip when placements exist (1/2/3 with display-type numerals)". */
export function ContestWinners({
  contest,
  labels,
}: {
  contest: ShapedContest;
  labels: ContestLabels;
}) {
  if (contest.winners.length === 0) return null;

  return (
    <section id="winners" data-contest-winners className="mt-14 border-t border-hairline pt-10">
      <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[0.95] font-black uppercase">
        {labels.winnersHeading}
      </h2>
      <ol className="mt-8 flex flex-col divide-y divide-[color:var(--hairline)] border-y border-hairline">
        {contest.winners.map((entry) => (
          <li
            key={entry.id}
            data-winner={String(entry.placement)}
            className="flex flex-wrap items-baseline gap-x-6 gap-y-2 py-5"
          >
            {/* Display-type numerals: the placement is the loudest thing in the row. */}
            <span className="text-accent w-16 shrink-0 font-display text-[clamp(1.75rem,4vw,3rem)] leading-none font-black tracking-tight uppercase">
              {placementLabel(labels, entry.placement!)}
            </span>
            <a
              href={entry.videoUrl}
              rel="noreferrer"
              className="font-display text-[clamp(1.25rem,2.4vw,1.75rem)] leading-none font-black uppercase"
            >
              <TextSwap>{entry.title}</TextSwap>
            </a>
            <a
              href={entry.snsUrl}
              rel="noreferrer"
              className="ml-auto font-label text-[0.65rem] tracking-[0.12em] uppercase opacity-60"
            >
              {entry.handle ?? ''}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** §14.2 — the approved-entries rail. */
export function ContestEntries({
  contest,
  labels,
}: {
  contest: ShapedContest;
  labels: ContestLabels;
}) {
  return (
    <section id="entries" data-contest-entries className="mt-14 border-t border-hairline pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[0.95] font-black uppercase">
          {labels.entriesHeading}
        </h2>
        <p className="font-mono text-[0.75rem] opacity-55">{labels.entriesModerated}</p>
      </div>

      {contest.entries.length === 0 ? (
        <p className="mt-8 font-mono text-code opacity-60">{labels.entriesEmpty}</p>
      ) : (
        <RevealGrid
          itemSelector="[data-contest-item]"
          className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {contest.entries.map((entry) => (
            <li key={entry.id} data-contest-item className="flex">
              <ContestEntryCard entry={entry} labels={labels} />
            </li>
          ))}
        </RevealGrid>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// the CTA
// ---------------------------------------------------------------------------

/**
 * §14.2 — "submit CTA (phase-aware: open → /contests/[slug]/submit; upcoming → starts date; closed
 * → entries/winners anchor)".
 *
 * Three states, three different KINDS of control, on purpose: an action, a statement, and a
 * navigation. Rendering a disabled "Enter" button on an upcoming contest would be the same
 * information delivered as a dead end.
 */
export function ContestCta({
  contest,
  locale,
  labels,
}: {
  contest: ShapedContest;
  locale: string;
  labels: ContestLabels;
}) {
  const { phase } = contest.timing;

  if (phase === 'open') {
    return (
      <p className="mt-10">
        <a
          href={contestSubmitPath(contest.slug)}
          data-contest-cta="enter"
          className={`text-accent ${CTA_CLASS}`}
        >
          <TextSwap>{labels.enterCta} →</TextSwap>
        </a>
      </p>
    );
  }

  if (phase === 'upcoming') {
    const date = formatDate(contest.startsAt, locale) ?? '';
    return (
      <p
        data-contest-cta="upcoming"
        className={`mt-10 border-hairline opacity-60 ${CTA_CLASS} border`}
      >
        {interpolate(labels.enterOpensCta, { date })}
      </p>
    );
  }

  return (
    <p className="mt-10">
      <a
        href={contest.winners.length > 0 ? '#winners' : '#entries'}
        data-contest-cta="closed"
        className={`text-accent ${CTA_CLASS}`}
      >
        <TextSwap>{labels.enterClosedCta} →</TextSwap>
      </a>
    </p>
  );
}

export function ContestBackLink({ locale, labels }: { locale: string; labels: ContestLabels }) {
  return (
    <p className="mt-12">
      <a href={contestsHref(locale)} className="text-accent font-label text-eyebrow uppercase">
        ← {labels.backToList}
      </a>
    </p>
  );
}
