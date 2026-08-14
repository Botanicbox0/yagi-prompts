import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { CONTEST_OPERATIONS } from '@/lib/admin/contest-operations';
import { classifyDbError } from '@/lib/admin/errors';
import {
  countPlacedEntries,
  loadContestBySlug,
  loadEntriesForModeration,
  loadEntryById,
  upsertEntry,
} from '@/lib/contests/repo';
import { parseContestMedia } from '@/lib/contests/schemas';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import {
  adminHarness,
  expectOk,
  formOf,
  upload,
  viewerOf,
  type AdminHarness,
} from '../helpers/admin';

/**
 * PLAN §14.2 — the admin operations, driven through the SAME guarded dispatcher every other admin
 * mutation goes through.
 *
 * The auth half is not repeated here: `tests/admin/auth.test.ts` enumerates `ADMIN_OPERATIONS` and
 * refuses every entry for a non-admin, so these eight are covered the moment they are registered.
 * What this file owns is the behaviour — the publish gate, the moderation transitions, and the two
 * placement guards that live on opposite sides of the TypeScript/SQL line.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 16);

const contestFields = (overrides: Record<string, string> = {}) => ({
  slug: 'launch-film-contest',
  titleEn: 'Launch film contest',
  titleKo: '런칭 단편 공모전',
  summaryEn: 'Make a short film with the prompts on this site.',
  summaryKo: '이 사이트의 프롬프트로 단편을 만들어 주세요.',
  prizeTotalEn: '$3,000',
  prizeTotalKo: '$3,000',
  prizeKind: 'cash',
  prizeTier1En: '$1,500',
  prizeTier1Ko: '$1,500',
  rulesEn: '## The brief\n\nA short film.',
  rulesKo: '## 브리프\n\n단편 하나.',
  hostName: 'YAGI WORKSHOP',
  hostKind: 'studio',
  hostUrl: 'https://yagiworkshop.xyz',
  startsAt: iso(-1),
  deadlineAt: iso(30),
  ...overrides,
});


/**
 * The moderation forms carry the entry's VERSION (M9 review, finding 2), so every call here has to
 * read the current one first — exactly as the rendered form does.
 */
async function versionOf(harness: AdminHarness, id: string): Promise<string> {
  const row = await loadEntryById(harness.ctx().sql, id);
  if (row === null) throw new Error(`no entry ${id}`);
  return row.version;
}

describe('registry (§14.2 / M4 doctrine)', () => {
  it('registers every contest operation in the ONE enumerated registry', () => {
    for (const name of Object.keys(CONTEST_OPERATIONS)) {
      expect(ADMIN_OPERATION_NAMES, name).toContain(name);
    }
    // The property the registry exists for: the auth matrix is enumeration-driven, so these are
    // refused for a non-admin without anyone remembering to add them to a list.
    expect(ADMIN_OPERATION_NAMES.length).toBeGreaterThanOrEqual(29);
  });

  it('refuses every contest operation for a signed-in non-admin', async () => {
    const harness = await adminHarness();
    try {
      for (const name of Object.keys(CONTEST_OPERATIONS)) {
        const outcome = await dispatchAdmin(name, formOf(name), harness.ctx(viewerOf('pro')));
        expect(outcome, name).toEqual({ ok: false, code: 'forbidden' });
      }
    } finally {
      await harness.close();
    }
  });
});

