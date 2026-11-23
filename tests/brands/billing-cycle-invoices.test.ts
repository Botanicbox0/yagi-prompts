import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  listBrandInvoices,
  resolveDraftCycle,
  updateDraftBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing/invoices';
import { nextCycleStart } from '@/lib/brands/billing/cycle';
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
  it('this cycle, the next, an exact start or a month; never one before the current cycle', () => {
    const anchor = '2027-01-31';
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycle: 'current' })).toEqual({ ok: true, cycle: { index: 1, start: '2027-02-28', end: '2027-03-31' } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycle: 'next' })).toEqual({ ok: true, cycle: { index: 2, start: '2027-03-31', end: '2027-04-30' } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycleStart: '2027-04-30' })).toMatchObject({ ok: true, cycle: { index: 3 } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycleStart: '2027-04-29' })).toEqual({ ok: false, field: 'cycleStart' });
    expect(resolveDraftCycle(anchor, '2027-03-05', { cycleStart: '2027-01-31' })).toEqual({ ok: false, field: 'cycleStart' });
    expect(resolveDraftCycle(anchor, '2027-03-05', { period: '2027-05' })).toMatchObject({ ok: true, cycle: { start: '2027-05-31', end: '2027-06-30' } });
    expect(resolveDraftCycle(anchor, '2027-03-05', { period: '2027-01' })).toEqual({ ok: false, field: 'period' });
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

  it('a month asked for is the cycle that starts in it; past cycles and non-starts are refused', async () => {
    expect(await draft({ period: '2027-01' })).toMatchObject({ ok: true, invoice: { period: '2027-01', cycleStart: '2027-01-17', cycleEnd: '2027-02-17', listKrw: 290_000 } });
    expect(await draft({ period: '2026-10' })).toEqual({ ok: false, code: 'invalid', field: 'period' });
    expect(await draft({ cycleStart: '2026-12-18' })).toEqual({ ok: false, code: 'invalid', field: 'cycleStart' });
    // Next month, the November cycle is in the past.
    expect(await draft({ cycleStart: '2026-11-17' }, at('2026-12-20T01:00:00Z'))).toEqual({ ok: false, code: 'invalid', field: 'cycleStart' });
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

  it('two cycles may start in one month when the start day moves', async () => {
    expect(await draft({ cycle: 'current' })).toMatchObject({ ok: true });
    await f.sql.query("update brand_plan_assignments set started_on = '2026-11-02' where organization_id = $1", [f.orgId]);
    // The Nov 2 anchor's current cycle (Nov 2 → Dec 2) starts in November too: a different cycle, accepted.
    expect(await draft({ cycleStart: '2026-11-02' })).toMatchObject({ ok: true, invoice: { period: '2026-11', cycleStart: '2026-11-02', cycleEnd: '2026-12-02' } });
    expect((await listBrandInvoices(f.sql, { organizationId: f.orgId })).filter((i) => i.period === '2026-11')).toHaveLength(2);
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
