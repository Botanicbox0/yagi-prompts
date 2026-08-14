import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadContestCatalog, splitByPhase, toContestCard } from '@/lib/contests/catalog';
import { upsertEntry } from '@/lib/contests/repo';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { contestHarness, makeContest, NOW, type ContestHarness } from '../helpers/contests';

/**
 * PLAN §14.2 — the listing projection.
 *
 * The assertion that carries the milestone's privacy property is the KEY SET one: this projection
 * is served from a `[static + tag 'contests']` document, byte-identical to every reader and cached
 * in a CDN, and an entrant's SNS link is a real identity. So the card is built by NAMING fields and
 * this test pins the exact list — a future `...row` would fail here before it reached a page.
 */

const EXPECTED_CARD_KEYS = [
  'announceAt',
  'deadlineAt',
  'entryCount',
  'hostKind',
  'hostLogo',
  'hostName',
  'hostUrl',
  'id',
  'poster',
  'prizeKind',
  'prizeTotal',
  'publishedAt',
  'slug',
  'startsAt',
  'summary',
  'title',
  'winnerCount',
].sort();

describe('contest card projection (§14.2)', () => {
  let harness: ContestHarness;

  beforeEach(async () => {
    harness = await contestHarness();
  });
  afterEach(async () => harness.close());

  it('carries exactly the card fields — and no entry data of any kind', async () => {
    await makeContest(harness, { slug: 'live', startsInDays: -1, deadlineInDays: 10 });
    const catalog = await loadContestCatalog(harness.sql);

    expect(catalog.contests).toHaveLength(1);
    const card = catalog.contests[0]!;
    expect(Object.keys(card).sort()).toEqual(EXPECTED_CARD_KEYS);

    // Spelled out as well as key-set-checked: these are the fields whose presence would be a leak.
    const serialised = JSON.stringify(card);
    for (const forbidden of ['sns', 'videoUrl', 'video_url', 'authorId', 'author_id', 'note']) {
      expect(serialised.includes(forbidden), forbidden).toBe(false);
    }
  });

  it('never lists a draft or an archived contest', async () => {
    await makeContest(harness, { slug: 'draft-one', status: 'draft', deadlineInDays: 10 });
    await makeContest(harness, { slug: 'archived-one', status: 'archived', deadlineInDays: 10 });
    await makeContest(harness, { slug: 'live-one', startsInDays: -1, deadlineInDays: 10 });

    const catalog = await loadContestCatalog(harness.sql);
    expect(catalog.contests.map((c) => c.slug)).toEqual(['live-one']);
    expect(catalog.totals.published).toBe(1);
  });

  it('counts APPROVED entries only, as integers', async () => {
    const { id } = await makeContest(harness, { slug: 'counted', startsInDays: -1, deadlineInDays: 10 });

    const entries: Array<[keyof typeof FIXTURE_USERS, string, number | null]> = [
      ['free', 'approved', 1],
      ['pro', 'approved', null],
      ['admin', 'pending', null],
    ];
    for (const [key, status, placement] of entries) {
      const entryId = await upsertEntry(harness.sql, {
        id: crypto.randomUUID(),
        contestId: id,
        authorId: FIXTURE_USERS[key].id,
        title: `${key} film`,
        videoUrl: 'https://vimeo.com/1',
        note: null,
        snsUrl: 'https://instagram.com/someone',
      });
      if (status !== 'pending') {
        await harness.sql.query(
          'update contest_entries set status = $2, placement = $3 where id = $1',
          [entryId, status, placement],
        );
      }
    }

    const catalog = await loadContestCatalog(harness.sql);
    const card = catalog.contests[0]!;
    expect(card.entryCount).toBe(2);
    expect(card.winnerCount).toBe(1);
    expect(catalog.totals.entries).toBe(2);
  });

  it('shapes an unpublished poster to null rather than emitting a staging key', () => {
    const card = toContestCard(
      {
        id: '9c000000-0000-4000-8000-000000000001',
        slug: 'x',
        status: 'draft',
        title: { en: 'A', ko: 'ㄱ' },
        summary: { en: 'B', ko: 'ㄴ' },
        prizeTotal: { en: '$1', ko: '$1' },
        prizeKind: 'cash',
        prizeTiers: [],
        rules: null,
        hostName: 'BRAND',
        hostKind: 'brand',
        hostUrl: null,
        media: { poster: { staging_key: 'content/contest/x/p.png', sha256: 'a'.repeat(64), mime: 'image/png' } },
        startsAt: null,
        deadlineAt: null,
        announceAt: null,
        createdAt: null,
        publishedAt: null,
      },
      { approved: 0, winners: 0 },
    );

    expect(card.poster).toBeNull();
    expect(JSON.stringify(card).includes('content/contest/')).toBe(false);
  });
});

describe('splitByPhase (§14.2 — open first, then upcoming, then closed)', () => {
  let harness: ContestHarness;

  beforeEach(async () => {
    harness = await contestHarness();
  });
  afterEach(async () => harness.close());

  it('puts every contest in exactly one rail, each in its own order', async () => {
    await makeContest(harness, { slug: 'open-late', startsInDays: -5, deadlineInDays: 20 });
    await makeContest(harness, { slug: 'open-soon', startsInDays: -5, deadlineInDays: 3 });
    await makeContest(harness, { slug: 'upcoming-far', startsInDays: 30, deadlineInDays: 60 });
    await makeContest(harness, { slug: 'upcoming-near', startsInDays: 5, deadlineInDays: 40 });
    await makeContest(harness, { slug: 'closed-old', startsInDays: -90, deadlineInDays: -60 });
    await makeContest(harness, { slug: 'closed-recent', startsInDays: -40, deadlineInDays: -2 });

    const phased = splitByPhase(await loadContestCatalog(harness.sql), NOW);

    expect(phased.open.map((c) => c.slug)).toEqual(['open-soon', 'open-late']);
    expect(phased.upcoming.map((c) => c.slug)).toEqual(['upcoming-near', 'upcoming-far']);
    expect(phased.closed.map((c) => c.slug)).toEqual(['closed-recent', 'closed-old']);

    expect(phased.totals).toMatchObject({ published: 6, open: 2, upcoming: 2, closed: 2 });
    // A card cannot be in two rails, and none may go missing.
    expect(phased.open.length + phased.upcoming.length + phased.closed.length).toBe(6);
  });

  /**
   * The cache property this design rests on: the projection stores DATES, so the same cached
   * catalog re-split at a later instant moves a contest between rails without a re-read. That is
   * what lets `/[locale]/contests` stay static with an hourly TTL.
   */
  it('re-splits the same cached catalog correctly at a later clock', async () => {
    await makeContest(harness, { slug: 'moves', startsInDays: 1, deadlineInDays: 2 });
    const catalog = await loadContestCatalog(harness.sql);

    expect(splitByPhase(catalog, NOW).upcoming.map((c) => c.slug)).toEqual(['moves']);
    expect(splitByPhase(catalog, NOW + 36 * 3600_000).open.map((c) => c.slug)).toEqual(['moves']);
    expect(splitByPhase(catalog, NOW + 5 * 24 * 3600_000).closed.map((c) => c.slug)).toEqual([
      'moves',
    ]);
  });
});
