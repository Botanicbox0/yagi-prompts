import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import { MIGRATIONS_DIR, expectReject } from '@/tests/helpers/pglite';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  DELETION_DAYS,
  DELETION_PENDING_QUERIES,
  NOTHING_PENDING,
  cancelAccountDeletion,
  countDeletionQueue,
  decideDeletion,
  deletionPending,
  deletionReady,
  loadDeletionQueue,
  openDeletionRequest,
  requestAccountDeletion,
} from '@/lib/account/deletion';
import { ADMIN_OPERATIONS } from '@/lib/admin/operations';
import { adminNextActions } from '@/lib/admin/workflow';

/**
 * docs/APP-STORE-LAUNCH.md §3.2 — the in-app deletion request (Apple 5.1.1(v), Google Play). The
 * member's side (a ticked box, one open request, cancel until started), the operator's three marks
 * (start, complete only once the account is gone, close with a reason) and the 0064 rule that a
 * closed request keeps no address.
 */
const ADMIN = 'a0000000-0000-4000-8000-0000000000ad';
const admin = { tier: 'free', userId: ADMIN, email: null, isAdmin: true, locale: 'ko' } as Viewer;
const member = { tier: 'free', userId: USER.buyer, email: 'me@twings.test', isAdmin: false, locale: 'ko' } as Viewer;
const now = new Date('2026-10-27T03:00:00Z');