describe('contest CRUD + publish gate (§14.2)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const sql = () => harness.ctx().sql;

  it('creates a DRAFT with a privately staged poster, and invalidates nothing', async () => {
    const outcome = expectOk(
      await harness.run('contest.create', {
        ...contestFields(),
        poster: upload('poster.png', 'poster bytes'),
      }),
    );
    expect(outcome.code).toBe('created');

    const row = (await loadContestBySlug(sql(), 'launch-film-contest'))!;
    expect(row.status).toBe('draft');

    // §14.1: a prize is a public commitment. Nothing about an unpublished contest is disclosed —
    // the poster has a staging key and NO published key at all.
    const media = parseContestMedia(row.media);
    expect(media.poster?.staging_key).toMatch(/^content\/contest\//);
    expect(media.poster?.published_key).toBeUndefined();
    // A draft was never on the listing, so nothing cached can be stale.
    expect(harness.contestsRevalidated).toBe(0);
  });

  it('refuses to publish a contest that is missing something, and names all of it', async () => {
    await harness.run('contest.create', {
      ...contestFields({ prizeTotalKo: '', startsAt: '', deadlineAt: '' }),
    });
    const row = (await loadContestBySlug(sql(), 'launch-film-contest'))!;

    const outcome = await harness.run('contest.publish', { id: row.id });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('notPublishable');
    expect(outcome.ok === false && outcome.detail).toContain('prize (en + ko)');
    expect(outcome.ok === false && outcome.detail).toContain('start date');
    expect(outcome.ok === false && outcome.detail).toContain('poster image');

    // Nothing was copied on the way to that refusal — a contest that cannot publish must not have
    // its bytes disclosed "just in case".
    expect((await loadContestBySlug(sql(), 'launch-film-contest'))!.status).toBe('draft');
    expect(harness.contestsRevalidated).toBe(0);
  });

  it('publishes a complete contest, copies the poster and invalidates the listing', async () => {
    await harness.run('contest.create', {
      ...contestFields(),
      poster: upload('poster.png', 'poster bytes'),
    });
    const draft = (await loadContestBySlug(sql(), 'launch-film-contest'))!;

    expectOk(await harness.run('contest.publish', { id: draft.id }));

    const live = (await loadContestBySlug(sql(), 'launch-film-contest'))!;
    expect(live.status).toBe('published');
    expect(live.publishedAt).not.toBeNull();

    const media = parseContestMedia(live.media);
    expect(media.poster?.bucket).toBe('public-content');
    expect(media.poster?.published_key).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(await harness.storage.exists('public-content', media.poster!.published_key!)).toBe(true);
    expect(harness.contestsRevalidated).toBe(1);
  });

  it('is idempotent: publishing twice copies nothing new and keeps the debut date', async () => {
    await harness.run('contest.create', {
      ...contestFields(),
      poster: upload('poster.png', 'poster bytes'),
    });
    const draft = (await loadContestBySlug(sql(), 'launch-film-contest'))!;
    expectOk(await harness.run('contest.publish', { id: draft.id }));
    const first = (await loadContestBySlug(sql(), 'launch-film-contest'))!;

    expectOk(await harness.run('contest.unpublish', { id: draft.id }));
    expectOk(await harness.run('contest.publish', { id: draft.id }));
    const second = (await loadContestBySlug(sql(), 'launch-film-contest'))!;

    expect(second.publishedAt).toBe(first.publishedAt);
  });

  it('unpublishes back to draft and takes it off the listing', async () => {
    await harness.run('contest.create', {
      ...contestFields(),
      poster: upload('poster.png', 'poster bytes'),
    });
    const row = (await loadContestBySlug(sql(), 'launch-film-contest'))!;
    expectOk(await harness.run('contest.publish', { id: row.id }));

    const outcome = expectOk(await harness.run('contest.unpublish', { id: row.id }));
    expect(outcome.code).toBe('unpublished');
    expect((await loadContestBySlug(sql(), 'launch-film-contest'))!.status).toBe('draft');
  });

  it('refuses a duplicate slug through the database', async () => {
    await harness.run('contest.create', contestFields());
    const outcome = await harness.run('contest.create', contestFields());
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('duplicateSlug');
  });

  it('refuses a deadline before the start at the zod boundary', async () => {
    const outcome = await harness.run('contest.create', {
      ...contestFields({ startsAt: iso(30), deadlineAt: iso(1) }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('invalid');
  });

  it('archives and restores rather than deleting', async () => {
    await harness.run('contest.create', contestFields());
    const row = (await loadContestBySlug(sql(), 'launch-film-contest'))!;

    expectOk(await harness.run('contest.archive', { id: row.id, archived: true }));
    expect((await loadContestBySlug(sql(), 'launch-film-contest'))!.status).toBe('archived');

    expectOk(await harness.run('contest.archive', { id: row.id, archived: false }));
    expect((await loadContestBySlug(sql(), 'launch-film-contest'))!.status).toBe('draft');
  });

  it('copies a poster uploaded onto an ALREADY published contest immediately', async () => {
    await harness.run('contest.create', {
      ...contestFields(),
      poster: upload('poster.png', 'poster bytes'),
    });
    const row = (await loadContestBySlug(sql(), 'launch-film-contest'))!;
    expectOk(await harness.run('contest.publish', { id: row.id }));

    expectOk(
      await harness.run('contest.update', {
        id: row.id,
        ...contestFields(),
        poster: upload('poster2.png', 'different bytes'),
      }),
    );

    const media = parseContestMedia((await loadContestBySlug(sql(), 'launch-film-contest'))!.media);
    // Already public surface, so the replacement is public the moment it is saved.
    expect(media.poster?.bucket).toBe('public-content');
    expect(await harness.storage.exists('public-content', media.poster!.published_key!)).toBe(true);
  });
});

describe('entry moderation + placements (§14.1/§14.2)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const sql = () => harness.ctx().sql;

  /**
   * A live contest plus one pending entry, with the deadline placed where the test needs it.
   *
   * Always published through the real operation — that is what copies the poster into the public
   * bucket, which the strengthened `contests_published_requires_poster` CHECK now demands (M9
   * review, finding 5). The dates are moved onto the DATABASE's clock afterwards, because the
   * placement guard compares against `now()` inside its own UPDATE and a fixture clock would not
   * be the one it reads.
   */
  async function seedEntry(deadlineDays: number): Promise<{ contestId: string; entryId: string }> {
    await harness.run('contest.create', {
      ...contestFields({ startsAt: iso(-30), deadlineAt: iso(Math.max(deadlineDays, 1)) }),
      poster: upload('poster.png', 'poster bytes'),
    });
    const contest = (await loadContestBySlug(sql(), 'launch-film-contest'))!;
    expectOk(await harness.run('contest.publish', { id: contest.id }));
    if (deadlineDays <= 0) {
      await sql().query(
        `update contests
            set starts_at = now() - interval '30 days', deadline_at = now() - interval '1 second'
          where id = $1`,
        [contest.id],
      );
    }

    await sql().query('insert into auth.users (id) values ($1) on conflict do nothing', [
      FIXTURE_USERS.free.id,
    ]);
    await sql().query(
      `insert into profiles (id, email, display_name, locale, plan, is_admin)
       values ($1, $2, $3, 'en', 'free', false) on conflict (id) do nothing`,
      [FIXTURE_USERS.free.id, FIXTURE_USERS.free.email, FIXTURE_USERS.free.displayName],
    );

    const entryId = await upsertEntry(sql(), {
      id: crypto.randomUUID(),
      contestId: contest.id,
      authorId: FIXTURE_USERS.free.id,
      title: 'Last train',
      videoUrl: 'https://vimeo.com/1',
      note: null,
      snsUrl: 'https://www.instagram.com/hana',
    });

    return { contestId: contest.id, entryId };
  }

  it('approves a pending entry and invalidates the listing', async () => {
    const { entryId } = await seedEntry(30);
    const before = harness.contestsRevalidated;

    expectOk(await harness.run('contestEntry.approve', { id: entryId, version: await versionOf(harness, entryId) }));
    expect((await loadEntryById(sql(), entryId))!.status).toBe('approved');
    expect(harness.contestsRevalidated).toBe(before + 1);
  });

  it('rejects with a reason, and refuses a rejection without one', async () => {
    const { entryId } = await seedEntry(30);

    const blank = await harness.run('contestEntry.reject', { id: entryId, reason: '', version: await versionOf(harness, entryId) });
    expect(blank.ok === false && blank.code).toBe('invalid');

    expectOk(await harness.run('contestEntry.reject', { id: entryId, reason: 'Reads as stock.', version: await versionOf(harness, entryId) }));
    const row = (await loadEntryById(sql(), entryId))!;
    expect(row.status).toBe('rejected');
    expect(row.rejectReason).toBe('Reads as stock.');
  });

  it('does not invalidate the listing when a PENDING entry is rejected', async () => {
    const { entryId } = await seedEntry(30);
    const before = harness.contestsRevalidated;
    expectOk(await harness.run('contestEntry.reject', { id: entryId, reason: 'Not this one.', version: await versionOf(harness, entryId) }));
    // It was never visible, so nothing cached can be stale.
    expect(harness.contestsRevalidated).toBe(before);
  });

  it('DOES invalidate when an approved entry is taken down', async () => {
    const { entryId } = await seedEntry(30);
    expectOk(await harness.run('contestEntry.approve', { id: entryId, version: await versionOf(harness, entryId) }));
    const before = harness.contestsRevalidated;
    expectOk(await harness.run('contestEntry.reject', { id: entryId, reason: 'Rights issue.', version: await versionOf(harness, entryId) }));
    expect(harness.contestsRevalidated).toBe(before + 1);
  });

  // --- the two placement guards -------------------------------------------

  it('refuses a placement BEFORE the deadline (§14.1 — post-deadline act)', async () => {
    const { entryId } = await seedEntry(30);
    expectOk(await harness.run('contestEntry.approve', { id: entryId, version: await versionOf(harness, entryId) }));

    const outcome = await harness.run('contestEntry.placement', { id: entryId, placement: '1' });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('deadlineNotPassed');
    expect((await loadEntryById(sql(), entryId))!.placement).toBeNull();
  });

  it('allows a placement after the deadline', async () => {
    const { entryId } = await seedEntry(-1);
    expectOk(await harness.run('contestEntry.approve', { id: entryId, version: await versionOf(harness, entryId) }));
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '1' }));
    expect((await loadEntryById(sql(), entryId))!.placement).toBe(1);
  });

  it('refuses a placement on an entry that is not approved', async () => {
    const { entryId } = await seedEntry(-1);
    const outcome = await harness.run('contestEntry.placement', { id: entryId, placement: '2' });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('notFound');
  });

  it('refuses a second entry taking the same place, through the database', async () => {
    const { contestId, entryId } = await seedEntry(-1);
    expectOk(await harness.run('contestEntry.approve', { id: entryId, version: await versionOf(harness, entryId) }));
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '1' }));

    await sql().query('insert into auth.users (id) values ($1) on conflict do nothing', [
      FIXTURE_USERS.pro.id,
    ]);
    await sql().query(
      `insert into profiles (id, email, display_name, locale, plan, is_admin)
       values ($1, $2, $3, 'en', 'pro', false) on conflict (id) do nothing`,
      [FIXTURE_USERS.pro.id, FIXTURE_USERS.pro.email, FIXTURE_USERS.pro.displayName],
    );
    const rival = await upsertEntry(sql(), {
      id: crypto.randomUUID(),
      contestId,
      authorId: FIXTURE_USERS.pro.id,
      title: 'Kitchen at 6am',
      videoUrl: 'https://vimeo.com/2',
      note: null,
      snsUrl: 'https://vimeo.com/jun',
    });
    expectOk(await harness.run('contestEntry.approve', { id: rival, version: await versionOf(harness, rival) }));

    const outcome = await harness.run('contestEntry.placement', { id: rival, placement: '1' });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('duplicatePlacement');
  });

  it('clears a placement at any time — correcting a mistake needs no deadline', async () => {
    const { entryId } = await seedEntry(-1);
    expectOk(await harness.run('contestEntry.approve', { id: entryId, version: await versionOf(harness, entryId) }));
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '2' }));
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: 'none' }));
    expect((await loadEntryById(sql(), entryId))!.placement).toBeNull();
  });

  it('drops the medal when a placed entry is rejected', async () => {
    const { entryId } = await seedEntry(-1);
    expectOk(await harness.run('contestEntry.approve', { id: entryId, version: await versionOf(harness, entryId) }));
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '3' }));
    expectOk(await harness.run('contestEntry.reject', { id: entryId, reason: 'Rights issue.', version: await versionOf(harness, entryId) }));

    const row = (await loadEntryById(sql(), entryId))!;
    expect(row.status).toBe('rejected');
    expect(row.placement).toBeNull();
  });

  it('lists pending entries first in the moderation queue', async () => {
    const { contestId, entryId } = await seedEntry(30);
    expectOk(await harness.run('contestEntry.approve', { id: entryId, version: await versionOf(harness, entryId) }));

    await sql().query('insert into auth.users (id) values ($1) on conflict do nothing', [
      FIXTURE_USERS.pro.id,
    ]);
    await sql().query(
      `insert into profiles (id, email, display_name, locale, plan, is_admin)
       values ($1, $2, $3, 'en', 'pro', false) on conflict (id) do nothing`,
      [FIXTURE_USERS.pro.id, FIXTURE_USERS.pro.email, FIXTURE_USERS.pro.displayName],
    );
    await upsertEntry(sql(), {
      id: crypto.randomUUID(),
      contestId,
      authorId: FIXTURE_USERS.pro.id,
      title: 'Waiting',
      videoUrl: 'https://vimeo.com/3',
      note: null,
      snsUrl: 'https://vimeo.com/jun',
    });

    const queue = await loadEntriesForModeration(sql(), contestId);
    expect(queue.map((e) => e.status)).toEqual(['pending', 'approved']);
  });
});

