import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { ContestCard } from '@/lib/contests/catalog';
import type { ContestEntryView } from '@/lib/contests/access';
import { ContestCardView } from '@/components/contests/contest-card';
import { ContestEntryCard } from '@/components/contests/entry-card';
import {
  CONTEST_MAILTO,
  ContestHireStrip,
  ContestRail,
  ContestsEmptyState,
} from '@/components/contests/rails';
import { contestLabels } from '@/components/contests/labels';

/**
 * PLAN §14.2 — the contests surface as MARKUP.
 *
 * The listing is static HTML shared by every reader, so what it contains is a disclosure question
 * rather than a styling one — the same reason `tests/ui/prompts.test.tsx` exists.
 *
 * The empty state moved here in the M9 review pass: the anonymous sweep now seeds a PUBLISHED
 * fixture contest (so its entry-visibility assertions stop being vacuous), which means the live
 * listing is no longer empty and the empty branch cannot be exercised over HTTP. It is still the
 * state production is in until the founder publishes a real contest, so it keeps a test — this one.
 */

const dict = getDictionary('en');
const ko = getDictionary('ko');
const labels = contestLabels(dict);
const NOW = Date.parse('2026-09-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function card(overrides: Partial<ContestCard> = {}): ContestCard {
  return {
    id: '9c000000-0000-4000-8000-000000000001',
    slug: 'launch-film-contest',
    title: { en: 'Launch film contest', ko: '런칭 단편 공모전' },
    summary: { en: 'Make a short film.', ko: '단편을 만들어 주세요.' },
    prize: { en: '$3,000', ko: '$3,000' },
    brandName: 'YAGI WORKSHOP',
    brandUrl: 'https://yagiworkshop.xyz',
    poster: null,
    startsAt: new Date(NOW - 2 * DAY).toISOString(),
    deadlineAt: new Date(NOW + 7 * DAY).toISOString(),
    publishedAt: new Date(NOW - 3 * DAY).toISOString(),
    entryCount: 2,
    winnerCount: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<ContestEntryView> = {}): ContestEntryView {
  return {
    id: '9d000000-0000-4000-8000-000000000001',
    title: 'Last train, Yeongdeungpo',
    note: 'Shot from the neon-alley prompt.',
    videoUrl: 'https://www.youtube.com/watch?v=abc',
    snsUrl: 'https://www.instagram.com/hana.films',
    platform: 'instagram',
    handle: '@hana.films',
    placement: null,
    createdAt: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

describe('the designed empty state (§14.2)', () => {
  it('carries the copy AND the B2B mailto in English', () => {
    const html = renderToStaticMarkup(
      <ContestsEmptyState
        title={dict.contests.emptyTitle}
        body={dict.contests.emptyBody}
        cta={dict.contests.emptyCta}
        mailto={CONTEST_MAILTO}
      />,
    );
    expect(html).toContain('data-contests-empty');
    expect(html).toContain('NOTHING OPEN YET.');
    expect(html).toContain('Run a contest with the studio');
    expect(html).toContain('mailto:hello@yagiworkshop.xyz');
  });

  it('carries the founder-authored Korean copy', () => {
    const html = renderToStaticMarkup(
      <ContestsEmptyState
        title={ko.contests.emptyTitle}
        body={ko.contests.emptyBody}
        cta={ko.contests.emptyCta}
        mailto={CONTEST_MAILTO}
      />,
    );
    expect(html).toContain('아직 열린 콘테스트가 없습니다');
    expect(html).toContain('스튜디오와 콘테스트 열기');
  });

  /**
   * The page renders the empty state OR the hire strip, never both — they carry the same sentence
   * and the same mailto, and eight lines apart that reads as a stutter rather than emphasis.
   */
  it('is the only B2B block when it renders (the page suppresses the strip)', () => {
    const page = readFileSyncSource();
    expect(page).toContain('{!empty && (');
    expect(page).toContain('<ContestsEmptyState');
  });
});

function readFileSyncSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { fileURLToPath } = require('node:url') as typeof import('node:url');
  const { join } = require('node:path') as typeof import('node:path');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  return readFileSync(join(root, 'app', '(marketing)', '[locale]', 'contests', 'page.tsx'), 'utf8');
}

describe('the hire strip (§14.2)', () => {
  it('renders the studio pitch and the same mailto', () => {
    const html = renderToStaticMarkup(
      <ContestHireStrip
        title={dict.contests.hireTitle}
        body={dict.contests.hireBody}
        cta={dict.contests.hireCta}
        mailto={CONTEST_MAILTO}
      />,
    );
    expect(html).toContain('data-contest-hire');
    expect(html).toContain('mailto:hello@yagiworkshop.xyz');
  });
});

describe('the contest card (§14.2)', () => {
  it('renders the phase chip and a server-rendered D-day, never a live clock', () => {
    const html = renderToStaticMarkup(
      <ContestCardView card={card()} locale="en" labels={labels} now={NOW} />,
    );
    expect(html).toContain('data-phase-chip="open"');
    expect(html).toContain('D-7');
    expect(html).toContain('data-contest-card="launch-film-contest"');
    expect(html).toContain('data-brand-chip');
    // No script, no timer: the countdown is HTML.
    expect(html).not.toContain('<script');
  });

  it('shows the winners marker only on a closed contest that has them', () => {
    const closed = card({
      startsAt: new Date(NOW - 40 * DAY).toISOString(),
      deadlineAt: new Date(NOW - 2 * DAY).toISOString(),
      winnerCount: 3,
    });
    const html = renderToStaticMarkup(
      <ContestCardView card={closed} locale="en" labels={labels} now={NOW} />,
    );
    expect(html).toContain('data-winners-marker');
    expect(html).not.toContain('data-dday');

    const unjudged = renderToStaticMarkup(
      <ContestCardView
        card={{ ...closed, winnerCount: 0 }}
        locale="en"
        labels={labels}
        now={NOW}
      />,
    );
    expect(unjudged).not.toContain('data-winners-marker');
  });

  /** The card carries a COUNT of entries and never a row of one — §14.2's no-PII rule, in markup. */
  it('never renders entry content', () => {
    const html = renderToStaticMarkup(
      <ContestCardView card={card()} locale="en" labels={labels} now={NOW} />,
    );
    for (const needle of ['instagram.com', 'youtube.com', 'hana', 'SENTINEL']) {
      expect(html.includes(needle), needle).toBe(false);
    }
  });

  it('falls back to the typographic poster without a published one', () => {
    const html = renderToStaticMarkup(
      <ContestCardView card={card()} locale="en" labels={labels} now={NOW} />,
    );
    expect(html).toContain('data-poster="contest"');
    // The brand kicker belongs to the hero variant; on a card the chips own that corner.
    expect(html.match(/YAGI WORKSHOP/g)).toHaveLength(1);
  });
});

describe('the entry card (§14.2)', () => {
  it('links the film and credits the SNS, both as external links', () => {
    const html = renderToStaticMarkup(<ContestEntryCard entry={entry()} labels={labels} />);
    expect(html).toContain('https://www.youtube.com/watch?v=abc');
    expect(html).toContain('https://www.instagram.com/hana.films');
    expect(html).toContain('data-entry-sns="instagram"');
    expect(html).toContain('@hana.films');
    expect(html.match(/rel="noreferrer"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('badges a placed entry and leaves an unplaced one alone', () => {
    const placed = renderToStaticMarkup(
      <ContestEntryCard entry={entry({ placement: 1 })} labels={labels} />,
    );
    expect(placed).toContain('data-winner-badge');
    expect(placed).toContain('data-placement="1"');

    const plain = renderToStaticMarkup(<ContestEntryCard entry={entry()} labels={labels} />);
    expect(plain).not.toContain('data-winner-badge');
  });
});

describe('the phase rail (§14.2)', () => {
  it('renders nothing at all when its phase is empty', () => {
    const html = renderToStaticMarkup(
      <ContestRail
        id="upcoming"
        heading="OPENING SOON"
        lede="…"
        cards={[]}
        locale="en"
        labels={labels}
        now={NOW}
      />,
    );
    // A heading over a void is worse than no section.
    expect(html).toBe('');
  });

  it('renders a card per contest when it is not', () => {
    const html = renderToStaticMarkup(
      <ContestRail
        id="open"
        heading="OPEN NOW"
        lede="…"
        cards={[card(), card({ slug: 'second', id: 'x' })]}
        locale="en"
        labels={labels}
        now={NOW}
      />,
    );
    expect(html).toContain('data-contest-rail="open"');
    expect(html.match(/data-contest-item/g)).toHaveLength(2);
  });
});
