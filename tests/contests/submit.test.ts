import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countRecentEntryWrites,
  loadEntryByAuthor,
  loadProfileSnsUrl,
  setEntryPlacement,
} from '@/lib/contests/repo';
import { isRateLimited, loadEntryFormState, submitEntry } from '@/lib/contests/submit';
import { ENTRY_WRITES_PER_DAY, RATE_WINDOW_HOURS } from '@/lib/contests/schemas';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import {
  ANON,
  contestHarness,
  entrantViewer,
  makeContest,
  NOW,
  type ContestHarness,
} from '../helpers/contests';

/**
 * PLAN §14.1/§14.2 — the entry path.
 *
 * Every assertion here is about something the SERVER decides and the form cannot: who the author
 * is, what status the row is born in, whether the clock still allows a write, whether there is any
 * quota left, and what happens to a medal when the film under it is replaced.
 */

const entrant = entrantViewer('free');
const other = entrantViewer('pro');

const input = (overrides: Partial<Parameters<typeof submitEntry>[3]> = {}) => ({
  title: 'Last train, Yeongdeungpo',
  videoUrl: 'https://www.youtube.com/watch?v=abc',
  snsUrl: 'https://www.instagram.com/hana.films',
  note: 'Shot entirely from the neon-alley prompt.',
  consent: true,
  ...overrides,
});

describe('rate limit (§14.1 — ≤10 entry writes/day/user)', () => {
  it('lets the first ten through and refuses the eleventh', () => {
    expect(ENTRY_WRITES_PER_DAY).toBe(10);
    expect(RATE_WINDOW_HOURS).toBe(24);
    expect([0, 9].map((n) => isRateLimited(n))).toEqual([false, false]);
    expect([10, 11, 99].map((n) => isRateLimited(n))).toEqual([true, true, true]);
  });
});