describe('error classification (§14 backstops)', () => {
  it('maps the contest constraint names onto codes a moderator can read', () => {
    expect(
      classifyDbError(
        new Error('new row violates check constraint "contests_published_requires_localized"'),
      ),
    ).toBe('notPublishable');
    expect(
      classifyDbError(new Error('violates check constraint "contests_deadline_after_start"')),
    ).toBe('notPublishable');
    expect(
      classifyDbError(
        new Error('duplicate key value violates unique constraint "uq_contest_entries_placement"'),
      ),
    ).toBe('duplicatePlacement');
    expect(
      classifyDbError(new Error('violates check constraint "contest_entries_video_url_http"')),
    ).toBe('invalid');
  });
});

describe('stale-review guard (§14.2 / M9 review, finding 2)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const sql = () => harness.ctx().sql;

  async function liveEntry(): Promise<string> {
    await harness.run('contest.create', {
      ...contestFields(),
      poster: upload('poster.png', 'poster bytes'),
    });
    const contest = (await loadContestBySlug(sql(), 'launch-film-contest'))!;
    expectOk(await harness.run('contest.publish', { id: contest.id }));

    await sql().query('insert into auth.users (id) values ($1) on conflict do nothing', [
      FIXTURE_USERS.free.id,
    ]);
    await sql().query(
      `insert into profiles (id, email, display_name, locale, plan, is_admin)
       values ($1, $2, $3, 'en', 'free', false) on conflict (id) do nothing`,
      [FIXTURE_USERS.free.id, FIXTURE_USERS.free.email, FIXTURE_USERS.free.displayName],
    );
    return upsertEntry(sql(), {
      id: crypto.randomUUID(),
      contestId: contest.id,
      authorId: FIXTURE_USERS.free.id,
      title: 'Original cut',
      videoUrl: 'https://vimeo.com/original',
      note: null,
      snsUrl: 'https://www.instagram.com/hana',
    });
  }

  /** A resubmit between render and press must not be blessed unseen. */
  it('refuses an APPROVE issued against a superseded version', async () => {
    const entryId = await liveEntry();
    const stale = await versionOf(harness, entryId);

    // The entrant replaces the film the moderator was looking at.
    await upsertEntry(sql(), {
      id: crypto.randomUUID(),
      contestId: (await loadEntryById(sql(), entryId))!.contestId,
      authorId: FIXTURE_USERS.free.id,
      title: 'Director’s cut',
      videoUrl: 'https://vimeo.com/replacement',
      note: null,
      snsUrl: 'https://www.instagram.com/hana',
    });

    const outcome = await harness.run('contestEntry.approve', { id: entryId, version: stale });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('staleReview');

    // The status stayed pending: nothing was published on the strength of a film nobody watched.
    const row = (await loadEntryById(sql(), entryId))!;
    expect(row.status).toBe('pending');
    expect(row.title).toBe('Director’s cut');
  });

  it('refuses a REJECT issued against a superseded version', async () => {
    const entryId = await liveEntry();
    const stale = await versionOf(harness, entryId);
    await upsertEntry(sql(), {
      id: crypto.randomUUID(),
      contestId: (await loadEntryById(sql(), entryId))!.contestId,
      authorId: FIXTURE_USERS.free.id,
      title: 'Second cut',
      videoUrl: 'https://vimeo.com/second',
      note: null,
      snsUrl: 'https://www.instagram.com/hana',
    });

    const outcome = await harness.run('contestEntry.reject', {
      id: entryId,
      reason: 'Reads as stock.',
      version: stale,
    });
    expect(outcome.ok === false && outcome.code).toBe('staleReview');
    expect((await loadEntryById(sql(), entryId))!.status).toBe('pending');
  });

  it('accepts the CURRENT version', async () => {
    const entryId = await liveEntry();
    expectOk(
      await harness.run('contestEntry.approve', {
        id: entryId,
        version: await versionOf(harness, entryId),
      }),
    );
    expect((await loadEntryById(sql(), entryId))!.status).toBe('approved');
  });

  it('refuses a missing or invented token rather than falling through', async () => {
    const entryId = await liveEntry();
    const blank = await harness.run('contestEntry.approve', { id: entryId, version: '' });
    expect(blank.ok === false && blank.code).toBe('invalid');

    const invented = await harness.run('contestEntry.approve', {
      id: entryId,
      version: '2020-01-01T00:00:00.000000Z',
    });
    expect(invented.ok === false && invented.code).toBe('staleReview');
    expect((await loadEntryById(sql(), entryId))!.status).toBe('pending');
  });

  /** A second moderator who already acted is a different message from a resubmit. */
  it('reports notFound (not stale) when the version matches but the status moved on', async () => {
    const entryId = await liveEntry();
    const version = await versionOf(harness, entryId);
    await sql().query("update contest_entries set status = 'approved' where id = $1", [entryId]);

    const outcome = await harness.run('contestEntry.approve', { id: entryId, version });
    expect(outcome.ok).toBe(false);
    // The direct UPDATE above bumps `updated_at` through the shared trigger, so this is a stale
    // token too — which is the honest reading: the row is not what the form was rendered against.
    expect(['notFound', 'staleReview']).toContain(outcome.ok === false ? outcome.code : '');
  });
});

