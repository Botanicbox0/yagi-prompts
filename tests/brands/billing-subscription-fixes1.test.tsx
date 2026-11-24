import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creditsLeft } from '@/lib/brand-studio/credits';
import { loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { draftBrandInvoice, issueBrandInvoice, markBrandInvoicePaid, saveBrandBillingProfileAdmin } from '@/lib/brands/billing';
import { loadPlanAssignment } from '@/lib/brands/plans';
import {
  cancelSubscription,
  loadBrandSubscription,
  reconcileSubscriptionInTx,
  runBrandSubscriptionTick,
  scheduleDowngrade,
  undoCancelSubscription,
} from '@/lib/brands/subscriptions';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/** B1c-2 fix round 1 (notes: B1c2-fixes-1.md): the founder's 50% change (A) and review findings B1–B7, on the real service. */

const ssrMocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/brand-workspace',
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => ADMIN_VIEWER, getViewer: async () => ADMIN_VIEWER }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ssrMocks.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
  publicHref: (p: string) => `https://twings.app${p}`,
}));

const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };
let h: AdminHarness;
let sql: SqlRunner;
const at = (iso: string) => () => new Date(iso);
const tick = (iso: string) => runBrandSubscriptionTick({ sql, now: at(iso) });

async function makeOrg(name: string): Promise<string> {
  const res = await createStudioOrganization({ sql }, ADMIN_VIEWER, { name, requestId: randomUUID() });
  if (!res.ok) throw new Error(res.code);
  await saveBrandBillingProfileAdmin({ sql }, ADMIN_VIEWER, {
    organizationId: res.id,
    companyLegalName: name,
    businessRegNo: '111-11-11119',
    representativeName: 'Fixture Owner',
    businessAddress: 'Seoul',
    taxInvoiceEmail: 'billing@fixture.invalid',
    contactName: 'Ops',
    contactPhone: '02-000-0000',
  });
  return res.id;
}

