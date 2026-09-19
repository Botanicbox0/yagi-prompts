import type { ShapedContest } from '@/lib/contests/access';
import { contestSubmitPath, contestsHref } from '@/lib/contests/links';
import { formatDate, localize } from '@/lib/i18n/format';
import { Markdown } from '@/components/playbook/markdown';
import { RevealGrid } from '@/components/motion/reveal-grid';
import { TextSwap } from '@/components/ui/text-swap';
import { ContestEntryCard } from './entry-card';
import { ContestHero } from './hero';
import { ContestPoster } from './poster';
import {
  hostKindLabel,
  phaseLabel,
  placementLabel,
  prizeKindLabel,
  type ContestLabels,
} from './labels';

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

/**
 * One heading treatment for every section on the page (M9 design review, finding 7).
 *
 * The brief used to be set as a 14px LABEL while the winners and entries below it were display
 * type — so the most important reading on the page announced itself as the least. All three are now
 * the same size, and each opens with exactly one hairline, so the page reads as a stack of equals.
 */
const SECTION_CLASS = 'mt-14 border-t border-hairline pt-10';
const SECTION_HEADING_CLASS = 'font-display text-contest-section font-black uppercase';

// ---------------------------------------------------------------------------
// hero + title + host strip
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
  const prize = localize(contest.prizeTotal, locale);

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
            host={contest.hostName}
            prize={prize}
            payouts={contest.prizeTiers.map(
              (tier) => `${placementLabel(labels, tier.place)} ${localize(tier.value, locale)}`,
            )}
            prizeLabel={prizeKindLabel(labels, contest.prizeKind)}
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

        {/**
         * §14.2's host strip — who is asking, what kind of thing they are, and where they live.
         *
         * The mark is optional and deliberately small: a host that uploaded a logo is recognised at
         * a glance, and one that did not looks like the same component rather than a broken one.
         * The KIND chip is what makes the surface host-agnostic to a reader (2026-08-15) — the word
         * PLATFORM beside a name they have never seen is what tells them how to read the prize.
         */}
        <div
          data-contest-host
          data-host-kind={contest.hostKind}
          className="flex flex-wrap items-center gap-x-4 gap-y-3"
        >
          {contest.hostLogo && (
            // eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader
            <img
              src={contest.hostLogo.src}
              alt=""
              data-host-logo
              className="h-7 w-auto max-w-[9rem] object-contain"
              loading="lazy"
            />
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-label text-eyebrow uppercase">
            <span className="opacity-50">{labels.hostedBy}</span>
            {contest.hostUrl ? (
              <a
                href={contest.hostUrl}
                rel="noreferrer"
                data-host-link
                className="text-accent border-b border-current"
              >
                {contest.hostName}
              </a>
            ) : (
              <span data-host-chip>{contest.hostName}</span>
            )}
            <span data-host-kind-chip className="border border-hairline px-2 py-1 opacity-60">
              {hostKindLabel(labels, contest.hostKind)}
            </span>
          </div>
        </div>

        {/* §5.2 "display lines manually broken" — the author's breaks are the composition. */}
        <h1 className="mt-5 font-display text-title font-black whitespace-pre-line uppercase">
          {title}
        </h1>
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
 * A full-width BLACK inversion band (M9 design review, finding 3), and both halves of that are
 * load-bearing:
 *
 *   · **full-width** — §5.1 makes the black↔white inversion the identity, and the one fact that
 *     decides whether a reader keeps reading is the one place the page should invert. It therefore
 *     renders OUTSIDE the ad-rail anchor, because a band that stops 340px short of the right edge
 *     is a panel, not an inversion. It carries `data-section` so the nav's observer inverts with it.
 *   · **split** — the total is display type and the payout is a table under it, because one run of
 *     display type would give the breakdown the same voice as the headline figure.
 *
 * Where the split comes from changed on 2026-08-15. The prize used to be ONE authored string that
 * `splitPrize()` took apart at a middle dot — punctuation as a schema, and no way for the code to
 * know a credits prize from a cash one. Now the KIND is a translated word, the TOTAL is the
 * author's own figure, and the payout is a real table of up to three tiers.
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
  const total = localize(contest.prizeTotal, locale);
  const tiers = contest.prizeTiers;

  return (
    <section
      data-contest-prize
      data-section
      data-theme="dark"
      data-prize-kind={contest.prizeKind}
      className="section py-12 lg:py-16"
    >
      <div className="band">
        <p className="text-accent font-label text-eyebrow uppercase">
          {prizeKindLabel(labels, contest.prizeKind)}
        </p>
        <p data-prize-total className="mt-5 font-display text-contest-prize font-black uppercase">
          {total}
        </p>

        {tiers.length > 0 && (
          <div data-prize-payouts className="mt-10 border-t border-white/20 pt-6">
            <p className="font-label text-[0.6875rem] tracking-[0.12em] uppercase opacity-50">
              {labels.prizeBreakdown}
            </p>
            <dl className="mt-4 grid sm:grid-cols-3">
              {tiers.map((tier) => (
                <div
                  key={tier.place}
                  data-prize-tier={tier.place}
                  className="flex flex-col gap-2 border-t border-white/20 py-4 sm:border-t-0 sm:border-l sm:py-0 sm:pl-5 sm:first:border-l-0 sm:first:pl-0"
                >
                  <dt className="font-label text-[0.6875rem] tracking-[0.12em] uppercase opacity-50">
                    {placementLabel(labels, tier.place)}
                  </dt>
                  <dd className="font-display text-[clamp(1.35rem,2.2vw,1.9rem)] leading-[0.95] font-black uppercase">
                    {localize(tier.value, locale)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// meta strip
// ---------------------------------------------------------------------------

/**
 * §14.2 — "phase, D-day or 결과, deadline date in locale format".
 *
 * A definition list rather than a slash-separated sentence (M9 design review, finding 4). The four
 * facts are a TABLE — every one of them is a labelled value — and running them together with `/`
 * characters made a reader parse punctuation to find the deadline. Two columns on a phone, four
 * from 768 up, one hairline grid, 72px rows: the deadline is now findable without reading.
 *
 * Every cell renders in every phase, blanks included as an em dash: a grid whose columns move
 * between contests is a grid you have to re-read each time.
 */
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
  const cells: Array<{ key: string; label: string; value: string; accent?: boolean }> = [
    { key: 'status', label: labels.metaStatus, value: phaseLabel(labels, phase), accent: true },
    { key: 'opens', label: labels.metaOpens, value: formatDate(contest.startsAt, locale) ?? '—' },
    {
      key: 'deadline',
      label: labels.metaDeadline,
      value: formatDate(contest.deadlineAt, locale) ?? '—',
    },
    {
      // The second question every entrant asks (2026-08-15). "—" while the host has not committed
      // to a date, which is honest — a results date invented by the site is a promise nobody made.
      key: 'announce',
      label: labels.metaAnnounce,
      value: formatDate(contest.announceAt, locale) ?? '—',
    },
    {
      key: 'countdown',
      label: labels.metaCountdown,
      // §14.2: "D-day or 결과" — the countdown while it matters, the word after it stops.
      value: phase === 'closed' ? labels.resultsLabel : (dDay ?? '—'),
    },
  ];

  return (
    <dl
      data-contest-meta
      data-phase={phase}
      className="mt-10 grid grid-cols-2 border-t border-l border-hairline md:grid-cols-5"
    >
      {cells.map((cell) => (
        <div
          key={cell.key}
          data-meta-cell={cell.key}
          className="flex min-h-[72px] flex-col justify-center gap-2 border-r border-b border-hairline p-4"
        >
          <dt className="font-label text-[0.6875rem] tracking-[0.12em] uppercase opacity-45">
            {cell.label}
          </dt>
          <dd className={`font-mono text-[0.8125rem] ${cell.accent ? 'text-accent' : ''}`}>
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
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
    <section id="brief" data-contest-rules className={SECTION_CLASS}>
      <h2 className={SECTION_HEADING_CLASS}>{labels.rulesHeading}</h2>
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
    <section id="winners" data-contest-winners className={SECTION_CLASS}>
      <h2 className={SECTION_HEADING_CLASS}>{labels.winnersHeading}</h2>
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
    <section id="entries" data-contest-entries className={SECTION_CLASS}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className={SECTION_HEADING_CLASS}>{labels.entriesHeading}</h2>
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
 * §14.2 — "submit CTA (phase-aware: open → /contests/[slug]/submit; upcoming → starts date)".
 *
 * Two states, two different KINDS of control, on purpose: an action and a navigation. Rendering a
 * disabled "Enter" button on an upcoming contest would be the same information delivered as a dead
 * end — and the M9 design review (finding 4) removed the version that stated the opening date a
 * second time inside a button-shaped box, six lines under the metadata cell that already carries
 * it. What an early reader can actually DO is read the brief, so that is what the control offers.
 *
 * A closed contest gets no CTA at all: its winners and its entries are the next two sections
 * (finding 7's order), so a jump link would scroll a reader to what is already under their thumb.
 */
export function ContestCta({ contest, labels, submitHref }: { contest: ShapedContest; labels: ContestLabels; submitHref?: string }) {
  const { phase } = contest.timing;

  if (phase === 'open') {
    return (
      <p className="mt-10">
        <a
          href={submitHref ?? contestSubmitPath(contest.slug)}
          data-contest-cta="enter"
          className={`text-accent ${CTA_CLASS}`}
        >
          <TextSwap>{labels.enterCta} →</TextSwap>
        </a>
      </p>
    );
  }

  if (phase === 'upcoming') {
    return (
      <p className="mt-10">
        <a href="#brief" data-contest-cta="upcoming" className={`text-accent ${CTA_CLASS}`}>
          <TextSwap>{labels.readBriefCta} →</TextSwap>
        </a>
      </p>
    );
  }

  return null;
}

/**
 * The page body, in the order the phase makes true (M9 design review, finding 7).
 *
 * Order is content, not layout: an OPEN contest is asking for a film, so the brief comes before the
 * films already in. A CLOSED one has already been answered, so the answers come first and the brief
 * becomes the reference at the bottom. Both surfaces that render a contest (the public route and
 * the admin preview) compose THIS, so a draft is previewed in the order it will publish in.
 */
export function ContestBody({
  contest,
  locale,
  labels,
  submitHref,
}: {
  contest: ShapedContest;
  locale: string;
  labels: ContestLabels;
  submitHref?: string;
}) {
  const brief = <ContestRules contest={contest} locale={locale} labels={labels} />;
  const entries = <ContestEntries contest={contest} labels={labels} />;

  if (contest.timing.phase === 'closed') {
    return (
      <>
        <ContestWinners contest={contest} labels={labels} />
        {entries}
        {brief}
      </>
    );
  }

  return (
    <>
      <ContestCta contest={contest} labels={labels} {...(submitHref === undefined ? {} : { submitHref })} />
      {brief}
      {entries}
    </>
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
