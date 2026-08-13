import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getWallet,
  grantPurchase,
  listRecentUnlocks,
  listUnlocks,
  unlockPrompt,
} from '@/lib/cookies/repo';
import {
  PACK_COOKIES,
  SIGNUP_COOKIES,
  UNLOCK_COST,
  decideUnlockPanel,
} from '@/lib/cookies/wallet';
import {
  creditCookiePack,
  isCookiePackPurchasable,
  startCookiePackPurchase,
} from '@/lib/cookies/purchase';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { expectReject } from '../helpers/pglite';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * PLAN §15.1 — the wallet, driven against a real Postgres.
 *
 * Everything here rides the §15.1-6 shape: profile row `FOR UPDATE` → idempotency check → lazy
 * weekly grant → balance guard → ledger append + unlock insert + balance write, one transaction.
 * PGlite is single-connection, so — exactly as `tests/contests/atomicity.test.ts` establishes —
 * what a race would exploit is pinned as SEMANTICS: the lock is taken first, the order is the
 * specified order, and a failure anywhere rolls the WHOLE spend back. The concurrency itself is a
 * property of `FOR UPDATE` plus `transaction()` pinning one connection (tests/db/transaction).
 */

const FREE = FIXTURE_USERS.free.id;
const GATED = 'neon-alley-dolly'; // yagi, pro — the §15 unlockable
const GATED_2 = 'handheld-market-run'; // second yagi pro item
const TEASER = 'static-portrait-window-light'; // yagi, public — nothing to buy
const COMMUNITY = 'skate-park-golden-hour'; // community — free by doctrine (§13.3-1)