describe('0064 account deletion requests (core)', () => {
  let h: BillingHarness;
  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
  });
  afterEach(async () => h.close());
  const insert = (extra = '', values = '') =>
    h.db.query(`insert into account_deletion_requests (user_id, email, due_at${extra}) values ($1, 'me@twings.test', now() + interval '7 days'${values})`, [USER.buyer]);

  it('keeps one open request per member, and only the four states', async () => {
    await insert();
    expect(await expectReject(() => insert())).toMatch(/duplicate key|unique/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='deleted'`))).toMatch(/check/i);
    await h.db.query(`update account_deletion_requests set status='cancelled', cancelled_at=now(), email=null`);
    await insert();
  });

  it('refuses a closed request that still holds an address, and a completed one whose account exists', async () => {
    await insert();
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='cancelled', cancelled_at=now()`))).toMatch(/check/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='completed', completed_at=now(), email=null`))).toMatch(/check/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='processing'`))).toMatch(/check/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set due_at=requested_at`))).toMatch(/check/i);
  });

  it('outlives the profile with an empty user_id, so completion is reachable after the runbook', async () => {
    await insert();
    await h.db.query('delete from profiles where id=$1', [USER.buyer]);
    const { rows } = await h.db.query<{ user_id: string | null; status: string }>('select user_id, status from account_deletion_requests');
    expect(rows).toEqual([{ user_id: null, status: 'requested' }]);
    await h.db.query(`update account_deletion_requests set status='completed', completed_at=now(), email=null`);
  });
});

describe('0144 account deletion requests (glue)', () => {
  const core = readFileSync(join(MIGRATIONS_DIR, '0064_core_account_deletion_requests.sql'), 'utf8');
  const glue = readFileSync(join(MIGRATIONS_DIR, '0144_glue_account_deletion_requests.sql'), 'utf8');

  it('says on the first line that the cloud needs it applied', () => {
    expect(core.split('\n')[0]).toContain('CLOUD APPLICATION REQUIRED');
    expect(glue.split('\n')[0]).toContain('CLOUD APPLICATION REQUIRED');
  });

  it('closes the table to the browser roles and opens it to service_role only (the 0141 shape)', () => {
    expect(glue).toContain("'account_deletion_requests'");
    expect(glue).toContain('alter table public.%I enable row level security');
    expect(glue).toContain('alter table public.%I force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).toContain('grant select,insert,update,delete on public.%I to service_role');
    expect(glue).not.toMatch(/create\s+policy/i);
  });
});

describe('the member asks', () => {
  let h: BillingHarness;
  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer, email: 'profile@twings.test' });
  });
  afterEach(async () => h.close());

  it('needs a session and the ticked box', async () => {
    expect(await requestAccountDeletion(h.sql, { userId: null, email: null }, true, now)).toEqual({ ok: false, code: 'signedOut' });
    expect(await requestAccountDeletion(h.sql, member, false, now)).toEqual({ ok: false, code: 'unconfirmed' });
    expect(await openDeletionRequest(h.sql, USER.buyer)).toBeNull();
  });

  it('records one request due in 7 days, and a second press answers with the same one', async () => {
    const first = await requestAccountDeletion(h.sql, member, true, now);
    expect(first).toMatchObject({ ok: true, created: true, request: { status: 'requested', requestedAt: now.toISOString() } });
    if (!first.ok) throw new Error('unreachable');
    expect(new Date(first.request.dueAt).getTime() - now.getTime()).toBe(DELETION_DAYS * 24 * 60 * 60 * 1000);
    const again = await requestAccountDeletion(h.sql, member, true, new Date(now.getTime() + 60_000));
    expect(again).toMatchObject({ ok: true, created: false, request: { id: first.request.id } });
    const { rows } = await h.db.query<{ n: number; email: string }>('select count(*)::int n, max(email) email from account_deletion_requests');
    expect(rows[0]).toEqual({ n: 1, email: 'me@twings.test' });
  });

  it('falls back to the profile address when the session has none', async () => {
    await requestAccountDeletion(h.sql, { ...member, email: null }, true, now);
    expect((await h.db.query<{ email: string }>('select email from account_deletion_requests')).rows[0]?.email).toBe('profile@twings.test');
  });

  it('cancels only before an operator starts, and drops the address', async () => {
    await requestAccountDeletion(h.sql, member, true, now);
    expect(await cancelAccountDeletion(h.sql, USER.buyer, now)).toBe(true);
    expect((await h.db.query('select status, email from account_deletion_requests')).rows[0]).toEqual({ status: 'cancelled', email: null });
    expect(await cancelAccountDeletion(h.sql, USER.buyer, now)).toBe(false);

    const second = await requestAccountDeletion(h.sql, member, true, now);
    if (!second.ok) throw new Error('unreachable');
    await seedProfile(h.sql, { id: ADMIN, isAdmin: true });
    await decideDeletion(h.sql, admin, 'start', { id: second.request.id }, now);
    expect(await cancelAccountDeletion(h.sql, USER.buyer, now)).toBe(false);
    expect((await openDeletionRequest(h.sql, USER.buyer))?.status).toBe('processing');
  });

  it('answers "unavailable" before 0064 rather than throwing', async () => {
    await h.db.query('drop table account_deletion_requests');
    expect(await deletionReady(h.sql)).toBe(false);
    expect(await requestAccountDeletion(h.sql, member, true, now)).toEqual({ ok: false, code: 'unavailable' });
    expect(await cancelAccountDeletion(h.sql, USER.buyer, now)).toBe(false);
    expect(await loadDeletionQueue(h.sql)).toBeNull();
    expect(await countDeletionQueue(h.sql)).toBe(0);
  });
});

describe('what is still moving on the account', () => {
  it('runs against the real schema and finds nothing on a fresh account', async () => {
    const h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
    expect(await deletionPending(h.sql, USER.buyer)).toEqual(NOTHING_PENDING);
    await h.close();
  });

  it('only counts states the tables can actually hold', async () => {
    const h = await billingDb();
    for (const [table, query] of Object.entries(DELETION_PENDING_QUERIES)) {
      const { rows } = await h.db.query<{ def: string }>(
        `select pg_get_constraintdef(c.oid) def from pg_constraint c where c.conrelid=$1::regclass and c.contype='c'`,
        [table],
      );
      const defs = rows.map((r) => r.def).join('\n');
      const states = [...query.matchAll(/status in \(([^)]+)\)/g)].flatMap((m) => m[1]!.split(',').map((s) => s.trim()));
      expect(states.length, table).toBeGreaterThan(0);
      for (const state of states) expect(defs, `${table} ${state}`).toContain(`${state}::text`);
    }
    await h.close();
  });

  it('maps the counts and counts a missing table as zero', async () => {
    const seen: string[] = [];
    const sql: SqlRunner = {
      async query<T>(text: string) {
        seen.push(text);
        if (text.includes('unnest')) return { rows: [{ name: 'render_jobs' }, { name: 'billing_payments' }, { name: 'campaign_applications' }] as T[] };
        if (text.includes('from render_jobs')) return { rows: [{ n: 2 }] as T[] };
        if (text.includes('from billing_payments')) return { rows: [{ n: 1 }] as T[] };
        if (text.includes('from campaign_applications')) return { rows: [{ n: 3 }] as T[] };
        throw new Error(`unexpected query: ${text}`);
      },
      transaction: (fn) => fn(sql),
    };
    expect(await deletionPending(sql, USER.buyer)).toEqual({ renders: 2, payments: 1, subscription: false, campaigns: 3 });
    expect(seen.some((text) => text.includes('creator_subscriptions where'))).toBe(false);
  });
});

describe('the operator works the queue', () => {
  let h: BillingHarness;
  let id: string;
  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
    await seedProfile(h.sql, { id: ADMIN, isAdmin: true });
    const r = await requestAccountDeletion(h.sql, member, true, now);
    if (!r.ok) throw new Error('request failed');
    id = r.request.id;
  });
  afterEach(async () => h.close());

  it('re-reads is_admin under the decision', async () => {
    await h.db.query('update profiles set is_admin=false where id=$1', [ADMIN]);
    expect(await decideDeletion(h.sql, admin, 'start', { id }, now)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('starts, refuses completion while the account exists, then completes and forgets the address', async () => {
    expect(await countDeletionQueue(h.sql)).toBe(1);
    expect(await decideDeletion(h.sql, admin, 'start', { id, note: 'stripe checked' }, now)).toEqual({ ok: true, status: 'processing' });
    expect(await decideDeletion(h.sql, admin, 'start', { id }, now)).toEqual({ ok: false, code: 'badTransition', from: 'processing' });
    expect(await decideDeletion(h.sql, admin, 'complete', { id }, now)).toEqual({ ok: false, code: 'accountExists', from: 'processing' });

    const waiting = await loadDeletionQueue(h.sql);
    expect(waiting?.open).toHaveLength(1);
    expect(waiting?.open[0]).toMatchObject({ email: 'me@twings.test', accountExists: true, staff: false, status: 'processing', note: 'stripe checked' });

    await h.db.query('delete from auth.users where id=$1', [USER.buyer]);
    expect(await decideDeletion(h.sql, admin, 'complete', { id }, now)).toEqual({ ok: true, status: 'completed' });
    const { rows } = await h.db.query('select status, email, user_id, closed_by from account_deletion_requests');
    expect(rows[0]).toEqual({ status: 'completed', email: null, user_id: null, closed_by: ADMIN });
    expect(await countDeletionQueue(h.sql)).toBe(0);
    expect((await loadDeletionQueue(h.sql))?.closed[0]).toMatchObject({ status: 'completed', accountExists: false });
    expect(await decideDeletion(h.sql, admin, 'cancel', { id, note: 'x' }, now)).toEqual({ ok: false, code: 'badTransition', from: 'completed' });
  });

  it('closes a request only with a reason', async () => {
    expect(await decideDeletion(h.sql, admin, 'cancel', { id }, now)).toEqual({ ok: false, code: 'invalid' });
    expect(await decideDeletion(h.sql, admin, 'cancel', { id, note: 'member asked by mail to keep the account' }, now)).toEqual({ ok: true, status: 'cancelled' });
    expect((await h.db.query('select email, note from account_deletion_requests')).rows[0]).toEqual({ email: null, note: 'member asked by mail to keep the account' });
  });

  it('flags a staff account for the founder', async () => {
    await h.db.query('update profiles set is_admin=true where id=$1', [USER.buyer]);
    expect((await loadDeletionQueue(h.sql))?.open[0]?.staff).toBe(true);
  });

  it('is in the one admin registry, and the dispatcher codes say what happened', async () => {
    const ops = ADMIN_OPERATIONS as unknown as Record<string, { parse(form: FormData): { ok: boolean; value?: unknown }; run(ctx: unknown, input: unknown): Promise<{ ok: boolean; code: string; detail?: string }> }>;
    for (const name of ['account.deletion.start', 'account.deletion.complete', 'account.deletion.cancel']) expect(Object.keys(ops)).toContain(name);
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
    expect(ops['account.deletion.cancel']!.parse(form({ id }))).toMatchObject({ ok: false });
    const ctx = { sql: h.sql, viewer: admin };
    const complete = ops['account.deletion.complete']!;
    const refused = await complete.run(ctx, (complete.parse(form({ id })) as { value: unknown }).value);
    expect(refused).toMatchObject({ ok: false, code: 'badTransition' });
    expect(refused.detail).toContain('account still exists');
    expect(await ops['account.deletion.start']!.run(ctx, { id })).toMatchObject({ ok: true, code: 'saved' });
  });
});

describe('the admin home', () => {
  it('puts open deletion requests first, and only when there are some', () => {
    const base = { posts: 1, applicants: 0, payouts: 0, studio: 0, inquiries: 0, feedback: 0, templates: 0 };
    expect(adminNextActions({ ...base, accountDeletions: 2 }).map((a) => [a.key, a.count, a.href])).toEqual([
      ['accountDeletions', 2, '/admin/account-deletions'],
      ['posts', 1, '/admin/campaigns'],
    ]);
    expect(adminNextActions({ ...base, accountDeletions: 0 }).map((a) => a.key)).toEqual(['posts']);
  });
});
