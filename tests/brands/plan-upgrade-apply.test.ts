import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  markBrandInvoicePaid,
  saveBrandBillingProfileAdmin,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { upgradeManualPlan, upgradeSubscriptionPlan } from '@/lib/brands/billing/plan-upgrade-apply';
import { loadPlanAssignment, setPlanAssignment } from '@/lib/brands/plans';
import { effectiveInvoiceDueOn, loadBrandSubscription, runBrandSubscriptionTick, scheduleDowngrade } from '@/lib/brands/subscriptions';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1c-3 (notes: B1c3-brief.md §2, §4): a mid-cycle upgrade on the real service with an injected clock — a subscribed
 * organization (automatic billing) and a manual one (an admin assigns the plan and drafts invoices by hand).
 */

let h: AdminHarness;
let sql: SqlRunner;
const at = (iso: string) => () => new Date(iso);
const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };

type Upgrade = typeof upgradeManualPlan;

/** Step 1 (preview) then step 2 (confirm with the preview's digest), as the admin form does. */
async function upgradeConfirmed(fn: Upgrade, iso: string, organizationId: string, planId: string) {
  const preview = await fn({ sql, now: at(iso) }, ADMIN_VIEWER, { organizationId, planId, previewOnly: true });
  if (!preview.ok || preview.applied) return preview;
  return fn({ sql, now: at(iso) }, ADMIN_VIEWER, { organizationId, planId, confirm: true, previewDigest: preview.preview.digest });
}

async function makeOrg(name: string): Promise<string> {
  const res = await createStudioOrganization({ sql }, ADMIN_VIEWER, { name, requestId: randomUUID() });
  if (!res.ok) throw new Error(res.code);
  const saved = await saveBrandBillingProfileAdmin({ sql }, ADMIN_VIEWER, {
    organizationId: res.id,
    companyLegalName: name,
    businessRegNo: '111-11-11119',
    representativeName: 'Fixture Owner',
    businessAddress: 'Seoul',
    taxInvoiceEmail: 'billing@fixture.invalid',
    contactName: 'Ops',
    contactPhone: '02-000-0000',
  });
  expect(saved.ok).toBe(true);
  return res.id;
}

