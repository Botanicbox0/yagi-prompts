import type { SqlRunner } from '@/lib/db/sql-runner';
import { UNLOCK_COST, WEEKLY_COOKIES, WEEKLY_INTERVAL } from './wallet';

/**
 * PLAN §15.1 — every wallet read and write, in one driver-agnostic module.
 *
 * Same seam as `lib/contests/repo.ts`: the acceptance tests drive these against real PGlite, the
 * app drives them against Supabase Postgres through `pg`, and neither needs a session — the CALLER
 * supplies the profile id and the shaping happens above.
 *
 * The §15.1-6 contract every write here honors: profile row `FOR UPDATE` → idempotency check →
 * lazy weekly grant → balance guard → ledger append + unlock insert + balance write, ONE
 * transaction. The ledger and the balance column move together or not at all; `cookie_balance` is
 * the fast read, `cookie_ledger` is the truth a support question is answered from.
 *
 * No SQL function owns any of this (the 0103 lesson — see migration 0008): `transaction()` pinning
 * one connection is what makes the multi-statement invariant real on the pooled cloud driver.
 */

export interface Wallet {
  balance: number;
  /** ISO timestamp of the last weekly grant, or null when the clock has never been read. */
  grantedAt: string | null;
}

export type UnlockOutcome = 'unlocked' | 'alreadyUnlocked' | 'needCookies' | 'notFound';

