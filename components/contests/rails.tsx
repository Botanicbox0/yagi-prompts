import type { ContestCard } from '@/lib/contests/catalog';
import { contestTiming } from '@/lib/contests/phase';
import { contestHref } from '@/lib/contests/links';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { RevealGrid } from '@/components/motion/reveal-grid';
import { TextSwap } from '@/components/ui/text-swap';
import { ContestCardView } from './contest-card';
import { hostKindLabel, prizeKindLabel, type ContestLabels } from './labels';

/**
 * PLAN §14.2 — the three phase rails, and the empty state that has to look like a decision.
 *
 * A three-column grid rather than the prompts wall's CSS columns: a contest card carries a title, a
 * summary and a prize line under its poster, so the cards are close to the same height already and
 * a column-major masonry would only scramble the reading order of a list whose ORDER is the point
 * (soonest deadline first). §5.3-6's hover is identical either way — it lives on `.card`.
 */
/**
 * The featured board (founder direction, 2026-08-15 — "콘테스트 페이지도 sota급으로").
 *
 * The listing used to open with three equal rails, which is a filing cabinet: a reader who arrived
 * because a contest is running had to scan a grid to find the one thing that is actually open. This
 * takes the MOST URGENT open contest — soonest deadline, which is the order the catalog already
 * arrives in — and gives it the treatment the fact deserves: a black inversion (§5.1), the prize in
 * display type, the clock beside it, one link.
 *
 * It renders NOTHING when nothing is open. An "featured" slot filled with an upcoming contest would
 * be an advert for a door that is shut.
 */
