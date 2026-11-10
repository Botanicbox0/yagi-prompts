import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { MIGRATIONS_DIR, expectReject } from '@/tests/helpers/pglite';
import type { Viewer } from '@/lib/auth/identity';
import {
  DELETION_DAYS,
  DELETION_HOLD_CHECKS,
  cancelAccountDeletion,
  countDeletionQueue,
  decideDeletion,
  deleteAccountNow,
  deletionGraceDays,
  deletionConfirmPhrase,
  deletionHolds,
  deletionInProgress,
  deletionPassGate,
  deletionReady,
  finishDeletion,
  loadDeletionQueue,
  openDeletionRequest,
  requestAccountDeletion,
  runDeletionPass,
  type DeletionDeps,
} from '@/lib/account/deletion';
import { ADMIN_OPERATIONS } from '@/lib/admin/operations';

/**
 * docs/RUNBOOK-deletion.md — self-serve account deletion (Apple 5.1.1(v), Google Play). The member's
 * side (a ticked box, one open request, a grace period with a cancel button), what holds an account
 * back, the one transaction that deletes it while keeping the payment records, the cleanup outside
 * the database, and the operator's three marks.
 */
const ADMIN = 'a0000000-0000-4000-8000-0000000000ad';
const admin = { tier: 'free', userId: ADMIN, email: null, isAdmin: true, locale: 'ko' } as Viewer;
const member = { tier: 'free', userId: USER.buyer, email: 'me@twings.test', isAdmin: false, locale: 'ko' } as Viewer;
const now = new Date('2026-11-11T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(now.getTime() + days * DAY);

describe('0064 account deletion requests (core)', () => {
  let h: BillingHarness;
  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
  });
  afterEach(async () => h.close());
  const insert = () =>
    h.db.query(
      `insert into account_deletion_requests (user_id, email, scheduled_for, due_at) values ($1, 'me@twings.test', now() + interval '3 days', now() + interval '7 days')`,
      [USER.buyer],
    );

  it('keeps one open request per member, and only the four states', async () => {
    await insert();
    expect(await expectReject(() => insert())).toMatch(/duplicate key|unique/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='deleted'`))).toMatch(/check/i);
    await h.db.query(`update account_deletion_requests set status='cancelled', cancelled_at=now(), email=null`);
    await insert();
  });

  it('refuses a closed request that still holds an address, and anything past "requested" whose account exists', async () => {
    await insert();
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='cancelled', cancelled_at=now()`))).toMatch(/check/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='completed', completed_at=now(), email=null`))).toMatch(/check/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='processing', started_at=now(), cleanup='{}'`))).toMatch(/check/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set due_at=requested_at`))).toMatch(/check/i);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set scheduled_for=requested_at - interval '1 second'`))).toMatch(/check/i);
  });

  it('outlives the profile with an empty user_id, and a closed row keeps nothing to clean', async () => {
    await insert();
    await h.db.query('delete from profiles where id=$1', [USER.buyer]);
    expect((await h.db.query('select user_id, status from account_deletion_requests')).rows).toEqual([{ user_id: null, status: 'requested' }]);
    await h.db.query(`update account_deletion_requests set status='processing', started_at=now(), cleanup='{"folders":["x"]}'`);
    expect(await expectReject(() => h.db.query(`update account_deletion_requests set status='completed', completed_at=now(), email=null`))).toMatch(/check/i);
    await h.db.query(`update account_deletion_requests set status='completed', completed_at=now(), email=null, cleanup=null`);
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

describe('the grace period', () => {
  it('is three days unless the environment names a whole number from 0 to 5', () => {
    expect(deletionGraceDays({})).toBe(3);
    expect(deletionGraceDays({ ACCOUNT_DELETION_GRACE_DAYS: '0' })).toBe(0);
    expect(deletionGraceDays({ ACCOUNT_DELETION_GRACE_DAYS: '5' })).toBe(5);
    // Six would leave one daily pass before the 7-day promise; refuse it rather than cut it close.
    for (const bad of ['6', '-1', '1.5', 'soon', '']) expect(deletionGraceDays({ ACCOUNT_DELETION_GRACE_DAYS: bad }), bad).toBe(3);
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

  it('records one request: deleted after the grace period, promised within 7 days', async () => {
    const first = await requestAccountDeletion(h.sql, member, true, now, 3);
    expect(first).toMatchObject({ ok: true, created: true, request: { status: 'requested', requestedAt: now.toISOString(), hold: [] } });
    if (!first.ok) throw new Error('unreachable');
    expect(first.request.scheduledFor).toBe(later(3).toISOString());
    expect(first.request.dueAt).toBe(later(DELETION_DAYS).toISOString());
    const again = await requestAccountDeletion(h.sql, member, true, later(1), 3);
    expect(again).toMatchObject({ ok: true, created: false, request: { id: first.request.id } });
    expect((await h.db.query('select count(*)::int n, max(email) email from account_deletion_requests')).rows[0]).toEqual({ n: 1, email: 'me@twings.test' });
  });

  it('falls back to the profile address when the session has none', async () => {
    await requestAccountDeletion(h.sql, { ...member, email: null }, true, now);
    expect((await h.db.query<{ email: string }>('select email from account_deletion_requests')).rows[0]?.email).toBe('profile@twings.test');
  });

  it('cancels while the account still exists, and drops the address', async () => {
    await requestAccountDeletion(h.sql, member, true, now);
    expect(await cancelAccountDeletion(h.sql, USER.buyer, now)).toBe(true);
    expect((await h.db.query('select status, email from account_deletion_requests')).rows[0]).toEqual({ status: 'cancelled', email: null });
    expect(await cancelAccountDeletion(h.sql, USER.buyer, now)).toBe(false);
    expect(await openDeletionRequest(h.sql, USER.buyer)).toBeNull();
  });

  it('answers "unavailable" before 0064 rather than throwing', async () => {
    await h.db.query('drop table account_deletion_requests');
    expect(await deletionReady(h.sql)).toBe(false);
    expect(await requestAccountDeletion(h.sql, member, true, now)).toEqual({ ok: false, code: 'unavailable' });
    expect(await cancelAccountDeletion(h.sql, USER.buyer, now)).toBe(false);
    expect(await loadDeletionQueue(h.sql)).toBeNull();
    expect(await countDeletionQueue(h.sql)).toBe(0);
    expect(await runDeletionPass({ sql: h.sql, files: null, auth: null, provider: null }, { now })).toMatchObject({ ready: false });
  });
});

// ---------------------------------------------------------------------------
// a real account: a saved photo, a finished render, a paid order, a push subscription
// ---------------------------------------------------------------------------

const SELFIE = '5e1f1e00-0000-4000-8000-000000000001';
const ORDER = '0d0e0000-0000-4000-8000-000000000001';

interface Account { render: string; template: { id: string; slug: string } }

async function seedAccount(h: PromptHarness, userId = USER.buyer): Promise<Account> {
  await seedProfile(h.sql, { id: userId, email: 'profile@twings.test' });
  const template = (await h.sql.query<{ id: string; slug: string }>('select id, slug from prompt_items order by slug limit 1')).rows[0]!;
  await h.sql.query(
    `insert into identity_selfies (id, user_id, input_key, sha256, width, height, consent_at, is_default) values ($1, $2, $3, $4, 800, 800, now(), true)`,
    [SELFIE, userId, `${SELFIE}/selfie.png`, 'a'.repeat(64)],
  );
  const render = (await h.sql.query<{ id: string }>(
    `insert into render_jobs (user_id, template_id, template_slug, medium, engine, aspect, status, error_code)
     values ($1, $2, $3, 'video', 'seedance-2.0', '9:16', 'failed', 'fixture') returning id`,
    [userId, template.id, template.slug],
  )).rows[0]!.id;
  await h.sql.query(`update render_jobs set input_key=$2, input_mime='image/png' where id=$1`, [render, `${render}/input.png`]);
  await h.sql.query(
    `insert into billing_payments (id,user_id,environment,amount_krw,template_id,template_slug,order_name,aspect,locale,render_ref,input_key,input_mime,expires_at,status,failure_code)
     values ($1,$2,'fake',2500,$3,$4,'TWINGS','9:16','ko',$1,$5,'image/jpeg',$6,'failed','expired')`,
    [ORDER, userId, template.id, template.slug, `${ORDER}/input.jpg`, new Date(now.getTime() - DAY)],
  );
  await h.sql.query(`insert into identity_groups (user_id, status, group_id, verified_at) values ($1, 'active', 'grp-buyer', now())`, [userId]);
  await h.sql.query(`insert into identity_assets (user_id, group_id, asset_id, photo_sha256, status) values ($1, 'grp-buyer', 'ast-buyer-1', $2, 'Active')`, [userId, 'b'.repeat(64)]);
  await h.sql.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.test/abc', 'p', 'a')`, [userId]);
  await h.sql.query(`insert into events (type, user_id) values ('start_checkout', $1)`, [userId]);
  return { render, template };
}

function fakes(sql: PromptHarness['sql'], failing: { folder?: string; auth?: boolean; provider?: boolean; asset?: boolean } = {}) {
  const seen = { folders: [] as string[], users: [] as string[], assets: [] as string[], groups: [] as string[] };
  const deps: DeletionDeps = {
    sql,
    files: { async deleteFolder(folder) { if (folder === failing.folder) throw new Error('storage refused'); seen.folders.push(folder); } },
    auth: { async deleteUser(id) { if (failing.auth) throw new Error('auth refused'); seen.users.push(id); await sql.query('delete from auth.users where id=$1', [id]); } },
    provider: {
      async deleteAsset(id) { if (failing.provider || failing.asset) throw new Error('provider refused'); seen.assets.push(id); },
      async deleteAssetGroup(id) { if (failing.provider) throw new Error('provider refused'); seen.groups.push(id); },
    },
  };
  return { deps, seen };
}

describe('what holds an account back', () => {
  let h: PromptHarness;
  let account: Account;
  beforeEach(async () => {
    h = await promptHarness();
    account = await seedAccount(h);
  });
  afterEach(async () => h.close());

  it('finds nothing on an ordinary account with a finished render and a closed order', async () => {
    expect(await deletionHolds(h.sql, USER.buyer, now)).toEqual({ wait: [], review: [], tables: [] });
  });

  it('only names states the tables can actually hold', async () => {
    for (const { table, sql: query } of DELETION_HOLD_CHECKS) {
      const { rows } = await h.db.query<{ def: string }>(`select pg_get_constraintdef(c.oid) def from pg_constraint c where c.conrelid=$1::regclass and c.contype='c'`, [table]);
      const defs = rows.map((r) => r.def).join('\n');
      // subscriptions.status is the old provider's word verbatim: no CHECK to compare with.
      if (!/status/.test(defs)) continue;
      const states = [...query.matchAll(/status\s*(?:in \(([^)]+)\)|=\s*('[a-z_]+'))/g)].flatMap((m) => (m[1] ?? m[2])!.split(',').map((s) => s.trim()));
      for (const state of states) expect(defs, `${table} ${state}`).toContain(`${state}::text`);
    }
  });

  it('waits for a render in the oven and for money in flight', async () => {
    await h.sql.query(`update render_jobs set status='running', error_code=null where id=$1`, [account.render]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).wait).toEqual(['render']);
    await h.sql.query(`update render_jobs set status='failed', error_code='fixture' where id=$1`, [account.render]);

    // A checkout still open counts; one that has run out does not.
    await h.sql.query(`update billing_payments set status='pending', failure_code=null, expires_at=$2 where id=$1`, [ORDER, later(1)]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).wait).toEqual(['payment']);
    expect((await deletionHolds(h.sql, USER.buyer, later(2))).wait).toEqual([]);
    await h.sql.query(`update billing_payments set status='confirming' where id=$1`, [ORDER]);
    expect((await deletionHolds(h.sql, USER.buyer, later(2))).wait).toEqual(['payment']);
    // Paid and not yet delivered: either the render or the refund is still owed.
    await h.sql.query(`update billing_payments set status='paid', payment_key='pk_1', approved_at=now(), consent_at=now() where id=$1`, [ORDER]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).wait).toEqual(['payment']);
    await h.sql.query(`update billing_payments set fulfilled_at=now() where id=$1`, [ORDER]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).wait).toEqual([]);
    await h.sql.query(`update billing_payments set status='refund_pending' where id=$1`, [ORDER]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).wait).toEqual(['payment']);
  });

  it('waits for a refund that is still owed: a delivered order whose render then failed', async () => {
    // reconcileTossPayments picks this order up through its render (`r.status='failed'`). If the render
    // cascaded away with the account, `render_id` would empty itself and the refund would never be sent.
    await h.sql.query(
      `update billing_payments set status='paid', failure_code=null, payment_key='pk_1', approved_at=now(), consent_at=now(), fulfilled_at=now(), render_id=$2 where id=$1`,
      [ORDER, account.render],
    );
    expect((await deletionHolds(h.sql, USER.buyer, now)).wait).toEqual(['payment']);
    // Refunded: the money went back, nothing is owed.
    await h.sql.query(`update billing_payments set status='refunded', refunded_at=now() where id=$1`, [ORDER]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).wait).toEqual([]);
  });

  it('keeps the records of the old cookie and subscription era out of the cascade', async () => {
    // Free cookies and what they opened are not money: they go with the account.
    await h.sql.query(`insert into cookie_ledger (profile_id, delta, reason) values ($1, 3, 'signup')`, [USER.buyer]);
    await h.sql.query(`insert into prompt_unlocks (profile_id, prompt_id) values ($1, $2)`, [USER.buyer, account.template.id]);
    expect(await deletionHolds(h.sql, USER.buyer, now)).toEqual({ wait: [], review: [], tables: [] });

    // A paid pack is a transaction record (5 years): an operator decides, the cascade does not.
    await h.sql.query(`insert into cookie_purchase_events (event_id, profile_id, cookies) values ('evt_1', $1, 20)`, [USER.buyer]);
    expect(await deletionHolds(h.sql, USER.buyer, now)).toEqual({ wait: [], review: ['records'], tables: ['cookie_purchase_events'] });
    await h.sql.query('delete from cookie_purchase_events');
    await h.sql.query(`insert into cookie_ledger (profile_id, delta, reason) values ($1, 20, 'purchase')`, [USER.buyer]);
    expect(await deletionHolds(h.sql, USER.buyer, now)).toEqual({ wait: [], review: ['records'], tables: ['cookie_ledger'] });
    await h.sql.query(`delete from cookie_ledger where reason='purchase'`);

    // A plan the old provider is still charging must be stopped by a person first; an ended one is a record.
    await h.sql.query(`insert into subscriptions (user_id, stripe_subscription_id, status, stripe_fetched_at) values ($1, 'sub_1', 'active', now())`, [USER.buyer]);
    expect(await deletionHolds(h.sql, USER.buyer, now)).toEqual({ wait: [], review: ['subscription'], tables: ['subscriptions'] });
    await h.sql.query(`update subscriptions set status='past_due'`);
    expect((await deletionHolds(h.sql, USER.buyer, now)).review).toEqual(['subscription']);
    await h.sql.query(`update subscriptions set status='canceled'`);
    expect(await deletionHolds(h.sql, USER.buyer, now)).toEqual({ wait: [], review: ['records'], tables: ['subscriptions'] });
  });

  it('never deletes the payment reviewer account by itself', async () => {
    // lib/auth/review-login.ts — the account the payment provider and the app stores sign in with.
    for (const email of ['pg-review@twings.app', 'pg-review-toss-2@twings.app']) {
      await h.sql.query('update profiles set email=$2 where id=$1', [USER.buyer, email]);
      expect((await deletionHolds(h.sql, USER.buyer, now)).review, email).toEqual(['staff']);
    }
    // The request itself is accepted like anyone's; the hold is written on it.
    const asked = await requestAccountDeletion(h.sql, { ...member, email: 'pg-review@twings.app' }, true, now, 0);
    expect(asked).toMatchObject({ ok: true, request: { hold: ['staff'] } });
    expect(await runDeletionPass(fakes(h.sql).deps, { now: later(1) })).toMatchObject({ deleted: 0, held: 1 });
    expect((await h.db.query('select count(*)::int n from profiles where id=$1', [USER.buyer])).rows[0]).toEqual({ n: 1 });
    // A look-alike address on another domain is an ordinary member.
    await h.sql.query(`update profiles set email='pg-review@example.test' where id=$1`, [USER.buyer]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).review).toEqual([]);
  });

  it('sends a staff account, a campaign with money in it, a brand member and a creative to an operator', async () => {
    await h.sql.query('update profiles set is_admin=true where id=$1', [USER.buyer]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).review).toEqual(['staff']);
    await h.sql.query('update profiles set is_admin=false where id=$1', [USER.buyer]);

    const campaign = '0ca00000-0000-4000-8000-000000000001';
    await h.sql.query(
      `insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots,applications_close_at,post_deadline_at,published_at,payout) values($1,'c1','recruiting','{"en":"C","ko":"C"}','{"en":"S","ko":"S"}','Brand',array['instagram'],3,'2026-12-01','2026-12-15',now(),'{"model":"flat","flatCents":30000,"currency":"KRW","holdDays":7}')`,
      [campaign],
    );
    await h.sql.query(`insert into campaign_applications (campaign_id, creator_id, status, pitch, sns_url, follower_count) values ($1, $2, 'applied', '성수동 카페 리뷰를 꾸준히 올려요', 'https://www.instagram.com/creator.a/', 4200)`, [campaign, USER.buyer]);
    // Applying is not a commitment: the application goes with the account.
    expect((await deletionHolds(h.sql, USER.buyer, now)).review).toEqual([]);
    await h.sql.query(`update campaign_applications set status='selected' where creator_id=$1`, [USER.buyer]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).review).toEqual(['campaign']);
    await h.sql.query('delete from campaign_applications where creator_id=$1', [USER.buyer]);

    await h.sql.query(`insert into platform_creators (user_id, contract_version) values ($1, 'v1')`, [USER.buyer]);
    expect((await deletionHolds(h.sql, USER.buyer, now)).review).toEqual(['creative']);
    await h.sql.query('delete from platform_creators where user_id=$1', [USER.buyer]);

    // A row nothing cascades away (brand_organizations.created_by has no ON DELETE): found by the
    // catalogue scan, so a table added next year is covered without touching this file.
    const org = (await h.sql.query<{ id: string }>(`insert into brand_organizations (name, created_by, request_id) values ('Acme', $1, gen_random_uuid()) returning id`, [USER.buyer])).rows[0]!.id;
    await h.sql.query(`insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [org, USER.buyer]);
    const holds = await deletionHolds(h.sql, USER.buyer, now);
    expect(holds.review).toEqual(['brand']);
    expect(holds.tables).toEqual(expect.arrayContaining(['brand_memberships', 'brand_organizations']));
  });
});

describe('deleting the account', () => {
  let h: PromptHarness;
  let account: Account;
  let id: string;
  beforeEach(async () => {
    h = await promptHarness();
    account = await seedAccount(h);
    const r = await requestAccountDeletion(h.sql, member, true, now, 3);
    if (!r.ok) throw new Error('request failed');
    id = r.request.id;
  });
  afterEach(async () => h.close());
  const row = async () => (await h.db.query<Record<string, unknown>>('select * from account_deletion_requests where id=$1', [id])).rows[0]!;

  it('waits out the grace period unless an operator says now', async () => {
    const { deps } = fakes(h.sql);
    expect(await deleteAccountNow(deps, id, { now: later(2) })).toEqual({ ok: false, code: 'notDue' });
    expect((await h.db.query('select count(*)::int n from profiles where id=$1', [USER.buyer])).rows[0]).toEqual({ n: 1 });
    expect(await deleteAccountNow(deps, id, { now: later(2), force: true })).toMatchObject({ ok: true });
  });

  it('does nothing but write down why while something holds the account', async () => {
    await h.sql.query(`update render_jobs set status='running', error_code=null where id=$1`, [account.render]);
    const { deps, seen } = fakes(h.sql);
    expect(await deleteAccountNow(deps, id, { now: later(3) })).toEqual({ ok: false, code: 'held', hold: ['render'] });
    expect(await row()).toMatchObject({ status: 'requested', hold: ['render'], attempts: 1, user_id: USER.buyer });
    expect(seen).toEqual({ folders: [], users: [], assets: [], groups: [] });
    // The member can still change their mind.
    expect(await cancelAccountDeletion(h.sql, USER.buyer, later(3))).toBe(true);
  });

  it('removes the account in one transaction and keeps the payment record without the photo', async () => {
    const { deps, seen } = fakes(h.sql);
    expect(await deleteAccountNow(deps, id, { now: later(3) })).toEqual({ ok: true, status: 'processing' });

    const count = async (table: string, where: string) => (await h.db.query<{ n: number }>(`select count(*)::int n from ${table} where ${where}`)).rows[0]!.n;
    expect(await count('profiles', `id='${USER.buyer}'`)).toBe(0);
    for (const table of ['identity_selfies', 'render_jobs', 'identity_groups', 'identity_assets', 'push_subscriptions']) expect(await count(table, 'true'), table).toBe(0);
    // The order stays for its retention period: no owner, no render, and its photo marked as gone.
    const order = (await h.db.query('select user_id, render_id, amount_krw, status, input_deleted_at is not null as photo_gone from billing_payments where id=$1', [ORDER])).rows[0];
    expect(order).toEqual({ user_id: null, render_id: null, amount_krw: 2500, status: 'failed', photo_gone: true });
    expect(await count('events', 'user_id is not null')).toBe(0);
    expect(await count('events', "type='start_checkout'")).toBe(1);

    // Nothing outside the database has been touched yet; the request remembers what is left.
    expect(seen).toEqual({ folders: [], users: [], assets: [], groups: [] });
    const after = await row();
    expect(after).toMatchObject({ status: 'processing', user_id: null, hold: [], email: 'me@twings.test' });
    expect(after.cleanup).toEqual({
      authUserId: USER.buyer,
      folders: [ORDER, SELFIE, account.render].sort(),
      providerAssets: ['ast-buyer-1'],
      providerGroups: ['grp-buyer'],
    });
    expect(after.removed).toEqual({ selfies: 1, renders: 1, folders: 3, paymentsKept: 1 });

    expect(await finishDeletion(deps, id, later(3))).toEqual({ ok: true, status: 'completed' });
    expect(seen).toEqual({ folders: [ORDER, SELFIE, account.render].sort(), users: [USER.buyer], assets: ['ast-buyer-1'], groups: ['grp-buyer'] });
    expect(await row()).toMatchObject({ status: 'completed', email: null, cleanup: null, last_error: null });
    expect(await count('auth.users', `id='${USER.buyer}'`)).toBe(0);
    expect(await count('billing_payments', 'true')).toBe(1);
  });

  it('keeps a failed cleanup item on the list and finishes on a later pass', async () => {
    const broken = fakes(h.sql, { folder: SELFIE, provider: true });
    expect(await deleteAccountNow(broken.deps, id, { now: later(3) })).toMatchObject({ ok: true });
    expect(await finishDeletion(broken.deps, id, later(3))).toEqual({ ok: false, code: 'cleanupLeft', left: 3 });
    const stuck = await row();
    expect(stuck).toMatchObject({ status: 'processing', cleanup: { authUserId: null, folders: [SELFIE], providerAssets: ['ast-buyer-1'], providerGroups: ['grp-buyer'] } });
    expect(String(stuck.last_error)).toMatch(/^files: /);
    expect(await countDeletionQueue(h.sql)).toBe(1);

    const fixed = fakes(h.sql);
    expect(await runDeletionPass(fixed.deps, { now: later(4) })).toMatchObject({ ready: true, completed: 1, deleted: 0 });
    expect(fixed.seen).toEqual({ folders: [SELFIE], users: [], assets: ['ast-buyer-1'], groups: ['grp-buyer'] });
    expect(await row()).toMatchObject({ status: 'completed' });
  });

  it('never removes a sign-in account whose owner has come back', async () => {
    // The first try at the sign-in account fails; the rows are already gone.
    const broken = fakes(h.sql, { auth: true });
    expect(await deleteAccountNow(broken.deps, id, { now: later(3) })).toMatchObject({ ok: true });
    expect(await finishDeletion(broken.deps, id, later(3))).toEqual({ ok: false, code: 'cleanupLeft', left: 1 });
    // Everything else on the list went; only the sign-in account is left.
    expect(broken.seen.folders).toHaveLength(3);
    expect(broken.seen.groups).toEqual(['grp-buyer']);
    // While the request lists that sign-in account, the callback must not start a new profile on it.
    expect(await deletionInProgress(h.sql, USER.buyer)).toBe(true);
    expect(await deletionInProgress(h.sql, USER.other)).toBe(false);

    // Suppose a profile appeared anyway (another path, a manual insert). Deleting the sign-in account
    // now would cascade a NEW account away, with whatever it has paid for since.
    await seedProfile(h.sql, { id: USER.buyer, email: 'back@twings.test' });
    const next = fakes(h.sql);
    expect(await finishDeletion(next.deps, id, later(4))).toMatchObject({ ok: false, code: 'cleanupLeft', left: 1 });
    expect(next.seen.users).toEqual([]);
    expect((await h.db.query('select count(*)::int n from profiles where id=$1', [USER.buyer])).rows[0]).toEqual({ n: 1 });
    const stuck = await row();
    expect(stuck).toMatchObject({ status: 'processing', cleanup: { authUserId: USER.buyer, folders: [], providerAssets: [], providerGroups: [] } });
    expect(String(stuck.last_error)).toMatch(/^auth: .*signed in again/);
    // An operator decides; the daily pass keeps saying so and keeps its hands off.
    expect(await runDeletionPass(next.deps, { now: later(5) })).toMatchObject({ completed: 0, failed: 1 });
    expect(next.seen.users).toEqual([]);
  });

  it('removes every face asset at the provider before its group, whatever state the group is in', async () => {
    // A group that failed or was revoked still exists at the provider; an evicted one was already removed there.
    await h.sql.query(`update identity_groups set status='revoked' where user_id=$1`, [USER.buyer]);
    await h.sql.query(`insert into identity_assets (user_id, group_id, asset_id, photo_sha256, status) values ($1, 'grp-buyer', 'ast-buyer-2', $2, 'Failed')`, [USER.buyer, 'c'.repeat(64)]);
    const order: string[] = [];
    const { deps } = fakes(h.sql);
    deps.provider = {
      async deleteAsset(assetId) { order.push(`asset:${assetId}`); },
      async deleteAssetGroup(groupId) { order.push(`group:${groupId}`); },
    };
    expect(await deleteAccountNow(deps, id, { now: later(3) })).toMatchObject({ ok: true });
    expect((await row()).cleanup).toMatchObject({ providerAssets: ['ast-buyer-1', 'ast-buyer-2'], providerGroups: ['grp-buyer'] });
    expect(await finishDeletion(deps, id, later(3))).toEqual({ ok: true, status: 'completed' });
    expect(order).toEqual(['asset:ast-buyer-1', 'asset:ast-buyer-2', 'group:grp-buyer']);
  });

  it('does not list a group the provider has already forgotten, and leaves a group alone while one of its assets is left', async () => {
    await h.sql.query('delete from identity_assets where user_id=$1', [USER.buyer]);
    await h.sql.query(`update identity_groups set status='evicted' where user_id=$1`, [USER.buyer]);
    const evicted = fakes(h.sql);
    expect(await deleteAccountNow(evicted.deps, id, { now: later(3) })).toMatchObject({ ok: true });
    expect((await row()).cleanup).toMatchObject({ providerAssets: [], providerGroups: [] });
  });

  it('keeps the group on the list while an asset refuses to go', async () => {
    const broken = fakes(h.sql, { asset: true });
    expect(await deleteAccountNow(broken.deps, id, { now: later(3) })).toMatchObject({ ok: true });
    expect(await finishDeletion(broken.deps, id, later(3))).toEqual({ ok: false, code: 'cleanupLeft', left: 2 });
    expect(broken.seen.groups).toEqual([]);
    expect(await row()).toMatchObject({ cleanup: { providerAssets: ['ast-buyer-1'], providerGroups: ['grp-buyer'] } });
    expect(String((await row()).last_error)).toMatch(/^provider: /);
  });

  it('leaves the account whole when the cleanup tools are missing, rather than orphaning files', async () => {
    expect(await deleteAccountNow({ sql: h.sql, files: null, auth: null, provider: null }, id, { now: later(3) })).toEqual({ ok: false, code: 'unavailable' });
    expect(await row()).toMatchObject({ status: 'requested', user_id: USER.buyer });
  });

  it('takes a pet or partner photo with it, though those rows hang on the sign-in account and not on the profile', async () => {
    // docs/CAST-CATEGORIES.md — an extra photo for one render; the render id here has no job yet.
    const ref = '51070000-0000-4000-8000-000000000001';
    await h.sql.query(
      `insert into render_slot_inputs (render_id, slot, user_id, template_id, storage_key, mime, partner_consent_at, expires_at)
       values ($1, 'partner', $2, $3, $4, 'image/jpeg', now(), now() + interval '7 days')`,
      [ref, USER.buyer, account.template.id, `${ref}/slot-partner.jpg`],
    );
    const { deps, seen } = fakes(h.sql);
    expect(await deleteAccountNow(deps, id, { now: later(3) })).toMatchObject({ ok: true });
    // Gone with the profile, before the sign-in account is touched.
    expect((await h.db.query('select count(*)::int n from render_slot_inputs')).rows[0]).toEqual({ n: 0 });
    expect(seen.users).toEqual([]);
    expect(((await row()).cleanup as { folders: string[] }).folders).toContain(ref);
    await finishDeletion(deps, id, later(3));
    expect(seen.folders).toContain(ref);
  });

  it('holds an account that a table hung straight on the sign-in row would strand', async () => {
    await h.db.query('create table later_ledger (owner uuid not null references auth.users(id))');
    await h.db.query('insert into later_ledger values ($1)', [USER.buyer]);
    const holds = await deletionHolds(h.sql, USER.buyer, now);
    expect(holds).toEqual({ wait: [], review: ['records'], tables: ['later_ledger'] });
    expect(await deleteAccountNow(fakes(h.sql).deps, id, { now: later(3) })).toEqual({ ok: false, code: 'held', hold: ['records'] });
    expect((await h.db.query('select count(*)::int n from profiles where id=$1', [USER.buyer])).rows[0]).toEqual({ n: 1 });
  });

  it('destroys nothing when a row it did not know about refuses the delete', async () => {
    // A second-level reference the catalogue scan cannot see: something that restricts a render.
    await h.db.query('create table later_feature (render_id uuid not null references render_jobs(id) on delete restrict)');
    await h.db.query('insert into later_feature values ($1)', [account.render]);
    const { deps, seen } = fakes(h.sql);
    expect(await deleteAccountNow(deps, id, { now: later(3) })).toEqual({ ok: false, code: 'held', hold: ['records'] });
    const after = await row();
    expect(after).toMatchObject({ status: 'requested', user_id: USER.buyer, hold: ['records'], attempts: 1, cleanup: null });
    expect(String(after.last_error)).toContain('later_feature');
    expect(seen).toEqual({ folders: [], users: [], assets: [], groups: [] });
    // Nothing moved: the photo marker and the analytics rows are as they were.
    expect((await h.db.query('select input_deleted_at from billing_payments where id=$1', [ORDER])).rows[0]).toEqual({ input_deleted_at: null });
    expect((await h.db.query('select count(*)::int n from events where user_id=$1', [USER.buyer])).rows[0]).toEqual({ n: 1 });
  });
});

describe('the daily pass', () => {
  let h: PromptHarness;
  beforeEach(async () => {
    h = await promptHarness();
    await seedAccount(h);
  });
  afterEach(async () => h.close());

  it('acts only on requests whose grace period has run out, and reports counts only', async () => {
    const r = await requestAccountDeletion(h.sql, member, true, now, 3);
    if (!r.ok) throw new Error('request failed');
    const early = fakes(h.sql);
    expect(await runDeletionPass(early.deps, { now: later(2) })).toEqual({ ready: true, deleted: 0, completed: 0, held: 0, failed: 0 });
    const due = fakes(h.sql);
    expect(await runDeletionPass(due.deps, { now: later(3) })).toEqual({ ready: true, deleted: 1, completed: 1, held: 0, failed: 0 });
    expect(due.seen.users).toEqual([USER.buyer]);
    expect(await countDeletionQueue(h.sql)).toBe(0);
  });

  it('does not call a hand-removed account done: its files and provider assets were never checked', async () => {
    const r = await requestAccountDeletion(h.sql, member, true, now, 3);
    if (!r.ok) throw new Error('request failed');
    await seedProfile(h.sql, { id: ADMIN, isAdmin: true });
    // Removed in a console: the rows that knew where the files were went with it.
    await h.db.query('delete from auth.users where id=$1', [USER.buyer]);
    const { deps, seen } = fakes(h.sql);
    expect(await runDeletionPass(deps, { now: later(1) })).toEqual({ ready: true, deleted: 0, completed: 0, held: 1, failed: 0 });
    expect(seen).toEqual({ folders: [], users: [], assets: [], groups: [] });
    const waiting = (await h.db.query<{ status: string; last_error: string; attempts: number }>('select status, last_error, attempts from account_deletion_requests')).rows[0]!;
    expect(waiting).toMatchObject({ status: 'requested', attempts: 1 });
    expect(waiting.last_error).toMatch(/removed outside/);
    expect(await countDeletionQueue(h.sql, later(1))).toBe(1);
    // The next day says the same thing without counting another attempt.
    await runDeletionPass(deps, { now: later(2) });
    expect((await h.db.query('select attempts from account_deletion_requests')).rows[0]).toEqual({ attempts: 1 });

    // "Delete now" has nothing to delete; an operator closes it with a word on what they checked.
    expect(await decideDeletion(deps, admin, 'run', { id: r.request.id, confirm: 'me@twings.test' }, later(2))).toEqual({ ok: false, code: 'removedElsewhere' });
    expect(await decideDeletion(deps, admin, 'complete', { id: r.request.id }, later(2))).toEqual({ ok: false, code: 'invalid' });
    expect(await decideDeletion(deps, admin, 'complete', { id: r.request.id, note: 'storage and provider console checked by hand' }, later(2))).toEqual({ ok: true, status: 'completed' });
    expect((await h.db.query('select status, email from account_deletion_requests')).rows[0]).toEqual({ status: 'completed', email: null });
  });

  it('runs only behind the cron secret, and only after the render and payment pass went through', () => {
    // The tick used to be "open but harmless" without a secret. It deletes accounts now.
    expect(deletionPassGate({ cronSecret: undefined, renderPassOk: true })).toBe('no_secret');
    expect(deletionPassGate({ cronSecret: '  ', renderPassOk: true })).toBe('no_secret');
    // A pass that threw may not have settled a refund: an account it would have held must not go today.
    expect(deletionPassGate({ cronSecret: 's3cret', renderPassOk: false })).toBe('render_pass_failed');
    expect(deletionPassGate({ cronSecret: 's3cret', renderPassOk: true })).toBe('run');
  });

  it('counts a held account and tries again the next day', async () => {
    await requestAccountDeletion(h.sql, member, true, now, 0);
    await h.sql.query(`update render_jobs set status='queued', error_code=null`);
    expect(await runDeletionPass(fakes(h.sql).deps, { now: later(1) })).toMatchObject({ deleted: 0, held: 1 });
    await h.sql.query(`update render_jobs set status='failed', error_code='fixture'`);
    expect(await runDeletionPass(fakes(h.sql).deps, { now: later(2) })).toMatchObject({ deleted: 1, completed: 1, held: 0 });
  });
});

describe('the operator works the queue', () => {
  let h: PromptHarness;
  let id: string;
  beforeEach(async () => {
    h = await promptHarness();
    await seedAccount(h);
    await seedProfile(h.sql, { id: ADMIN, isAdmin: true });
    const r = await requestAccountDeletion(h.sql, member, true, now, 3);
    if (!r.ok) throw new Error('request failed');
    id = r.request.id;
  });
  afterEach(async () => h.close());

  it('re-reads is_admin under the decision', async () => {
    await h.db.query('update profiles set is_admin=false where id=$1', [ADMIN]);
    expect(await decideDeletion(fakes(h.sql).deps, admin, 'run', { id }, now)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('shows what the request is waiting on, and deletes now without waiting for the grace period', async () => {
    await h.sql.query(`update render_jobs set status='running', error_code=null`);
    const { deps } = fakes(h.sql);
    expect(await decideDeletion(deps, admin, 'run', { id, confirm: 'me@twings.test' }, now)).toEqual({ ok: false, code: 'held', hold: ['render'] });
    const waiting = await loadDeletionQueue(h.sql);
    expect(waiting?.open[0]).toMatchObject({ email: 'me@twings.test', accountExists: true, status: 'requested', hold: ['render'], attempts: 1, cleanupLeft: 0 });

    await h.sql.query(`update render_jobs set status='failed', error_code='fixture'`);
    expect(await decideDeletion(deps, admin, 'run', { id, confirm: 'me@twings.test' }, now)).toEqual({ ok: true, status: 'completed' });
    expect((await h.db.query('select started_by, status from account_deletion_requests')).rows[0]).toEqual({ started_by: ADMIN, status: 'completed' });
    expect((await loadDeletionQueue(h.sql))?.closed[0]).toMatchObject({ status: 'completed', accountExists: false, removed: { selfies: 1, renders: 1 } });
  });

  it('asks the operator to type the account before skipping the grace period', async () => {
    const { deps, seen } = fakes(h.sql);
    expect(deletionConfirmPhrase('Me@Twings.test ')).toBe('me@twings.test');
    expect(deletionConfirmPhrase(null)).toBe('DELETE');
    for (const confirm of [undefined, '', 'someone@else.test', 'DELETE']) {
      expect(await decideDeletion(deps, admin, 'run', confirm === undefined ? { id } : { id, confirm }, now), String(confirm)).toEqual({ ok: false, code: 'unconfirmed' });
    }
    expect(seen.users).toEqual([]);
    expect((await h.db.query('select status, attempts from account_deletion_requests')).rows[0]).toEqual({ status: 'requested', attempts: 0 });
    // Case and stray spaces do not matter; the address does.
    expect(await decideDeletion(deps, admin, 'run', { id, confirm: ' ME@twings.test' }, now)).toEqual({ ok: true, status: 'completed' });
  });

  it('retries the cleanup of a request already past the point of no return', async () => {
    const broken = fakes(h.sql, { auth: true });
    expect(await decideDeletion(broken.deps, admin, 'run', { id, confirm: 'me@twings.test' }, now)).toEqual({ ok: false, code: 'cleanupLeft', left: 1 });
    expect((await loadDeletionQueue(h.sql))?.open[0]).toMatchObject({ status: 'processing', accountExists: false, cleanupLeft: 1 });
    expect(await decideDeletion(fakes(h.sql).deps, admin, 'run', { id }, now)).toEqual({ ok: true, status: 'completed' });
  });

  it('marks a request done by hand only once the account is gone, and with a note when cleanup is left', async () => {
    const { deps } = fakes(h.sql);
    expect(await decideDeletion(deps, admin, 'complete', { id }, now)).toEqual({ ok: false, code: 'accountExists', from: 'requested' });
    const broken = fakes(h.sql, { provider: true });
    await decideDeletion(broken.deps, admin, 'run', { id, confirm: 'me@twings.test' }, now);
    expect(await decideDeletion(deps, admin, 'complete', { id }, now)).toEqual({ ok: false, code: 'invalid' });
    expect(await decideDeletion(deps, admin, 'complete', { id, note: 'group removed in the provider console' }, now)).toEqual({ ok: true, status: 'completed' });
    expect((await h.db.query('select status, email, cleanup, closed_by, note from account_deletion_requests')).rows[0]).toEqual({
      status: 'completed', email: null, cleanup: null, closed_by: ADMIN, note: 'group removed in the provider console',
    });
  });

  it('closes a request only with a reason, and never one whose account is already gone', async () => {
    const { deps } = fakes(h.sql);
    expect(await decideDeletion(deps, admin, 'cancel', { id }, now)).toEqual({ ok: false, code: 'invalid' });
    expect(await decideDeletion(deps, admin, 'cancel', { id, note: 'member asked by mail to keep the account' }, now)).toEqual({ ok: true, status: 'cancelled' });
    expect((await h.db.query('select email, note from account_deletion_requests')).rows[0]).toEqual({ email: null, note: 'member asked by mail to keep the account' });

    const again = await requestAccountDeletion(h.sql, member, true, now, 3);
    if (!again.ok) throw new Error('request failed');
    await decideDeletion(fakes(h.sql, { auth: true }).deps, admin, 'run', { id: again.request.id, confirm: 'me@twings.test' }, now);
    expect(await decideDeletion(deps, admin, 'cancel', { id: again.request.id, note: 'too late' }, now)).toEqual({ ok: false, code: 'badTransition', from: 'processing' });
  });

  it('is in the one admin registry', () => {
    for (const name of ['account.deletion.run', 'account.deletion.complete', 'account.deletion.cancel']) expect(Object.keys(ADMIN_OPERATIONS)).toContain(name);
    const cancel = (ADMIN_OPERATIONS as unknown as Record<string, { parse(form: FormData): { ok: boolean } }>)['account.deletion.cancel']!;
    const form = new FormData();
    form.set('id', id);
    expect(cancel.parse(form)).toMatchObject({ ok: false });
  });
});
