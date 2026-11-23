import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import {
  draftBrandInvoice,
  draftBrandInvoiceInTx,
  issueBrandInvoice,
  listBrandInvoices,
  resolveDraftCycle,
  updateDraftBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing/invoices';
import { nextCycleStart } from '@/lib/brands/billing/cycle';
import { setPlanAssignment } from '@/lib/brands/plans';
import { kstDayOf } from '@/lib/brands/billing/math';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

/**
 * B1c-1 §4: an admin draft for a paid plan organization covers ONE billing cycle of the plan start day, at the full
 * monthly price (no proration), unique per (organization, cycle). Organizations without a plan keep the calendar-month
 * draft exactly as before.
 */
let f: StudioFixture;
const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const at = (iso: string) => () => new Date(iso);
const NOW = at('2026-11-20T01:00:00Z');

beforeEach(async () => {
  f = await studioFixture({ capKrw: null });
  await f.sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-17', null, 1)",
    [f.orgId],
  );
});
afterEach(async () => {
  await f.db.close();
});

/** The operation runs on the real clock: the next cycle of the Nov 17 anchor from today (KST). */
const kstNextCycleStart = () => nextCycleStart('2026-11-17', kstDayOf(new Date()));

const draft = (input: Record<string, unknown>, now = NOW) => draftBrandInvoice({ sql: f.sql, now }, admin(), { organizationId: f.orgId, ...input });

describe('resolveDraftCycle', () => {
  it('this cycle, the next, an exact start or a month; any cycle of the anchor, past ones included (fix round)', () => {
    const anchor = '2027-01-31';
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycle: 'current' })).toEqual({ ok: true, cycle: { index: 1, start: '2027-02-28', end: '2027-03-31' } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycle: 'next' })).toEqual({ ok: true, cycle: { index: 2, start: '2027-03-31', end: '2027-04-30' } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycleStart: '2027-04-30' })).toMatchObject({ ok: true, cycle: { index: 3 } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycleStart: '2027-04-29' })).toEqual({ ok: false, field: 'cycleStart' });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycleStart: '2027-01-31' })).toMatchObject({ ok: true, cycle: { index: 0, end: '2027-02-28' } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycleStart: '2027-01-30' })).toEqual({ ok: false, field: 'cycleStart' });
    expect(resolveDraftCycle(anchor, '2027-03-05', { period: '2027-05' })).toMatchObject({ ok: true, cycle: { start: '2027-05-31', end: '2027-06-30' } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { period: '2027-01' })).toMatchObject({ ok: true, cycle: { index: 0 } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { period: '2026-12' })).toEqual({ ok: false, field: 'period' });
    // Before the plan starts, "this cycle" is the first one.
    expect(resolveDraftCycle('2026-12-17', '2026-11-20', { cycle: 'current' })).toMatchObject({ ok: true, cycle: { index: 0, start: '2026-12-17' } });
  });
});

