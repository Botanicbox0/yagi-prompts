import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prerender } from 'react-dom/static';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrandOrgDetailOps } from '@/lib/admin/brand-org-detail';
import {
  billingPeriodParam,
  formatBillingOutcomeDetail,
  loadBrandBillingOverview,
  loadBrandDiscountCodesConsole,
} from '@/lib/admin/brand-billing-console';
import {
  createBrandDiscountCode,
  draftBrandInvoice,
  grantBrandDiscount,
  grantExtraAllowance,
  issueBrandInvoice,
  markBrandInvoicePaid,
  redeemBrandDiscountCode,
  setPlanAllowanceDefault,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { setPlanAssignment } from '@/lib/brands/plans';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { deterministicNoticeSourceId, enqueueTeamNotice } from '@/lib/brands/team-notice-outbox';
import { ADMIN_ORIGIN, adminUrl } from '@/lib/seo/site-url';
import { adminHarness, ADMIN_VIEWER } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { asRole, createAppRole, expectReject, freshDb, runner } from '@/tests/helpers/pglite';
import { studioDeps, viewerOf } from '@/tests/brand-studio/server/helpers';

const openClosers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (openClosers.length > 0) {
    const close = openClosers.pop();
    if (close) await close();
  }
});

describe('brand org detail, billing console, operations, migrations & page gates', () => {
  it('loads org detail ops, filtered studio jobs with returned KRW, and merged chronological timeline', async () => {
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    const deps = studioDeps(sql);
    const now = new Date('2026-11-20T06:00:00.000Z');
    const ownerId = randomUUID();
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: 'lead-ops@yagiworkshop.xyz' });
    await seedProfile(sql, { id: ownerId, email: 'founder@northstar-apparel.example' });
    await sql.query("update profiles set display_name = 'Ops Lead' where id = $1", [ADMIN_VIEWER.userId]);

    const orgId = randomUUID();
    await sql.query(
      'insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)',
      [orgId, 'Northstar Apparel', ownerId, randomUUID()],
    );
    await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
      orgId,
      ownerId,
      'owner',
    ]);

    const setRes = await h.run('brandBilling.planAndAllowance.set', {
      organizationId: orgId,
      planId: 'b2b_49',
      billingMode: 'invoice',
      startedOn: '2026-11-01',
      seats: 4,
      planNote: 'Initial B2B launch plan',
      allowanceMode: 'override',
      monthlyCapKrw: 650_000,
      preferredLane: 'sunra_api',
      allowanceNote: 'Launch cap boost',
      expectedRevision: 0,
    });
    expect(setRes).toMatchObject({ ok: true, code: 'saved' });

    const profileRes = await h.run('brandBilling.profile.set', {
      organizationId: orgId,
      companyLegalName: 'Northstar Apparel Co., Ltd.',
      businessRegNo: '2208162517',
      representativeName: 'Alex Kim',
      businessAddress: '100 Example-ro, Seoul',
      taxInvoiceEmail: 'billing@northstar.example',
      contactName: 'Alex Kim',
      contactPhone: '02-555-0100',
      memo: 'Verified business cert',
    });
    expect(profileRes).toMatchObject({ ok: true, code: 'saved' });

    await grantBrandDiscount({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgId,
      percent: 30,
      invoicesTotal: 2,
      memo: 'Partner 30% discount',
    });
    await grantExtraAllowance({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgId,
      amountKrw: 100_000,
      validMonth: '2026-11',
      reason: 'Onboarding bonus credits',
    });
    const drafted = await draftBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgId,
      period: '2026-11',
      prorate: false,
    });
    expect(drafted.ok).toBe(true);
    if (drafted.ok) {
      await issueBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
    }

    // Jobs: 1 failed with full estimate returned, 1 succeeded
    const failJob = await createStudioJob(deps, viewerOf(ownerId), {
      kind: 'image',
      organizationId: orgId,
      requestId: randomUUID(),
      model: 'seedream-5.5',
      prompt: 'campaign banner',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
    });
    expect(failJob.ok).toBe(true);
    if (failJob.ok) {
      await sql.query(
        `update brand_studio_jobs
            set status = 'failed', lane = 'sunra_mcp', error_code = 'provider_unavailable', error_detail = 'Exceeded 180s',
                estimate_krw = 2400, usage_krw = 0, finished_at = $2::timestamptz
          where id = $1`,
        [failJob.job.id, '2026-11-20T05:00:00.000Z'],
      );
    }

    const okJob = await createStudioJob(deps, viewerOf(ownerId), {
      kind: 'image',
      organizationId: orgId,
      requestId: randomUUID(),
      model: 'seedream-5.5',
      prompt: 'campaign teaser',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
    });
    expect(okJob.ok).toBe(true);
    if (okJob.ok) {
      await sql.query(
        `update brand_studio_jobs
            set status = 'succeeded', lane = 'sunra_api', usage_krw = 70, finished_at = $2::timestamptz
          where id = $1`,
        [okJob.job.id, '2026-11-20T05:30:00.000Z'],
      );
    }

    const detail = await loadBrandOrgDetailOps(sql, ADMIN_VIEWER, orgId, { jobStatus: 'failed', now });
    expect(detail).not.toBeNull();
    if (!detail) return;

    expect(detail.billingAvailable).toBe(true);
    expect(detail.studioJobsAvailable).toBe(true);
    expect(detail.billingProfile?.companyLegalName).toBe('Northstar Apparel Co., Ltd.');
    expect(detail.activeDiscount?.percent).toBe(30);
    expect(detail.grants).toHaveLength(1);
    expect(detail.invoices).toHaveLength(1);
    expect(detail.studioJobs).toHaveLength(1);
    expect(detail.studioJobs[0]?.status).toBe('failed');
    expect(detail.studioJobs[0]?.returnedKrw).toBe(2400);

    const categories = new Set(detail.history.map((item) => item.category));
    expect(categories.has('plan')).toBe(true);
    expect(categories.has('invoice')).toBe(true);
    expect(categories.has('discount')).toBe(true);
    expect(categories.has('grant')).toBe(true);
    expect(detail.history.some((item) => item.actorName === 'Ops Lead')).toBe(true);

    // Non-admin returns null across loaders
    const outsider = viewerOf(ownerId);
    expect(await loadBrandOrgDetailOps(sql, outsider, orgId, { now })).toBeNull();
    expect(await loadBrandBillingOverview(sql, outsider, { period: '2026-11', now })).toBeNull();
    expect(await loadBrandDiscountCodesConsole(sql, outsider)).toBeNull();
  });

  it('computes billing overview totals, overdue list, uninvoiced active orgs, and 2-step plan defaults + stay/validUntil ops', async () => {
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    const now = new Date('2026-11-20T06:00:00.000Z');
    const owner1 = randomUUID();
    const owner2 = randomUUID();
    const owner3 = randomUUID();
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: 'ops2@yagiworkshop.xyz' });
    await seedProfile(sql, { id: owner1, email: 'o1@brand.example' });
    await seedProfile(sql, { id: owner2, email: 'o2@brand.example' });
    await seedProfile(sql, { id: owner3, email: 'o3@brand.example' });

    await sql.query("update profiles set display_name = 'Redeemer Kim' where id = $1", [owner2]);

    const mkOrg = async (name: string, uid: string) => {
      const id = randomUUID();
      await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
        id,
        name,
        uid,
        randomUUID(),
      ]);
      await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
        id,
        uid,
        'owner',
      ]);
      return id;
    };

    const orgPaid = await mkOrg('Harbor Labs', owner1);
    const orgUninvoiced = await mkOrg('Kestrel Works', owner2);
    const orgExpired = await mkOrg('Lantern Old', owner3);

    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgPaid,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      expectedRevision: 0,
    });
    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgUninvoiced,
      planId: 'b2b_49',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '2026-11-18', // in grace -> still eligible for invoice
      expectedRevision: 0,
    });
    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgExpired,
      planId: 'b2b_69',
      billingMode: 'invoice',
      startedOn: '2026-09-01',
      endsOn: '2026-10-31', // expired -> NOT uninvoiced active
      expectedRevision: 0,
    });

    // Org Paid has a paid invoice in 2026-11 AND an overdue issued invoice from 2026-10
    const novPaid = await draftBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgPaid,
      period: '2026-11',
      prorate: false,
    });
    expect(novPaid.ok).toBe(true);
    if (novPaid.ok) {
      await issueBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, { invoiceId: novPaid.invoice.id });
      await markBrandInvoicePaid({ sql, now: () => now }, ADMIN_VIEWER, {
        invoiceId: novPaid.invoice.id,
        paidMethod: 'wire',
      });
    }

    const octOverdue = await draftBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgPaid,
      period: '2026-10',
      prorate: false,
    });
    expect(octOverdue.ok).toBe(true);
    if (octOverdue.ok) {
      await issueBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, { invoiceId: octOverdue.invoice.id });
      await sql.query(`update brand_invoices set issued_at = $2::timestamptz where id = $1`, [
        octOverdue.invoice.id,
        '2026-11-01T00:00:00.000Z',
      ]);
    }

    // Void-only invoice on orgUninvoiced should STILL leave orgUninvoiced in uninvoiced list!
    const voidInv = await draftBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgUninvoiced,
      period: '2026-11',
      prorate: false,
    });
    expect(voidInv.ok).toBe(true);
    if (voidInv.ok) {
      await voidBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, {
        invoiceId: voidInv.invoice.id,
        reason: 'Wrong period draft',
      });
    }

    // Two-step planDefault.set via dispatchAdmin
    const previewRes = await h.run('brandBilling.planDefault.set', {
      planId: 'b2b_29',
      monthlyCapKrw: '180000',
      note: 'Founder approved cap',
    });
    expect(previewRes).toMatchObject({ ok: true, code: 'prepared' });
    expect(previewRes.detail).toContain('Harbor Labs:0->180000');

    const applyRes = await h.run('brandBilling.planDefault.set', {
      planId: 'b2b_29',
      monthlyCapKrw: '180000',
      note: 'Founder approved cap',
      confirm: 'true',
    });
    expect(applyRes).toMatchObject({ ok: true, code: 'saved' });

    // One-click draft with stay=1 stays on /admin/brand-billing
    const draftStay = await h.run(
      'brandBilling.invoice.draft',
      {
        organizationId: orgUninvoiced,
        period: '2026-11',
        planId: 'b2b_49',
        applyActiveDiscount: '1',
        prorate: '1',
        stay: '1',
      },
    );
    expect(draftStay).toMatchObject({ ok: true, code: 'created' });
    expect('to' in draftStay ? draftStay.to : undefined).toBeUndefined();

    // Discount code creation with date input + redemption
    const codeOp = await h.run('brandBilling.discountCode.create', {
      code: 'AUTUMN-2026',
      percent: '25',
      invoicesTotal: '2',
      maxRedemptions: '5',
      validUntil: '2027-01-31',
      organizationId: orgUninvoiced,
      memo: 'Q4 launch promo',
    });
    expect(codeOp).toMatchObject({ ok: true, code: 'created' });

    const redeemRes = await redeemBrandDiscountCode({ sql, now: () => now }, viewerOf(owner2), {
      organizationId: orgUninvoiced,
      code: 'AUTUMN-2026',
    });
    expect(redeemRes.ok).toBe(true);

    const overview = await loadBrandBillingOverview(sql, ADMIN_VIEWER, {
      period: '2026-11',
      env: { defaultMonthlyKrw: 200_000, planGraceDays: 3 },
      now,
    });
    expect(overview).not.toBeNull();
    if (!overview) return;

    expect(overview.available).toBe(true);
    expect(overview.byStatus.paid.count).toBe(1);
    expect(overview.byStatus.paid.supplyKrw).toBe(290_000);
    expect(overview.byStatus.paid.vatKrw).toBe(29_000);
    expect(overview.byStatus.paid.totalKrw).toBe(319_000);
    expect(overview.byStatus.draft.count).toBe(1);
    expect(overview.byStatus.void.count).toBe(1);
    // activeTotals excludes void
    expect(overview.activeTotals.count).toBe(2);
    expect(overview.overdueInvoices.map((i) => i.organizationId)).toEqual([orgPaid]);
    expect(overview.overdueInvoices[0]?.daysSinceIssued).toBeGreaterThanOrEqual(19);
    // orgUninvoiced already drafted above, so 0 left
    expect(overview.uninvoicedActiveOrgs).toHaveLength(0);
    const b2b29Default = overview.planDefaults.find((p) => p.planId === 'b2b_29');
    expect(b2b29Default?.monthlyCapKrw).toBe(180_000);
    expect(b2b29Default?.followingOrgCount).toBe(1);

    const codesConsole = await loadBrandDiscountCodesConsole(sql, ADMIN_VIEWER);
    expect(codesConsole?.available).toBe(true);
    const createdCode = codesConsole?.codes.find((c) => c.code === 'AUTUMN-2026');
    expect(createdCode?.boundOrganizationName).toBe('Kestrel Works');
    expect(createdCode?.redemptions).toHaveLength(1);
    expect(createdCode?.redemptions[0]?.redeemerName).toBe('Redeemer Kim');

    // Sanity check utilities
    expect(billingPeriodParam({ period: '2026-11' }, now)).toBe('2026-11');
    expect(billingPeriodParam({ period: 'bad' }, now)).toBe('2026-11');
    expect(formatBillingOutcomeDetail('conflict', 'ko')).toContain('충돌');
    expect(adminUrl('/admin/brand-studio')).toBe(`${ADMIN_ORIGIN}/admin/brand-studio`);
    expect(ADMIN_ORIGIN).toContain('admin.twings.app');

    // Graceful degradation when billing tables missing (fresh SqlRunner without stale table cache)
    await sql.query(
      'drop table if exists brand_invoice_events, brand_invoices, brand_discount_redemptions, brand_discount_codes, brand_discounts, brand_allowance_grants, brand_billing_profiles, brand_plan_allowance_defaults cascade',
    );
    const sqlNoBilling = runner(h.db);
    expect((await loadBrandBillingOverview(sqlNoBilling, ADMIN_VIEWER, { now }))?.available).toBe(false);
    expect((await loadBrandDiscountCodesConsole(sqlNoBilling, ADMIN_VIEWER))?.available).toBe(false);
    const degradedDetail = await loadBrandOrgDetailOps(sqlNoBilling, ADMIN_VIEWER, orgPaid, { now });
    expect(degradedDetail?.billingAvailable).toBe(false);
  });

  it('keeps 0180 + 0181 ops_alert migrations idempotent and preserves deny-all RLS on team_notice_deliveries', async () => {
    const db = await freshDb();
    openClosers.push(() => db.close());
    const sql = runner(db);

    await createAppRole(db, 'anon');
    await createAppRole(db, 'authenticated');
    await createAppRole(db, 'service_role');
    await db.exec('alter role service_role bypassrls;');

    const sql0179 = await readFile(
      resolve(process.cwd(), 'supabase/migrations/0179_glue_support_delivery.sql'),
      'utf8',
    );
    const sql0180 = await readFile(
      resolve(process.cwd(), 'supabase/migrations/0180_core_ops_alert_kind.sql'),
      'utf8',
    );
    const sql0181 = await readFile(
      resolve(process.cwd(), 'supabase/migrations/0181_glue_ops_alert_kind.sql'),
      'utf8',
    );

    // Execute twice to verify idempotency
    await db.exec(sql0179);
    await db.exec(sql0180);
    await db.exec(sql0181);
    await db.exec(sql0180);
    await db.exec(sql0181);

    const okNotice = await enqueueTeamNotice(sql, 'ops_alert', {
      organizationId: null,
      sourceTable: 'brand_studio_jobs',
      sourceId: deterministicNoticeSourceId('ops_alert', 'idempotency-check'),
      surface: 'ops_alert:mass_failure',
      actorLabel: 'Brand Studio Ops',
      preview: '[운영 경보] 테스트 카운트 5건',
      adminPath: '/admin/brand-studio',
    });
    expect(okNotice.enqueued).toBe(true);

    // Invalid kind still hits check constraint 23514
    const bogusSourceId = randomUUID();
    const errMsg = await expectReject(() =>
      sql.query(
        `insert into team_notice_deliveries (kind, source_table, source_id, surface, preview, admin_path)
         values ('bogus_kind', 'brand_studio_jobs', $1, 'ops_alert:test', 'bad', '/admin/brand-studio')`,
        [bogusSourceId],
      ),
    );
    expect(errMsg).toMatch(/violates check constraint/i);

    // RLS posture: anon & authenticated cannot select/insert; service_role can select/insert/update
    const anonMsg = await expectReject(() => asRole(db, 'anon', () => db.query('select id from team_notice_deliveries')));
    expect(anonMsg).toMatch(/permission denied/i);
    const authMsg = await expectReject(() =>
      asRole(db, 'authenticated', () => db.query('select id from team_notice_deliveries')),
    );
    expect(authMsg).toMatch(/permission denied/i);

    await asRole(db, 'service_role', async () => {
      const sel = await db.query<{ count: string }>('select count(*)::text as count from team_notice_deliveries');
      expect(Number(sel.rows[0]?.count ?? 0)).toBe(1);
      const delMsg = await expectReject(() => db.query('delete from team_notice_deliveries'));
      expect(delMsg).toMatch(/permission denied/i);
    });
  });

  it('refuses non-admin requests at every new and updated admin page gate before reading DB', async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth/viewer', () => ({
      requireAdmin: async () => {
        throw new Error('ADMIN_REQUIRED');
      },
    }));

    try {
      const billingOverview = (await import('@/app/(admin)/admin/brand-billing/page')).default;
      const discountCodes = (await import('@/app/(admin)/admin/brand-billing/codes/page')).default;
      const studioOps = (await import('@/app/(admin)/admin/brand-studio/page')).default;
      const brandWorkspace = (await import('@/app/(admin)/admin/brand-workspace/page')).default;
      const orgDetail = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;

      await expect(billingOverview({ searchParams: Promise.resolve({}) })).rejects.toThrow('ADMIN_REQUIRED');
      await expect(discountCodes({ searchParams: Promise.resolve({}) })).rejects.toThrow('ADMIN_REQUIRED');
      await expect(studioOps({ searchParams: Promise.resolve({}) })).rejects.toThrow('ADMIN_REQUIRED');
      await expect(brandWorkspace({ searchParams: Promise.resolve({}) })).rejects.toThrow('ADMIN_REQUIRED');
      await expect(
        orgDetail({ params: Promise.resolve({ id: randomUUID() }), searchParams: Promise.resolve({}) }),
      ).rejects.toThrow('ADMIN_REQUIRED');
    } finally {
      vi.doUnmock('@/lib/auth/viewer');
      vi.resetModules();
    }
  });

  it('F3/F4/F5/F6/F9: enforces billing form safety, allowance-only/no-op paths, active discount confirm, manualAmounts untick, and period-scoped uninvoiced list', async () => {
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    const now = new Date('2026-11-20T06:00:00.000Z');
    const ownerId = randomUUID();
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: 'ops-f345@yagiworkshop.xyz' });
    await seedProfile(sql, { id: ownerId, email: 'owner-f345@example.invalid' });

    const orgNoPlan = randomUUID();
    const orgWithPlan = randomUUID();
    const orgMayEnded = randomUUID();
    const orgMayBoundaryEnd = randomUUID();

    for (const [orgId, name] of [
      [orgNoPlan, 'Orchard NoPlan'],
      [orgWithPlan, 'Quartz ActivePlan'],
      [orgMayEnded, 'Saffron MayEnded'],
      [orgMayBoundaryEnd, 'Topaz MayStartDayBoundary'],
    ] as const) {
      await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
        orgId,
        name,
        ownerId,
        randomUUID(),
      ]);
      await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
        orgId,
        ownerId,
        'owner',
      ]);
    }

    // F4a: Allowance-only path on an org with NO plan (planId='') saves allowance without touching brand_plan_assignments
    const allowOnly = await h.run('brandBilling.planAndAllowance.set', {
      organizationId: orgNoPlan,
      planId: '',
      expectedRevision: 0,
      allowanceMode: 'override',
      monthlyCapKrw: '300000',
      preferredLane: 'sunra_api',
      allowanceNote: 'Allowance only before plan',
    });
    expect(allowOnly).toMatchObject({ ok: true, code: 'saved' });
    expect(
      (await sql.query('select 1 from brand_plan_assignments where organization_id = $1', [orgNoPlan])).rows,
    ).toHaveLength(0);
    expect(
      (await sql.query('select monthly_cap_krw from brand_studio_allowances where organization_id = $1', [orgNoPlan])).rows[0],
    ).toMatchObject({ monthly_cap_krw: 300_000 });

    // F4c: Existing plan + no allowance row -> unchanged submit must be a no-op (no revision bump, no brand_plan_events)
    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgWithPlan,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      expectedRevision: 0,
    });
    const eventsBefore = Number(
      (await sql.query<{ n: number }>('select count(*)::int as n from brand_plan_events where organization_id = $1', [orgWithPlan])).rows[0]!.n,
    );
    const noopRes = await h.run('brandBilling.planAndAllowance.set', {
      organizationId: orgWithPlan,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '',
      seats: '',
      planNote: '',
      expectedRevision: 1,
      allowanceMode: 'plan_default',
      monthlyCapKrw: '',
      preferredLane: '',
      allowanceNote: '',
    });
    expect(noopRes).toMatchObject({ ok: true, code: 'saved', detail: 'no_change' });
    const revAfterNoop = Number(
      (await sql.query<{ revision: number }>('select revision from brand_plan_assignments where organization_id = $1', [orgWithPlan])).rows[0]!.revision,
    );
    const eventsAfterNoop = Number(
      (await sql.query<{ n: number }>('select count(*)::int as n from brand_plan_events where organization_id = $1', [orgWithPlan])).rows[0]!.n,
    );
    expect(revAfterNoop).toBe(1);
    expect(eventsAfterNoop).toBe(eventsBefore);

    // Changing only allowance on orgWithPlan updates allowance WITHOUT bumping plan revision or writing brand_plan_events
    const allowChangeOnly = await h.run('brandBilling.planAndAllowance.set', {
      organizationId: orgWithPlan,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '',
      seats: '',
      planNote: '',
      expectedRevision: 1,
      allowanceMode: 'override',
      monthlyCapKrw: '450000',
      preferredLane: 'sunra_mcp',
      allowanceNote: 'Temp custom cap',
    });
    expect(allowChangeOnly).toMatchObject({ ok: true, code: 'saved' });
    expect(
      Number((await sql.query<{ revision: number }>('select revision from brand_plan_assignments where organization_id = $1', [orgWithPlan])).rows[0]!.revision),
    ).toBe(1);
    expect(
      Number((await sql.query<{ n: number }>('select count(*)::int as n from brand_plan_events where organization_id = $1', [orgWithPlan])).rows[0]!.n),
    ).toBe(eventsBefore);

    // F5: Discount grant refuses silently replacing an active discount without confirmReplace
    await grantBrandDiscount({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgWithPlan,
      percent: 25,
      invoicesTotal: 2,
      memo: 'Original 25%',
    });
    const blockedGrant = await h.run('brandBilling.discount.grant', {
      organizationId: orgWithPlan,
      percent: '40',
      invoicesTotal: '3',
      memo: 'Should block without confirm',
    });
    expect(blockedGrant).toMatchObject({ ok: false, code: 'invalid', detail: 'confirmReplace' });
    const confirmedGrant = await h.run('brandBilling.discount.grant', {
      organizationId: orgWithPlan,
      percent: '40',
      invoicesTotal: '3',
      memo: 'Confirmed replace',
      confirmReplace: '1',
    });
    expect(confirmedGrant).toMatchObject({ ok: true, code: 'saved' });

    // F6: Draft invoice with manualAmounts=true can be turned back OFF (['0'] or unticked)
    const manualDraft = await draftBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgWithPlan,
      period: '2026-11',
      prorate: false,
      manualAmounts: true,
      manualReason: 'Initial override',
      supplyKrw: 100_000,
      vatKrw: 10_000,
      totalKrw: 110_000,
    });
    expect(manualDraft.ok).toBe(true);
    if (!manualDraft.ok) return;
    expect(manualDraft.invoice.manualAmounts).toBe(true);

    // Simulate HTML form post when hidden=0 precedes checkbox (checkbox unticked -> only '0'; ticked -> ['0','1'])
    const untickForm = new FormData();
    untickForm.set('_op', 'brandBilling.invoice.updateDraft');
    untickForm.set('_back', '/admin');
    untickForm.set('invoiceId', manualDraft.invoice.id);
    untickForm.set('planId', 'b2b_29');
    untickForm.append('manualAmounts', '0');
    untickForm.set('manualReason', '');
    const { dispatchAdmin } = await import('@/lib/admin/dispatch');
    const untickRes = await dispatchAdmin('brandBilling.invoice.updateDraft', untickForm, h.ctx(ADMIN_VIEWER));
    expect(untickRes).toMatchObject({ ok: true, code: 'saved' });
    const updatedRow = (
      await sql.query<{ manual_amounts: boolean; total_krw: number }>(
        'select manual_amounts, total_krw from brand_invoices where id = $1',
        [manualDraft.invoice.id],
      )
    ).rows[0]!;
    expect(updatedRow.manual_amounts).toBe(false);
    expect(updatedRow.total_krw).toBeGreaterThan(110_000); // reverted to derived b2b_29 amounts

    // Check ['0', '1'] (ticked checkbox with hidden input before it) enables manualAmounts=true
    const tickForm = new FormData();
    tickForm.set('_op', 'brandBilling.invoice.updateDraft');
    tickForm.set('_back', '/admin');
    tickForm.set('invoiceId', manualDraft.invoice.id);
    tickForm.set('planId', 'b2b_29');
    tickForm.append('manualAmounts', '0');
    tickForm.append('manualAmounts', '1');
    tickForm.set('manualReason', 'Re-enabled');
    tickForm.set('supplyKrw', '200000');
    tickForm.set('vatKrw', '20000');
    tickForm.set('totalKrw', '220000');
    const tickRes = await dispatchAdmin('brandBilling.invoice.updateDraft', tickForm, h.ctx(ADMIN_VIEWER));
    expect(tickRes).toMatchObject({ ok: true, code: 'saved' });

    // F9: Period-scoped uninvoiced active orgs when viewing ?period=2026-05 (now=2026-11-20)
    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgMayEnded,
      planId: 'b2b_49',
      billingMode: 'invoice',
      startedOn: '2026-04-01',
      endsOn: '2026-05-15',
      expectedRevision: 0,
    });
    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgMayBoundaryEnd,
      planId: 'b2b_49',
      billingMode: 'invoice',
      startedOn: '2026-04-01',
      endsOn: '2026-05-01', // exclusive end on day 1 -> covered zero days of May
      expectedRevision: 0,
    });
    const mayOverview = await loadBrandBillingOverview(sql, ADMIN_VIEWER, { period: '2026-05', now });
    expect(mayOverview?.uninvoicedActiveOrgs.map((o) => o.organizationId)).toEqual([orgMayEnded]);

    // F3 & F4 & F5 & F6 SSR HTML verification on org detail page
    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgNoPlan,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-01',
      expectedRevision: 0,
    });
    // Reset one org with NO plan (orgUnassignedSsr) and one with plan + NO allowance row (orgMayBoundaryEnd)
    const orgUnassignedSsr = randomUUID();
    await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      orgUnassignedSsr,
      'Unassigned Brand SSR',
      ownerId,
      randomUUID(),
    ]);

    vi.resetModules();
    vi.doMock('next/navigation', () => ({
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
    vi.doMock('@/lib/auth/viewer', () => ({ requireAdmin: async () => ADMIN_VIEWER, getViewer: async () => ADMIN_VIEWER }));
    vi.doMock('@/lib/db/connect', () => ({ getSqlRunner: async () => sql }));
    vi.doMock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
    vi.doMock('@/lib/routing/request-surface', () => ({
      requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
      publicHref: (p: string) => `https://twings.app${p}`,
    }));
    try {
      const OrgDetail = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;
      const renderTimeout = () => AbortSignal.timeout(5000);
      const htmlNoPlan = await new Response(
        (await prerender(
          await OrgDetail({ params: Promise.resolve({ id: orgUnassignedSsr }), searchParams: Promise.resolve({}) }),
          { signal: renderTimeout() },
        )).prelude,
      ).text();
      expect(htmlNoPlan).toMatch(/name="planId"[\s\S]*?<option value="" selected=""/);
      const amountKrwInput = htmlNoPlan.match(/<input[^>]*name="amountKrw"[^>]*>/)?.[0] ?? '';
      expect(amountKrwInput).toContain('min="1000"');
      expect(amountKrwInput).toContain('step="1000"');
      expect(htmlNoPlan).not.toMatch(/min="1"[^>]*step="1000"/);

      const htmlPlanNoRow = await new Response(
        (await prerender(
          await OrgDetail({ params: Promise.resolve({ id: orgMayBoundaryEnd }), searchParams: Promise.resolve({}) }),
          { signal: renderTimeout() },
        )).prelude,
      ).text();
      expect(htmlPlanNoRow).toMatch(/name="allowanceMode"[\s\S]*?<option value="plan_default" selected=""/);

      const htmlActiveDisc = await new Response(
        (await prerender(
          await OrgDetail({ params: Promise.resolve({ id: orgWithPlan }), searchParams: Promise.resolve({}) }),
          { signal: renderTimeout() },
        )).prelude,
      ).text();
      expect(htmlActiveDisc).toContain('name="confirmReplace"');
      expect(htmlActiveDisc).toContain('name="manualAmounts" value="0"');
    } finally {
      vi.doUnmock('next/navigation');
      vi.doUnmock('@/lib/auth/viewer');
      vi.doUnmock('@/lib/db/connect');
      vi.doUnmock('@/lib/i18n/server');
      vi.doUnmock('@/lib/routing/request-surface');
      vi.resetModules();
    }
  });
});
