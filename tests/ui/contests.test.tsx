import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { ContestCard } from '@/lib/contests/catalog';
import type { ContestEntryView, ShapedContest } from '@/lib/contests/access';
import { ContestCardView } from '@/components/contests/contest-card';
import { ContestEntryCard } from '@/components/contests/entry-card';
import {
  ContestBody,
  ContestMeta,
  ContestPrize,
} from '@/components/contests/detail';
import { ContestPoster, posterTitleLines } from '@/components/contests/poster';
import { splitPrize } from '@/components/contests/prize';
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

  /**
   * M9 design review, finding 8: the Korean title is DISPLAY type, and §5.2 breaks display type by
   * hand. The copy now carries its own line endings, so the element that renders it has to honour
   * them — a `whitespace-pre-line` that goes missing turns three authored lines into one paragraph
   * that wraps wherever the viewport says.
   */
  it('carries the founder-authored Korean copy, with its authored line breaks', () => {
    const html = renderToStaticMarkup(
      <ContestsEmptyState
        title={ko.contests.emptyTitle}
        body={ko.contests.emptyBody}
        cta={ko.contests.emptyCta}
        mailto={CONTEST_MAILTO}
      />,
    );
    expect(ko.contests.emptyTitle.split('\n')).toHaveLength(3);
    expect(html).toContain('지금은\n열린 콘테스트가\n없습니다.');
    expect(html).toContain('whitespace-pre-line');
    expect(html).toContain('스튜디오와 콘테스트 열기');
  });

  /**
   * Finding 9: 128px of combined margin+padding above one statement on an otherwise empty page
   * read as a rendering failure rather than a decision, and the 14px CTA under 56px display type
   * read as a footnote. The numbers are the review's.
   */
  it('sits at the reviewed spacing, with a CTA that has a real touch target', () => {
    const html = renderToStaticMarkup(
      <ContestsEmptyState title="T" body="B" cta="C" mailto={CONTEST_MAILTO} />,
    );
    expect(html).toContain('mt-8 border-t border-hairline pt-8 lg:mt-10 lg:pt-10');
    for (const token of ['min-h-12', 'px-6', 'py-3.5', 'text-[1rem]', 'tracking-[0.1em]']) {
      expect(html, token).toContain(token);
    }
    // …and still exactly one 1px border, not a second box around it.
    expect(html.match(/border border-current/g)).toHaveLength(1);
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

function readSource(...parts: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { fileURLToPath } = require('node:url') as typeof import('node:url');
  const { join } = require('node:path') as typeof import('node:path');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  return readFileSync(join(root, ...parts), 'utf8');
}

function readFileSyncSource(): string {
  return readSource('app', '(marketing)', '[locale]', 'contests', 'page.tsx');
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

  /**
   * M9 design review, finding 10. The listing is where a brand without a contest is standing, and
   * the site footer carries the same enquiry on every page. On a detail page the strip was the
   * third printing of one sentence, wedged between the entries rail and the footer that repeats it.
   */
  it('is on the LISTING only — the detail page does not repeat it', () => {
    expect(readFileSyncSource()).toContain('<ContestHireStrip');
    const detail = readSource('app', '(marketing)', '[locale]', 'contests', '[slug]', 'page.tsx');
    expect(detail).not.toContain('ContestHireStrip');
    expect(detail).not.toContain('CONTEST_MAILTO');
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

// ---------------------------------------------------------------------------
// M9 design review — the findings, as assertions
// ---------------------------------------------------------------------------

function shaped(overrides: Partial<ShapedContest> = {}): ShapedContest {
  return {
    id: '9c000000-0000-4000-8000-000000000001',
    slug: 'launch-film-contest',
    title: { en: 'YAGI PROMPTS\nLAUNCH FILM\nCONTEST', ko: 'YAGI PROMPTS\n론칭 단편\n공모전' },
    summary: { en: 'Make a short film.', ko: '단편을 만들어 주세요.' },
    prize: {
      en: '$3,000 · 1st $1,500 / 2nd $1,000 / 3rd $500',
      ko: '총 $3,000 · 1위 $1,500 / 2위 $1,000 / 3위 $500',
    },
    rules: { en: '## What we are looking for\n\nA short film.', ko: '## 이런 작품을 찾습니다' },
    brandName: 'YAGI WORKSHOP',
    brandUrl: 'https://yagiworkshop.xyz',
    poster: null,
    video: null,
    startsAt: new Date(NOW - 2 * DAY).toISOString(),
    deadlineAt: new Date(NOW + 7 * DAY).toISOString(),
    publishedAt: new Date(NOW - 3 * DAY).toISOString(),
    timing: { phase: 'open', daysRemaining: 7, dDay: 'D-7' },
    entries: [],
    winners: [],
    preview: false,
    ...overrides,
  };
}

/** The section markers, in the order they appear in the rendered document. */
function order(html: string): string[] {
  return [...html.matchAll(/data-contest-(cta|rules|winners|entries)\b/g)].map((m) => m[1]!);
}

describe('the hero poster (finding 1)', () => {
  it('sets EVERY authored line and discards nothing', () => {
    const title = 'YAGI PROMPTS\nLAUNCH FILM\nCONTEST';
    expect(posterTitleLines(title)).toEqual(['YAGI PROMPTS', 'LAUNCH FILM', 'CONTEST']);

    const html = renderToStaticMarkup(
      <ContestPoster wide title={title} slug="s" brand="YAGI WORKSHOP" prize="$3,000 · 1st $1,500" />,
    );
    for (const line of ['YAGI PROMPTS', 'LAUNCH FILM', 'CONTEST']) {
      expect(html, line).toContain(line);
    }
  });

  /** A title with no authored break is CHUNKED, never truncated — the old three-word cut. */
  it('chunks an unbroken title instead of throwing the rest away', () => {
    expect(posterTitleLines('YAGI PROMPTS LAUNCH FILM CONTEST')).toEqual([
      'YAGI PROMPTS',
      'LAUNCH FILM',
      'CONTEST',
    ]);
    expect(posterTitleLines('ONE')).toEqual(['ONE']);
  });

  /** The outline is semantic: the LAST line, never a hash-picked word and never the studio name. */
  it('outlines the final line only', () => {
    const html = renderToStaticMarkup(
      <ContestPoster wide title={'YAGI PROMPTS\nLAUNCH FILM\nCONTEST'} slug="s" brand="B" />,
    );
    expect(html.match(/-webkit-text-stroke:1px #ffffff/g)).toHaveLength(1);
    const finalSpan = /data-poster-line="final"[^>]*>([^<]*)</.exec(html)?.[1];
    expect(finalSpan).toBe('CONTEST');
  });

  it('lays out a real responsive grid rather than one 21:9 band', () => {
    const html = renderToStaticMarkup(
      <ContestPoster wide title="A B" slug="s" brand="B" prize="$1 · 1st $1" prizeLabel="Prize" />,
    );
    // one column → 8 → 12, at 24 / 32 / 56px padding
    for (const token of [
      'grid-cols-1',
      'sm:grid-cols-8',
      'lg:grid-cols-12',
      'p-6',
      'sm:p-8',
      'lg:p-14',
    ]) {
      expect(html, token).toContain(token);
    }
    // the prize panel spans 9–12 behind a STRUCTURAL hairline (a border on the panel itself)
    expect(html).toContain('lg:col-span-4');
    expect(html).toContain('sm:border-l');
    // …and nothing on the poster is placed by a hash any more
    expect(html).not.toMatch(/style="left:/);
  });

  it('splits the prize instead of setting the whole string in one run', () => {
    const html = renderToStaticMarkup(
      <ContestPoster
        wide
        title="A"
        slug="s"
        brand="B"
        prizeLabel="Prize"
        prize="$3,000 · 1st $1,500 / 2nd $1,000 / 3rd $500"
      />,
    );
    expect(html).toContain('text-contest-poster-prize');
    expect(html).toContain('>$3,000<');
    expect(html).toContain('1st $1,500');
    expect(html).not.toContain('$3,000 · 1st');
  });

  /** Finding 1's mobile geometry lives on the hero box, which owns the ratio. */
  it('goes portrait below 640 (the hero box)', () => {
    const hero = readSource('components', 'contests', 'hero.tsx');
    expect(hero).toContain('aspect-4/5 w-full sm:aspect-16/9 lg:aspect-21/9');
    expect(hero).not.toMatch(/className="aspect-4\/3/);
  });
});

describe('black panels are dark surfaces (finding 2)', () => {
  it('declares data-theme on the poster, both variants', () => {
    const wide = renderToStaticMarkup(<ContestPoster wide title="A" slug="s" brand="B" />);
    const tile = renderToStaticMarkup(<ContestPoster title="A" slug="s" brand="B" />);
    expect(wide).toContain('data-theme="dark"');
    expect(tile).toContain('data-theme="dark"');
  });

  it('declares it on the entry card panel too', () => {
    const html = renderToStaticMarkup(<ContestEntryCard entry={entry()} labels={labels} />);
    expect(html).toContain('data-theme="dark"');
  });

  /**
   * The other half of finding 2: a SOLID blue chip carries white text on its own surface, where
   * #0000EE measures 9.40:1 and the dark-surface tone-map would drop it to ~3.6:1. The tone-map is
   * for ink ON black; the chips stay the plan's blue.
   */
  it('keeps solid blue chips on #0000EE, not the tone-mapped accent', () => {
    const placed = renderToStaticMarkup(
      <ContestEntryCard entry={entry({ placement: 1 })} labels={labels} />,
    );
    expect(placed).toMatch(/data-winner-badge[^>]*bg-blue/);

    const open = renderToStaticMarkup(
      <ContestCardView card={card()} locale="en" labels={labels} now={NOW} />,
    );
    expect(open).toMatch(/data-phase-chip="open"[^>]*bg-blue/);
  });
});

describe('the prize band (finding 3)', () => {
  it('is a full-width dark inversion with an inner band', () => {
    const html = renderToStaticMarkup(
      <ContestPrize contest={shaped()} locale="en" labels={labels} />,
    );
    expect(html).toContain('data-contest-prize');
    expect(html).toContain('data-theme="dark"');
    // `data-section` is what makes the nav invert with it (§4's observer reads that pair).
    expect(html).toContain('data-section');
    expect(html).toContain('py-12 lg:py-16');
    expect(html).toContain('class="band"');
  });

  it('sets the TOTAL in display type and the payouts at 14px mono', () => {
    const html = renderToStaticMarkup(
      <ContestPrize contest={shaped()} locale="en" labels={labels} />,
    );
    expect(html).toContain('text-contest-prize');
    expect(html).toMatch(/data-prize-total[^>]*>\$3,000</);
    expect(html).toContain('font-mono text-[0.875rem]');
    for (const payout of ['1st $1,500', '2nd $1,000', '3rd $500']) {
      expect(html, payout).toContain(payout);
    }
    expect(html).not.toContain('$3,000 · 1st');
  });

  it('splits on the delimiters the copy actually uses', () => {
    expect(splitPrize('$3,000 · 1st $1,500 / 2nd $1,000 / 3rd $500')).toEqual({
      total: '$3,000',
      payouts: ['1st $1,500', '2nd $1,000', '3rd $500'],
    });
    expect(splitPrize('총 $3,000 · 1위 $1,500 / 2위 $1,000')).toEqual({
      total: '총 $3,000',
      payouts: ['1위 $1,500', '2위 $1,000'],
    });
    // A one-figure prize is a total, not a guess.
    expect(splitPrize('£1,000')).toEqual({ total: '£1,000', payouts: [] });
    expect(splitPrize('   ')).toEqual({ total: '', payouts: [] });
  });

  /** It has to sit OUTSIDE the ad-rail anchor, or it is a panel rather than an inversion. */
  it('renders outside the rail anchor on both surfaces that show a contest', () => {
    for (const page of [
      readSource('app', '(marketing)', '[locale]', 'contests', '[slug]', 'page.tsx'),
      readSource('app', '(admin)', 'admin', 'contests', '[slug]', 'preview', 'page.tsx'),
    ]) {
      const prize = page.indexOf('<ContestPrize');
      const body = page.indexOf('<ContestBody');
      expect(prize).toBeGreaterThan(-1);
      expect(body).toBeGreaterThan(prize);
    }
    const detail = readSource('app', '(marketing)', '[locale]', 'contests', '[slug]', 'page.tsx');
    expect(detail.indexOf('<ContestPrize')).toBeLessThan(detail.indexOf('id="contest-rail-anchor"'));
  });
});

describe('the metadata grid (finding 4)', () => {
  it('is a dl of four labelled cells, not a slash-separated sentence', () => {
    const html = renderToStaticMarkup(
      <ContestMeta contest={shaped()} locale="en" labels={labels} />,
    );
    expect(html).toContain('<dl');
    for (const cell of ['status', 'opens', 'deadline', 'countdown']) {
      expect(html, cell).toContain(`data-meta-cell="${cell}"`);
    }
    expect(html.match(/<dt/g)).toHaveLength(4);
    expect(html.match(/<dd/g)).toHaveLength(4);
    // 2 columns at 375, 4 from 768; 72px rows; 16px cells; internal hairlines
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('md:grid-cols-4');
    expect(html).toContain('min-h-[72px]');
    expect(html).toContain('p-4');
    expect(html).toContain('border-r border-b border-hairline');
  });

  it('keeps every column present in every phase', () => {
    const closed = renderToStaticMarkup(
      <ContestMeta
        contest={shaped({
          timing: { phase: 'closed', daysRemaining: null, dDay: null },
          startsAt: null,
        })}
        locale="en"
        labels={labels}
      />,
    );
    expect(closed.match(/data-meta-cell/g)).toHaveLength(4);
    expect(closed).toContain('—'); // the missing start date, held open rather than dropped
    expect(closed).toContain(dict.contests.resultsLabel);
  });

  /** The upcoming CTA is a thing to DO, not the opening date printed a second time. */
  it('replaces the upcoming pseudo-button with a link into the brief', () => {
    const html = renderToStaticMarkup(
      <ContestBody
        contest={shaped({ timing: { phase: 'upcoming', daysRemaining: 3, dDay: 'D-3' } })}
        locale="en"
        labels={labels}
      />,
    );
    expect(html).toContain('data-contest-cta="upcoming"');
    expect(html).toContain('href="#brief"');
    expect(html).toContain(dict.contests.readBriefCta);
    expect(html).toContain('id="brief"');
  });
});

describe('the card chips (finding 6)', () => {
  it('runs at 12px with one weight per phase', () => {
    const open = renderToStaticMarkup(
      <ContestCardView card={card()} locale="en" labels={labels} now={NOW} />,
    );
    expect(open).toMatch(/data-phase-chip="open"[^>]*text-\[0\.75rem\]/);
    expect(open).not.toContain('text-[0.6875rem]');

    const upcoming = renderToStaticMarkup(
      <ContestCardView
        card={card({ startsAt: new Date(NOW + 3 * DAY).toISOString() })}
        locale="en"
        labels={labels}
        now={NOW}
      />,
    );
    expect(upcoming).toMatch(/data-phase-chip="upcoming"[^>]*bg-white text-black/);

    const closed = renderToStaticMarkup(
      <ContestCardView
        card={card({
          startsAt: new Date(NOW - 40 * DAY).toISOString(),
          deadlineAt: new Date(NOW - 2 * DAY).toISOString(),
        })}
        locale="en"
        labels={labels}
        now={NOW}
      />,
    );
    expect(closed).toMatch(/data-phase-chip="closed"[^>]*bg-black\/70 text-white opacity-70/);
  });

  it('boxes the brand chip on the poster instead of captioning the title', () => {
    const html = renderToStaticMarkup(
      <ContestCardView card={card()} locale="en" labels={labels} now={NOW} />,
    );
    expect(html).toMatch(/data-brand-chip[^>]*border border-white\/35/);
    expect(html).not.toContain('text-[0.65rem]');
    expect(html.match(/YAGI WORKSHOP/g)).toHaveLength(1);
  });

  it('counts the winners on a closed card, and keeps the D-day for the rest', () => {
    const closed = card({
      startsAt: new Date(NOW - 40 * DAY).toISOString(),
      deadlineAt: new Date(NOW - 2 * DAY).toISOString(),
      winnerCount: 3,
    });
    const html = renderToStaticMarkup(
      <ContestCardView card={closed} locale="en" labels={labels} now={NOW} />,
    );
    expect(html).toContain('Winners ×3');
    expect(html).not.toContain('data-dday');

    const open = renderToStaticMarkup(
      <ContestCardView card={card()} locale="en" labels={labels} now={NOW} />,
    );
    expect(open).toContain('data-dday');
    expect(open).not.toContain('data-winners-marker');
  });
});

describe('section order and headings (finding 7)', () => {
  it('sets every section heading at one size, over one hairline', () => {
    const html = renderToStaticMarkup(
      <ContestBody
        contest={shaped({ entries: [entry()], winners: [] })}
        locale="en"
        labels={labels}
      />,
    );
    // the brief used to be a 14px LABEL above two display-type siblings
    expect(html.match(/text-contest-section/g)).toHaveLength(2);
    expect(html.match(/mt-14 border-t border-hairline pt-10/g)).toHaveLength(2);
  });

  it('asks for a film first when the contest is open', () => {
    const html = renderToStaticMarkup(<ContestBody contest={shaped()} locale="en" labels={labels} />);
    expect(order(html)).toEqual(['cta', 'rules', 'entries']);
  });

  it('answers first when it is closed and judged', () => {
    const html = renderToStaticMarkup(
      <ContestBody
        contest={shaped({
          timing: { phase: 'closed', daysRemaining: null, dDay: null },
          entries: [entry({ placement: 1 })],
          winners: [entry({ placement: 1 })],
        })}
        locale="en"
        labels={labels}
      />,
    );
    expect(order(html)).toEqual(['winners', 'entries', 'rules']);
  });

  it('drops the winners strip — and the redundant jump link — when there are none', () => {
    const html = renderToStaticMarkup(
      <ContestBody
        contest={shaped({
          timing: { phase: 'closed', daysRemaining: null, dDay: null },
          entries: [entry()],
        })}
        locale="en"
        labels={labels}
      />,
    );
    expect(order(html)).toEqual(['entries', 'rules']);
    expect(html).not.toContain('data-contest-cta');
  });
});

describe('the entry form (finding 5)', () => {
  const page = readSource('app', '(app)', 'contests', '[slug]', 'submit', 'page.tsx');

  it('keeps the field order §14.2 asked for', () => {
    const positions = ['"title"', '"videoUrl"', '"snsUrl"', '"note"', '"consent"'].map((name) =>
      page.indexOf(`name=${name}`),
    );
    expect(positions.every((value) => value > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  /** `ok=1` outlives the deadline; a resubmit after it can only ever be refused. */
  it('offers a replacement only while the contest is open', () => {
    expect(page).toContain("timing.phase === 'open' && (");
  });

  it('marks the field the server named, and shouts rather than whispers', () => {
    for (const token of [
      'isEntryField',
      'aria-invalid',
      'border-accent',
      'data-field-error',
      'text-[0.75rem]',
      'role="alert"',
      // the generic banner survives for refusals that belong to no single field
      'data-entry-error',
    ]) {
      expect(page, token).toContain(token);
    }
    expect(page).not.toContain('role="status"');
  });

  it('gives the submit button a pending state and repeats the replacement warning', () => {
    const button = readSource('app', '(app)', 'contests', '[slug]', 'submit', 'submit-button.tsx');
    expect(button).toContain("'use client'");
    expect(button).toContain('useFormStatus');
    expect(button).toContain('disabled={pending}');
    expect(button).toContain('disabled:opacity-50');
    expect(button).toContain('min-h-12');
    expect(page).toContain('data-resubmit-warning');
    expect(page).toContain('pendingLabel={copy.submitPending}');
  });

  /** The action has to SAY which field, or the page has nothing to mark. */
  it('carries the field enum from the validator to the URL', () => {
    expect(readSource('app', '(app)', 'contests', '[slug]', 'submit', 'actions.ts')).toContain(
      '&field=',
    );
    const submit = readSource('lib', 'contests', 'submit.ts');
    expect(submit).toContain('isEntryField');
    expect(submit).toContain('field?: EntryField');
  });
});

describe('the admin editor (finding 8)', () => {
  it('authors the contest title in a textarea, so a line break is a decision', () => {
    const admin = readSource('app', '(admin)', 'admin', 'contests', 'page.tsx');
    expect(admin).toMatch(/label=\{a\.fieldContestTitle\} name="title"[\s\S]{0,80}multiline/);
  });
});