async function start(orgId: string, day: string, extra: Record<string, unknown> = {}) {
  const s = await startConfirmed({ sql, now: at(`${day}T01:00:00Z`) }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_69', ...extra });
  if (!s.ok || !s.applied) throw new Error(`start failed: ${JSON.stringify(s)}`);
  return s;
}

const pay = (invoiceId: string, nowIso: string, paidAt?: string) =>
  markBrandInvoicePaid({ sql, now: at(nowIso) }, ADMIN_VIEWER, { invoiceId, paidMethod: 'transfer', ...(paidAt ? { paidAt } : {}) });

async function paidFrom(orgId: string, day: string) {
  const s = await start(orgId, day);
  expect(await pay(s.firstInvoiceId, `${day}T03:00:00Z`, day)).toMatchObject({ ok: true });
  return s;
}

async function row(id: string) {
  return (
    await sql.query<{ status: string; period: string; cycle_start: string | null; cycle_end: string | null; due_on: string | null; plan_id: string; base_list_krw: number; paid_at: unknown; void_reason: string }>(
      `select status, period, cycle_start::text as cycle_start, cycle_end::text as cycle_end, due_on::text as due_on, plan_id, base_list_krw, paid_at, void_reason
         from brand_invoices where id = $1`,
      [id],
    )
  ).rows[0]!;
}

async function subInvoices(orgId: string) {
  return (
    await sql.query<{ id: string; status: string; period: string; cycle_start: string | null; cycle_end: string | null; due_on: string | null; plan_id: string; base_list_krw: number; void_reason: string }>(
      `select id::text as id, status, period, cycle_start::text as cycle_start, cycle_end::text as cycle_end, due_on::text as due_on, plan_id, base_list_krw, void_reason
         from brand_invoices where organization_id = $1 and kind = 'subscription' order by created_at, id`,
      [orgId],
    )
  ).rows;
}

const use = (orgId: string, krw: number, iso: string) =>
  sql.query(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, estimate_krw, usage_krw, created_at, finished_at)
     values ($1, $2, $3, 'image', 'succeeded', 'seedream-5.5', 'p', $4, $4, $5, $5)`,
    [orgId, ADMIN_VIEWER.userId, `use_${randomUUID().slice(0, 12)}`, krw, iso],
  );

async function renderOrg(id: string): Promise<string> {
  const OrgDetailPage = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;
  return new Response(
    (await prerender(await OrgDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) })).prelude,
  ).text();
}

beforeEach(async () => {
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  h = await adminHarness();
  sql = runner(h.db);
  ssrMocks.sql = sql;
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  await sql.query(
    "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000) on conflict (plan_id) do update set monthly_cap_krw = excluded.monthly_cap_krw",
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await h.close();
});

describe('A (founder 2026-11-24): the 50% cap applies only after the due date', () => {
  it('early access: full the day before and ON the due date, half from the next KST day (14:59:59Z / 15:00:00Z)', async () => {
    const orgId = await makeOrg('Half After Due Fixture');
    await start(orgId, '2026-11-10', { activateBeforePayment: true, confirm: true }); // due Nov 24
    const load = (iso: string) => loadAllowance(sql, orgId, STUDIO, new Date(iso));
    expect(await load('2026-11-23T14:59:59Z')).toMatchObject({ baseCapKrw: 650_000 }); // Nov 23
    expect(await load('2026-11-23T15:00:00Z')).toMatchObject({ baseCapKrw: 650_000 }); // Nov 24 00:00 KST (due date)
    const lastSecond = await load('2026-11-24T14:59:59Z'); // Nov 24 23:59:59 KST
    expect(lastSecond).toMatchObject({ baseCapKrw: 650_000 });
    expect(lastSecond).not.toHaveProperty('planCapHalvedUnpaid');
    expect(await load('2026-11-24T15:00:00Z')).toMatchObject({ baseCapKrw: 325_000, planCapHalvedUnpaid: true }); // Nov 25 00:00 KST
  });

  it('usage already above 50% when the due date passes: reservations refused, credits left 0 (never negative), nothing taken back; payment restores', async () => {
    const orgId = await makeOrg('Half Over Usage Fixture');
    const s = await start(orgId, '2026-11-10', { activateBeforePayment: true, confirm: true });
    await use(orgId, 400_000, '2026-11-20T03:00:00Z');
    const after = await loadAllowance(sql, orgId, STUDIO, new Date('2026-11-25T01:00:00Z'));
    expect(after).toMatchObject({ capKrw: 325_000, usedKrw: 400_000 });
    expect(creditsLeft(after.capKrw, after.usedKrw)).toBe(0);
    expect(await sql.transaction((tx) => reserveAllowance(tx, orgId, 10, STUDIO, new Date('2026-11-25T01:00:00Z')))).toEqual({
      ok: false,
      code: 'allowance_exhausted',
    });
    const jobs = (await sql.query<{ n: number; used: number }>('select count(*)::int as n, sum(usage_krw)::int as used from brand_studio_jobs where organization_id = $1', [orgId])).rows[0]!;
    expect(jobs).toEqual({ n: 1, used: 400_000 });
    expect(await pay(s.firstInvoiceId, '2026-11-26T01:00:00Z')).toMatchObject({ ok: true });
    const paid = await loadAllowance(sql, orgId, STUDIO, new Date('2026-11-26T02:00:00Z'));
    expect(paid).toMatchObject({ capKrw: 650_000, usedKrw: 400_000 });
    expect(creditsLeft(paid.capKrw, paid.usedKrw)).toBe(25_000);
  });

  it('two unpaid invoices (older overdue, newer not yet due): paying only the newer keeps half; paying the older restores', async () => {
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '30');
    const orgId = await makeOrg('Half Two Unpaid Fixture');
    await paidFrom(orgId, '2026-11-10');
    for (const d of ['2026-12-03', '2026-12-10']) await tick(`${d}T01:00:00Z`);
    expect(await loadAllowance(sql, orgId, { ...STUDIO, planGraceDays: 30 }, new Date('2026-12-24T01:00:00Z'))).toMatchObject({ baseCapKrw: 650_000 });
    await tick('2026-12-25T01:00:00Z');
    expect(await loadAllowance(sql, orgId, { ...STUDIO, planGraceDays: 30 }, new Date('2026-12-25T02:00:00Z'))).toMatchObject({ baseCapKrw: 325_000 });
    for (const d of ['2027-01-03', '2027-01-10']) await tick(`${d}T01:00:00Z`);
    const invs = await subInvoices(orgId);
    const dec = invs.find((i) => i.cycle_start === '2026-12-10')!;
    const jan = invs.find((i) => i.cycle_start === '2027-01-10')!;
    expect(jan).toMatchObject({ status: 'issued', due_on: '2027-01-24' });
    expect(await pay(jan.id, '2027-01-11T01:00:00Z')).toMatchObject({ ok: true });
    expect(await loadAllowance(sql, orgId, { ...STUDIO, planGraceDays: 30 }, new Date('2027-01-11T02:00:00Z'))).toMatchObject({ baseCapKrw: 325_000 });
    expect(await pay(dec.id, '2027-01-12T01:00:00Z')).toMatchObject({ ok: true });
    expect(await loadAllowance(sql, orgId, { ...STUDIO, planGraceDays: 30 }, new Date('2027-01-12T02:00:00Z'))).toMatchObject({ baseCapKrw: 650_000 });
  });
});

describe('B1: the first-payment date is bounded', () => {
  it('reviewer probe: a new epoch cannot take a paid date before its start (nothing written); the start day itself works', async () => {
    const orgId = await makeOrg('Paid Before Start Fixture');
    await paidFrom(orgId, '2026-10-20');
    await cancelSubscription({ sql, now: at('2026-11-10T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    await tick('2026-11-20T01:00:00Z');
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'ended' });
    const again = await start(orgId, '2026-11-25');
    const before = (await sql.query<{ n: number }>('select count(*)::int as n from brand_invoice_events where invoice_id = $1', [again.firstInvoiceId])).rows[0]!.n;
    expect(await pay(again.firstInvoiceId, '2026-11-25T03:00:00Z', '2026-11-10')).toMatchObject({ ok: false, detail: 'paid_at_before_start' });
    expect(await row(again.firstInvoiceId)).toMatchObject({ status: 'issued', paid_at: null, cycle_start: null });
    expect((await sql.query<{ n: number }>('select count(*)::int as n from brand_invoice_events where invoice_id = $1', [again.firstInvoiceId])).rows[0]!.n).toBe(before);
    expect(await pay(again.firstInvoiceId, '2026-11-25T03:00:00Z', '2026-11-25')).toMatchObject({ ok: true });
    expect(await row(again.firstInvoiceId)).toMatchObject({ status: 'paid', cycle_start: '2026-11-25', cycle_end: '2026-12-25' });
  });

  it('a deposit dated after the start but before a reissue is accepted (the bound is the epoch start, not the reissue)', async () => {
    const orgId = await makeOrg('Paid Before Reissue Fixture');
    const s = await start(orgId, '2026-11-10');
    const { voidBrandInvoice } = await import('@/lib/brands/billing');
    await voidBrandInvoice({ sql, now: at('2026-11-12T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, reason: 'redo' });
    const { reissueConfirmed } = await import('@/tests/brands/helpers/subscription-confirm');
    const re = await reissueConfirmed({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-11' });
    if (!re.ok || !re.applied) throw new Error(`reissue failed: ${JSON.stringify(re)}`);
    expect(await pay(re.invoice.id, '2026-11-21T01:00:00Z', '2026-11-15')).toMatchObject({ ok: true });
    expect(await row(re.invoice.id)).toMatchObject({ status: 'paid', cycle_start: '2026-11-15', cycle_end: '2026-12-15' });
  });

  it('a paid date whose cycle would overlap another subscription invoice (any epoch, legacy by month) is refused', async () => {
    const orgId = await makeOrg('Paid Overlap Fixture');
    const s = await start(orgId, '2026-11-25');
    await sql.query(
      `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent, discount_krw, supply_krw, vat_krw, total_krw, status, issued_at, kind)
       values (gen_random_uuid(), $1, '2026-12', 'b2b_69', 690000, 690000, 0, 0, 690000, 69000, 759000, 'issued', '2026-11-25T05:00:00Z', 'subscription')`,
      [orgId],
    );
    expect(await pay(s.firstInvoiceId, '2026-11-26T03:00:00Z', '2026-11-26')).toMatchObject({ ok: false, detail: 'paid_at_overlaps_cycle' });
    expect(await row(s.firstInvoiceId)).toMatchObject({ status: 'issued', paid_at: null });
  });

  it('the job never turns an out-of-bounds paid date (recorded while the flag was off) into cycle 0', async () => {
    const orgId = await makeOrg('Paid Bound Engine Fixture');
    const s = await start(orgId, '2026-11-25');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    expect(await pay(s.firstInvoiceId, '2026-11-26T03:00:00Z', '2026-11-20')).toMatchObject({ ok: true });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await tick('2026-11-27T01:00:00Z');
    expect(await row(s.firstInvoiceId)).toMatchObject({ status: 'paid', cycle_start: null });
    expect(await loadPlanAssignment(sql, orgId)).toBeNull();
    const sub = await loadBrandSubscription(sql, orgId);
    expect(sub).toMatchObject({ status: 'pending' });
    expect(sub!.lastReconcileError).toContain('paid_at_before_start');
  });
});

describe('B2: a subscription always starts today (KST)', () => {
  it('a back-dated start is refused; without a date it starts today and is due today + 14, in both early-access modes', async () => {
    const orgId = await makeOrg('Start Today Fixture');
    expect(
      await startConfirmed({ sql, now: at('2026-11-24T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_69', startedOn: '2026-11-01' }),
    ).toMatchObject({ ok: false, field: 'startedOn', detail: 'started_on_must_be_today' });
    const s = await start(orgId, '2026-11-24');
    expect(s.subscription).toMatchObject({ startedOn: '2026-11-24' });
    expect(await row(s.firstInvoiceId)).toMatchObject({ status: 'issued', due_on: '2026-12-08', cycle_start: null });

    const early = await makeOrg('Start Today Early Fixture');
    const e = await start(early, '2026-11-24', { activateBeforePayment: true, confirm: true });
    expect(await row(e.firstInvoiceId)).toMatchObject({ due_on: '2026-12-08', cycle_start: '2026-11-24', cycle_end: '2026-12-24' });
    expect(await loadPlanAssignment(sql, early)).toMatchObject({ startedOn: '2026-11-24', endsOn: '2026-12-08' });
  });

  it('the start operation takes no date and the form shows "오늘 시작" read-only', async () => {
    const { ADMIN_OPERATIONS } = await import('@/lib/admin/operations');
    const fd = new FormData();
    fd.set('organizationId', randomUUID());
    fd.set('planId', 'b2b_69');
    fd.set('startedOn', '2026-11-01');
    const parsed = ADMIN_OPERATIONS['brandSubscription.start'].parse(fd);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.value).not.toHaveProperty('startedOn');
    const orgId = await makeOrg('Start Today Form Fixture');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T01:00:00Z'));
    const html = await renderOrg(orgId);
    const form = html.slice(html.indexOf('data-subscription-start-note'), html.indexOf('data-subscription-start-note') + 6000);
    expect(form).toContain('data-subscription-start-today');
    expect(form).toContain('2026-11-24');
    expect(form).not.toContain('name="startedOn"');
  });
});

describe('B3: a cycle that ended without a job run restarts on today', () => {
  it('one skipped cycle: no invoice for the ended cycle, a full-price cycle from today, active again in one run', async () => {
    const orgId = await makeOrg('Skipped One Fixture');
    await paidFrom(orgId, '2026-11-17');
    await tick('2026-12-08T01:00:00Z');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    await tick('2027-01-10T01:00:00Z');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const t = await tick('2027-02-01T01:00:00Z');
    expect(t).toMatchObject({ errors: 0, partialFailures: 0 });
    const live = (await subInvoices(orgId)).filter((i) => i.status !== 'void');
    expect(live.map((i) => i.cycle_start)).toEqual(['2026-11-17', '2027-02-01']);
    expect(live[1]).toMatchObject({ status: 'issued', cycle_end: '2027-03-01', due_on: '2027-02-15', base_list_krw: 690_000 });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active', reconcileFailures: 0 });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2027-02-01', endsOn: '2027-02-15' });
  });

  it('a draft made before the outage is voided by the system; several skipped cycles restart the same way', async () => {
    const orgId = await makeOrg('Skipped Many Fixture');
    await paidFrom(orgId, '2026-11-17');
    await tick('2026-12-10T01:00:00Z');
    const draft = (await subInvoices(orgId)).find((i) => i.cycle_start === '2026-12-17')!;
    expect(draft.status).toBe('draft');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await tick('2027-04-05T01:00:00Z');
    expect(await row(draft.id)).toMatchObject({ status: 'void', void_reason: 'stale_system_draft' });
    const live = (await subInvoices(orgId)).filter((i) => i.status !== 'void');
    expect(live.map((i) => [i.cycle_start, i.status])).toEqual([
      ['2026-11-17', 'paid'],
      ['2027-04-05', 'issued'],
    ]);
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active', reconcileFailures: 0 });
  });
});

describe('B4: held adoption rows are reported', () => {
  it('reviewer probe: a legacy December invoice paid while the flag was off, subscription pending → held, counted, noticed, shown', async () => {
    const orgId = await makeOrg('Held Row Fixture');
    await start(orgId, '2026-11-10');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const drafted = await draftBrandInvoice({ sql, now: at('2026-11-12T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-12', planId: 'b2b_69' });
    if (!drafted.ok) throw new Error(drafted.code);
    expect(await issueBrandInvoice({ sql, now: at('2026-11-12T02:00:00Z') }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id })).toMatchObject({ ok: true });
    expect(await pay(drafted.invoice.id, '2026-11-13T01:00:00Z')).toMatchObject({ ok: true });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const t = await tick('2026-11-14T01:00:00Z');
    expect(t).toMatchObject({ held: 1 });
    const notices = (await sql.query<{ preview: string }>("select preview from team_notice_deliveries where kind = 'ops_alert' order by created_at, id")).rows.map((r) => r.preview);
    expect(notices.some((p) => p.includes('편입 보류 1건'))).toBe(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T02:00:00Z'));
    const html = await renderOrg(orgId);
    expect(html).toContain('data-subscription-held');
    expect(html).toContain('2026-12');
    expect(html).toContain('플랜 배정이 없음');
  });
});

describe('B5: cancel then undo keeps a scheduled downgrade', () => {
  it('the Feb 17 invoice is drafted and issued at the downgraded plan after cancel + undo; ending clears it', async () => {
    const orgId = await makeOrg('Cancel Keeps Downgrade Fixture');
    await paidFrom(orgId, '2027-01-17');
    expect(await scheduleDowngrade({ sql, now: at('2027-01-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' })).toMatchObject({ ok: true });
    await cancelSubscription({ sql, now: at('2027-01-25T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ cancelAtPeriodEnd: true, pendingPlanId: 'b2b_29' });
    await undoCancelSubscription({ sql, now: at('2027-01-26T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ cancelAtPeriodEnd: false, pendingPlanId: 'b2b_29' });
    for (const d of ['2027-02-10', '2027-02-17']) await tick(`${d}T01:00:00Z`);
    const feb = (await subInvoices(orgId)).find((i) => i.cycle_start === '2027-02-17' && i.status !== 'void')!;
    expect(feb).toMatchObject({ status: 'issued', plan_id: 'b2b_29', base_list_krw: 290_000 });

    const other = await makeOrg('Cancel Ends Downgrade Fixture');
    await paidFrom(other, '2027-01-17');
    await scheduleDowngrade({ sql, now: at('2027-01-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: other, planId: 'b2b_29' });
    await cancelSubscription({ sql, now: at('2027-01-25T01:00:00Z') }, ADMIN_VIEWER, { organizationId: other });
    await tick('2027-02-17T01:00:00Z');
    expect(await loadBrandSubscription(sql, other)).toMatchObject({ status: 'ended', pendingPlanId: null });
  });
});

describe('B6: a failed plan change holds the cycle being billed', () => {
  it('applyPendingPlan fails on the boundary → that cycle is not issued in this run; the next run issues it at the new plan', async () => {
    const orgId = await makeOrg('Pending Plan Failure Fixture');
    await paidFrom(orgId, '2027-01-17');
    await scheduleDowngrade({ sql, now: at('2027-01-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' });
    await tick('2027-02-10T01:00:00Z');
    await sql.query(`create or replace function test_fail_plan_change() returns trigger language plpgsql as $$
      begin
        if new.plan_id is distinct from old.plan_id then raise exception 'forced plan change failure' using errcode = '23514'; end if;
        return new;
      end $$`);
    await sql.query('create trigger test_fail_plan_change before update on brand_subscriptions for each row execute function test_fail_plan_change()');
    // The failed plan change holds the cycle it belongs to (Feb 17) at once: one attempt, not one per billing pass.
    const summary = await sql.transaction((tx) =>
      reconcileSubscriptionInTx(tx, { organizationId: orgId, actor: { kind: 'system' }, now: new Date('2027-02-17T01:00:00Z') }),
    );
    expect(summary.failures).toHaveLength(1);
    expect(summary.issuedPeriods).toEqual([]);
    const t = await tick('2027-02-17T01:30:00Z');
    expect(t).toMatchObject({ errors: 0, partialFailures: 1 });
    const feb = (await subInvoices(orgId)).find((i) => i.cycle_start === '2027-02-17' && i.status !== 'void')!;
    expect(feb.status).toBe('draft');
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_69', pendingPlanId: 'b2b_29' });
    await sql.query('drop trigger test_fail_plan_change on brand_subscriptions');
    await tick('2027-02-17T02:00:00Z');
    expect((await subInvoices(orgId)).find((i) => i.cycle_start === '2027-02-17' && i.status !== 'void')).toMatchObject({ status: 'issued', plan_id: 'b2b_29' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_29', pendingPlanId: null });
  });
});

describe('Found by the extended property test: an early-access reissue never bills suspended days', () => {
  it('cycle 0 voided after it ended → the reissue starts a new cycle today; voided while it runs → same dates and due date', async () => {
    const orgId = await makeOrg('Early Reissue Restart Fixture');
    const s = await start(orgId, '2026-11-10', { activateBeforePayment: true, confirm: true }); // cycle 0 Nov 10 – Dec 10, due Nov 24
    for (const d of ['2026-11-25', '2026-12-09', '2026-12-12']) await tick(`${d}T01:00:00Z`);
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'suspended' });
    const { voidBrandInvoice } = await import('@/lib/brands/billing');
    await voidBrandInvoice({ sql, now: at('2026-12-15T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, reason: 'customer asked' });
    const { reissueConfirmed } = await import('@/tests/brands/helpers/subscription-confirm');
    const re = await reissueConfirmed({ sql, now: at('2026-12-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-12' });
    if (!re.ok || !re.applied) throw new Error(`reissue failed: ${JSON.stringify(re)}`);
    expect(await row(re.invoice.id)).toMatchObject({ status: 'issued', cycle_start: '2026-12-20', cycle_end: '2027-01-20', due_on: '2027-01-03' });

    const other = await makeOrg('Early Reissue Same Cycle Fixture');
    const o = await start(other, '2026-11-10', { activateBeforePayment: true, confirm: true });
    await voidBrandInvoice({ sql, now: at('2026-11-15T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: o.firstInvoiceId, reason: 'redo' });
    const same = await reissueConfirmed({ sql, now: at('2026-11-16T01:00:00Z') }, ADMIN_VIEWER, { organizationId: other, period: '2026-11' });
    if (!same.ok || !same.applied) throw new Error(`reissue failed: ${JSON.stringify(same)}`);
    expect(await row(same.invoice.id)).toMatchObject({ status: 'issued', cycle_start: '2026-11-10', cycle_end: '2026-12-10', due_on: '2026-11-24' });
  });
});

describe('B7: the first payment sets the cycle, never the period', () => {
  it('a first invoice issued in November and paid on Dec 3 keeps period 2026-11 (a tax invoice may name it)', async () => {
    const orgId = await makeOrg('Keep Period Fixture');
    const s = await start(orgId, '2026-11-28');
    expect(await pay(s.firstInvoiceId, '2026-12-03T03:00:00Z', '2026-12-03')).toMatchObject({ ok: true });
    expect(await row(s.firstInvoiceId)).toMatchObject({ status: 'paid', period: '2026-11', cycle_start: '2026-12-03', cycle_end: '2027-01-03' });
  });
});
