import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { formatBillingOutcomeDetail, loadBrandBillingOverview } from '@/lib/admin/brand-billing-console';
import { loadBrandOrgDetailOps } from '@/lib/admin/brand-org-detail';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { loadCustomerExtraGrants } from '@/lib/brands/billing-page-data';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  listBrandInvoices,
  loadCustomerBrandBilling,
  markBrandInvoicePaid,
  saveBrandBillingProfileAdmin,
  setPlanAllowanceDefault,
  updateDraftBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { loadPlanAssignment, setPlanAssignment } from '@/lib/brands/plans';
import {
  cancelSubscription,
  loadBrandSubscription,
  runBrandSubscriptionTick,
  startSubscription,
} from '@/lib/brands/subscriptions';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { startConfirmed, startSubscriptionCompat } from '@/tests/brands/helpers/subscription-confirm';
import { invoiceFlagOffScenario } from '@/tests/brands/helpers/invoice-flag-off-parity';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

/**
 * Review round 1 of B1a: the gaps the first test files left open — B1 commit-then-reconcile ordering and a
 * real (not stubbed) reconcile failure, C6 exact flag-off parity with origin/main, A1 start refusals, C3
 * cancel edge cases, B5 server-side confirmation, the long-suspension resume, C2 notice keys, and the
 * product owner's requirement that explicit allowance overrides stay untouched.
 */

type Logged = { text: string; params: unknown[] };

/** B1c fix round: the no-overlap check that replaced origin/main's same-period check on subscription drafts. */
const OVERLAP_CHECK = /^select 1 from brand_invoices where organization_id = \$1 and status <> 'void'( and kind = 'subscription')? and /;
const ORIGIN_PERIOD_CHECK = "select 1 from brand_invoices where organization_id = $1 and period = $2 and status <> 'void' limit 1";
const isInvoiceColumnProbe = (q: Logged) => q.text.includes('pg_attribute') && q.params[0] === 'public.brand_invoices';

/** A runner over the same database that records every statement (whitespace collapsed) and can fail some. */
function recorder(db: PGlite, failWhen?: (text: string) => boolean): { sql: SqlRunner; log: Logged[] } {
  const log: Logged[] = [];
  const sql = makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    log.push({ text: normalized, params });
    if (failWhen?.(normalized)) throw new Error('simulated_reconcile_failure');
    const res = await db.query<T>(text, params as never[]);
    return { rows: res.rows as T[] };
  });
  return { sql, log };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const normalizeIds = (value: unknown): unknown => JSON.parse(JSON.stringify(value).replace(UUID_RE, '<uuid>'));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), 'tests', 'brands', 'fixtures', name), 'utf8')) as T;
}

async function pre0182Db(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
  for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0182_'))) await db.exec(readMigration(file));
  return db;
}

async function seedCompleteBillingProfile(sql: SqlRunner, viewer: Viewer, organizationId: string, name: string) {
  const res = await saveBrandBillingProfileAdmin({ sql }, viewer, {
    organizationId,
    companyLegalName: name,
    businessRegNo: '111-11-11119',
    representativeName: 'Test Owner',
    businessAddress: '100 Test Street, Seoul',
    taxInvoiceEmail: 'billing@fixture.invalid',
    contactName: 'Finance Contact',
    contactPhone: '02-000-0000',
  });
  expect(res.ok).toBe(true);
}

let f: StudioFixture;
const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const at = (iso: string) => () => new Date(iso);

async function newOrg(sql: SqlRunner, name: string): Promise<string> {
  const orgId = randomUUID();
  await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
    orgId,
    name,
    f.ids.owner,
    randomUUID(),
  ]);
  await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [orgId, f.ids.owner, 'owner']);
  await seedCompleteBillingProfile(sql, admin(), orgId, name);
  return orgId;
}

beforeEach(async () => {
  f = await studioFixture({ capKrw: null });
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_29', monthlyCapKrw: 270_000, confirm: true });
  await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_49', monthlyCapKrw: 460_000, confirm: true });
  await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_69', monthlyCapKrw: 650_000, confirm: true });
  await seedCompleteBillingProfile(f.sql, admin(), f.orgId, 'Review Fixture Org');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await f.db.close();
});