export function ContestFeature({
  card,
  locale,
  labels,
  now,
}: {
  card: ContestCard;
  locale: string;
  labels: ContestLabels;
  now: Date | number;
}) {
  const timing = contestTiming(card, now);
  const title = localize(card.title, locale);
  const summary = localize(card.summary, locale);
  const deadline = formatDate(card.deadlineAt, locale);

  return (
    <section
      data-contest-feature={card.slug}
      data-theme="dark"
      className="mt-10 border border-hairline bg-black text-white"
    >
      <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:p-14">
        <div>
          <p className="text-accent font-label text-eyebrow uppercase">{labels.featuredEyebrow}</p>
          <h2 className="mt-5 font-display text-[clamp(2rem,5vw,3.75rem)] leading-[0.9] font-black whitespace-pre-line uppercase">
            <a href={contestHref(locale, card.slug)}>{title}</a>
          </h2>
          <p className="mt-5 max-w-detail text-[0.95rem] leading-relaxed opacity-70">{summary}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 font-label text-[0.75rem] tracking-[0.12em] uppercase">
            <span className="opacity-50">{labels.hostedBy}</span>
            <span data-feature-host>{card.hostName}</span>
            <span className="border border-white/30 px-2 py-1 opacity-70">
              {hostKindLabel(labels, card.hostKind)}
            </span>
          </div>
        </div>

        {/* The money and the clock, in that order — the two facts that decide whether to enter. */}
        <div className="border-t border-white/20 pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
          <p className="font-label text-[0.7rem] tracking-[0.12em] uppercase opacity-50">
            {prizeKindLabel(labels, card.prizeKind)}
          </p>
          <p
            data-feature-prize
            className="mt-3 font-display text-[clamp(2.25rem,6vw,4rem)] leading-[0.88] font-black uppercase"
          >
            {localize(card.prizeTotal, locale)}
          </p>
          <p className="mt-5 font-mono text-[0.8rem] opacity-70">
            {deadline ? interpolate(labels.deadlineLabel, { date: deadline }) : labels.phaseOpen}
            {timing.dDay ? ` · ${timing.dDay}` : ''}
          </p>
          <a
            href={contestHref(locale, card.slug)}
            className="mt-7 inline-block min-h-12 border border-current px-6 py-3.5 font-label text-[1rem] tracking-[0.1em] uppercase"
          >
            {labels.featuredCta}
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * "Who gets to host?" — the statement that makes the surface host-agnostic (2026-08-15).
 *
 * Five chips, not five logos: naming the KINDS is a true statement about what the product supports,
 * while a row of company marks would imply clients that do not exist yet. When real hosts arrive
 * this is the block their logos replace.
 */
export function ContestHostKinds({
  title,
  body,
  kinds,
}: {
  title: string;
  body: string;
  kinds: string[];
}) {
  return (
    <section data-contest-host-kinds className="mt-16 border-t border-hairline pt-10 lg:mt-24">
      <h2 className="font-display text-[clamp(1.4rem,2.6vw,2.1rem)] leading-[0.95] font-black uppercase">
        {title}
      </h2>
      <p className="mt-4 max-w-detail text-[0.95rem] leading-relaxed opacity-70">{body}</p>
      <ul className="mt-6 flex flex-wrap gap-2">
        {kinds.map((kind) => (
          <li
            key={kind}
            className="border border-hairline px-3 py-2 font-label text-[0.75rem] tracking-[0.12em] uppercase opacity-75"
          >
            {kind}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContestRail({
  id,
  heading,
  lede,
  cards,
  locale,
  labels,
  now,
}: {
  id: string;
  heading: string;
  lede: string;
  cards: ContestCard[];
  locale: string;
  labels: ContestLabels;
  now: Date | number;
}) {
  if (cards.length === 0) return null;

  return (
    <section data-contest-rail={id} className="mt-16 first:mt-0 lg:mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-hairline pb-4">
        {/* §5.2: rail headers are DISPLAY type; globals.css does the KO 0.85× on top. */}
        <h2
          id={`contest-rail-${id}`}
          className="font-display text-[clamp(1.6rem,3.4vw,2.75rem)] leading-[0.92] font-black tracking-tight uppercase"
        >
          {heading}
        </h2>
        <p className="font-mono text-[0.75rem] opacity-55">{lede}</p>
      </div>

      <RevealGrid
        itemSelector="[data-contest-item]"
        className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {cards.map((card) => (
          <li key={card.slug} data-contest-item className="flex">
            <ContestCardView card={card} locale={locale} labels={labels} now={now} />
          </li>
        ))}
      </RevealGrid>
    </section>
  );
}

/**
 * §14.2 — "a designed empty state (site is live — empty must look intentional)".
 *
 * The site launched before its first contest existed, so this is the state a real visitor meets
 * today: it has to read as a statement about how contests start here, not as a missing row. It is
 * therefore built like a section and not like a notice — display type, a hairline, a real sentence,
 * and the one CTA that turns an empty page into a lead (the same `hire_click` mailto the footer
 * carries, §3.1).
 */
export function ContestsEmptyState({
  title,
  body,
  cta,
  mailto,
}: {
  title: string;
  body: string;
  cta: string;
  mailto: string;
}) {
  return (
    /**
     * The spacing and the CTA are both from the M9 design review (finding 9): 128px of combined
     * margin+padding above the one statement on an otherwise empty page read as a rendering
     * failure rather than as a decision, and a 14px CTA under 56px display type read as a
     * footnote. 80px of air (64 on a phone), and a CTA with a real touch target under it.
     */
    <section data-contests-empty className="mt-8 border-t border-hairline pt-8 lg:mt-10 lg:pt-10">
      <div className="max-w-detail">
        {/* §5.2 "display lines manually broken" — the KO copy carries its own breaks. */}
        <p className="font-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.92] font-black whitespace-pre-line uppercase">
          {title}
        </p>
        <p className="mt-6 text-body opacity-70">{body}</p>
        <a
          href={mailto}
          className="text-accent mt-9 inline-flex min-h-12 items-center border border-current px-6 py-3.5 font-label text-[1rem] tracking-[0.1em] uppercase"
        >
          <TextSwap>{cta} →</TextSwap>
        </a>
      </div>
    </section>
  );
}

/**
 * §14.2 — the B2B strip. Same shape as the prompts `SubmitStrip`, aimed at the other side of the
 * marketplace: prompts ask a creator for work, contests ask a brand for a brief.
 */
export function ContestHireStrip({
  title,
  body,
  cta,
  mailto,
}: {
  title: string;
  body: string;
  cta: string;
  mailto: string;
}) {
  return (
    <aside data-contest-hire className="mt-16 border border-hairline p-8 sm:p-10">
      <p className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[0.95] font-black uppercase">
        {title}
      </p>
      <p className="mt-4 max-w-detail text-body opacity-70">{body}</p>
      <a
        href={mailto}
        className="text-accent mt-7 inline-block border border-current px-4 py-2 font-label text-eyebrow uppercase"
      >
        <TextSwap>{cta} →</TextSwap>
      </a>
    </aside>
  );
}

/**
 * The one mailto both strips use.
 *
 * Built here rather than in the dictionary so the subject line carries the contest context and the
 * address stays a single literal — the footer's studio enquiry and this one land in the same inbox
 * and must not drift apart.
 *
 * Founder direction (2026-08-15): "개설 요청 폼은 따로 받는거보다 그냥 메일로 소통하는게 나을듯."
 * So the BODY is the form. It prefills the five things the admin editor needs to open a contest —
 * host and kind, prize kind and figure, the three dates, the brief, a link — which is the whole
 * difference between an enquiry that starts the work and one that starts a thread asking for it.
 * Five short lines, because a long mailto body is truncated by some clients.
 */
const CONTEST_EMAIL = 'hello@yagiworkshop.xyz';

const ENQUIRY: Record<'en' | 'ko', { subject: string; body: string[] }> = {
  en: {
    subject: 'YAGI PROMPTS — run a contest with the studio',
    body: [
      'Host (brand / platform / studio / creator / community):',
      'Prize — kind (cash, credits, subscription, gear, feature) and the figure:',
      'Dates — opens / deadline / results:',
      'The brief, in a sentence:',
      'A link to you:',
    ],
  },
  ko: {
    subject: 'YAGI PROMPTS — 콘테스트 개최 문의',
    body: [
      '주최 (브랜드 / 플랫폼 / 스튜디오 / 크리에이터 / 커뮤니티):',
      '보상 — 종류(현금·크레딧·구독권·장비·피처링)와 금액:',
      '일정 — 시작 / 마감 / 발표:',
      '브리프 한 줄:',
      '참고 링크:',
    ],
  },
};

export function contestMailto(locale: string): string {
  const copy = locale === 'ko' ? ENQUIRY.ko : ENQUIRY.en;
  const query = new URLSearchParams({
    subject: copy.subject,
    // Two newlines per line so a reply-under-each-question habit has room.
    body: `${copy.body.join('\n\n')}\n`,
  });
  // `URLSearchParams` encodes a space as `+`, which mail clients render literally in a subject.
  return `mailto:${CONTEST_EMAIL}?${query.toString().replace(/\+/g, '%20')}`;
}