describe('admin drafts by cycle', () => {
  it('this cycle: Nov 17 → Dec 17, period 2026-11, the full price, no proration', async () => {
    const res = await draft({ cycle: 'current' });
    expect(res).toMatchObject({
      ok: true,
      invoice: {
        period: '2026-11',
        cycleStart: '2026-11-17',
        cycleEnd: '2026-12-17',
        planId: 'b2b_29',
        baseListKrw: 290_000,
        listKrw: 290_000,
        proratedDays: null,
        periodDays: null,
        supplyKrw: 290_000,
        vatKrw: 29_000,
        totalKrw: 319_000,
        status: 'draft',
      },
    });
    expect(await draft({ cycle: 'next' })).toMatchObject({ ok: true, invoice: { period: '2026-12', cycleStart: '2026-12-17', cycleEnd: '2027-01-17', listKrw: 290_000 } });
  });

  it('one non-void invoice per cycle; a void frees the cycle', async () => {
    const first = await draft({ cycle: 'current' });
    if (!first.ok) throw new Error(first.code);
    expect(await draft({ cycleStart: '2026-11-17' })).toEqual({ ok: false, code: 'conflict' });
    expect(await draft({ period: '2026-11' })).toEqual({ ok: false, code: 'conflict' });
    await voidBrandInvoice({ sql: f.sql, now: NOW }, admin(), { invoiceId: first.invoice.id, reason: 'redo' });
    expect(await draft({ cycle: 'current' })).toMatchObject({ ok: true, invoice: { cycleStart: '2026-11-17' } });
  });

  it('a month asked for is the cycle that starts in it; a missed past cycle is billable; non-starts and months before the plan are refused', async () => {
    expect(await draft({ period: '2027-01' })).toMatchObject({ ok: true, invoice: { period: '2027-01', cycleStart: '2027-01-17', cycleEnd: '2027-02-17', listKrw: 290_000 } });
    expect(await draft({ period: '2026-10' })).toEqual({ ok: false, code: 'invalid', field: 'period' });
    expect(await draft({ cycleStart: '2026-12-18' })).toEqual({ ok: false, code: 'invalid', field: 'cycleStart' });
    // A month later the Nov 17 cycle is in the past and was never billed: it can be billed (fix round, B.4).
    expect(await draft({ cycleStart: '2026-11-17' }, at('2026-12-20T01:00:00Z'))).toMatchObject({ ok: true, invoice: { cycleStart: '2026-11-17', cycleEnd: '2026-12-17' } });
    expect(await draft({})).toEqual({ ok: false, code: 'invalid', field: 'period' });
  });

  it('the active discount applies as for any draft, its use counted on issue; manual amounts still work', async () => {
    await f.sql.query(
      "insert into brand_discounts (organization_id, percent, invoices_total, status, created_by) values ($1, 20, 2, 'active', $2)",
      [f.orgId, f.ids.admin],
    );
    const d = await draft({ cycle: 'current' });
    expect(d).toMatchObject({ ok: true, invoice: { discountPercent: 20, discountKrw: 58_000, supplyKrw: 232_000, vatKrw: 23_200, totalKrw: 255_200 } });
    if (!d.ok) throw new Error(d.code);
    expect(await issueBrandInvoice({ sql: f.sql, now: NOW }, admin(), { invoiceId: d.invoice.id })).toMatchObject({ ok: true });
    expect((await f.sql.query('select invoices_used from brand_discounts where organization_id = $1', [f.orgId])).rows[0]).toEqual({ invoices_used: 1 });
    const manual = await draft({ cycle: 'next', manualAmounts: true, manualReason: 'negotiated', supplyKrw: 200_000 });
    expect(manual).toMatchObject({ ok: true, invoice: { manualAmounts: true, supplyKrw: 200_000, cycleStart: '2026-12-17' } });
  });

  it('a cycle draft cannot be prorated afterwards', async () => {
    const d = await draft({ cycle: 'current' });
    if (!d.ok) throw new Error(d.code);
    expect(await updateDraftBrandInvoice({ sql: f.sql, now: NOW }, admin(), { invoiceId: d.invoice.id, proratedDays: 14, periodDays: 30 })).toEqual({
      ok: false,
      code: 'invalid',
      field: 'proratedDays',
    });
    expect(await updateDraftBrandInvoice({ sql: f.sql, now: NOW }, admin(), { invoiceId: d.invoice.id, memo: 'ok' })).toMatchObject({ ok: true, invoice: { memo: 'ok', cycleStart: '2026-11-17' } });
  });

  it('no overlap (i): a calendar-month invoice drafted before the plan blocks the cycle that overlaps it', async () => {
    const other = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Late plan', f.ids.owner, randomUUID()]);
    const legacy = await draftBrandInvoice({ sql: f.sql, now: NOW }, admin(), { organizationId: other, period: '2026-12', planId: 'b2b_29' });
    expect(legacy).toMatchObject({ ok: true });
    await f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-12-17', null, 1)",
      [other],
    );
    const at20 = at('2026-12-20T01:00:00Z');
    expect(await draftBrandInvoice({ sql: f.sql, now: at20 }, admin(), { organizationId: other, cycle: 'current' })).toEqual({ ok: false, code: 'conflict' });
    expect(await draftBrandInvoice({ sql: f.sql, now: at20 }, admin(), { organizationId: other, period: '2026-12' })).toEqual({ ok: false, code: 'conflict' });
    expect(await draftBrandInvoice({ sql: f.sql, now: at20 }, admin(), { organizationId: other, cycleStart: '2026-12-17' })).toEqual({ ok: false, code: 'conflict' });
    // The next cycle (Jan 17 → Feb 17) does not overlap December.
    expect(await draftBrandInvoice({ sql: f.sql, now: at20 }, admin(), { organizationId: other, cycle: 'next' })).toMatchObject({ ok: true, invoice: { cycleStart: '2027-01-17' } });
  });

  it('no overlap (ii): an invoiced cycle blocks moving the start day; a draft overlapping it is refused however it is asked', async () => {
    const d = await draft({ cycle: 'current' });
    if (!d.ok) throw new Error(d.code);
    const moveTo = (startedOn: string, planId = 'b2b_29') =>
      setPlanAssignment({ sql: f.sql, now: NOW }, admin(), { organizationId: f.orgId, planId, startedOn, expectedRevision: 1 });
    expect(await moveTo('2026-11-25')).toEqual({ ok: false, code: 'conflict', field: 'cycle_already_invoiced' });
    // Other edits keep working: same start day, another plan.
    expect(await moveTo('2026-11-17', 'b2b_49')).toMatchObject({ ok: true, revision: 2 });
    // Even if the start day moved by hand, the overlapping cycle cannot be drafted.
    await f.sql.query("update brand_plan_assignments set started_on = '2026-11-25' where organization_id = $1", [f.orgId]);
    const at26 = at('2026-11-26T01:00:00Z');
    for (const ask of [{ cycle: 'current' }, { cycleStart: '2026-11-25' }, { period: '2026-11' }]) {
      expect(await draft(ask, at26), JSON.stringify(ask)).toEqual({ ok: false, code: 'conflict' });
    }
    // Voiding the first invoice frees the days.
    await voidBrandInvoice({ sql: f.sql, now: NOW }, admin(), { invoiceId: d.invoice.id, reason: 'moved' });
    expect(await draft({ cycle: 'current' }, at26)).toMatchObject({ ok: true, invoice: { cycleStart: '2026-11-25', cycleEnd: '2026-12-25' } });
  });

  it('moving the start day is allowed when no subscription invoice covers today or later', async () => {
    const past = await draft({ cycleStart: '2026-11-17' });
    if (!past.ok) throw new Error(past.code);
    // At Dec 20 the Nov 17 → Dec 17 invoice is over: the start day may move.
    expect(
      await setPlanAssignment({ sql: f.sql, now: at('2026-12-20T01:00:00Z') }, admin(), { organizationId: f.orgId, planId: 'b2b_29', startedOn: '2026-12-25', expectedRevision: 1 }),
    ).toMatchObject({ ok: true });
  });

  it('a non-subscription invoice (credit pack) never blocks a subscription draft, whichever way it is asked', async () => {
    await f.sql.query(
      `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent, discount_krw, supply_krw, vat_krw, total_krw,
          status, created_by, updated_by, kind) values ($1, $2, '2026-11', 'b2b_29', 290000, 290000, 0, 0, 290000, 29000, 319000, 'draft', $3, $3, 'credit_pack')`,
      [randomUUID(), f.orgId, f.ids.admin],
    );
    expect(await draft({ period: '2026-11' })).toMatchObject({ ok: true, invoice: { cycleStart: '2026-11-17' } });
    const other = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Pack only', f.ids.owner, randomUUID()]);
    await f.sql.query(
      `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent, discount_krw, supply_krw, vat_krw, total_krw,
          status, created_by, updated_by, kind) values ($1, $2, '2026-11', 'b2b_29', 290000, 290000, 0, 0, 290000, 29000, 319000, 'draft', $3, $3, 'credit_pack')`,
      [randomUUID(), other, f.ids.admin],
    );
    expect(await draftBrandInvoice({ sql: f.sql, now: NOW }, admin(), { organizationId: other, period: '2026-11', planId: 'b2b_29' })).toMatchObject({ ok: true });
  });

  it('the console lists every cycle no subscription invoice covers, from the plan start to the current one (latest 12)', async () => {
    const { loadBrandBillingOverview } = await import('@/lib/admin/brand-billing-console');
    const feb = new Date('2027-02-20T01:00:00Z');
    expect(await draft({ cycleStart: '2026-12-17' }, () => feb)).toMatchObject({ ok: true });
    const overview = await loadBrandBillingOverview(f.sql, admin(), { now: feb, env: { defaultMonthlyKrw: 0, planGraceDays: 14 } });
    expect(overview?.uninvoicedCycles.filter((c) => c.organizationId === f.orgId).map((c) => c.cycleStart)).toEqual(['2026-11-17', '2027-01-17', '2027-02-17']);
    await f.sql.query("update brand_plan_assignments set started_on = '2025-11-17' where organization_id = $1", [f.orgId]);
    const many = await loadBrandBillingOverview(f.sql, admin(), { now: feb, env: { defaultMonthlyKrw: 0, planGraceDays: 14 } });
    const starts = many?.uninvoicedCycles.filter((c) => c.organizationId === f.orgId).map((c) => c.cycleStart) ?? [];
    expect(starts[0]).toBe('2026-03-17'); // 12 latest cycles: Mar 2026 … Feb 2027, minus the invoiced Dec 17 one
    expect(starts).toHaveLength(11);
  });

  it('a cycle starting on or after the plan end is refused', async () => {
    await f.sql.query("update brand_plan_assignments set ends_on = '2026-12-17' where organization_id = $1", [f.orgId]);
    expect(await draft({ cycle: 'current' })).toMatchObject({ ok: true });
    expect(await draft({ cycle: 'next' })).toEqual({ ok: false, code: 'invalid', field: 'cycle' });
    expect(await draft({ cycleStart: '2026-12-17' })).toEqual({ ok: false, code: 'invalid', field: 'cycleStart' });
  });

  it('the engine path (flag on) cannot draft a calendar month that overlaps a manual cycle invoice', async () => {
    expect(await draft({ cycle: 'current' })).toMatchObject({ ok: true });
    const res = await f.sql.transaction((tx) =>
      draftBrandInvoiceInTx(
        tx,
        { kind: 'system' },
        { organizationId: f.orgId, period: '2026-12', planId: 'b2b_29', applyActiveDiscount: true, manualAmounts: false, manualReason: '', memo: '' },
        new Date('2026-11-25T01:00:00Z'),
        { kind: 'subscription', coversMonths: 1, dueOn: '2026-12-15', collectionMethod: 'transfer', subscriptionEpoch: 1 },
      ),
    );
    expect(res).toEqual({ ok: false, code: 'conflict' });
  });

  it('the admin form posts cycle=current|next through brandBilling.invoice.draft', async () => {
    const { ADMIN_OPERATIONS } = await import('@/lib/admin/operations');
    const op = ADMIN_OPERATIONS['brandBilling.invoice.draft'];
    const fd = new FormData();
    fd.set('organizationId', f.orgId);
    fd.set('cycle', 'next');
    const parsed = op.parse(fd);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.value).not.toHaveProperty('period');
    const res = await op.run({ sql: f.sql, viewer: admin() } as never, parsed.value as never);
    expect(res).toMatchObject({ ok: true, code: 'created' });
    const rows = await listBrandInvoices(f.sql, { organizationId: f.orgId });
    expect(rows.map((r) => r.cycleStart)).toEqual([kstNextCycleStart()]);
  });

  it('an organization without a plan drafts a calendar month as before (no cycle fields)', async () => {
    const other = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'No plan', f.ids.owner, randomUUID()]);
    const res = await draftBrandInvoice({ sql: f.sql, now: NOW }, admin(), { organizationId: other, period: '2026-11', planId: 'b2b_49' });
    expect(res).toMatchObject({ ok: true, invoice: { period: '2026-11', listKrw: 490_000 } });
    if (res.ok) expect(res.invoice).not.toHaveProperty('cycleStart');
    expect(await draftBrandInvoice({ sql: f.sql, now: NOW }, admin(), { organizationId: other, cycle: 'current' })).toEqual({ ok: false, code: 'invalid', field: 'cycle' });
  });
});