describe('B1a review round 1 — integration gaps', () => {
  it('C6: with the flag off, draft/updateDraft/issue/markPaid/void/setPlan/list run exactly origin/main SQL and return the same results, before and after 0182', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    // B1c: the invoices of this scenario belong to an organization without a plan (the path B1c leaves unchanged); a paid
    // plan organization drafts per billing cycle since B1c (tests/brands/billing-cycle-invoices.test.ts). Re-recorded from
    // origin/main 14d21d56 (tests/brands/helpers/invoice-flag-off-parity.ts).
    const expected = fixture<{ ops: Array<{ op: string; log: unknown; result: unknown }> }>('brand-billing-flag-off-legacy-parity.json');
    for (const make of [freshDb, pre0182Db]) {
      const db = await make();
      try {
        const actual = await invoiceFlagOffScenario(db);
        expect(actual.map((o) => o.op)).toEqual(expected.ops.map((o) => o.op));
        for (const [i, op] of expected.ops.entries()) {
          if (op.op.startsWith('draft')) {
            // B1c fix round, on purpose: a subscription draft is refused when ANY non-void subscription invoice overlaps its
            // days (checked after the plan is read), instead of origin/main's "same period" check. Every other statement and
            // every result are still origin/main's.
            const log = actual[i]!.log as Logged[];
            const overlaps = log.filter((q) => OVERLAP_CHECK.test(q.text));
            expect(overlaps, `${op.op}: one overlap check`).toHaveLength(1);
            expect(actual[i]!.result, `${op.op}: full result`).toEqual(op.result);
            if (op.op === 'draftConflict') continue; // refused later now (after the plan read), same answer
            const mine = log.filter((q) => !OVERLAP_CHECK.test(q.text) && !isInvoiceColumnProbe(q));
            const theirs = (op.log as Logged[]).filter((q) => q.text !== ORIGIN_PERIOD_CHECK);
            expect(mine, `${op.op}: SQL and parameters besides the check`).toEqual(theirs);
            continue;
          }
          expect(actual[i]!.log, `${op.op}: SQL and parameters`).toEqual(op.log);
          expect(actual[i]!.result, `${op.op}: full result`).toEqual(op.result);
        }
      } finally {
        await db.close();
      }
    }
  });

  it('C6: with the flag off on the migrated schema, loaders and invoice operations name no new table or column', async () => {
    // A subscription row exists (as after a flag roll-back); flag-off code must still never look at it.
    const started = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-02T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-02',
    });
    expect(started).toMatchObject({ ok: true, applied: true });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');

    const r = recorder(f.db);
    const now = at('2026-11-10T01:00:00Z');
    const d = await draftBrandInvoice({ sql: r.sql, now }, admin(), { organizationId: f.orgId, period: '2027-02', planId: 'b2b_29' });
    if (!d.ok) throw new Error(d.code);
    await issueBrandInvoice({ sql: r.sql, now }, admin(), { invoiceId: d.invoice.id });
    await markBrandInvoicePaid({ sql: r.sql, now }, admin(), { invoiceId: d.invoice.id, paidMethod: 'wire' });
    const d2 = await draftBrandInvoice({ sql: r.sql, now }, admin(), { organizationId: f.orgId, period: '2027-03', planId: 'b2b_29' });
    if (!d2.ok) throw new Error(d2.code);
    await voidBrandInvoice({ sql: r.sql, now }, admin(), { invoiceId: d2.invoice.id, reason: 'x' });
    await loadBrandBillingOverview(r.sql, admin(), { period: '2026-11', now: now() });
    await loadBrandOrgDetailOps(r.sql, admin(), f.orgId, { now: now() });
    const customer = await loadCustomerBrandBilling({ sql: r.sql, env: studioEnv(), now }, viewerOf(f.ids.owner), f.orgId);
    expect(customer).toMatchObject({ ok: true });
    await loadCustomerExtraGrants(r.sql, f.orgId, now());
    expect(await runBrandSubscriptionTick({ sql: r.sql, now })).toEqual({ ok: true, skipped: 'disabled' });

    const forbidden =
      /brand_subscriptions|brand_subscription_events|subscription_epoch|last_reconciled_at|tax_invoice_issued_on|tax_invoice_ref|created_via|issued_via|covers_months|\bdue_on\b|actor_kind|collection_method|pending_plan_effective_period|\bkind\s*=/;
    // B1c fix round: the no-overlap check on subscription drafts names `kind = 'subscription'` on purpose (flag off too).
    // R3 items 2 and 4 (changed on purpose): the admin organization page reads the 0182 bookkeeping columns of its invoices
    // with the flag off — the due date and the tax invoice the manual path shows and records — in exactly this one
    // statement, which names no subscription table, epoch or other subscription column.
    const BOOKKEEPING_READ =
      'select id::text as id, due_on::text as due_on, collection_method, tax_invoice_issued_on::text as tax_invoice_issued_on, tax_invoice_ref from brand_invoices where organization_id = $1';
    expect(r.log.filter((q) => q.text === BOOKKEEPING_READ)).toHaveLength(1);
    const leaks = r.log.filter(
      (q) =>
        !OVERLAP_CHECK.test(q.text) &&
        q.text !== BOOKKEEPING_READ &&
        (forbidden.test(q.text) || q.params.some((p) => typeof p === 'string' && /^brand_subscription/.test(p))),
    );
    expect(leaks.map((q) => q.text)).toEqual([]);
    // The subscription row was never touched by flag-off code.
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'pending', revision: 1 });
  });

  it('C6: flag on with the pre-0182 schema — markPaid and void are recorded, the job says schema_not_ready, panels are neutral', async () => {
    const db = await pre0182Db();
    try {
      const sql = runner(db);
      const adminId = randomUUID();
      const ownerId = randomUUID();
      await seedProfile(sql, { id: adminId, isAdmin: true, email: 'pre-flag-admin@fixture.invalid' });
      await seedProfile(sql, { id: ownerId, email: 'pre-flag-owner@fixture.invalid' });
      const viewer = { userId: adminId, isAdmin: true, tier: 'pro', email: 'pre-flag-admin@fixture.invalid', locale: 'ko' } as Viewer;
      const orgId = randomUUID();
      await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
        orgId,
        'Pre-migration Fixture',
        ownerId,
        randomUUID(),
      ]);
      const now = at('2026-11-10T01:00:00Z');
      const a = await draftBrandInvoice({ sql, now }, viewer, { organizationId: orgId, period: '2026-11', planId: 'b2b_29' });
      const b = await draftBrandInvoice({ sql, now }, viewer, { organizationId: orgId, period: '2026-12', planId: 'b2b_29' });
      if (!a.ok || !b.ok) throw new Error('draft failed');
      await issueBrandInvoice({ sql, now }, viewer, { invoiceId: a.invoice.id });
      await issueBrandInvoice({ sql, now }, viewer, { invoiceId: b.invoice.id });
      const paid = await markBrandInvoicePaid({ sql, now }, viewer, { invoiceId: a.invoice.id, paidMethod: 'wire' });
      expect(paid).toEqual({ ok: true, invoice: expect.objectContaining({ status: 'paid' }) });
      const voided = await voidBrandInvoice({ sql, now }, viewer, { invoiceId: b.invoice.id, reason: 'x' });
      expect(voided).toEqual({ ok: true, invoice: expect.objectContaining({ status: 'void' }) });
      expect(await runBrandSubscriptionTick({ sql, now })).toEqual({ ok: true, skipped: 'schema_not_ready' });
      const overview = await loadBrandBillingOverview(sql, viewer, { period: '2026-11', now: now() });
      expect(overview?.taxInvoicePanel).toEqual({ enabled: true, schemaReady: false, pending: [] });
      const detail = await loadBrandOrgDetailOps(sql, viewer, orgId, { now: now() });
      expect(detail?.subscriptionPanel).toMatchObject({ enabled: true, schemaReady: false, subscription: null });
    } finally {
      await db.close();
    }
  });

  it('B1: markPaid and void commit first; reconcile runs afterwards in its own transaction that locks the organization first', async () => {
    const started = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-02T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-02',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');

    const r = recorder(f.db);
    const paid = await markBrandInvoicePaid({ sql: r.sql, now: at('2026-11-03T01:00:00Z') }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });
    expect(paid).toEqual({ ok: true, invoice: expect.objectContaining({ status: 'paid' }) });
    const texts = r.log.map((q) => q.text);
    const iPaid = texts.findIndex((t) => t.startsWith("update brand_invoices set status = 'paid'"));
    const iCommit = texts.indexOf('commit', iPaid);
    const iBegin = texts.indexOf('begin', iCommit);
    const iLock = texts.indexOf('select id::text as id, name from brand_organizations where id = $1 for no key update');
    expect(iPaid).toBeGreaterThan(0);
    expect(iCommit).toBeGreaterThan(iPaid);
    expect(iBegin).toBeGreaterThan(iCommit);
    expect(iLock).toBeGreaterThan(iBegin);
    // The payment transaction itself never locks the organization or reads the subscription (no invoice -> org order).
    expect(texts.slice(0, iCommit).filter((t) => /brand_organizations|brand_subscriptions/.test(t))).toEqual([]);
    // ... and the reconcile transaction takes the organization lock before any invoice lock (the job's order).
    const iInvoiceLock = texts.findIndex((t, i) => i > iBegin && /from brand_invoices .*for update/.test(t));
    expect(iInvoiceLock).toBeGreaterThan(iLock);
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'active' });
  });

  it('B1: a real reconcile failure after commit leaves the payment and the void recorded, is logged without ids, and is reported as deferred', async () => {
    const started = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-02T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-02',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');
    // Round 5, A2: an admin drafts no subscription invoice for a subscribed organization; a draft left from
    // flag-off time is the invoice voided here.
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const extra = await draftBrandInvoice({ sql: f.sql, now: at('2026-11-02T02:00:00Z') }, admin(), {
      organizationId: f.orgId,
      period: '2026-10',
      planId: 'b2b_29',
    });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    if (!extra.ok) throw new Error(extra.code);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const failing = recorder(f.db, (t) => t.includes('from brand_subscriptions') && t.includes('for update'));
    const paid = await markBrandInvoicePaid({ sql: failing.sql, now: at('2026-11-03T01:00:00Z') }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });
    // B1a-2 review, item 3: when the whole post-commit reconcile throws, access certainly was not updated.
    expect(paid).toEqual({ ok: true, invoice: expect.objectContaining({ status: 'paid' }), reconcileDeferred: true, accessNotUpdated: true });
    const voided = await voidBrandInvoice({ sql: failing.sql, now: at('2026-11-03T02:00:00Z') }, admin(), {
      invoiceId: extra.invoice.id,
      reason: 'not needed',
    });
    expect(voided).toEqual({ ok: true, invoice: expect.objectContaining({ status: 'void' }), reconcileDeferred: true, accessNotUpdated: true });

    const rows = (
      await f.sql.query<{ id: string; status: string }>('select id::text as id, status from brand_invoices where organization_id = $1', [f.orgId])
    ).rows;
    expect(rows.find((x) => x.id === started.firstInvoiceId)?.status).toBe('paid');
    expect(rows.find((x) => x.id === extra.invoice.id)?.status).toBe('void');
    // Still pending: the failed reconcile changed nothing; the hourly job is the retry.
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'pending' });
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('post_invoice_reconcile_deferred');
    expect(logged).not.toContain(f.orgId);
    expect(logged).not.toContain(started.firstInvoiceId);
    expect(formatBillingOutcomeDetail('subscription_reconcile_deferred', 'ko')).toContain('다음 정산 배치');

    const tick = await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-11-03T03:00:00Z') });
    expect(tick).toMatchObject({ ok: true, errors: 0 });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'active' });
  });

  it('A1: start refuses a future start date and any non-void subscription invoice of the start month or later, with specific admin messages', async () => {
    const nov10 = at('2026-11-10T01:00:00Z');
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: nov10 }, admin(), { organizationId: f.orgId, planId: 'b2b_29', startedOn: '2026-11-20' }),
    ).toEqual({ ok: false, code: 'invalid', field: 'startedOn', detail: 'started_on_must_be_today' }); // B1c-2 fix round 1, B2: always today

    // A manual (null-epoch) invoice drafted for next month before the subscription would collide with the
    // engine's own December draft (the unique index spans every epoch).
    const dec = await draftBrandInvoice({ sql: f.sql, now: nov10 }, admin(), { organizationId: f.orgId, period: '2026-12', planId: 'b2b_29' });
    if (!dec.ok) throw new Error(dec.code);
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: nov10 }, admin(), { organizationId: f.orgId, planId: 'b2b_29', startedOn: '2026-11-10' }),
    ).toEqual({ ok: false, code: 'conflict', detail: 'period_already_invoiced' });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toBeNull();
    await voidBrandInvoice({ sql: f.sql, now: nov10 }, admin(), { invoiceId: dec.invoice.id, reason: 'cleanup' });
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: nov10 }, admin(), { organizationId: f.orgId, planId: 'b2b_29', startedOn: '2026-11-10' }),
    ).toMatchObject({ ok: true, applied: true, subscription: { epoch: 1 } });

    for (const [detail, needle] of [
      ['conflict:manual_plan_active', '유효한 수동 플랜'],
      ['conflict:period_already_invoiced', '그 이후 달에'],
      ['startedOn:started_on_in_future', '오늘(KST) 또는 그 이전'],
      ['startedOn:started_on_must_be_today', '오늘(KST) 시작'],
      ['paidAt:paid_at_before_start', '구독을 시작한 날보다 앞설 수 없습니다'],
      ['paidAt:paid_at_overlaps_cycle', '다른 청구서의 기간과 겹칩니다'],
      ['invalid:preview_required', '미리보기를 확인한 뒤 다시 실행하세요.'],
    ] as const) {
      const text = formatBillingOutcomeDetail(detail, 'ko') ?? '';
      expect(text, detail).toContain(needle);
      expect(text, detail).not.toContain('동일 기간 청구서가 이미 있거나');
    }
    // Pre-existing details keep their pre-existing text.
    expect(formatBillingOutcomeDetail('conflict', 'ko')).toBe('동일 기간 청구서가 이미 있거나 동시 수정 충돌이 발생했습니다 (conflict)');
    expect(formatBillingOutcomeDetail('startedOn', 'en')).toBe('Check the start date (YYYY-MM-DD) (startedOn)');
  });

  it('A1: the subscription panel shows only the current epoch as the oldest unpaid invoice', async () => {
    const oct = await draftBrandInvoice({ sql: f.sql, now: at('2026-10-05T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      period: '2026-10',
      planId: 'b2b_29',
    });
    if (!oct.ok) throw new Error(oct.code);
    await issueBrandInvoice({ sql: f.sql, now: at('2026-10-05T01:00:00Z') }, admin(), { invoiceId: oct.invoice.id });
    const started = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-03T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-03',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');
    const detail = await loadBrandOrgDetailOps(f.sql, admin(), f.orgId, { now: new Date('2026-11-04T01:00:00Z') });
    expect(detail?.subscriptionPanel?.oldestUnpaid).toMatchObject({ id: started.firstInvoiceId, period: '2026-11', dueOn: '2026-11-17' });
  });

  it('C3 / round 2 item 4: cancel with nothing paid voids every unpaid invoice (early access too, discount returned) and ends; a current-period engine draft is voided by the system', async () => {
    await f.sql.query(
      "insert into brand_discounts (organization_id, percent, invoices_total, status, created_by) values ($1, 20, 1, 'active', $2)",
      [f.orgId, f.ids.admin],
    );
    const early = await startConfirmed({ sql: f.sql, now: at('2026-11-10T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-10',
      activateBeforePayment: true,
      confirm: true,
    });
    if (!early.ok || !early.applied) throw new Error('start failed');
    expect(await loadPlanAssignment(f.sql, f.orgId)).toMatchObject({ endsOn: '2026-11-24' });
    const usedAfterIssue = (
      await f.sql.query<{ invoices_used: number }>('select invoices_used from brand_discounts where organization_id = $1', [f.orgId])
    ).rows[0];
    expect(usedAfterIssue?.invoices_used).toBe(1);
    // The panel knows nothing was paid, so the cancel confirmation says the unpaid invoice will be voided.
    const panel = await loadBrandOrgDetailOps(f.sql, admin(), f.orgId, { now: new Date('2026-11-12T01:00:00Z') });
    expect(panel?.subscriptionPanel?.facts).toMatchObject({ nothingPaid: true });

    const canceled = await cancelSubscription({ sql: f.sql, now: at('2026-11-12T01:00:00Z') }, admin(), { organizationId: f.orgId });
    expect(canceled).toMatchObject({ ok: true, subscription: { status: 'ended' } });
    const first = (
      await f.sql.query<{ status: string; voided_by: string | null; void_reason: string }>(
        'select status, voided_by::text as voided_by, void_reason from brand_invoices where id = $1',
        [early.firstInvoiceId],
      )
    ).rows[0];
    expect(first).toEqual({ status: 'void', voided_by: null, void_reason: 'subscription_canceled_unpaid' });
    const usedAfterCancel = (
      await f.sql.query<{ invoices_used: number; status: string }>(
        'select invoices_used, status from brand_discounts where organization_id = $1',
        [f.orgId],
      )
    ).rows[0];
    expect(usedAfterCancel).toMatchObject({ invoices_used: 0, status: 'active' });
    expect(await loadPlanAssignment(f.sql, f.orgId)).toBeNull();

    const org2 = await newOrg(f.sql, 'Cancel Current Draft Fixture');
    const s2 = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-01T01:00:00Z') }, admin(), {
      organizationId: org2,
      planId: 'b2b_49',
      startedOn: '2026-11-01',
    });
    if (!s2.ok || !s2.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql: f.sql, now: at('2026-11-01T02:00:00Z') }, admin(), { invoiceId: s2.firstInvoiceId, paidMethod: 'transfer' });
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-11-25T01:00:00Z') });
    const decDraft = (await listBrandInvoices(f.sql, { organizationId: org2 })).find((i) => i.period === '2026-12');
    expect(decDraft?.status).toBe('draft');
    // Canceled on Dec 1 (KST) before the hourly run issued December.
    const cancelDec1 = await cancelSubscription({ sql: f.sql, now: at('2026-11-30T15:30:00Z') }, admin(), { organizationId: org2 });
    expect(cancelDec1).toMatchObject({ ok: true, subscription: { status: 'ended' } });
    const decAfter = (
      await f.sql.query<{ status: string; voided_by: string | null; void_reason: string }>(
        'select status, voided_by::text as voided_by, void_reason from brand_invoices where id = $1',
        [decDraft!.id],
      )
    ).rows[0];
    expect(decAfter).toEqual({ status: 'void', voided_by: null, void_reason: 'subscription_canceled_current_draft' });
  });

  it('B5 / round 2 item 9: start and reissue confirms are bound to the preview digest; stale or missing digests are refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T01:00:00Z'));
    const h = await adminHarness();
    try {
      const sql = runner(h.db);
      const ownerId = randomUUID();
      await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: 'ops-b5@fixture.invalid' });
      await seedProfile(sql, { id: ownerId, email: 'owner-b5@fixture.invalid' });
      const orgId = randomUUID();
      await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
        orgId,
        'Confirm Fixture',
        ownerId,
        randomUUID(),
      ]);
      await seedCompleteBillingProfile(sql, ADMIN_VIEWER, orgId, 'Confirm Fixture');
      const countSubs = async () =>
        Number((await sql.query<{ n: number }>('select count(*)::int as n from brand_subscriptions')).rows[0]!.n);
      const digestOf = (detail: unknown) => /digest=([0-9a-f]{16})/.exec(String(detail))?.[1] ?? '';
      const step2 = (extra: Record<string, string>) =>
        h.run('brandSubscription.start', {
          organizationId: orgId,
          planId: 'b2b_29',
          startedOn: '2026-11-10',
          confirm: 'true',
          previewPlanId: 'b2b_29',
          previewStartedOn: '2026-11-10',
          previewActivateBeforePayment: '0',
          ...extra,
        });

      // Step 1 previews (even without early access); nothing is created.
      const preview = await h.run('brandSubscription.start', { organizationId: orgId, planId: 'b2b_29', startedOn: '2026-11-10' });
      expect(preview).toMatchObject({ ok: true, code: 'prepared' });
      expect(String(preview.detail)).toMatch(/digest=[0-9a-f]{16}/);
      expect(await countSubs()).toBe(0);
      // A single confirm without the digest, or without the ConfirmCheck, is refused.
      expect(await step2({ _confirm: '1' })).toMatchObject({ ok: false, code: 'invalid', detail: 'preview_required' });
      expect(await step2({ previewDigest: digestOf(preview.detail) })).toMatchObject({ ok: false, code: 'invalid', detail: 'confirmCheck' });
      // The amounts changed after the preview (a discount was granted): stale.
      await sql.query(
        "insert into brand_discounts (organization_id, percent, invoices_total, status, created_by) values ($1, 20, null, 'active', $2)",
        [orgId, ADMIN_VIEWER.userId],
      );
      expect(await step2({ previewDigest: digestOf(preview.detail), _confirm: '1' })).toMatchObject({
        ok: false,
        detail: 'conflict:preview_stale',
      });
      expect(await countSubs()).toBe(0);
      const fresh = await h.run('brandSubscription.start', { organizationId: orgId, planId: 'b2b_29', startedOn: '2026-11-10' });
      expect(digestOf(fresh.detail)).not.toBe(digestOf(preview.detail));
      const created = await step2({ previewDigest: digestOf(fresh.detail), _confirm: '1' });
      expect(created).toMatchObject({ ok: true, code: 'created' });
      expect(await countSubs()).toBe(1);

      // Reissue: the first invoice is voided (nothing paid -> needs a reissue); preview + digest-bound confirm.
      const firstId = String(created.detail);
      await sql.query("update brand_invoices set status = 'void', voided_at = now(), voided_by = $2, void_reason = 'x' where id = $1", [
        firstId,
        ADMIN_VIEWER.userId,
      ]);
      expect(await h.run('brandSubscription.reissuePeriod', { organizationId: orgId, period: '2026-11', confirm: 'true' })).toMatchObject({
        ok: false,
        code: 'invalid',
        detail: 'preview_required',
      });
      const reissuePreview = await h.run('brandSubscription.reissuePeriod', { organizationId: orgId, period: '2026-11' });
      expect(reissuePreview).toMatchObject({ ok: true, code: 'prepared' });
      expect(
        await h.run('brandSubscription.reissuePeriod', {
          organizationId: orgId,
          period: '2026-11',
          confirm: 'true',
          previewDigest: '0123456789abcdef',
        }),
      ).toMatchObject({ ok: false, detail: 'conflict:preview_stale' });
      expect(
        await h.run('brandSubscription.reissuePeriod', {
          organizationId: orgId,
          period: '2026-11',
          confirm: 'true',
          previewDigest: digestOf(reissuePreview.detail),
        }),
      ).toMatchObject({ ok: true, code: 'saved' });
    } finally {
      await h.close();
      vi.useRealTimers();
    }
  });

  it('C2: two runs on the same day that each issue a different invoice both notify; a rerun with nothing new does not', async () => {
    const org2 = await newOrg(f.sql, 'Notice Pair Fixture');
    for (const orgId of [f.orgId, org2]) {
      const s = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-01T01:00:00Z') }, admin(), { organizationId: orgId, planId: 'b2b_29', startedOn: '2026-11-01' });
      if (!s.ok || !s.applied) throw new Error('start failed');
      await markBrandInvoicePaid({ sql: f.sql, now: at('2026-11-01T02:00:00Z') }, admin(), { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
    }
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-11-25T01:00:00Z') });
    await f.sql.query('update brand_subscriptions set last_reconciled_at = null');
    const first = await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-12-01T01:00:00Z'), batchLimit: 1 });
    const second = await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-12-01T02:00:00Z'), batchLimit: 1 });
    const third = await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-12-01T03:00:00Z'), batchLimit: 5 });
    expect([first.issued, second.issued, third.issued]).toEqual([1, 1, 0]);
    expect([first.noticeEnqueued, second.noticeEnqueued, third.noticeEnqueued]).toEqual([true, true, false]);
    const notices = (
      await f.sql.query<{ preview: string; source_id: string }>(
        "select preview, source_id::text as source_id from team_notice_deliveries where surface = 'brand_billing:tax_invoices_pending'",
      )
    ).rows;
    expect(notices).toHaveLength(2);
    for (const n of notices) {
      expect(n.preview).not.toContain(n.source_id);
      expect(n.preview).not.toMatch(UUID_RE);
    }
  });
});