const used = (organizationId: string, krw: number, iso: string) =>
  sql.query(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, estimate_krw, usage_krw, created_at, finished_at)
     values ($1, $2, $3, 'image', 'succeeded', 'seedream-5.5', 'p', $4, $4, $5, $5)`,
    [organizationId, ADMIN_VIEWER.userId, `use_${randomUUID().slice(0, 12)}`, krw, iso],
  );

const load = (organizationId: string, iso: string) => loadAllowance(sql, organizationId, STUDIO, new Date(iso));
const reserve = (organizationId: string, krw: number, iso: string) =>
  sql.transaction((tx) => reserveAllowance(tx, organizationId, krw, STUDIO, new Date(iso)));

async function subscriptionInvoices(organizationId: string) {
  return (
    await sql.query<{
      id: string;
      status: string;
      plan_id: string;
      cycle_start: string | null;
      cycle_end: string | null;
      due_on: string | null;
      total_krw: number;
      prorated_days: number | null;
      void_reason: string;
      voided_by: string | null;
    }>(
      `select id::text as id, status, plan_id, cycle_start::text as cycle_start, cycle_end::text as cycle_end, due_on::text as due_on,
              total_krw, prorated_days, void_reason, voided_by::text as voided_by
         from brand_invoices where organization_id = $1 and kind = 'subscription' order by created_at, id`,
      [organizationId],
    )
  ).rows;
}

async function carryGrants(organizationId: string) {
  return (
    await sql.query<{ amount_krw: number; kind: string; valid_from: string | null; valid_until: string | null; valid_month: string; revoked_at: unknown }>(
      `select amount_krw, kind, valid_from::text as valid_from, valid_until::text as valid_until, valid_month, revoked_at
         from brand_allowance_grants where organization_id = $1 and kind = 'carry' order by created_at`,
      [organizationId],
    )
  ).rows;
}

/** No two non-void subscription invoices share a day (a cycle covers [start, end), a legacy row its month). */
async function expectNoOverlap(organizationId: string) {
  const rows = (await subscriptionInvoices(organizationId)).filter((r) => r.status !== 'void' && r.cycle_start && r.cycle_end);
  for (const a of rows) {
    for (const b of rows) {
      if (a.id === b.id) continue;
      expect(a.cycle_start! < b.cycle_end! && b.cycle_start! < a.cycle_end!, `${a.cycle_start}–${a.cycle_end} vs ${b.cycle_start}–${b.cycle_end}`).toBe(false);
    }
  }
}

/** A manual plan organization on `planId` from `startedOn`, its first cycle drafted, issued and (optionally) paid. */
async function manualPlanOrg(name: string, startedOn: string, opts: { planId?: string; paid?: boolean; issued?: boolean } = {}) {
  const orgId = await makeOrg(name);
  await sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, $2, 'invoice', $3, null, 1)",
    [orgId, opts.planId ?? 'b2b_29', startedOn],
  );
  if (opts.issued === false) return { orgId, invoiceId: null as string | null };
  const now = at(`${startedOn}T01:00:00Z`);
  const drafted = await draftBrandInvoice({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, cycle: 'current' });
  if (!drafted.ok) throw new Error(`draft ${drafted.code}`);
  const issued = await issueBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
  if (!issued.ok) throw new Error(`issue ${issued.code}`);
  if (opts.paid !== false) {
    const paid = await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id, paidMethod: 'transfer' });
    if (!paid.ok) throw new Error(`paid ${paid.code}`);
  }
  return { orgId, invoiceId: drafted.invoice.id as string | null };
}

/** A subscribed organization on `planId` whose first payment (on `paidOn`) started cycle 0 that day. */
async function subscribedOrg(name: string, paidOn: string, planId = 'b2b_29') {
  const orgId = await makeOrg(name);
  const s = await startConfirmed({ sql, now: at(`${paidOn}T01:00:00Z`) }, ADMIN_VIEWER, { organizationId: orgId, planId, startedOn: paidOn });
  if (!s.ok || !s.applied) throw new Error('start failed');
  const paid = await markBrandInvoicePaid({ sql, now: at(`${paidOn}T02:00:00Z`) }, ADMIN_VIEWER, {
    invoiceId: s.firstInvoiceId,
    paidMethod: 'transfer',
    paidAt: paidOn,
  });
  if (!paid.ok) throw new Error('pay failed');
  return { orgId, firstInvoiceId: s.firstInvoiceId };
}

beforeEach(async () => {
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  h = await adminHarness();
  sql = runner(h.db);
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  await sql.query(
    "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000) on conflict (plan_id) do update set monthly_cap_krw = excluded.monthly_cap_krw",
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await h.close();
});

describe('subscribed organization (automatic billing, flag on)', () => {
  beforeEach(() => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
  });

  it('worked example: day 9, 100,000 of 270,000 used → 49 issued today, carry 170,000 until the new cycle ends', async () => {
    const { orgId, firstInvoiceId } = await subscribedOrg('Upgrade Subscribed Fixture', '2026-11-17');
    await used(orgId, 100_000, '2026-11-20T03:00:00Z');
    expect(await load(orgId, '2026-11-24T03:00:00Z')).toMatchObject({ source: 'plan', capKrw: 270_000, usedKrw: 100_000 });

    const preview = await upgradeSubscriptionPlan({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_49',
      previewOnly: true,
    });
    expect(preview).toMatchObject({
      ok: true,
      applied: false,
      preview: {
        mode: 'subscription',
        oldPlanId: 'b2b_29',
        newPlanId: 'b2b_49',
        todayKst: '2026-11-25',
        oldCycle: { start: '2026-11-17', end: '2026-11-25', endBefore: '2026-12-17' },
        newCycle: { start: '2026-11-25', end: '2026-12-25' },
        carryKrw: 170_000,
        carryValidUntil: '2026-12-24',
        newPlanCapKrw: 460_000,
        newPlanCapUnpaidKrw: 230_000,
        invoice: { totalKrw: 539_000, dueOn: '2026-12-09' },
      },
    });

    const done = await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_49');
    expect(done).toMatchObject({ ok: true, applied: true });
    const rows = await subscriptionInvoices(orgId);
    expect(rows.find((r) => r.id === firstInvoiceId)).toMatchObject({ status: 'paid', cycle_start: '2026-11-17', cycle_end: '2026-11-25' });
    const fresh = rows.find((r) => r.cycle_start === '2026-11-25');
    expect(fresh).toMatchObject({ status: 'issued', plan_id: 'b2b_49', cycle_end: '2026-12-25', total_krw: 539_000, due_on: '2026-12-09', prorated_days: null });
    expect(done.ok && done.applied && done.invoiceId).toBe(fresh!.id);
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49', startedOn: '2026-11-25', endsOn: '2026-12-09' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_49', status: 'active', pendingPlanId: null });
    expect(await carryGrants(orgId)).toEqual([
      { amount_krw: 170_000, kind: 'carry', valid_from: '2026-11-25', valid_until: '2026-12-24', valid_month: '2026-11', revoked_at: null },
    ]);
    await expectNoOverlap(orgId);

    // Unpaid but not yet due: the new plan's full credits (the 50% rule applies only after the due date, B1c-2 fix
    // round). The carried credits are never halved.
    const upgradeDay = await load(orgId, '2026-11-25T02:00:00Z');
    expect(upgradeDay).toMatchObject({
      source: 'plan',
      baseCapKrw: 460_000,
      extraKrw: 170_000,
      capKrw: 630_000,
      usedKrw: 0,
      cycle: { start: '2026-11-25', end: '2026-12-25' },
    });
    expect(upgradeDay.planCapHalvedUnpaid).toBeUndefined();
    // The due date itself (Dec 9) is still full; from Dec 10 00:00 KST, still unpaid, only the new plan's part is halved.
    expect(await load(orgId, '2026-12-09T14:59:59Z')).toMatchObject({ baseCapKrw: 460_000, capKrw: 630_000 });
    expect(await load(orgId, '2026-12-09T15:00:00Z')).toMatchObject({
      baseCapKrw: 230_000,
      extraKrw: 170_000,
      capKrw: 400_000,
      planCapHalvedUnpaid: true,
    });
    expect(await reserve(orgId, 400_000, '2026-12-09T15:00:00Z')).toMatchObject({ ok: true });
    expect(await reserve(orgId, 400_010, '2026-12-09T15:00:00Z')).toEqual({ ok: false, code: 'allowance_exhausted' });

    const paid = await markBrandInvoicePaid({ sql, now: at('2026-12-10T02:00:00Z') }, ADMIN_VIEWER, { invoiceId: fresh!.id, paidMethod: 'transfer' });
    expect(paid.ok).toBe(true);
    expect(await load(orgId, '2026-12-10T03:00:00Z')).toMatchObject({ baseCapKrw: 460_000, extraKrw: 170_000, capKrw: 630_000 });

    // The next cycle follows the new anchor; at the new cycle's end the carry is gone.
    await runBrandSubscriptionTick({ sql, now: at('2026-12-18T01:00:00Z') });
    expect((await subscriptionInvoices(orgId)).filter((r) => r.status === 'draft')).toMatchObject([{ cycle_start: '2026-12-25', cycle_end: '2027-01-25', plan_id: 'b2b_49' }]);
    expect(await load(orgId, '2026-12-24T14:00:00Z')).toMatchObject({ capKrw: 630_000 });
    expect(await load(orgId, '2026-12-24T15:00:00Z')).toMatchObject({ baseCapKrw: 460_000, extraKrw: 0, capKrw: 460_000, cycle: { start: '2026-12-25' } });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-25T01:00:00Z') });
    expect((await subscriptionInvoices(orgId)).find((r) => r.cycle_start === '2026-12-25')).toMatchObject({ status: 'issued', total_krw: 539_000, due_on: '2027-01-08' });
    await expectNoOverlap(orgId);
  });

  it('usage earlier on the upgrade day counts in the new cycle only (not also taken off the carry)', async () => {
    const { orgId } = await subscribedOrg('Upgrade Same Day Usage Fixture', '2026-11-17');
    await used(orgId, 100_000, '2026-11-20T03:00:00Z');
    await used(orgId, 20_000, '2026-11-25T00:30:00Z'); // 09:30 KST on the upgrade day
    const done = await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_49');
    expect(done).toMatchObject({ ok: true, applied: true, preview: { carryKrw: 170_000, oldUsedKrw: 100_000 } });
    expect(await load(orgId, '2026-11-25T02:00:00Z')).toMatchObject({ capKrw: 630_000, usedKrw: 20_000 });
  });

  it('refusals: unpaid current cycle, waived cycle, first day of the cycle, a downgrade, sandboxed, flag off, the manual operation', async () => {
    // Unpaid: early access, cycle 0 issued and not paid.
    const early = await makeOrg('Upgrade Unpaid Fixture');
    const s = await startConfirmed({ sql, now: at('2026-11-17T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: early,
      planId: 'b2b_29',
      startedOn: '2026-11-17',
      activateBeforePayment: true,
    });
    expect(s).toMatchObject({ ok: true, applied: true });
    expect(await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', early, 'b2b_49')).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: 'current_cycle_unpaid',
    });

    // Waived: cycle 1 issued, then voided by an admin after cycle 0 was paid.
    const { orgId: waivedOrg } = await subscribedOrg('Upgrade Waived Fixture', '2026-10-17');
    await runBrandSubscriptionTick({ sql, now: at('2026-11-17T01:00:00Z') });
    const cycle1 = (await subscriptionInvoices(waivedOrg)).find((r) => r.cycle_start === '2026-11-17');
    expect(cycle1).toMatchObject({ status: 'issued' });
    expect(await voidBrandInvoice({ sql, now: at('2026-11-18T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: cycle1!.id, reason: 'waive' })).toMatchObject({ ok: true });
    expect(await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', waivedOrg, 'b2b_49')).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: 'current_cycle_waived',
    });

    const { orgId } = await subscribedOrg('Upgrade Refusals Fixture', '2026-11-17', 'b2b_49');
    expect(await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-17T05:00:00Z', orgId, 'b2b_69')).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: 'upgrade_on_cycle_start',
    });
    expect(await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_29')).toMatchObject({
      ok: false,
      code: 'invalid',
      field: 'planId',
      detail: 'not_an_upgrade',
    });
    expect(await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_49')).toMatchObject({
      ok: false,
      code: 'invalid',
      field: 'planId',
      detail: 'same_plan',
    });
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_69')).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: 'subscription_upgrade_only',
    });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    expect(await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_69')).toMatchObject({ ok: false, code: 'disabled' });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    // Nothing above changed anything.
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49', startedOn: '2026-11-17' });
    expect(await carryGrants(orgId)).toEqual([]);

    const sandboxed = await makeOrg('Morphic Upgrade Fixture');
    expect(await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', sandboxed, 'b2b_49')).toMatchObject({
      ok: false,
      code: 'invalid',
      field: 'organizationId',
      detail: 'sandboxed_org',
    });
  });

  it('double submit, stale preview and a confirm without a preview are refused; the first upgrade stands', async () => {
    const { orgId } = await subscribedOrg('Upgrade Double Submit Fixture', '2026-11-17');
    await used(orgId, 100_000, '2026-11-20T03:00:00Z');
    const now = at('2026-11-25T01:00:00Z');
    const preview = await upgradeSubscriptionPlan({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_49', previewOnly: true });
    if (!preview.ok || preview.applied) throw new Error('preview failed');
    expect(await upgradeSubscriptionPlan({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_49', confirm: true })).toMatchObject({
      ok: false,
      code: 'invalid',
      field: 'previewDigest',
      detail: 'preview_required',
    });
    // Usage after the preview changes the carry: the preview is stale.
    await used(orgId, 5_000, '2026-11-24T03:00:00Z');
    const stale = await upgradeSubscriptionPlan({ sql, now }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_49',
      confirm: true,
      previewDigest: preview.preview.digest,
    });
    expect(stale).toMatchObject({ ok: false, code: 'conflict', detail: 'preview_stale' });
    const second = await upgradeSubscriptionPlan({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_49', previewOnly: true });
    if (!second.ok || second.applied) throw new Error('preview failed');
    const confirm = () =>
      upgradeSubscriptionPlan({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_49', confirm: true, previewDigest: second.preview.digest });
    expect(await confirm()).toMatchObject({ ok: true, applied: true, preview: { carryKrw: 165_000 } });
    expect(await confirm()).toMatchObject({ ok: false, code: 'conflict', detail: 'already_upgraded_today' });
    expect((await subscriptionInvoices(orgId)).filter((r) => r.status !== 'void')).toHaveLength(2);
    expect(await carryGrants(orgId)).toHaveLength(1);
  });

  it('a scheduled downgrade is cleared and the old anchor\'s next-cycle draft is voided by the system', async () => {
    const { orgId } = await subscribedOrg('Upgrade Clears Fixture', '2026-11-17', 'b2b_49');
    expect(await scheduleDowngrade({ sql, now: at('2026-12-01T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' })).toMatchObject({ ok: true });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-10T01:00:00Z') });
    const oldDraft = (await subscriptionInvoices(orgId)).find((r) => r.status === 'draft');
    expect(oldDraft).toMatchObject({ cycle_start: '2026-12-17', plan_id: 'b2b_29' });

    const done = await upgradeConfirmed(upgradeSubscriptionPlan, '2026-12-12T01:00:00Z', orgId, 'b2b_69');
    expect(done).toMatchObject({ ok: true, applied: true, preview: { scheduledDowngradeCleared: 'b2b_29', draftsVoided: 1 } });
    expect((await subscriptionInvoices(orgId)).find((r) => r.id === oldDraft!.id)).toMatchObject({ status: 'void', void_reason: 'plan_upgrade', voided_by: null });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_69', pendingPlanId: null, pendingPlanEffectivePeriod: null });
    const events = (
      await sql.query<{ action: string; actor_kind: string }>(
        "select action, actor_kind from brand_subscription_events where organization_id = $1 and created_at >= '2026-12-12T00:00:00Z' order by created_at, id",
        [orgId],
      )
    ).rows.map((r) => r.action);
    expect(events).toEqual(expect.arrayContaining(['downgrade_cleared', 'plan_changed']));
    expect((await subscriptionInvoices(orgId)).find((r) => r.cycle_start === '2026-12-12')).toMatchObject({ status: 'issued', plan_id: 'b2b_69', cycle_end: '2027-01-12' });
    await expectNoOverlap(orgId);
    // The job finds nothing to redo.
    const tick = await runBrandSubscriptionTick({ sql, now: at('2026-12-12T03:00:00Z') });
    expect(tick).toMatchObject({ ok: true });
    expect((await subscriptionInvoices(orgId)).filter((r) => r.status !== 'void')).toHaveLength(2);
  });

  it('atomic: when the new invoice cannot be issued nothing changes (cut, plan, subscription, carry, voids)', async () => {
    const { orgId, firstInvoiceId } = await subscribedOrg('Upgrade Atomic Fixture', '2026-11-17');
    await used(orgId, 100_000, '2026-11-20T03:00:00Z');
    const preview = await upgradeSubscriptionPlan({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_49', previewOnly: true });
    if (!preview.ok || preview.applied) throw new Error('preview failed');
    await sql.query(`create or replace function test_fail_draft_insert() returns trigger language plpgsql as $$
      begin
        if new.status = 'draft' then raise exception 'forced draft failure' using errcode = '23514'; end if;
        return new;
      end $$`);
    await sql.query('create trigger test_fail_draft_insert before insert on brand_invoices for each row execute function test_fail_draft_insert()');
    const refused = await upgradeSubscriptionPlan({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_49',
      confirm: true,
      previewDigest: preview.preview.digest,
    });
    await sql.query('drop trigger if exists test_fail_draft_insert on brand_invoices');
    expect(refused).toMatchObject({ ok: false, code: 'conflict', detail: 'upgrade_issue_failed' });
    expect((await subscriptionInvoices(orgId)).find((r) => r.id === firstInvoiceId)).toMatchObject({ status: 'paid', cycle_end: '2026-12-17' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29', startedOn: '2026-11-17' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_29' });
    expect(await carryGrants(orgId)).toEqual([]);
    const events = await sql.query("select 1 from brand_invoice_events where organization_id = $1 and snapshot->>'reason' = 'plan_upgrade'", [orgId]);
    expect(events.rows).toHaveLength(0);
    // With the failure gone the same preview goes through.
    expect(
      await upgradeSubscriptionPlan({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, {
        organizationId: orgId,
        planId: 'b2b_49',
        confirm: true,
        previewDigest: preview.preview.digest,
      }),
    ).toMatchObject({ ok: true, applied: true });
  });

  it('atomic: when any other step of the engine run fails (here the plan sync) the upgrade is rolled back too', async () => {
    const { orgId, firstInvoiceId } = await subscribedOrg('Upgrade Atomic Sync Fixture', '2026-11-17');
    const preview = await upgradeSubscriptionPlan({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_49', previewOnly: true });
    if (!preview.ok || preview.applied) throw new Error('preview failed');
    // The engine's plan sync writes its plan event as the system; the upgrade's own plan write is the admin's.
    await sql.query(`create or replace function test_fail_system_plan_event() returns trigger language plpgsql as $$
      begin
        if new.actor_kind = 'system' then raise exception 'forced sync failure' using errcode = '23514'; end if;
        return new;
      end $$`);
    await sql.query('create trigger test_fail_system_plan_event before insert on brand_plan_events for each row execute function test_fail_system_plan_event()');
    const refused = await upgradeSubscriptionPlan({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_49',
      confirm: true,
      previewDigest: preview.preview.digest,
    });
    await sql.query('drop trigger if exists test_fail_system_plan_event on brand_plan_events');
    expect(refused).toMatchObject({ ok: false, code: 'conflict', detail: 'upgrade_issue_failed' });
    expect((await subscriptionInvoices(orgId)).find((r) => r.id === firstInvoiceId)).toMatchObject({ status: 'paid', cycle_end: '2026-12-17' });
    expect((await subscriptionInvoices(orgId)).filter((r) => r.status !== 'void')).toHaveLength(1);
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29', startedOn: '2026-11-17', endsOn: '2026-12-17' });
    expect(await carryGrants(orgId)).toEqual([]);
  });

  it('non-payment after an upgrade: past_due, suspended by the normal rules; paying restores the new plan only', async () => {
    const { orgId } = await subscribedOrg('Upgrade Unpaid After Fixture', '2026-11-17');
    expect(await upgradeConfirmed(upgradeSubscriptionPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_49')).toMatchObject({ ok: true, applied: true });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-10T01:00:00Z') });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'past_due', planId: 'b2b_49' });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-24T01:00:00Z') });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'suspended', planId: 'b2b_49' });
    expect(await load(orgId, '2026-12-24T02:00:00Z')).toMatchObject({ source: 'default' });
    const unpaid = (await subscriptionInvoices(orgId)).find((r) => r.cycle_start === '2026-11-25')!;
    expect(await markBrandInvoicePaid({ sql, now: at('2026-12-26T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: unpaid.id, paidMethod: 'transfer' })).toMatchObject({ ok: true });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active', planId: 'b2b_49' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49' });
    expect((await subscriptionInvoices(orgId)).filter((r) => r.status !== 'void').every((r) => r.plan_id !== 'b2b_29' || r.cycle_start === '2026-11-17')).toBe(true);
    await expectNoOverlap(orgId);
  });
});

describe('manual plan organization (no flag)', () => {
  it('worked example: a draft for the new cycle is left for the admin; carry 170,000; nothing halved', async () => {
    const { orgId, invoiceId } = await manualPlanOrg('Upgrade Manual Fixture', '2026-11-17');
    await used(orgId, 100_000, '2026-11-20T03:00:00Z');
    const done = await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_49');
    expect(done).toMatchObject({
      ok: true,
      applied: true,
      preview: { mode: 'manual', carryKrw: 170_000, newPlanCapUnpaidKrw: null, invoice: { totalKrw: 539_000, dueOn: '2026-12-09' } },
    });
    const rows = await subscriptionInvoices(orgId);
    expect(rows.find((r) => r.id === invoiceId)).toMatchObject({ status: 'paid', cycle_start: '2026-11-17', cycle_end: '2026-11-25' });
    const fresh = rows.find((r) => r.cycle_start === '2026-11-25');
    expect(fresh).toMatchObject({ status: 'draft', plan_id: 'b2b_49', cycle_end: '2026-12-25', total_krw: 539_000, prorated_days: null });
    expect(done.ok && done.applied && done.invoiceId).toBe(fresh!.id);
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49', startedOn: '2026-11-25', endsOn: null });
    expect(await carryGrants(orgId)).toMatchObject([{ amount_krw: 170_000, valid_from: '2026-11-25', valid_until: '2026-12-24' }]);
    await expectNoOverlap(orgId);
    expect(await load(orgId, '2026-11-25T02:00:00Z')).toMatchObject({ baseCapKrw: 460_000, extraKrw: 170_000, capKrw: 630_000, usedKrw: 0 });
    expect(await load(orgId, '2026-12-24T14:59:59Z')).toMatchObject({ capKrw: 630_000 });
    expect(await load(orgId, '2026-12-24T15:00:00Z')).toMatchObject({ capKrw: 460_000, extraKrw: 0, cycle: { start: '2026-12-25' } });

    // The admin issues the draft as any other; the manual path stores no due day and uses 14 days from issue.
    const issued = await issueBrandInvoice({ sql, now: at('2026-11-25T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: fresh!.id });
    if (!issued.ok) throw new Error(issued.code);
    expect((await subscriptionInvoices(orgId)).find((r) => r.id === fresh!.id)).toMatchObject({ status: 'issued', due_on: null });
    expect(effectiveInvoiceDueOn({ dueOn: null, issuedAt: issued.invoice.issuedAt })).toBe('2026-12-09');
  });

  it('refusals: unpaid, no invoice for the current cycle, first day, plan not active, a later cycle already issued, sandboxed', async () => {
    const unpaid = await manualPlanOrg('Upgrade Manual Unpaid Fixture', '2026-11-17', { paid: false });
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', unpaid.orgId, 'b2b_49')).toMatchObject({ ok: false, detail: 'current_cycle_unpaid' });

    const none = await manualPlanOrg('Upgrade Manual None Fixture', '2026-11-17', { issued: false });
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', none.orgId, 'b2b_49')).toMatchObject({ ok: false, detail: 'current_cycle_not_invoiced' });

    const paid = await manualPlanOrg('Upgrade Manual First Day Fixture', '2026-11-17');
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-17T05:00:00Z', paid.orgId, 'b2b_49')).toMatchObject({ ok: false, detail: 'upgrade_on_cycle_start' });

    // The next cycle already issued by hand: void it first.
    const next = await draftBrandInvoice({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: paid.orgId, cycle: 'next' });
    if (!next.ok) throw new Error(next.code);
    expect(await issueBrandInvoice({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: next.invoice.id })).toMatchObject({ ok: true });
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', paid.orgId, 'b2b_49')).toMatchObject({ ok: false, detail: 'later_cycle_already_issued' });

    const ended = await manualPlanOrg('Upgrade Manual Ended Fixture', '2026-11-17');
    await sql.query("update brand_plan_assignments set ends_on = '2026-11-24' where organization_id = $1", [ended.orgId]);
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', ended.orgId, 'b2b_49')).toMatchObject({ ok: false, detail: 'plan_not_active' });

    const noPlan = await makeOrg('Upgrade Manual No Plan Fixture');
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', noPlan, 'b2b_49')).toMatchObject({ ok: false, detail: 'no_plan' });

    const sandboxed = await manualPlanOrg('Morphic Manual Upgrade Fixture', '2026-11-17', { issued: false });
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', sandboxed.orgId, 'b2b_49')).toMatchObject({ ok: false, detail: 'sandboxed_org' });
  });

  it('a draft of the old anchor\'s next cycle is voided; the admin start-day guard still refuses an ordinary edit', async () => {
    const { orgId } = await manualPlanOrg('Upgrade Manual Draft Fixture', '2026-11-17');
    const next = await draftBrandInvoice({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, cycle: 'next' });
    if (!next.ok) throw new Error(next.code);
    // Before the upgrade, moving the start day mid-cycle is refused (an invoice covers today).
    const move = (startedOn: string, iso: string, expectedRevision: number) =>
      setPlanAssignment({ sql, now: at(iso) }, ADMIN_VIEWER, {
        organizationId: orgId,
        planId: 'b2b_49',
        billingMode: 'invoice',
        startedOn,
        endsOn: null,
        seats: null,
        note: '',
        expectedRevision,
      });
    expect(await move('2026-11-22', '2026-11-22T01:00:00Z', 1)).toMatchObject({ ok: false, field: 'cycle_already_invoiced' });

    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_49')).toMatchObject({
      ok: true,
      applied: true,
      preview: { draftsVoided: 1 },
    });
    expect((await subscriptionInvoices(orgId)).find((r) => r.id === next.invoice.id)).toMatchObject({ status: 'void', void_reason: 'plan_upgrade' });
    await expectNoOverlap(orgId);
    // After the upgrade an ordinary mid-cycle start-day edit is still refused; a same-day edit is not.
    const assignment = await loadPlanAssignment(sql, orgId);
    expect(await move('2026-11-28', '2026-11-28T01:00:00Z', assignment!.revision)).toMatchObject({ ok: false, field: 'cycle_already_invoiced' });
    expect(await move('2026-11-25', '2026-11-28T01:00:00Z', assignment!.revision)).toMatchObject({ ok: true });
  });

  it('override organization: upgraded for billing, no carry grant, the cap stays the override', async () => {
    const { orgId } = await manualPlanOrg('Upgrade Override Fixture', '2026-11-17');
    await sql.query(
      "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, note) values ($1, 1000000, true, 'contract')",
      [orgId],
    );
    await used(orgId, 100_000, '2026-11-20T03:00:00Z');
    const before = await load(orgId, '2026-11-25T00:00:00Z');
    expect(before).toMatchObject({ source: 'override', capKrw: 1_000_000 });
    expect(await upgradeConfirmed(upgradeManualPlan, '2026-11-25T01:00:00Z', orgId, 'b2b_49')).toMatchObject({
      ok: true,
      applied: true,
      preview: { carryKrw: 0 },
    });
    expect(await carryGrants(orgId)).toEqual([]);
    expect(await load(orgId, '2026-11-25T02:00:00Z')).toMatchObject({ source: 'override', capKrw: 1_000_000 });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49', startedOn: '2026-11-25' });
  });
});

/** Seeded PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property on the real code (seeded): the carry belongs to the new cycle only and ends with it', () => {
  it('random anchors, upgrade days, usage and other grants', async () => {
    const random = prng(20261125);
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
    const days = (start: string, n: number) => {
      const t = new Date(`${start}T00:00:00Z`);
      t.setUTCDate(t.getUTCDate() + n);
      return t.toISOString().slice(0, 10);
    };
    const kstMidnight = (day: string, plusMinutes = 0) => new Date(Date.parse(`${day}T00:00:00Z`) - 9 * 3_600_000 + plusMinutes * 60_000).toISOString();
    for (let i = 0; i < 10; i += 1) {
      const anchor = `2026-${String(int(1, 10)).padStart(2, '0')}-${String([1, 15, 28, 29, 30, 31][int(0, 5)]).padStart(2, '0')}`;
      const valid = !Number.isNaN(Date.parse(`${anchor}T00:00:00Z`)) && new Date(`${anchor}T00:00:00Z`).toISOString().slice(0, 10) === anchor;
      const start = valid ? anchor : `${anchor.slice(0, 8)}28`;
      const { orgId } = await manualPlanOrg(`Upgrade Property ${i}`, start);
      const cycleEnd = (await subscriptionInvoices(orgId))[0]!.cycle_end!;
      const length = Math.round((Date.parse(`${cycleEnd}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
      const upgradeDay = days(start, int(1, length - 1));
      const usedKrw = int(0, 30) * 10_000;
      if (usedKrw > 0) await used(orgId, usedKrw, kstMidnight(start, 60));
      // Another grant made in the old cycle (attached to it) is part of what is carried.
      const gift = random() < 0.5 ? int(1, 5) * 10_000 : 0;
      if (gift > 0) {
        await sql.query(
          "insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, created_at) values ($1, $2, $3, 'gift', $4)",
          [orgId, gift, start.slice(0, 7), kstMidnight(start, 120)],
        );
      }
      const oldCap = 270_000 + gift;
      const done = await upgradeConfirmed(upgradeManualPlan, kstMidnight(upgradeDay, 600), orgId, random() < 0.5 ? 'b2b_49' : 'b2b_69');
      if (!done.ok || !done.applied) throw new Error(`upgrade refused: ${JSON.stringify(done)}`);
      const { carryKrw, newCycle, newPlanCapKrw } = done.preview;
      expect(carryKrw).toBe(Math.max(0, Math.floor((oldCap - usedKrw) / 10) * 10));
      // Another grant made inside the new cycle belongs to it too (and to no other cycle).
      let newGift = 0;
      if (random() < 0.5) {
        newGift = int(1, 5) * 10_000;
        const day = days(newCycle.start, int(0, 20));
        await sql.query(
          "insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, created_at) values ($1, $2, $3, 'gift', $4)",
          [orgId, newGift, day.slice(0, 7), kstMidnight(day, 180)],
        );
      }
      // Every day of the new cycle: new plan cap + carry + its own grants; from the next cycle on: new plan cap only.
      const probe = [newCycle.start, days(newCycle.start, int(1, 27)), days(newCycle.end, -1)];
      for (const day of probe) {
        expect(await load(orgId, kstMidnight(day, 30)), `${anchor} ↑${upgradeDay} on ${day}`).toMatchObject({ capKrw: newPlanCapKrw + carryKrw + newGift });
      }
      for (const day of [newCycle.end, days(newCycle.end, int(1, 20))]) {
        expect(await load(orgId, kstMidnight(day)), `${anchor} ↑${upgradeDay} on ${day}`).toMatchObject({ capKrw: newPlanCapKrw, extraKrw: 0 });
      }
      await expectNoOverlap(orgId);
    }
  });
});
