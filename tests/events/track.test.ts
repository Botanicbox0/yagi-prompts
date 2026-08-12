import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { EVENT_TYPES, isEventType, recordEvent } from '@/lib/events/track';
import { BEACON_TYPES, parseBeacon } from '@/lib/events/beacon';
import { billingDb, USER, seedProfile, type BillingHarness } from '../helpers/billing';

/**
 * PLAN §3.4 / §6 — the funnel.
 *
 * Two properties, and both are about what CANNOT happen: an event type outside the five never
 * reaches the database (the CHECK constraint is the backstop, not the gate), and a failing insert
 * never reaches the caller. Analytics that can break a render is worse than no analytics.
 */

interface EventRow {
  type: string;
  user_id: string | null;
  playbook_id: string | null;
  meta: Record<string, string> | null;
}

describe('recordEvent (§6 events)', () => {
  let harness: BillingHarness;
  let sql: SqlRunner;

  beforeAll(async () => {
    harness = await billingDb();
    sql = harness.sql;
    await seedProfile(sql, { id: USER.buyer });
  });
  afterAll(async () => harness.close());

  beforeEach(async () => {
    await sql.query('delete from events');
  });

  const rows = async () =>
    (await sql.query<EventRow>('select type, user_id, playbook_id, meta from events order by id'))
      .rows;

  /**
   * §6 shipped five; §13.2's copy endpoint added the sixth together with migration 0006. The
   * literal union and the CHECK constraint have to move as ONE change — this assertion is what
   * makes forgetting the migration a red test rather than a runtime constraint violation on a
   * fire-and-forget insert nobody would see fail.
   */
  it('carries exactly the six types §6 + §13.2 allow', () => {
    expect([...EVENT_TYPES]).toEqual([
      'view_playbook',
      'hit_lock',
      'start_checkout',
      'unlock_success',
      'hire_click',
      'copy_prompt',
    ]);
  });

  it('inserts an anonymous event with a null user', async () => {
    expect(await recordEvent(sql, { type: 'view_playbook', userId: null })).toBe(true);
    expect(await rows()).toEqual([
      { type: 'view_playbook', user_id: null, playbook_id: null, meta: null },
    ]);
  });

  it('keeps the whitelist ahead of the CHECK constraint', async () => {
    // @ts-expect-error — the literal union is the first gate; this is the runtime one.
    expect(await recordEvent(sql, { type: 'pageview' })).toBe(false);
    expect(await rows()).toHaveLength(0);
    expect(isEventType('view_playbook')).toBe(true);
    expect(isEventType('drop table')).toBe(false);
  });

  it('drops anything in meta that is not one of the three allowed keys', async () => {
    await recordEvent(sql, {
      type: 'hit_lock',
      userId: USER.buyer,
      meta: {
        slug: 'character-sheet-generation',
        surface: 'detail',
        // @ts-expect-error — the type forbids it; this asserts the runtime filter agrees.
        email: 'leak@example.com',
      },
    });
    const [row] = await rows();
    expect(row?.meta).toEqual({ slug: 'character-sheet-generation', surface: 'detail' });
    expect(JSON.stringify(row?.meta)).not.toContain('leak@example.com');
  });

  it('ignores a user or playbook id that is not a uuid rather than throwing', async () => {
    expect(await recordEvent(sql, { type: 'hire_click', userId: 'not-a-uuid' })).toBe(true);
    const [row] = await rows();
    expect(row?.user_id).toBeNull();
  });

  it('swallows an insert failure and reports it as false', async () => {
    const broken: SqlRunner = {
      async query() {
        throw new Error('connection terminated');
      },
    };
    await expect(recordEvent(broken, { type: 'view_playbook' })).resolves.toBe(false);
  });
});

describe('parseBeacon — what a browser may claim (§ M3 brief)', () => {
  it('accepts only the two client-observable moments', () => {
    expect([...BEACON_TYPES]).toEqual(['hit_lock', 'hire_click']);
    for (const type of BEACON_TYPES) {
      expect(parseBeacon({ type })).toMatchObject({ ok: true, type });
    }
  });

  it('rejects server-only event types even though they are valid events', () => {
    for (const type of ['view_playbook', 'start_checkout', 'unlock_success']) {
      expect(parseBeacon({ type }), type).toEqual({ ok: false, reason: 'bad_type' });
    }
  });

  it('rejects an unknown type and a non-object body', () => {
    expect(parseBeacon({ type: 'pageview' })).toEqual({ ok: false, reason: 'bad_type' });
    expect(parseBeacon({})).toEqual({ ok: false, reason: 'bad_type' });
    expect(parseBeacon(null)).toEqual({ ok: false, reason: 'bad_body' });
    expect(parseBeacon('hit_lock')).toEqual({ ok: false, reason: 'bad_body' });
  });

  it('keeps a real slug and drops a forged one', () => {
    expect(parseBeacon({ type: 'hit_lock', slug: 'talking-character-clip' })).toEqual({
      ok: true,
      type: 'hit_lock',
      slug: 'talking-character-clip',
      surface: null,
    });
    // A caller cannot smuggle an id, a path or anything else through the slug field.
    for (const bad of ['../../etc', 'UPPER', 'a'.repeat(200), 42, { x: 1 }]) {
      const parsed = parseBeacon({ type: 'hit_lock', slug: bad });
      expect(parsed).toMatchObject({ ok: true, slug: null });
    }
  });

  it('only accepts a surface from the closed vocabulary', () => {
    expect(parseBeacon({ type: 'hire_click', surface: 'footer' })).toMatchObject({
      surface: 'footer',
    });
    expect(parseBeacon({ type: 'hire_click', surface: 'wherever' })).toMatchObject({
      surface: null,
    });
  });

  it('has no field in which a user id could arrive', () => {
    const parsed = parseBeacon({
      type: 'hit_lock',
      userId: 'f0000000-0000-4000-8000-000000000002',
      email: 'x@y.z',
    });
    expect(parsed).toEqual({ ok: true, type: 'hit_lock', slug: null, surface: null });
  });
});