export interface UnlockHistoryRow {
  promptId: string;
  slug: string;
  title: string;
  titleKo: string | null;
  status: string;
  createdAt: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

interface LockedWallet {
  cookie_balance: number;
  cookies_granted_at: Date | string | null;
  grant_due: boolean;
}

/**
 * The one locked read every wallet path starts from.
 *
 * `grant_due` is the DATABASE's opinion (the contests lesson — the clock that stamps the row is
 * the clock that judges it): NULL means the weekly clock has never been read, which §15.1-3 treats
 * as due — that is how a backfilled profile collects its return cookie.
 */
const LOCK_WALLET = `select cookie_balance, cookies_granted_at,
       (cookies_granted_at is null or cookies_granted_at <= now() - interval '${WEEKLY_INTERVAL}') as grant_due
  from profiles where id = $1 for update`;

/**
 * Apply the §15.1-3 grant to an already-locked wallet row. Non-accumulating by construction: the
 * stamp resets to now(), so an absent month yields this ONE grant and the next lands a week out.
 */
async function applyWeeklyGrant(
  tx: SqlRunner,
  profileId: string,
  locked: LockedWallet,
): Promise<Wallet> {
  if (!locked.grant_due) {
    return { balance: locked.cookie_balance, grantedAt: toIso(locked.cookies_granted_at) };
  }
  const { rows } = await tx.query<{ cookie_balance: number; cookies_granted_at: Date | string }>(
    `update profiles
        set cookie_balance = cookie_balance + $2, cookies_granted_at = now()
      where id = $1
      returning cookie_balance, cookies_granted_at`,
    [profileId, WEEKLY_COOKIES],
  );
  await tx.query(
    `insert into cookie_ledger (profile_id, delta, reason) values ($1, $2, 'weekly')`,
    [profileId, WEEKLY_COOKIES],
  );
  const row = rows[0]!;
  return { balance: row.cookie_balance, grantedAt: toIso(row.cookies_granted_at) };
}

/**
 * Read the wallet — and, because a read is where §15.1-3 fires, maybe grant inside the same
 * transaction. Returns null for a missing profile (a session whose row is gone is unknown, not
 * broke — the caller fails closed).
 */
export async function getWallet(sql: SqlRunner, profileId: string): Promise<Wallet | null> {
  if (!UUID.test(profileId)) return null;
  return await sql.transaction(async (tx) => {
    const { rows } = await tx.query<LockedWallet>(LOCK_WALLET, [profileId]);
    const locked = rows[0];
    if (locked === undefined) return null;
    return applyWeeklyGrant(tx, profileId, locked);
  });
}

/**
 * Spend one cookie on one YAGI prompt, permanently — the §15.1-6 transaction, in its exact order.
 *
 * 'alreadyUnlocked' returns BEFORE the weekly grant on purpose: re-pressing an unlock is not a
 * wallet read, and charging the check with a side effect would make the idempotent path the one
 * that mutates. The prompt must be `source='yagi'`, `status='published'` AND `text_visibility=
 * 'pro'` — community text is free by doctrine (§13.3-1), a public teaser has nothing to sell, and
 * both answer 'notFound' rather than eating a cookie for a thing the reader already has.
 *
 * Two spends racing on the same last cookie serialize on the profile lock: the loser re-reads the
 * winner's committed state and lands in 'alreadyUnlocked' (same prompt) or 'needCookies'
 * (different prompt). The unique (profile_id, prompt_id) constraint is the structural backstop.
 */
export async function unlockPrompt(
  sql: SqlRunner,
  profileId: string,
  promptId: string,
): Promise<UnlockOutcome> {
  if (!UUID.test(profileId) || !UUID.test(promptId)) return 'notFound';
  return await sql.transaction(async (tx) => {
    const { rows } = await tx.query<LockedWallet>(LOCK_WALLET, [profileId]);
    const locked = rows[0];
    if (locked === undefined) return 'notFound';

    const existing = await tx.query<{ ok: number }>(
      'select 1 as ok from prompt_unlocks where profile_id = $1 and prompt_id = $2',
      [profileId, promptId],
    );
    if (existing.rows.length > 0) return 'alreadyUnlocked';

    const wallet = await applyWeeklyGrant(tx, profileId, locked);

    const prompt = await tx.query<{ source: string; status: string; text_visibility: string }>(
      'select source, status, text_visibility::text from prompt_items where id = $1',
      [promptId],
    );
    const row = prompt.rows[0];
    if (
      row === undefined ||
      row.source !== 'yagi' ||
      row.status !== 'published' ||
      row.text_visibility !== 'pro'
    ) {
      return 'notFound';
    }

    if (wallet.balance < UNLOCK_COST) return 'needCookies';

    await tx.query(
      'update profiles set cookie_balance = cookie_balance - $2 where id = $1',
      [profileId, UNLOCK_COST],
    );
    await tx.query(
      `insert into cookie_ledger (profile_id, delta, reason, prompt_id)
       values ($1, $2, 'unlock', $3)`,
      [profileId, -UNLOCK_COST, promptId],
    );
    await tx.query(
      'insert into prompt_unlocks (profile_id, prompt_id) values ($1, $2)',
      [profileId, promptId],
    );
    return 'unlocked';
  });
}

/**
 * Which of these prompts has this account unlocked. An empty input answers itself — no query, so
 * the gallery-adjacent call sites (related rails) cost nothing when there is nothing gated.
 */
export async function listUnlocks(
  sql: SqlRunner,
  profileId: string,
  promptIds: string[],
): Promise<Set<string>> {
  if (promptIds.length === 0 || !UUID.test(profileId)) return new Set();
  const { rows } = await sql.query<{ prompt_id: string }>(
    'select prompt_id from prompt_unlocks where profile_id = $1 and prompt_id = any($2::uuid[])',
    [profileId, promptIds],
  );
  return new Set(rows.map((row) => row.prompt_id));
}

/** `/account` — "prompts you opened", newest first, with the title the link needs. */
export async function listRecentUnlocks(
  sql: SqlRunner,
  profileId: string,
  limit = 20,
): Promise<UnlockHistoryRow[]> {
  if (!UUID.test(profileId)) return [];
  const { rows } = await sql.query<{
    prompt_id: string;
    slug: string;
    title: string;
    title_ko: string | null;
    status: string;
    created_at: Date | string | null;
  }>(
    `select u.prompt_id, u.created_at, p.slug, p.title, p.title_ko, p.status
       from prompt_unlocks u
       join prompt_items p on p.id = u.prompt_id
      where u.profile_id = $1
      order by u.created_at desc, p.slug asc
      limit $2`,
    [profileId, limit],
  );
  return rows.map((row) => ({
    promptId: row.prompt_id,
    slug: row.slug,
    title: row.title,
    titleKo: row.title_ko,
    status: row.status,
    createdAt: toIso(row.created_at),
  }));
}

/**
 * Credit a purchased pack (§15.1-5). Not wired to a gateway yet — this is the function the
 * M8 Paddle-class webhook calls, and the reason it exists now is that the seam has to be tested
 * before there is money on it. Returns false for a profile that does not exist.
 */
export async function grantPurchase(
  sql: SqlRunner,
  profileId: string,
  cookies: number,
): Promise<boolean> {
  if (!Number.isInteger(cookies) || cookies <= 0) {
    throw new Error('a purchase credits a positive whole number of cookies');
  }
  if (!UUID.test(profileId)) return false;
  return await sql.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      'update profiles set cookie_balance = cookie_balance + $2 where id = $1 returning id',
      [profileId, cookies],
    );
    if (rows.length === 0) return false;
    await tx.query(
      `insert into cookie_ledger (profile_id, delta, reason) values ($1, $2, 'purchase')`,
      [profileId, cookies],
    );
    return true;
  });
}
