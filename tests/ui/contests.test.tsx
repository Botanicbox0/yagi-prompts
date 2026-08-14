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
import {
  contestMailto,
  ContestFeature,
  ContestHireStrip,
  ContestHostKinds,
  ContestRail,
  ContestsEmptyState,
} from '@/components/contests/rails';
import { contestLabels, hostKindLabel } from '@/components/contests/labels';
import { HOST_KINDS } from '@/lib/contests/schemas';

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
    prizeTotal: { en: '$3,000', ko: '$3,000' },
    prizeKind: 'cash',
    hostName: 'YAGI WORKSHOP',
    hostKind: 'studio',
    hostUrl: 'https://yagiworkshop.xyz',
    hostLogo: null,
    poster: null,
    startsAt: new Date(NOW - 2 * DAY).toISOString(),
    deadlineAt: new Date(NOW + 7 * DAY).toISOString(),
    announceAt: null,
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
        mailto={contestMailto('en')}
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
        mailto={contestMailto('en')}
      />,
    );
    expect(ko.contests.emptyTitle.split('\n')).toHaveLength(3);
    expect(html).toContain('진행 중인\n콘테스트가\n없습니다.');
    expect(html).toContain('whitespace-pre-line');
    expect(html).toContain('콘테스트 개최 문의');
  });

  /**
   * Finding 9: 128px of combined margin+padding above one statement on an otherwise empty page
   * read as a rendering failure rather than a decision, and the 14px CTA under 56px display type
   * read as a footnote. The numbers are the review's.
   */
  it('sits at the reviewed spacing, with a CTA that has a real touch target', () => {
    const html = renderToStaticMarkup(
      <ContestsEmptyState title="T" body="B" cta="C" mailto={contestMailto('en')} />,
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

/**
 * Founder direction (2026-08-15): no host-application form — the enquiry stays an email. That makes
 * the mailto BODY the intake form, and these are the fields the admin editor cannot open a contest
 * without. A bare mailto would start a thread asking for them one at a time.
 */
describe('the contest enquiry mailto', () => {
  it('prefills the fields a contest needs, in the reader’s language', () => {
    const en = decodeURIComponent(contestMailto('en'));
    expect(en.startsWith('mailto:hello@yagiworkshop.xyz?')).toBe(true);
    for (const field of ['Host', 'Prize', 'Dates', 'brief', 'link']) {
      expect(en, field).toContain(field);
    }
    // Every host kind is named, so the sender does not have to guess whether they qualify.
    for (const kind of ['brand', 'platform', 'studio', 'creator', 'community']) {
      expect(en, kind).toContain(kind);
    }

    const ko = decodeURIComponent(contestMailto('ko'));
    expect(ko).toContain('주최');
    expect(ko).toContain('보상');
    expect(ko).toContain('일정');
    expect(ko).toContain('플랫폼');
  });

  /** A `+` in a mailto query renders as a literal plus in most clients, never as a space. */
  it('encodes spaces as %20, not as +', () => {
    expect(contestMailto('en')).not.toContain('+');
    expect(contestMailto('ko')).not.toContain('+');
  });
});

describe('the hire strip (§14.2)', () => {
  it('renders the studio pitch and the same mailto', () => {
    const html = renderToStaticMarkup(
      <ContestHireStrip
        title={dict.contests.hireTitle}
        body={dict.contests.hireBody}
        cta={dict.contests.hireCta}
        mailto={contestMailto('en')}
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
    expect(detail).not.toContain('contestMailto');
  });
});

/**
 * The host-agnostic surface (founder direction, 2026-08-15 — "brand뿐만 아니라 higgsfield나
 * 플랫폼이나 다 관계없이 콘테스트 열 수 있게"). What is asserted is the thing that used to be
 * impossible: a PLATFORM hosting a CREDITS contest reads correctly everywhere it appears.
 */
describe('a host that is not a brand', () => {
  const platform = card({
    hostName: 'HIGGSFIELD',
    hostKind: 'platform',
    prizeKind: 'credits',
    prizeTotal: { en: '50,000 credits', ko: '크레딧 50,000' },
  });

  it('names the kind on the card, beside the host, in both locales', () => {
    const html = renderToStaticMarkup(
      <ContestCardView card={platform} locale="en" labels={labels} now={NOW} />,
    );
    expect(html).toContain('data-host-kind="platform"');
    expect(html).toContain('HIGGSFIELD');
    expect(html).toContain(dict.contests.hostKindPlatform);
    // The card LEADS with the prize now, and says what kind of number it is.
    expect(html).toContain('data-prize-kind="credits"');
    expect(html).toMatch(/data-prize-total[^>]*>50,000 credits</);
    expect(html).toContain('font-display');

    const koHtml = renderToStaticMarkup(
      <ContestCardView card={platform} locale="ko" labels={contestLabels(ko)} now={NOW} />,
    );
    expect(koHtml).toContain(ko.contests.hostKindPlatform);
    expect(koHtml).toContain('크레딧 50,000');
    // Never the word 브랜드 for a platform — that was the whole bug.
    expect(koHtml).not.toContain(ko.contests.hostKindBrand);
  });

  it('gives the featured board the same host and prize, with one link to the contest', () => {
    const html = renderToStaticMarkup(
      <ContestFeature card={platform} locale="en" labels={labels} now={NOW} />,
    );
    expect(html).toContain('data-contest-feature="launch-film-contest"');
    expect(html).toContain(dict.contests.hostKindPlatform);
    expect(html).toMatch(/data-feature-prize[^>]*>50,000 credits</);
    expect(html).toContain('href="/en/contests/launch-film-contest"');
    // The inversion is the point: a dark surface so §5.1's accent maps to the dark-surface blue.
    expect(html).toContain('data-theme="dark"');
  });

  /** The five kinds are a STATEMENT about who may host — it must list every one of them. */
  it('lists every host kind in the who-can-host strip', () => {
    const html = renderToStaticMarkup(
      <ContestHostKinds
        title={dict.contests.hostKindsTitle}
        body={dict.contests.hostKindsBody}
        kinds={HOST_KINDS.map((kind) => hostKindLabel(labels, kind))}
      />,
    );
    for (const kind of HOST_KINDS) {
      expect(html, kind).toContain(hostKindLabel(labels, kind));
    }
    expect(html).toContain('data-contest-host-kinds');
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
    expect(html).toContain('data-host-chip');
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
    prizeTotal: { en: '$3,000', ko: '총 $3,000' },
    prizeKind: 'cash',
    prizeTiers: [
      { place: 1, value: { en: '$1,500', ko: '$1,500' } },
      { place: 2, value: { en: '$1,000', ko: '$1,000' } },
      { place: 3, value: { en: '$500', ko: '$500' } },
    ],
    rules: { en: '## What we are looking for\n\nA short film.', ko: '## 이런 작품을 찾습니다' },
    hostName: 'YAGI WORKSHOP',
    hostKind: 'studio',
    hostUrl: 'https://yagiworkshop.xyz',
    hostLogo: null,
    poster: null,
    video: null,
    startsAt: new Date(NOW - 2 * DAY).toISOString(),
    deadlineAt: new Date(NOW + 7 * DAY).toISOString(),
    announceAt: null,
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
      <ContestPoster wide title={title} slug="s" host="YAGI WORKSHOP" prize="$3,000" payouts={['1st $1,500']} />,
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
      <ContestPoster wide title={'YAGI PROMPTS\nLAUNCH FILM\nCONTEST'} slug="s" host="B" />,
    );
    expect(html.match(/-webkit-text-stroke:1px #ffffff/g)).toHaveLength(1);
    const finalSpan = /data-poster-line="final"[^>]*>([^<]*)</.exec(html)?.[1];
    expect(finalSpan).toBe('CONTEST');
  });

  it('lays out a real responsive grid rather than one 21:9 band', () => {
    const html = renderToStaticMarkup(
      <ContestPoster wide title="A B" slug="s" host="B" prize="$1 · 1st $1" prizeLabel="Prize" />,
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

  /** The caller hands the poster parts, not a sentence to parse (2026-08-15). */
  it('sets the total in display type and the payout small, in two runs', () => {
    const html = renderToStaticMarkup(
      <ContestPoster
        wide
        title="A"
        slug="s"
        host="B"
        prizeLabel="Prize"
        prize="$3,000"
        payouts={['1st $1,500', '2nd $1,000', '3rd $500']}
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
    const wide = renderToStaticMarkup(<ContestPoster wide title="A" slug="s" host="B" />);
    const tile = renderToStaticMarkup(<ContestPoster title="A" slug="s" host="B" />);
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
    // The podium is a TABLE of tiers now, not a parsed sentence: each place is its own cell.
    for (const [place, value] of [
      ['1', '$1,500'],
      ['2', '$1,000'],
      ['3', '$500'],
    ]) {
      expect(html, value).toMatch(new RegExp(`data-prize-tier="${place}"`));
      expect(html, value).toContain(value);
    }
    expect(html).not.toContain('$3,000 · 1st');
  });

  /**
   * The whole point of the 2026-08-15 model change: a credits contest is a DIFFERENT thing from a
   * cash one, and the page has to say which without the author writing the word into the figure.
   */
  it('names the prize KIND from the dictionary, in each locale', () => {
    const credits = shaped({
      prizeKind: 'credits',
      prizeTotal: { en: '50,000 credits', ko: '크레딧 50,000' },
      prizeTiers: [],
    });
    const en = renderToStaticMarkup(<ContestPrize contest={credits} locale="en" labels={labels} />);
    expect(en).toContain('data-prize-kind="credits"');
    expect(en).toContain(dict.contests.prizeKindCredits);
    expect(en).not.toContain(dict.contests.prizeKindCash);

    const koLabels = contestLabels(ko);
    const koHtml = renderToStaticMarkup(
      <ContestPrize contest={credits} locale="ko" labels={koLabels} />,
    );
    expect(koHtml).toContain(ko.contests.prizeKindCredits);
    // No tiers authored → no payout table, rather than an empty heading over nothing.
    expect(koHtml).not.toContain('data-prize-payouts');
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
  it('is a dl of five labelled cells, not a slash-separated sentence', () => {
    const html = renderToStaticMarkup(
      <ContestMeta contest={shaped()} locale="en" labels={labels} />,
    );
    expect(html).toContain('<dl');
    for (const cell of ['status', 'opens', 'deadline', 'announce', 'countdown']) {
      expect(html, cell).toContain(`data-meta-cell="${cell}"`);
    }
    expect(html.match(/<dt/g)).toHaveLength(5);
    expect(html.match(/<dd/g)).toHaveLength(5);
    // 2 columns at 375, 4 from 768; 72px rows; 16px cells; internal hairlines
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('md:grid-cols-5');
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
    expect(closed.match(/data-meta-cell/g)).toHaveLength(5);
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

  it('boxes the host chip on the poster instead of captioning the title', () => {
    const html = renderToStaticMarkup(
      <ContestCardView card={card()} locale="en" labels={labels} now={NOW} />,
    );
    expect(html).toMatch(/data-host-chip[^>]*border border-white\/35/);
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