describe('explicit allowance overrides stay untouched (product owner requirement)', () => {
  const OVERRIDE_CAP = 777_000;
  const studioEnvFor = { defaultMonthlyKrw: 0, planGraceDays: 14 };

  async function addOverride(orgId: string): Promise<void> {
    await f.sql.query(
      "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note) values ($1, $2, true, 'sunra_mcp', 'override fixture')",
      [orgId, OVERRIDE_CAP],
    );
  }
  async function allowanceRow(orgId: string) {
    return (
      await f.sql.query('select organization_id::text as organization_id, monthly_cap_krw, is_override, preferred_lane, note, updated_by, updated_at from brand_studio_allowances where organization_id = $1', [orgId])
    ).rows[0];
  }

  it('(a) flag off: loadAllowance and reserveAllowance for an override organization run origin/main SQL and return origin/main values', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    await addOverride(f.orgId);
    await f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_49', 'invoice', '2026-11-01', null, 1)",
      [f.orgId],
    );
    const expected = fixture<{ load: unknown; loadLog: unknown; reserve: unknown; reserveLog: unknown }>('brand-allowance-override-parity.json');
    const now = new Date('2026-11-10T01:00:00Z');
    const r1 = recorder(f.db);
    const load = await loadAllowance(r1.sql, f.orgId, studioEnvFor, now);
    const r2 = recorder(f.db);
    const reserve = await r2.sql.transaction((tx) => reserveAllowance(tx, f.orgId, 5000, studioEnvFor, now));
    expect(normalizeIds(load)).toEqual(expected.load);
    expect(normalizeIds(r1.log)).toEqual(expected.loadLog);
    expect(normalizeIds(reserve)).toEqual(expected.reserve);
    expect(normalizeIds(r2.log)).toEqual(expected.reserveLog);
    expect(load).toMatchObject({ source: 'override', baseCapKrw: OVERRIDE_CAP, preferredLane: 'sunra_mcp' });
  });

  it('(b) flag on: an override organization with a subscription keeps source override and its cap in every status, and the job never writes its allowance row', async () => {
    await addOverride(f.orgId);
    const before = await allowanceRow(f.orgId);
    const writes: string[] = [];
    const check = async (expectedStatus: string, nowIso: string) => {
      const r = recorder(f.db);
      await runBrandSubscriptionTick({ sql: r.sql, now: at(nowIso) });
      writes.push(...r.log.map((q) => q.text).filter((t) => /^(insert into|update|delete from) brand_studio_allowances/.test(t)));
      expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: expectedStatus });
      const allowance = await loadAllowance(f.sql, f.orgId, studioEnvFor, new Date(nowIso));
      expect(allowance, expectedStatus).toMatchObject({ source: 'override', baseCapKrw: OVERRIDE_CAP, preferredLane: 'sunra_mcp' });
      expect(await allowanceRow(f.orgId), expectedStatus).toEqual(before);
    };

    const started = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-01T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');
    await check('pending', '2026-11-02T01:00:00Z');
    await markBrandInvoicePaid({ sql: f.sql, now: at('2026-11-03T01:00:00Z') }, admin(), { invoiceId: started.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-11-01' });
    await check('active', '2026-11-25T01:00:00Z');
    await check('active', '2026-12-01T01:00:00Z');
    await check('past_due', '2026-12-16T01:00:00Z');
    await check('suspended', '2026-12-30T01:00:00Z');
    expect(await cancelSubscription({ sql: f.sql, now: at('2026-12-31T01:00:00Z') }, admin(), { organizationId: f.orgId })).toMatchObject({
      ok: true,
      subscription: { status: 'ended' },
    });
    await check('ended', '2027-01-02T01:00:00Z');
    expect(writes).toEqual([]);
    expect(await allowanceRow(f.orgId)).toEqual(before);
  });

  it('(c) flag on: an override organization without a subscription is never selected, read or written by the job', async () => {
    const other = await newOrg(f.sql, 'Override Only Fixture');
    await addOverride(other);
    const before = await allowanceRow(other);
    const started = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-01T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql: f.sql, now: at('2026-11-01T02:00:00Z') }, admin(), { invoiceId: started.firstInvoiceId, paidMethod: 'transfer' });

    const touched: string[] = [];
    let statements = 0;
    for (const nowIso of ['2026-11-02T01:00:00Z', '2026-11-25T01:00:00Z', '2026-12-01T01:00:00Z', '2026-12-16T01:00:00Z', '2026-12-30T01:00:00Z']) {
      const r = recorder(f.db);
      const tick = await runBrandSubscriptionTick({ sql: r.sql, now: at(nowIso) });
      expect(tick).toMatchObject({ ok: true, checked: 1, errors: 0 });
      statements += r.log.length;
      for (const q of r.log) {
        if (q.params.some((p) => String(p).includes(other)) || q.text.includes(other)) touched.push(q.text);
      }
    }
    expect(statements).toBeGreaterThan(20);
    expect(touched).toEqual([]);
    expect(await allowanceRow(other)).toEqual(before);
    expect(await loadAllowance(f.sql, other, studioEnvFor, new Date('2026-12-30T01:00:00Z'))).toMatchObject({
      source: 'override',
      baseCapKrw: OVERRIDE_CAP,
      preferredLane: 'sunra_mcp',
    });
  });
});
