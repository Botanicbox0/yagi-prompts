import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shapeContestDetail, shapeContestPreview } from '@/lib/contests/access';
import { upsertEntry } from '@/lib/contests/repo';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { contestHarness, makeContest, NOW, type ContestHarness } from '../helpers/contests';

/**
 * PLAN §14.2 — the detail gate.
 *
 * Two rules, and they are different in kind:
 *   · a CONTEST's existence is a status question (published only, on the public route, for
 *     everyone) — §14.1 makes publishing the founder's deliberate act, so a draft that anyone
 *     holding the URL could read would defeat it;
 *   · an ENTRY's visibility is a moderation question, not a tier question.
 *
 * The entry projection's key set is pinned here for the same reason the card's is pinned in
 * `catalog.test.ts`: it IS the disclosure, and a spread would quietly widen it.
 */

const EXPECTED_ENTRY_KEYS = [
  'createdAt',
  'handle',
  'id',
  'note',
  'placement',
  'platform',
  'snsUrl',
  'title',
  'videoUrl',
].sort();

async function addEntry(
  harness: ContestHarness,
  contestId: string,
  key: 'free' | 'pro' | 'admin',
  status: 'pending' | 'approved' | 'rejected',
  extra: { placement?: number; title?: string } = {},
): Promise<string> {
  const id = await upsertEntry(harness.sql, {
    id: crypto.randomUUID(),
    contestId,
    authorId: FIXTURE_USERS[key].id,
    title: extra.title ?? `${key} film`,
    videoUrl: `https://vimeo.com/${key}`,
    note: `${key} note`,
    snsUrl: `https://www.instagram.com/${key}handle`,
  });
  if (status === 'approved') {
    await harness.sql.query(
      'update contest_entries set status = $2, placement = $3 where id = $1',
      [id, 'approved', extra.placement ?? null],
    );
  } else if (status === 'rejected') {
    await harness.sql.query(
      "update contest_entries set status = 'rejected', reject_reason = 'stock footage' where id = $1",
      [id],
    );
  }
  return id;
}

describe('shapeContestDetail (§14.2)', () => {
  let harness: ContestHarness;
  const deps = () => ({ sql: harness.sql, now: NOW });

  beforeEach(async () => {
    harness = await contestHarness();
  });
  afterEach(async () => harness.close());

  it('resolves a published contest with its derived timing', async () => {
    await makeContest(harness, { slug: 'live', startsInDays: -2, deadlineInDays: 7 });
    const result = await shapeContestDetail(deps(), 'live');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.contest.timing.phase).toBe('open');
    expect(result.contest.timing.dDay).toBe('D-7');
    expect(result.contest.preview).toBe(false);
  });

  it('404s a DRAFT for everyone — the public route has no admin branch', async () => {
    await makeContest(harness, { slug: 'secret', status: 'draft', deadlineInDays: 10 });
    expect(await shapeContestDetail(deps(), 'secret')).toEqual({ status: 'not_found' });
  });

  it('404s an archived contest and an unknown slug', async () => {
    await makeContest(harness, { slug: 'gone', status: 'archived', deadlineInDays: 10 });
    expect(await shapeContestDetail(deps(), 'gone')).toEqual({ status: 'not_found' });
    expect(await shapeContestDetail(deps(), 'no-such-contest')).toEqual({ status: 'not_found' });
  });

  it('publishes APPROVED entries only, with exactly the display fields', async () => {
    const { id } = await makeContest(harness, { slug: 'entries', startsInDays: -2, deadlineInDays: 7 });
    await addEntry(harness, id, 'free', 'approved', { title: 'Approved film' });
    await addEntry(harness, id, 'pro', 'pending', { title: 'Pending film' });
    await addEntry(harness, id, 'admin', 'rejected', { title: 'Rejected film' });

    const result = await shapeContestDetail(deps(), 'entries');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.contest.entries.map((e) => e.title)).toEqual(['Approved film']);
    expect(Object.keys(result.contest.entries[0]!).sort()).toEqual(EXPECTED_ENTRY_KEYS);

    // Nothing about the other two reaches the payload — not their titles, not their reject reason.
    const serialised = JSON.stringify(result.contest);
    for (const forbidden of ['Pending film', 'Rejected film', 'stock footage', 'author_id', 'status']) {
      expect(serialised.includes(forbidden), forbidden).toBe(false);
    }
  });

  it('derives the platform chip and the handle from the SNS link', async () => {
    const { id } = await makeContest(harness, { slug: 'chips', startsInDays: -2, deadlineInDays: 7 });
    await addEntry(harness, id, 'free', 'approved');

    const result = await shapeContestDetail(deps(), 'chips');
    if (result.status !== 'ok') throw new Error('expected ok');
    const entry = result.contest.entries[0]!;
    expect(entry.platform).toBe('instagram');
    expect(entry.handle).toBe('@freehandle');
  });

  it('orders entries by placement, and mirrors the placed ones into `winners`', async () => {
    const { id } = await makeContest(harness, { slug: 'podium', startsInDays: -30, deadlineInDays: -1 });
    await addEntry(harness, id, 'free', 'approved', { title: 'Third', placement: 3 });
    await addEntry(harness, id, 'pro', 'approved', { title: 'First', placement: 1 });
    await addEntry(harness, id, 'admin', 'approved', { title: 'Unplaced' });

    const result = await shapeContestDetail(deps(), 'podium');
    if (result.status !== 'ok') throw new Error('expected ok');

    expect(result.contest.entries.map((e) => e.title)).toEqual(['First', 'Third', 'Unplaced']);
    expect(result.contest.winners.map((e) => e.placement)).toEqual([1, 3]);
    expect(result.contest.timing.phase).toBe('closed');
  });

  it('has no winners strip when nothing has been placed', async () => {
    const { id } = await makeContest(harness, { slug: 'nowinners', startsInDays: -2, deadlineInDays: 7 });
    await addEntry(harness, id, 'free', 'approved');
    const result = await shapeContestDetail(deps(), 'nowinners');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.contest.winners).toEqual([]);
  });
});

describe('shapeContestPreview — the admin path (§14.2)', () => {
  let harness: ContestHarness;
  const deps = () => ({ sql: harness.sql, now: NOW });

  beforeEach(async () => {
    harness = await contestHarness();
  });
  afterEach(async () => harness.close());

  it('renders a draft and stamps `preview` so the page can say so', async () => {
    await makeContest(harness, { slug: 'secret', status: 'draft', startsInDays: 1, deadlineInDays: 30 });
    const result = await shapeContestPreview(deps(), 'secret');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.contest.preview).toBe(true);
    expect(result.contest.timing.phase).toBe('upcoming');
  });

  it('does NOT stamp preview on a published contest — the badge would be a lie', async () => {
    await makeContest(harness, { slug: 'live', startsInDays: -1, deadlineInDays: 7 });
    const result = await shapeContestPreview(deps(), 'live');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.contest.preview).toBe(false);
  });

  it('still 404s an unknown slug', async () => {
    expect(await shapeContestPreview(deps(), 'nope')).toEqual({ status: 'not_found' });
  });

  /** Even in preview, a pending entry is not shown as if it were in. */
  it('shows approved entries only, exactly like the public page', async () => {
    const { id } = await makeContest(harness, { slug: 'secret', status: 'draft', deadlineInDays: 30 });
    await addEntry(harness, id, 'free', 'approved', { title: 'In' });
    await addEntry(harness, id, 'pro', 'pending', { title: 'Waiting' });

    const result = await shapeContestPreview(deps(), 'secret');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.contest.entries.map((e) => e.title)).toEqual(['In']);
  });
});