describe('submitEntry (§14.1)', () => {
  let harness: ContestHarness;
  const deps = () => ({ sql: harness.sql, now: NOW });

  beforeEach(async () => {
    harness = await contestHarness();
  });
  afterEach(async () => harness.close());

  const openContest = () =>
    makeContest(harness, { slug: 'open-now', startsInDays: -2, deadlineInDays: 7 });

  it('creates a PENDING entry owned by the session user', async () => {
    const { id } = await openContest();
    const result = await submitEntry(deps(), entrant, 'open-now', input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resubmitted).toBe(false);

    const row = (await loadEntryByAuthor(harness.sql, id, FIXTURE_USERS.free.id))!;
    expect(row.status).toBe('pending');
    expect(row.authorId).toBe(FIXTURE_USERS.free.id);
    expect(row.placement).toBeNull();
    expect(row.rejectReason).toBeNull();
  });

  it('refuses an anonymous entry before it validates anything', async () => {
    await openContest();
    expect(await submitEntry(deps(), ANON, 'open-now', input())).toEqual({
      ok: false,
      code: 'sign_in_required',
    });
  });

  it('refuses an entry to a DRAFT contest — a draft has no entry form', async () => {
    await makeContest(harness, { slug: 'secret', status: 'draft', deadlineInDays: 30 });
    const result = await submitEntry(deps(), entrant, 'secret', input());
    expect(result).toEqual({ ok: false, code: 'not_found' });
  });

  it('refuses an entry to an unknown contest', async () => {
    expect(await submitEntry(deps(), entrant, 'nope', input())).toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  // --- the deadline, server-enforced (§14.1) --------------------------------

  it('refuses an entry after the deadline', async () => {
    await makeContest(harness, { slug: 'past', startsInDays: -30, deadlineInDays: -1 });
    const result = await submitEntry(deps(), entrant, 'past', input());
    expect(result).toMatchObject({ ok: false, code: 'not_open', detail: 'closed' });
  });

  it('refuses an entry before the contest opens', async () => {
    await makeContest(harness, { slug: 'soon', startsInDays: 3, deadlineInDays: 30 });
    const result = await submitEntry(deps(), entrant, 'soon', input());
    expect(result).toMatchObject({ ok: false, code: 'not_open', detail: 'upcoming' });
  });

  it('refuses at the exact deadline instant, and accepts one millisecond earlier', async () => {
    const { slug } = await makeContest(harness, { startsInDays: -10, deadlineInDays: 1 });
    const deadline = NOW + 24 * 60 * 60 * 1000;

    const late = await submitEntry({ sql: harness.sql, now: deadline }, entrant, slug, input());
    expect(late.ok).toBe(false);

    const inTime = await submitEntry({ sql: harness.sql, now: deadline - 1 }, entrant, slug, input());
    expect(inTime.ok).toBe(true);
  });

  // --- validation ----------------------------------------------------------

  it('refuses an unconsented entry and writes nothing', async () => {
    const { id } = await openContest();
    const result = await submitEntry(deps(), entrant, 'open-now', input({ consent: false }));
    expect(result.ok === false && result.code).toBe('invalid');
    expect(await loadEntryByAuthor(harness.sql, id, FIXTURE_USERS.free.id)).toBeNull();
  });

  it('refuses a javascript: film link', async () => {
    await openContest();
    const result = await submitEntry(
      deps(),
      entrant,
      'open-now',
      input({ videoUrl: 'javascript:alert(1)' }),
    );
    expect(result.ok === false && result.code).toBe('invalid');
  });

  it('refuses a missing SNS link — it is the requirement §14 exists for', async () => {
    await openContest();
    const result = await submitEntry(deps(), entrant, 'open-now', input({ snsUrl: '' }));
    expect(result.ok === false && result.code).toBe('invalid');
  });

  it('treats a blank note as no note rather than an empty string', async () => {
    const { id } = await openContest();
    await submitEntry(deps(), entrant, 'open-now', input({ note: '   ' }));
    const row = (await loadEntryByAuthor(harness.sql, id, FIXTURE_USERS.free.id))!;
    expect(row.note).toBeNull();
  });

  // --- resubmit (§14.1: replaces + resets to pending) -----------------------

  it('REPLACES an existing entry rather than adding a second one', async () => {
    const { id } = await openContest();
    const first = await submitEntry(deps(), entrant, 'open-now', input({ title: 'First cut' }));
    const second = await submitEntry(deps(), entrant, 'open-now', input({ title: 'Second cut' }));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.id).toBe(first.id);
    expect(second.resubmitted).toBe(true);

    const { rows } = await harness.sql.query<{ n: number }>(
      'select count(*)::int as n from contest_entries where contest_id = $1',
      [id],
    );
    expect(rows[0]?.n).toBe(1);

    const row = (await loadEntryByAuthor(harness.sql, id, FIXTURE_USERS.free.id))!;
    expect(row.title).toBe('Second cut');
  });

  it('resets an APPROVED entry to pending and clears its placement', async () => {
    const { id } = await openContest();
    const first = await submitEntry(deps(), entrant, 'open-now', input());
    if (!first.ok) throw new Error('setup failed');

    await harness.sql.query("update contest_entries set status = 'approved' where id = $1", [first.id]);
    await setEntryPlacement(harness.sql, first.id, 1);

    await submitEntry(deps(), entrant, 'open-now', input({ title: 'Director’s cut' }));

    const row = (await loadEntryByAuthor(harness.sql, id, FIXTURE_USERS.free.id))!;
    expect(row.status).toBe('pending');
    // A medal belongs to a film, not to a slot: the replaced entry is not the entry that won.
    expect(row.placement).toBeNull();
  });

  it('clears a rejection when the entrant tries again', async () => {
    const { id } = await openContest();
    const first = await submitEntry(deps(), entrant, 'open-now', input());
    if (!first.ok) throw new Error('setup failed');
    await harness.sql.query(
      "update contest_entries set status = 'rejected', reject_reason = 'stock footage' where id = $1",
      [first.id],
    );

    await submitEntry(deps(), entrant, 'open-now', input({ title: 'Actually mine' }));
    const row = (await loadEntryByAuthor(harness.sql, id, FIXTURE_USERS.free.id))!;
    expect(row.status).toBe('pending');
    expect(row.rejectReason).toBeNull();
  });

  it('keeps two different entrants in two different rows', async () => {
    const { id } = await openContest();
    await submitEntry(deps(), entrant, 'open-now', input({ title: 'Mine' }));
    await submitEntry(deps(), other, 'open-now', input({ title: 'Theirs' }));

    const { rows } = await harness.sql.query<{ n: number }>(
      'select count(*)::int as n from contest_entries where contest_id = $1',
      [id],
    );
    expect(rows[0]?.n).toBe(2);
  });

  // --- rate limit ----------------------------------------------------------

  it('refuses the ELEVENTH write inside the window, counting resubmits', async () => {
    await openContest();
    for (let n = 0; n < ENTRY_WRITES_PER_DAY; n += 1) {
      const result = await submitEntry(deps(), entrant, 'open-now', input({ title: `Cut ${n}` }));
      expect(result.ok, `write ${n}`).toBe(true);
    }
    const eleventh = await submitEntry(deps(), entrant, 'open-now', input({ title: 'One too many' }));
    expect(eleventh.ok).toBe(false);
    expect(eleventh.ok === false && eleventh.code).toBe('rate_limited');

    // The ledger is what makes "writes" countable at all — the entry row is a single upsert.
    expect(await countRecentEntryWrites(harness.sql, FIXTURE_USERS.free.id, RATE_WINDOW_HOURS)).toBe(
      ENTRY_WRITES_PER_DAY,
    );
    const { rows } = await harness.sql.query<{ n: number }>(
      'select count(*)::int as n from contest_entries where author_id = $1',
      [FIXTURE_USERS.free.id],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('does not spend another entrant’s quota', async () => {
    await openContest();
    for (let n = 0; n < ENTRY_WRITES_PER_DAY; n += 1) {
      await submitEntry(deps(), entrant, 'open-now', input({ title: `Cut ${n}` }));
    }
    expect((await submitEntry(deps(), other, 'open-now', input())).ok).toBe(true);
  });

  it('does not spend quota on a refused write', async () => {
    await openContest();
    await submitEntry(deps(), entrant, 'open-now', input({ consent: false }));
    await submitEntry(deps(), entrant, 'open-now', input({ videoUrl: 'nope' }));
    expect(await countRecentEntryWrites(harness.sql, FIXTURE_USERS.free.id, RATE_WINDOW_HOURS)).toBe(0);
  });

  // --- profiles.sns_url prefill + write-back (§14.1) ------------------------

  it('writes the SNS link back to the profile', async () => {
    await openContest();
    expect(await loadProfileSnsUrl(harness.sql, FIXTURE_USERS.free.id)).toBeNull();

    await submitEntry(deps(), entrant, 'open-now', input());
    expect(await loadProfileSnsUrl(harness.sql, FIXTURE_USERS.free.id)).toBe(
      'https://www.instagram.com/hana.films',
    );
  });

  it('does not write the profile back when the entry was refused', async () => {
    await openContest();
    await submitEntry(deps(), entrant, 'open-now', input({ consent: false }));
    expect(await loadProfileSnsUrl(harness.sql, FIXTURE_USERS.free.id)).toBeNull();
  });

  it('updates the profile when a corrected link is submitted', async () => {
    await openContest();
    await submitEntry(deps(), entrant, 'open-now', input());
    await submitEntry(
      deps(),
      entrant,
      'open-now',
      input({ snsUrl: 'https://www.tiktok.com/@hana' }),
    );
    expect(await loadProfileSnsUrl(harness.sql, FIXTURE_USERS.free.id)).toBe(
      'https://www.tiktok.com/@hana',
    );
  });
});

describe('loadEntryFormState — what the form renders before anything is typed (§14.2)', () => {
  let harness: ContestHarness;
  const deps = () => ({ sql: harness.sql, now: NOW });

  beforeEach(async () => {
    harness = await contestHarness();
  });
  afterEach(async () => harness.close());

  it('prefills the SNS field from the profile on a first entry', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -2, deadlineInDays: 7 });
    await harness.sql.query('update profiles set sns_url = $2 where id = $1', [
      FIXTURE_USERS.free.id,
      'https://www.instagram.com/from-profile',
    ]);

    const state = (await loadEntryFormState(deps(), 'open-now', FIXTURE_USERS.free.id))!;
    expect(state.existing).toBeNull();
    expect(state.snsPrefill).toBe('https://www.instagram.com/from-profile');
    expect(state.open).toBe(true);
  });

  /** The entry's own link is the more recent statement of the same fact, so it wins. */
  it('prefers the existing entry’s SNS over the profile’s', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -2, deadlineInDays: 7 });
    await harness.sql.query('update profiles set sns_url = $2 where id = $1', [
      FIXTURE_USERS.free.id,
      'https://www.instagram.com/stale',
    ]);
    await submitEntry(deps(), entrant, 'open-now', input({ snsUrl: 'https://www.tiktok.com/@fresh' }));

    const state = (await loadEntryFormState(deps(), 'open-now', FIXTURE_USERS.free.id))!;
    expect(state.existing?.title).toBe('Last train, Yeongdeungpo');
    expect(state.snsPrefill).toBe('https://www.tiktok.com/@fresh');
  });

  it('reports the phase so the page can render the closed state', async () => {
    await makeContest(harness, { slug: 'past', startsInDays: -30, deadlineInDays: -1 });
    const state = (await loadEntryFormState(deps(), 'past', FIXTURE_USERS.free.id))!;
    expect(state.open).toBe(false);
  });

  it('is null for a draft contest — the form 404s with the detail page', async () => {
    await makeContest(harness, { slug: 'secret', status: 'draft', deadlineInDays: 30 });
    expect(await loadEntryFormState(deps(), 'secret', FIXTURE_USERS.free.id)).toBeNull();
  });

  it('renders for a signed-out reader without inventing a prefill', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -2, deadlineInDays: 7 });
    const state = (await loadEntryFormState(deps(), 'open-now', null))!;
    expect(state.existing).toBeNull();
    expect(state.snsPrefill).toBeNull();
  });
});