describe('cookie wallet (§15.1)', () => {
  let harness: PromptHarness;
  const sql = () => harness.sql;

  beforeEach(async () => {
    harness = await promptHarness();
  });
  afterEach(async () => harness.close());

  const idOf = async (slug: string) => (await loadPromptBySlug(sql(), slug))!.id;

  const balance = async (userId = FREE) => {
    const { rows } = await sql().query<{ cookie_balance: number }>(
      'select cookie_balance from profiles where id = $1',
      [userId],
    );
    return rows[0]?.cookie_balance;
  };

  /** Pin the wallet to a known state: balance + a stamp expressed as an age (null = never read). */
  const setWallet = async (userId: string, cookieBalance: number, grantedAgo: string | null) => {
    await sql().query(
      `update profiles
          set cookie_balance = $2,
              cookies_granted_at = case when $3::text is null then null
                                        else now() - $3::interval end
        where id = $1`,
      [userId, cookieBalance, grantedAgo],
    );
  };

  const ledger = async (userId = FREE) => {
    const { rows } = await sql().query<{ delta: number; reason: string; prompt_id: string | null }>(
      'select delta, reason, prompt_id from cookie_ledger where profile_id = $1 order by id',
      [userId],
    );
    return rows;
  };

  const unlockRows = async (userId = FREE) => {
    const { rows } = await sql().query<{ prompt_id: string }>(
      'select prompt_id from prompt_unlocks where profile_id = $1',
      [userId],
    );
    return rows.map((r) => r.prompt_id);
  };

  // -------------------------------------------------------------------------
  // schema (§15.1-2)
  // -------------------------------------------------------------------------

  it('gives a fresh profile exactly the signup grant, with the weekly clock unread', async () => {
    const id = '00000000-0000-4000-8000-00000000c001';
    await sql().query('insert into auth.users (id) values ($1)', [id]);
    await sql().query(`insert into profiles (id, email) values ($1, 'new@playbook.test')`, [id]);

    const { rows } = await sql().query<{ cookie_balance: number; cookies_granted_at: string | null }>(
      'select cookie_balance, cookies_granted_at from profiles where id = $1',
      [id],
    );
    expect(rows[0]?.cookie_balance).toBe(SIGNUP_COOKIES);
    expect(rows[0]?.cookies_granted_at).toBeNull();
  });

  it('refuses a negative balance at the database (the CHECK is the last line)', async () => {
    const message = await expectReject(() =>
      sql().query('update profiles set cookie_balance = -1 where id = $1', [FREE]),
    );
    expect(message).toMatch(/profiles_cookie_balance_nonneg/);
  });

  // -------------------------------------------------------------------------
  // getWallet — the lazy weekly grant (§15.1-3)
  // -------------------------------------------------------------------------

  it('returns null for a profile that does not exist, and for a malformed id', async () => {
    expect(await getWallet(sql(), '00000000-0000-4000-8000-0000000000ff')).toBeNull();
    expect(await getWallet(sql(), 'not-a-uuid')).toBeNull();
  });

  it('does not grant when the stamp is fresh', async () => {
    await setWallet(FREE, 3, '1 hour');
    const wallet = await getWallet(sql(), FREE);
    expect(wallet?.balance).toBe(3);
    expect(await ledger()).toEqual([]);
  });

  it('grants ONE cookie on the first read of a never-read wallet (the backfill return)', async () => {
    await setWallet(FREE, 3, null);
    const wallet = await getWallet(sql(), FREE);
    expect(wallet?.balance).toBe(4);
    expect(wallet?.grantedAt).not.toBeNull();
    expect(await ledger()).toEqual([{ delta: 1, reason: 'weekly', prompt_id: null }]);
  });

  it('does not grant at six days twenty-three hours', async () => {
    await setWallet(FREE, 3, '6 days 23 hours');
    expect((await getWallet(sql(), FREE))?.balance).toBe(3);
    expect(await ledger()).toEqual([]);
  });

  it('grants exactly one at seven days, and resets the stamp', async () => {
    await setWallet(FREE, 3, '7 days');
    const wallet = await getWallet(sql(), FREE);
    expect(wallet?.balance).toBe(4);
    expect(await ledger()).toEqual([{ delta: 1, reason: 'weekly', prompt_id: null }]);

    // The stamp was RESET, not advanced: a second read straight after grants nothing.
    const again = await getWallet(sql(), FREE);
    expect(again?.balance).toBe(4);
    expect((await ledger()).length).toBe(1);
  });

  it('yields ONE grant after an absent month, not four (§15.1-3 non-accumulating)', async () => {
    await setWallet(FREE, 3, '31 days');
    expect((await getWallet(sql(), FREE))?.balance).toBe(4);
    expect((await ledger()).length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // unlockPrompt (§15.1-1, §15.1-6)
  // -------------------------------------------------------------------------

  it('spends one cookie, appends the ledger row and the unlock row — once', async () => {
    await setWallet(FREE, 3, '1 hour');
    const promptId = await idOf(GATED);

    expect(await unlockPrompt(sql(), FREE, promptId)).toBe('unlocked');
    expect(await balance()).toBe(3 - UNLOCK_COST);
    expect(await ledger()).toEqual([{ delta: -1, reason: 'unlock', prompt_id: promptId }]);
    expect(await unlockRows()).toEqual([promptId]);
  });

  it('is idempotent: a second spend on the same prompt charges nothing (§15.1-1)', async () => {
    await setWallet(FREE, 3, '1 hour');
    const promptId = await idOf(GATED);

    expect(await unlockPrompt(sql(), FREE, promptId)).toBe('unlocked');
    expect(await unlockPrompt(sql(), FREE, promptId)).toBe('alreadyUnlocked');
    expect(await balance()).toBe(2);
    expect((await ledger()).length).toBe(1);
    expect(await unlockRows()).toEqual([promptId]);
  });

  it('refuses at zero, spends nothing, and the balance never goes negative', async () => {
    await setWallet(FREE, 0, '1 hour');
    const promptId = await idOf(GATED);

    expect(await unlockPrompt(sql(), FREE, promptId)).toBe('needCookies');
    expect(await balance()).toBe(0);
    expect(await ledger()).toEqual([]);
    expect(await unlockRows()).toEqual([]);
  });

  it('applies the weekly grant inside the SAME transaction as the spend it enables', async () => {
    // Out of cookies but a week has passed: the grant lands first, then the spend — one commit.
    await setWallet(FREE, 0, '8 days');
    const promptId = await idOf(GATED);

    expect(await unlockPrompt(sql(), FREE, promptId)).toBe('unlocked');
    expect(await balance()).toBe(0);
    expect(await ledger()).toEqual([
      { delta: 1, reason: 'weekly', prompt_id: null },
      { delta: -1, reason: 'unlock', prompt_id: promptId },
    ]);
  });

  it('answers alreadyUnlocked BEFORE the weekly grant — a re-read is not a wallet read', async () => {
    await setWallet(FREE, 3, '1 hour');
    const promptId = await idOf(GATED);
    expect(await unlockPrompt(sql(), FREE, promptId)).toBe('unlocked');

    await setWallet(FREE, 2, '8 days');
    expect(await unlockPrompt(sql(), FREE, promptId)).toBe('alreadyUnlocked');
    // No weekly row appeared: the §15.1-6 order puts the idempotency check before the grant.
    expect(await balance()).toBe(2);
  });

  it('refuses everything that is not a published, gated YAGI prompt', async () => {
    await setWallet(FREE, 3, '1 hour');
    for (const slug of [COMMUNITY, TEASER]) {
      expect(await unlockPrompt(sql(), FREE, await idOf(slug)), slug).toBe('notFound');
    }
    const pending = await idOf('pending-underwater-drift');
    expect(await unlockPrompt(sql(), FREE, pending)).toBe('notFound');
    expect(await unlockPrompt(sql(), FREE, '11111111-2222-4333-8444-555555555555')).toBe('notFound');
    expect(await unlockPrompt(sql(), FREE, 'not-a-uuid')).toBe('notFound');
    // Nothing above charged anything.
    expect(await balance()).toBe(3);
    expect(await ledger()).toEqual([]);
  });

  it('refuses a viewer with no profile row, and writes nothing', async () => {
    const ghost = '00000000-0000-4000-8000-0000000000ee';
    expect(await unlockPrompt(sql(), ghost, await idOf(GATED))).toBe('notFound');
    const { rows } = await sql().query<{ n: number }>(
      'select count(*)::int as n from prompt_unlocks',
    );
    expect(rows[0]?.n).toBe(0);
  });

  // -------------------------------------------------------------------------
  // atomicity — the §15.1-6 transaction, in the contests idiom
  // -------------------------------------------------------------------------

  /** Observe (and optionally fail) every statement INSIDE the transaction — see tests/contests. */
  function spyRunner(
    base: SqlRunner,
    hook: (text: string) => Error | null = () => null,
  ): { runner: SqlRunner; statements: string[] } {
    const statements: string[] = [];
    const runner: SqlRunner = {
      query(text, params) {
        statements.push(text);
        const failure = hook(text);
        if (failure) return Promise.reject(failure);
        return base.query(text, params);
      },
      transaction: (fn) => base.transaction(() => fn(runner)),
    };
    return { runner, statements };
  }

  it('runs the spend in the specified order, profile lock first', async () => {
    await setWallet(FREE, 3, '1 hour');
    const promptId = await idOf(GATED);
    const { runner, statements } = spyRunner(sql());

    expect(await unlockPrompt(runner, FREE, promptId)).toBe('unlocked');

    const at = (needle: string) => statements.findIndex((s) => s.includes(needle));
    // 1 lock → 2 idempotency → 3 prompt check → 4 balance write → 5 ledger → 6 unlock row.
    expect(at('for update')).toBe(0);
    expect(at('from prompt_unlocks')).toBeGreaterThan(at('for update'));
    expect(at('from prompt_items')).toBeGreaterThan(at('from prompt_unlocks'));
    expect(at('cookie_balance - ')).toBeGreaterThan(at('from prompt_items'));
    expect(at('insert into cookie_ledger')).toBeGreaterThan(at('cookie_balance - '));
    expect(at('insert into prompt_unlocks')).toBeGreaterThan(at('insert into cookie_ledger'));
  });

  it('leaves ZERO rows and the full balance behind when the LAST statement fails', async () => {
    await setWallet(FREE, 3, '1 hour');
    const promptId = await idOf(GATED);
    const { runner } = spyRunner(sql(), (text) =>
      text.includes('insert into prompt_unlocks') ? new Error('connection terminated') : null,
    );

    await expect(unlockPrompt(runner, FREE, promptId)).rejects.toThrow('connection terminated');
    expect(await balance()).toBe(3);
    expect(await ledger()).toEqual([]);
    expect(await unlockRows()).toEqual([]);
  });

  it('rolls the weekly grant back with the spend that observed it', async () => {
    await setWallet(FREE, 0, '8 days');
    const promptId = await idOf(GATED);
    const { runner } = spyRunner(sql(), (text) =>
      text.includes('insert into prompt_unlocks') ? new Error('boom') : null,
    );

    await expect(unlockPrompt(runner, FREE, promptId)).rejects.toThrow('boom');
    // The +1 the transaction granted died with it — balance AND stamp are untouched.
    expect(await balance()).toBe(0);
    expect(await ledger()).toEqual([]);
    const wallet = await getWallet(sql(), FREE);
    // …which this read can prove: the grant is still due, so it fires now.
    expect(wallet?.balance).toBe(1);
  });

  /**
   * The race §15.1-6 exists for: two spends on the same last cookie. PGlite cannot interleave two
   * transactions, so the property is pinned the way the contests suite pins it — the loser of the
   * `FOR UPDATE` queue re-reads AFTER the winner committed, and what it then sees decides:
   * same prompt ⇒ 'alreadyUnlocked' (the idempotency check), different prompt ⇒ 'needCookies'
   * (the balance guard). Both refusal paths are exercised against the committed winner state.
   */
  it('a second spend against the committed winner state cannot double-spend', async () => {
    await setWallet(FREE, 1, '1 hour');
    const first = await idOf(GATED);
    const second = await idOf(GATED_2);

    expect(await unlockPrompt(sql(), FREE, first)).toBe('unlocked');
    expect(await unlockPrompt(sql(), FREE, first)).toBe('alreadyUnlocked');
    expect(await unlockPrompt(sql(), FREE, second)).toBe('needCookies');
    expect(await balance()).toBe(0);
    expect(await unlockRows()).toEqual([first]);
  });

  // -------------------------------------------------------------------------
  // listUnlocks / listRecentUnlocks
  // -------------------------------------------------------------------------

  it('answers an empty id list with an empty set and NO query', async () => {
    const poisoned: SqlRunner = {
      query: () => Promise.reject(new Error('should not query')),
      transaction: () => Promise.reject(new Error('should not transact')),
    };
    expect(await listUnlocks(poisoned, FREE, [])).toEqual(new Set());
  });

  it('returns exactly the unlocked subset', async () => {
    await setWallet(FREE, 3, '1 hour');
    const first = await idOf(GATED);
    const second = await idOf(GATED_2);
    await unlockPrompt(sql(), FREE, first);

    const unlocked = await listUnlocks(sql(), FREE, [first, second]);
    expect(unlocked).toEqual(new Set([first]));
    // Another profile sees nothing — unlocks are per (account, prompt).
    expect(await listUnlocks(sql(), FIXTURE_USERS.pro.id, [first, second])).toEqual(new Set());
  });

  it('lists recent unlocks with their titles, newest first', async () => {
    await setWallet(FREE, 3, '1 hour');
    const first = await idOf(GATED);
    await unlockPrompt(sql(), FREE, first);
    await sql().query(`update prompt_unlocks set created_at = now() - interval '1 day'`);
    const second = await idOf(GATED_2);
    await unlockPrompt(sql(), FREE, second);

    const recent = await listRecentUnlocks(sql(), FREE);
    expect(recent.map((r) => r.slug)).toEqual([GATED_2, GATED]);
    expect(recent[0]?.title).toBe('Handheld market run');
    expect(recent[0]?.status).toBe('published');
    expect(recent[0]?.createdAt).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // grantPurchase (§15.1-5) — what the M8 MoR webhook will call
  // -------------------------------------------------------------------------

  it('credits the pack and appends the purchase ledger row, transactionally', async () => {
    await setWallet(FREE, 0, '1 hour');
    expect(await grantPurchase(sql(), FREE, PACK_COOKIES, 'evt_pay_001')).toBe('credited');
    expect(await balance()).toBe(PACK_COOKIES);
    expect(await ledger()).toEqual([{ delta: PACK_COOKIES, reason: 'purchase', prompt_id: null }]);
  });

  /**
   * M10 review R1, finding 2 — webhooks REDELIVER. The provider event id is claimed under the
   * `cookie_purchase_events` primary key inside the crediting transaction, so the second delivery
   * of one payment answers 'duplicate' and the wallet moves exactly once.
   */
  it('credits one payment exactly once however many times the webhook delivers it', async () => {
    await setWallet(FREE, 0, '1 hour');
    expect(await grantPurchase(sql(), FREE, PACK_COOKIES, 'evt_pay_dup')).toBe('credited');
    expect(await grantPurchase(sql(), FREE, PACK_COOKIES, 'evt_pay_dup')).toBe('duplicate');
    expect(await grantPurchase(sql(), FREE, PACK_COOKIES, 'evt_pay_dup')).toBe('duplicate');

    expect(await balance()).toBe(PACK_COOKIES);
    expect(await ledger()).toEqual([{ delta: PACK_COOKIES, reason: 'purchase', prompt_id: null }]);
    const { rows } = await sql().query<{ n: number }>(
      'select count(*)::int as n from cookie_purchase_events where event_id = $1',
      ['evt_pay_dup'],
    );
    expect(rows[0]?.n).toBe(1);
    // A DIFFERENT payment is a different event and credits normally.
    expect(await grantPurchase(sql(), FREE, PACK_COOKIES, 'evt_pay_two')).toBe('credited');
    expect(await balance()).toBe(PACK_COOKIES * 2);
  });

  it('answers notFound for an unknown profile and refuses a bad credit or a blank event', async () => {
    expect(
      await grantPurchase(sql(), '00000000-0000-4000-8000-0000000000dd', 5, 'evt_ghost'),
    ).toBe('notFound');
    // The refused credit claimed nothing: the same event id can land on the right profile later.
    const { rows } = await sql().query<{ n: number }>(
      'select count(*)::int as n from cookie_purchase_events',
    );
    expect(rows[0]?.n).toBe(0);
    await expect(grantPurchase(sql(), FREE, 0, 'evt_zero')).rejects.toThrow();
    await expect(grantPurchase(sql(), FREE, -5, 'evt_neg')).rejects.toThrow();
    await expect(grantPurchase(sql(), FREE, 2.5, 'evt_frac')).rejects.toThrow();
    await expect(grantPurchase(sql(), FREE, 5, '   ')).rejects.toThrow();
  });

  /**
   * M10 review R1, finding 3 — the grant-inside-a-refused-unlock COMMITS. A due wallet pressing
   * unlock on a prompt that turns out not to exist still banks its weekly cookie: the transaction
   * returns 'notFound' as a VALUE, and `transaction()` commits on any non-throw return.
   */
  it('a notFound unlock still commits the weekly grant it observed on the way', async () => {
    await setWallet(FREE, 0, '8 days');
    expect(
      await unlockPrompt(sql(), FREE, '11111111-2222-4333-8444-555555555555'),
    ).toBe('notFound');
    expect(await balance()).toBe(1);
    expect(await ledger()).toEqual([{ delta: 1, reason: 'weekly', prompt_id: null }]);
    // …and the stamp reset with it: an immediate second read grants nothing more.
    const wallet = await getWallet(sql(), FREE);
    expect(wallet?.balance).toBe(1);
  });
});

describe('cookie pack purchase seam (§15.1-5)', () => {
  let harness: PromptHarness;

  beforeEach(async () => {
    harness = await promptHarness();
  });
  afterEach(async () => harness.close());

  it('is not purchasable and starts nothing until an M8 gateway is connected', async () => {
    expect(isCookiePackPurchasable()).toBe(false);
    expect(await startCookiePackPurchase(FREE, '/en/prompts/neon-alley-dolly')).toEqual({
      status: 'unavailable',
    });
  });

  it('credits exactly the pack when the (future) webhook calls in — once per provider event', async () => {
    await harness.sql.query(
      `update profiles set cookie_balance = 0, cookies_granted_at = now() where id = $1`,
      [FREE],
    );
    expect(await creditCookiePack(harness.sql, FREE, 'evt_seam_1')).toBe('credited');
    expect(await creditCookiePack(harness.sql, FREE, 'evt_seam_1')).toBe('duplicate');
    const { rows } = await harness.sql.query<{ cookie_balance: number }>(
      'select cookie_balance from profiles where id = $1',
      [FREE],
    );
    expect(rows[0]?.cookie_balance).toBe(PACK_COOKIES);
    const ledger = await harness.sql.query<{ delta: number; reason: string }>(
      'select delta, reason from cookie_ledger where profile_id = $1',
      [FREE],
    );
    expect(ledger.rows).toEqual([{ delta: PACK_COOKIES, reason: 'purchase' }]);
  });
});

describe('decideUnlockPanel (§15.3)', () => {
  it('funnels anon to sign-in, a funded reader to the spend, an empty one to the pack', () => {
    expect(decideUnlockPanel(null, null)).toEqual({ state: 'signin' });
    expect(decideUnlockPanel('user-1', 3)).toEqual({ state: 'spend', balance: 3 });
    expect(decideUnlockPanel('user-1', 1)).toEqual({ state: 'spend', balance: 1 });
    expect(decideUnlockPanel('user-1', 0)).toEqual({ state: 'empty' });
    // A signed-in viewer whose wallet could not be read spends nothing — fail closed.
    expect(decideUnlockPanel('user-1', null)).toEqual({ state: 'empty' });
  });
});
