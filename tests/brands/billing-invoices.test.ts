import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import {
  consumeBrandDiscountUse,
  draftBrandInvoice,
  grantBrandDiscount,
  listBrandDiscountCodes,
  listBrandInvoiceEvents,
  listBrandInvoices,
  loadActiveBrandDiscount,
  loadBrandBillingProfile,
  markBrandInvoicePaid,
  saveBrandBillingProfileAdmin,
  saveBrandBillingProfileCustomer,
  updateDraftBrandInvoice,
  issueBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { setPlanAssignment } from '@/lib/brands/plans';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { ADMIN_VIEWER, adminHarness, expectOk } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const owner = (): Viewer => viewerOf(f.ids.owner);
const editor = (): Viewer => viewerOf(f.ids.editor);

beforeEach(async () => {
  f = await studioFixture({ capKrw: 500_000 });
  deps = studioDeps(f.sql);
  await setPlanAssignment({ sql: f.sql }, admin(), {
    organizationId: f.orgId,
    planId: 'b2b_29',
    startedOn: '2026-11-16',
    expectedRevision: 0,
  });
});

afterEach(async () => {
  await f.db.close();
});

describe('billing profiles', () => {
  it('validates Korean business reg no checksum and keeps admin memo hidden from customer updates', async () => {
    expect(
      await saveBrandBillingProfileCustomer({ sql: f.sql }, owner(), {
        organizationId: f.orgId,
        companyLegalName: 'Sample Studio Inc.',
        businessRegNo: '123-45-67890',
        taxInvoiceEmail: 'tax@example.test',
      }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'businessRegNo' });

    expect(
      await saveBrandBillingProfileCustomer({ sql: f.sql }, editor(), {
        organizationId: f.orgId,
        companyLegalName: 'Sample Studio Inc.',
        businessRegNo: '111-11-11119',
      }),
    ).toMatchObject({ ok: false, code: 'forbidden' });

    expect(
      await saveBrandBillingProfileAdmin({ sql: f.sql }, admin(), {
        organizationId: f.orgId,
        companyLegalName: 'Sample Studio Inc.',
        businessRegNo: '111-11-11119',
        representativeName: 'Kim Test',
        businessAddress: 'Seoul',
        taxInvoiceEmail: 'tax@example.test',
        contactName: 'Billing Contact',
        contactPhone: '010-0000-0000',
        memo: 'internal accounting note',
      }),
    ).toMatchObject({ ok: true });

    // Owner updates address without overwriting admin memo
    const cust = await saveBrandBillingProfileCustomer({ sql: f.sql }, owner(), {
      organizationId: f.orgId,
      companyLegalName: 'Sample Studio Inc.',
      businessRegNo: '123-45-67891',
      representativeName: 'Kim Test',
      businessAddress: 'Gangnam, Seoul',
      taxInvoiceEmail: 'finance@example.test',
      contactName: 'Billing Contact',
      contactPhone: '010-0000-0000',
    });
    expect(cust.ok).toBe(true);
    const full = await loadBrandBillingProfile(f.sql, f.orgId);
    expect(full).toMatchObject({
      businessRegNo: '1234567891',
      businessAddress: 'Gangnam, Seoul',
      memo: 'internal accounting note',
    });
  });
});

describe('invoices ledger, proration proposal, state machine & overdue filter', () => {
  it('proposes first-month proration + active discount, edits draft, enforces transitions and records actor events', async () => {
    await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 40,
      invoicesTotal: 3,
    });

    const draftTime = new Date('2026-10-31T00:00:00Z');
    const editTime = new Date('2026-10-31T01:00:00Z');
    // Plan started 2026-11-16 -> 15 used days out of 30 days in 2026-11
    // floor(290000 * 15 / 30) = 145000; 40% off = 58000; supply = 87000; vat = 8700; total = 95700
    const d1 = await draftBrandInvoice({ sql: f.sql, now: () => draftTime }, admin(), {
      organizationId: f.orgId,
      period: '2026-11',
      memo: 'first month prorated',
    });
    expect(d1.ok).toBe(true);
    if (!d1.ok) return;
    expect(d1.invoice).toMatchObject({
      planId: 'b2b_29',
      baseListKrw: 290_000,
      listKrw: 145_000,
      proratedDays: 15,
      periodDays: 30,
      discountPercent: 40,
      discountKrw: 58_000,
      supplyKrw: 87_000,
      vatKrw: 8_700,
      totalKrw: 95_700,
      status: 'draft',
    });

    // Duplicate non-void invoice for same (org, period) refused
    expect(await draftBrandInvoice({ sql: f.sql }, admin(), { organizationId: f.orgId, period: '2026-11' })).toEqual({
      ok: false,
      code: 'conflict',
    });

    // Cannot jump draft -> paid
    expect(await markBrandInvoicePaid({ sql: f.sql }, admin(), { invoiceId: d1.invoice.id })).toEqual({
      ok: false,
      code: 'conflict',
    });

    // S5: manual supply/vat without manualAmounts=true is rejected; explicit manualAmounts=true requires manualReason + total=supply+vat
    expect(
      await updateDraftBrandInvoice({ sql: f.sql, now: () => editTime }, admin(), {
        invoiceId: d1.invoice.id,
        supplyKrw: 100_000,
        vatKrw: 10_000,
      }),
    ).toMatchObject({ ok: false, code: 'invalid' });
    expect(
      await updateDraftBrandInvoice({ sql: f.sql, now: () => editTime }, admin(), {
        invoiceId: d1.invoice.id,
        manualAmounts: true,
        supplyKrw: 100_000,
        vatKrw: 10_000,
        manualReason: '   ',
      }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'manualReason' });
    expect(
      await updateDraftBrandInvoice({ sql: f.sql, now: () => editTime }, admin(), {
        invoiceId: d1.invoice.id,
        manualAmounts: true,
        manualReason: 'bad total check',
        supplyKrw: 100_000,
        vatKrw: 10_000,
        totalKrw: 999_999,
      }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'totalKrw' });

    const edited = await updateDraftBrandInvoice({ sql: f.sql, now: () => editTime }, admin(), {
      invoiceId: d1.invoice.id,
      manualAmounts: true,
      manualReason: 'contracted custom rate',
      supplyKrw: 100_000,
      vatKrw: 10_000,
      memo: 'adjusted agreement',
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      expect(edited.invoice).toMatchObject({ supplyKrw: 100_000, vatKrw: 10_000, totalKrw: 110_000, manualAmounts: true });
    }

    // Issue invoice 15 days before `checkNow` -> overdue query sees it, and it does NOT block studio runs!
    const issueTime = new Date('2026-11-01T00:00:00Z');
    const checkNow = new Date('2026-11-16T00:00:01Z');
    const issued = await issueBrandInvoice({ sql: f.sql, now: () => issueTime }, admin(), { invoiceId: d1.invoice.id });
    expect(issued.ok).toBe(true);

    // Editing issued invoice is refused
    expect(await updateDraftBrandInvoice({ sql: f.sql }, admin(), { invoiceId: d1.invoice.id, supplyKrw: 1 })).toEqual({
      ok: false,
      code: 'conflict',
    });

    // Overdue query
    const overdue = await listBrandInvoices(f.sql, { overdueOnly: true, now: checkNow });
    expect(overdue.map((i) => i.id)).toEqual([d1.invoice.id]);
    // Exactly 14 days is NOT overdue
    expect(await listBrandInvoices(f.sql, { overdueOnly: true, now: new Date('2026-11-15T00:00:00Z') })).toEqual([]);

    // Studio generation still works when invoice is unpaid/overdue!
    const job = await createStudioJob(deps, owner(), {
      kind: 'image',
      organizationId: f.orgId,
      requestId: requestId(),
      model: 'seedream-5.5',
      prompt: 'test run while invoice unpaid',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
    });
    expect(job.ok).toBe(true);

    // Mark paid
    const paid = await markBrandInvoicePaid({ sql: f.sql, now: () => checkNow }, admin(), {
      invoiceId: d1.invoice.id,
      paidMethod: 'bank_transfer',
    });
    expect(paid.ok).toBe(true);
    if (paid.ok) expect(paid.invoice).toMatchObject({ status: 'paid', paidMethod: 'bank_transfer', overdue: false });

    // Paid -> void, paid -> issue, paid -> paid are all refused
    expect(await voidBrandInvoice({ sql: f.sql }, admin(), { invoiceId: d1.invoice.id, reason: 'nope' })).toEqual({
      ok: false,
      code: 'conflict',
    });
    expect(await issueBrandInvoice({ sql: f.sql }, admin(), { invoiceId: d1.invoice.id })).toEqual({
      ok: false,
      code: 'conflict',
    });

    // Events audit log recorded every transition with actor_id
    const events = await listBrandInvoiceEvents(f.sql, d1.invoice.id);
    expect(events.map((e) => e.action)).toEqual(['drafted', 'edited', 'issued', 'paid']);
    for (const ev of events) expect(ev.actorId).toBe(f.ids.admin);

    // Draft -> void requires reason and frees (org, period) for a new draft
    const d2 = await draftBrandInvoice({ sql: f.sql }, admin(), { organizationId: f.orgId, period: '2026-12' });
    expect(d2.ok).toBe(true);
    if (!d2.ok) return;
    expect(await voidBrandInvoice({ sql: f.sql }, admin(), { invoiceId: d2.invoice.id, reason: '   ' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await voidBrandInvoice({ sql: f.sql }, admin(), { invoiceId: d2.invoice.id, reason: 'recreate' })).toMatchObject({
      ok: true,
    });
    expect(await issueBrandInvoice({ sql: f.sql }, admin(), { invoiceId: d2.invoice.id })).toEqual({
      ok: false,
      code: 'conflict',
    });
    expect((await draftBrandInvoice({ sql: f.sql }, admin(), { organizationId: f.orgId, period: '2026-12' })).ok).toBe(true);
  });

  it('dispatches all discount, code, profile, and invoice admin operations through /admin/do registry', async () => {
    const h = await adminHarness();
    try {
      const hsql = runner(h.db);
      await seedProfile(hsql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
      const created = await createStudioOrganization({ sql: hsql }, ADMIN_VIEWER, { name: 'Ops Org', requestId: randomUUID() });
      if (!created.ok) throw new Error(created.code);

      expectOk(
        await h.run('brandEngine.plan', {
          organizationId: created.id,
          planId: 'b2b_49',
          startedOn: '2026-11-01',
          expectedRevision: 0,
        }),
      );
      expectOk(await h.run('brandBilling.discount.grant', { organizationId: created.id, percent: '25', invoicesTotal: '2', memo: 'vip' }));
      expect(await loadActiveBrandDiscount(hsql, created.id)).toMatchObject({ percent: 25, invoicesTotal: 2 });

      expectOk(
        await h.run('brandBilling.profile.set', {
          organizationId: created.id,
          companyLegalName: 'Ops Sample Corp',
          businessRegNo: '111-11-11119',
          taxInvoiceEmail: 'ops@example.test',
        }),
      );
      expect(await loadBrandBillingProfile(hsql, created.id)).toMatchObject({ companyLegalName: 'Ops Sample Corp', businessRegNo: '1111111119' });

      const d = expectOk(await h.run('brandBilling.invoice.draft', { organizationId: created.id, period: '2026-11', memo: 'nov' }));
      const invoiceId = d.detail!;
      expectOk(
        await h.run('brandBilling.invoice.updateDraft', {
          invoiceId,
          manualAmounts: 'true',
          manualReason: 'custom agreement',
          supplyKrw: '350000',
          vatKrw: '35000',
          memo: 'edited',
        }),
      );
      expectOk(await h.run('brandBilling.invoice.issue', { invoiceId }));
      expectOk(await h.run('brandBilling.invoice.markPaid', { invoiceId, paidMethod: 'wire' }));

      const d2 = expectOk(await h.run('brandBilling.invoice.draft', { organizationId: created.id, period: '2026-12' }));
      expectOk(await h.run('brandBilling.invoice.issue', { invoiceId: d2.detail! }));
      expectOk(await h.run('brandBilling.invoice.void', { invoiceId: d2.detail!, reason: 'canceled' }));

      expectOk(await h.run('brandBilling.discount.end', { organizationId: created.id, reason: 'done' }));
      expect(await loadActiveBrandDiscount(hsql, created.id)).toBeNull();

      expectOk(await h.run('brandBilling.discountCode.create', { code: 'OPS-PROMO-10', percent: '10', invoicesTotal: '1', maxRedemptions: '5' }));
      expectOk(await h.run('brandBilling.discountCode.disable', { code: 'OPS-PROMO-10' }));
      const codes = await listBrandDiscountCodes(hsql);
      expect(codes.find((c) => c.code === 'OPS-PROMO-10')?.disabled).toBe(true);
    } finally {
      await h.close();
    }
  });

  it('S5 & S8: changing planId re-proposes list amount, inconsistent drafts fail issue, and 0-KRW project_only invoices never consume a discount use', async () => {
    const disc = await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 40,
      invoicesTotal: 2,
    });
    expect(disc.ok).toBe(true);

    // Changing planId on draft from b2b_29 (290k) -> b2b_49 (490k) re-proposes 490k list and derives discount/supply/vat!
    const d = await draftBrandInvoice({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      period: '2026-12',
      planId: 'b2b_29',
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.invoice.baseListKrw).toBe(290_000);

    const switched = await updateDraftBrandInvoice({ sql: f.sql }, admin(), {
      invoiceId: d.invoice.id,
      planId: 'b2b_49',
    });
    expect(switched.ok).toBe(true);
    if (switched.ok) {
      expect(switched.invoice).toMatchObject({
        planId: 'b2b_49',
        baseListKrw: 490_000,
        listKrw: 490_000,
        discountPercent: 40,
        discountKrw: 196_000,
        supplyKrw: 294_000,
        vatKrw: 29_400,
        totalKrw: 323_400,
      });
    }

    // DB CHECK refuses corrupted derived amounts (even when total = supply + vat!) and refuses manual_amounts=true with blank reason
    await expect(
      f.sql.query('update brand_invoices set supply_krw = 1, vat_krw = 0, total_krw = 1 where id = $1', [d.invoice.id]),
    ).rejects.toThrow(/brand_invoices_derived_amounts/);
    await expect(
      f.sql.query('update brand_invoices set manual_amounts = true, supply_krw = 1, vat_krw = 0, total_krw = 1 where id = $1', [d.invoice.id]),
    ).rejects.toThrow(/brand_invoices_manual_reason/);

    // Application guard at issue ALSO catches any inconsistent row (even if DB constraints were relaxed/bypassed)
    await f.sql.query('alter table brand_invoices drop constraint brand_invoices_derived_amounts');
    await f.sql.query('update brand_invoices set supply_krw = 1, vat_krw = 0, total_krw = 1 where id = $1', [d.invoice.id]);
    expect(await issueBrandInvoice({ sql: f.sql }, admin(), { invoiceId: d.invoice.id })).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: 'inconsistent_amounts',
    });
    expect(await loadActiveBrandDiscount(f.sql, f.orgId)).toMatchObject({ invoicesUsed: 0, status: 'active' });

    // If a row is inconsistent (e.g. prorated_days doesn't match list_krw or supply mismatches), issueBrandInvoice refuses it too
    const zeroDraft = await draftBrandInvoice({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      period: '2027-01',
      planId: 'project_only',
    });
    expect(zeroDraft.ok).toBe(true);
    if (!zeroDraft.ok) return;
    expect(zeroDraft.invoice).toMatchObject({ planId: 'project_only', listKrw: 0, totalKrw: 0 });
    expect((await issueBrandInvoice({ sql: f.sql }, admin(), { invoiceId: zeroDraft.invoice.id })).ok).toBe(true);
    // S8: 0-KRW invoice did NOT consume a discount use!
    expect(await loadActiveBrandDiscount(f.sql, f.orgId)).toMatchObject({ invoicesUsed: 0, invoicesRemaining: 2 });
  });

  it('S10: conditional SQL guards stop interleaved issue-vs-void and concurrent last-discount-use writes without JS mutex', async () => {
    const disc = await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 30,
      invoicesTotal: 1,
    });
    if (!disc.ok) throw new Error('discount grant failed');

    // Part A: issue vs void interleaved at statement level on same draft invoice (both read status='draft' before either writes)
    const d1 = await draftBrandInvoice({ sql: f.sql }, admin(), { organizationId: f.orgId, period: '2027-02' });
    if (!d1.ok) throw new Error('draft failed');

    let readCount = 0;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    let sqlStatusGuardMisses = 0;

    const interleavedSql: SqlRunner = {
      async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
        const res = await f.sql.query<T>(text, params);
        if (text.includes('select * from brand_invoices where id =')) {
          readCount += 1;
          if (readCount === 2) releaseReads();
          await bothRead;
        }
        if (text.includes('update brand_invoices') && text.includes('and status =') && res.rows.length === 0) {
          sqlStatusGuardMisses += 1;
        }
        return res;
      },
      async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
        return fn(interleavedSql);
      },
    };

    const [voidRes, issueRes] = await Promise.all([
      voidBrandInvoice({ sql: interleavedSql }, admin(), { invoiceId: d1.invoice.id, reason: 'race void' }),
      issueBrandInvoice({ sql: interleavedSql }, admin(), { invoiceId: d1.invoice.id }),
    ]);

    expect([voidRes.ok, issueRes.ok].filter(Boolean)).toHaveLength(1);
    expect([voidRes, issueRes].filter((r) => !r.ok)).toEqual([{ ok: false, code: 'conflict' }]);
    expect(sqlStatusGuardMisses).toBe(1);

    // If void won, discount was NOT consumed (invoicesUsed = 0); if issue won, invoicesUsed = 1
    const finalInv = (await listBrandInvoices(f.sql, { organizationId: f.orgId })).find((i) => i.id === d1.invoice.id)!;
    const activeAfter = await loadActiveBrandDiscount(f.sql, f.orgId);
    if (finalInv.status === 'void') {
      expect(activeAfter).toMatchObject({ invoicesUsed: 0, status: 'active' });
    } else {
      expect(finalInv.status).toBe('issued');
      expect(activeAfter).toBeNull();
    }

    // Part B: direct conditional UPDATE SQL guard on invoices_used < invoices_total returns null (0 rows) on 2nd writer
    const d2 = await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 25,
      invoicesTotal: 1,
    });
    if (!d2.ok) throw new Error('second discount grant failed');
    const nowIso = '2026-11-20T00:00:00Z';
    const firstConsume = await consumeBrandDiscountUse(f.sql, d2.discount.id, nowIso, f.ids.admin);
    const secondConsume = await consumeBrandDiscountUse(f.sql, d2.discount.id, nowIso, f.ids.admin);
    expect(firstConsume).toMatchObject({ id: d2.discount.id, invoices_used: 1, status: 'ended', end_reason: 'exhausted' });
    expect(secondConsume).toBeNull();
  });
});