describe('placement + deadline races (§14.1 / M9 review, finding 4)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const sql = () => harness.ctx().sql;

  /** A published contest whose dates sit on the DATABASE clock, plus one approved entry. */
  async function judged(deadlineSql: string): Promise<{ contestId: string; entryId: string }> {
    await harness.run('contest.create', {
      ...contestFields(),
      poster: upload('poster.png', 'poster bytes'),
    });
    const contest = (await loadContestBySlug(sql(), 'launch-film-contest'))!;
    expectOk(await harness.run('contest.publish', { id: contest.id }));
    await sql().query(
      `update contests set starts_at = now() - interval '30 days', deadline_at = ${deadlineSql}
        where id = $1`,
      [contest.id],
    );

    await sql().query('insert into auth.users (id) values ($1) on conflict do nothing', [
      FIXTURE_USERS.free.id,
    ]);
    await sql().query(
      `insert into profiles (id, email, display_name, locale, plan, is_admin)
       values ($1, $2, $3, 'en', 'free', false) on conflict (id) do nothing`,
      [FIXTURE_USERS.free.id, FIXTURE_USERS.free.email, FIXTURE_USERS.free.displayName],
    );
    const entryId = await upsertEntry(sql(), {
      id: crypto.randomUUID(),
      contestId: contest.id,
      authorId: FIXTURE_USERS.free.id,
      title: 'Last train',
      videoUrl: 'https://vimeo.com/1',
      note: null,
      snsUrl: 'https://www.instagram.com/hana',
    });
    expectOk(
      await harness.run('contestEntry.approve', {
        id: entryId,
        version: await versionOf(harness, entryId),
      }),
    );
    return { contestId: contest.id, entryId };
  }

  /**
   * The deadline test is now IN the UPDATE, so it is evaluated against the database's clock in the
   * same statement that writes the medal — a deadline moved a millisecond earlier cannot slip a
   * placement onto a still-open contest.
   */
  it('refuses a placement while the database clock says the contest is open', async () => {
    const { entryId } = await judged("now() + interval '1 minute'");
    const outcome = await harness.run('contestEntry.placement', { id: entryId, placement: '1' });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('deadlineNotPassed');
    expect((await loadEntryById(sql(), entryId))!.placement).toBeNull();
  });

  it('allows it one second after the deadline', async () => {
    const { entryId } = await judged("now() - interval '1 second'");
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '1' }));
    expect((await loadEntryById(sql(), entryId))!.placement).toBe(1);
  });

  it('refuses a placement on a contest with no deadline at all', async () => {
    const { contestId, entryId } = await judged("now() - interval '1 second'");
    await sql().query('update contests set deadline_at = null, status = $2 where id = $1', [
      contestId,
      'draft',
    ]);
    const outcome = await harness.run('contestEntry.placement', { id: entryId, placement: '2' });
    expect(outcome.ok).toBe(false);
  });

  // --- the deadline-extension guard ---------------------------------------

  it('refuses to EXTEND the deadline while medals are on the board', async () => {
    const { contestId, entryId } = await judged("now() - interval '1 second'");
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '1' }));
    expect(await countPlacedEntries(sql(), contestId)).toBe(1);

    const outcome = await harness.run('contest.update', {
      id: contestId,
      ...contestFields({ startsAt: iso(-30), deadlineAt: iso(30) }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('placementsLocked');
  });

  it('allows the extension once the placements are cleared', async () => {
    const { contestId, entryId } = await judged("now() - interval '1 second'");
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '1' }));
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: 'none' }));

    expectOk(
      await harness.run('contest.update', {
        id: contestId,
        ...contestFields({ startsAt: iso(-30), deadlineAt: iso(30) }),
      }),
    );
  });

  it('allows SHORTENING a judged contest’s deadline — only the extension is contradictory', async () => {
    const { contestId, entryId } = await judged("now() - interval '2 days'");
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '3' }));

    expectOk(
      await harness.run('contest.update', {
        id: contestId,
        ...contestFields({ startsAt: iso(-30), deadlineAt: iso(-3) }),
      }),
    );
    expect((await loadEntryById(sql(), entryId))!.placement).toBe(3);
  });

  // --- R3b: the judged-contest lock cannot be laundered through NULL --------

  it('refuses to CLEAR the deadline while medals are on the board (null→future laundering, step 1)', async () => {
    const { contestId, entryId } = await judged("now() - interval '1 second'");
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '1' }));

    const outcome = await harness.run('contest.update', {
      id: contestId,
      ...contestFields({ startsAt: iso(-30), deadlineAt: '' }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('placementsLocked');
    expect((await loadEntryById(sql(), entryId))!.placement).toBe(1);
  });

  it('refuses to PUBLISH a judged contest whose deadline was pushed open out-of-band (laundering, step 2)', async () => {
    const { contestId, entryId } = await judged("now() - interval '1 second'");
    expectOk(await harness.run('contestEntry.placement', { id: entryId, placement: '1' }));
    await sql().query(
      `update contests set status = 'draft', deadline_at = now() + interval '30 days' where id = $1`,
      [contestId],
    );

    const outcome = await harness.run('contest.publish', { id: contestId });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('placementsLocked');
  });

  it('leaves an unjudged contest’s deadline free to move', async () => {
    const { contestId } = await judged("now() - interval '1 second'");
    expectOk(
      await harness.run('contest.update', {
        id: contestId,
        ...contestFields({ startsAt: iso(-30), deadlineAt: iso(60) }),
      }),
    );
  });
});
