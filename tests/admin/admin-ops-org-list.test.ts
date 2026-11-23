import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRAND_ORG_PAGE_SIZE,
  brandOrgListFilter,
  loadBrandOrgList,
} from '@/lib/admin/brand-org-list';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { planActiveWithGrace } from '@/lib/brands/billing/math';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  draftBrandInvoice,
  grantBrandDiscount,
  grantExtraAllowance,
  issueBrandInvoice,
  setPlanAllowanceDefault,
} from '@/lib/brands/billing';
import { setPlanAssignment } from '@/lib/brands/plans';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { deterministicNoticeSourceId, enqueueTeamNotice } from '@/lib/brands/team-notice-outbox';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import { studioDeps, viewerOf } from '@/tests/brand-studio/server/helpers';

const openDbs: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    if (db) await db.close();
  }
});

async function setupDb() {
  const db = await freshDb();
  openDbs.push(db);
  const sql = runner(db);
  const ids = {
    admin: randomUUID(),
    ownerA: randomUUID(),
    ownerB: randomUUID(),
    ownerC: randomUUID(),
    memberA: randomUUID(),
    outsider: randomUUID(),
  };
  await seedProfile(sql, { id: ids.admin, isAdmin: true, email: 'ops-admin@example.test' });
  await seedProfile(sql, { id: ids.ownerA, email: 'owner-a@example.test' });
  await seedProfile(sql, { id: ids.ownerB, email: 'owner-b@example.test' });
  await seedProfile(sql, { id: ids.ownerC, email: 'owner-c@example.test' });
  await seedProfile(sql, { id: ids.memberA, email: 'member-a@example.test' });
  await seedProfile(sql, { id: ids.outsider, email: 'outsider@example.test' });
  return { db, sql, ids, admin: { ...viewerOf(ids.admin), isAdmin: true } };
}

async function createOrg(sql: SqlRunner, name: string, ownerId: string, createdAtIso?: string): Promise<string> {
  const orgId = randomUUID();
  await sql.query(
    `insert into brand_organizations (id, name, created_by, request_id, created_at)
     values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))`,
    [orgId, name, ownerId, randomUUID(), createdAtIso ?? null],
  );
  await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
    orgId,
    ownerId,
    'owner',
  ]);
  return orgId;
}

describe('loadBrandOrgList', () => {
  it('aggregates plan states, allowance sources, discounts, invoices, members, and 7d failures with zero cross-org bleed', async () => {
    const { sql, ids, admin } = await setupDb();
    const deps = studioDeps(sql);
    const now = new Date('2026-11-20T06:00:00.000Z'); // 2026-11-20 KST
    const env = { defaultMonthlyKrw: 250_000, planGraceDays: 3 };

    const orgA = await createOrg(sql, 'Aurora Atelier', ids.ownerA, '2026-11-18T00:00:00.000Z');
    const orgB = await createOrg(sql, 'Boreal Goods', ids.ownerB, '2026-11-17T00:00:00.000Z');
    const orgC = await createOrg(sql, 'Cipher Studio', ids.ownerC, '2026-11-19T00:00:00.000Z');
    const orgD = await createOrg(sql, 'Delta Works', ids.ownerC, '2026-10-10T00:00:00.000Z');

    // Add extra member to Org A (now 2 members)
    await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
      orgA,
      ids.memberA,
      'editor',
    ]);

    // Plan assignments
    await setPlanAssignment({ sql }, admin, {
      organizationId: orgA,
      planId: 'b2b_49',
      billingMode: 'invoice',
      startedOn: '2026-11-01',
      expectedRevision: 0,
    });
    await setPlanAssignment({ sql }, admin, {
      organizationId: orgB,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '2026-11-18', // 2 days past -> in 3-day grace window on 2026-11-20
      expectedRevision: 0,
    });
    await setPlanAssignment({ sql }, admin, {
      organizationId: orgD,
      planId: 'b2b_69',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '2026-11-05', // expired past grace
      expectedRevision: 0,
    });

    // Plan default for b2b_29 = 150,000 (Org B follows it + extra grant 50,000)
    const defRes = await setPlanAllowanceDefault({ sql, now: () => now }, admin, {
      planId: 'b2b_29',
      monthlyCapKrw: 150_000,
      note: 'Launch tier cap',
      confirm: true,
    });
    expect(defRes.ok).toBe(true);
    await grantExtraAllowance({ sql, now: () => now }, admin, {
      organizationId: orgB,
      amountKrw: 50_000,
      validMonth: '2026-11',
      reason: 'Campaign launch boost',
    });

    // Explicit override for Org A = 500,000 + extra 100,000 -> total cap 600,000
    await sql.query(
      `insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, note)
       values ($1, 500000, true, 'Override tier')
       on conflict (organization_id) do update set is_override = true, monthly_cap_krw = 500000`,
      [orgA],
    );
    await grantExtraAllowance({ sql, now: () => now }, admin, {
      organizationId: orgA,
      amountKrw: 100_000,
      validMonth: '2026-11',
      reason: 'Extra test credit',
    });

    // Usage & failed jobs strictly in Org A
    const j1 = await createStudioJob(deps, viewerOf(ids.ownerA), {
      kind: 'image',
      organizationId: orgA,
      requestId: randomUUID(),
      model: 'seedream-5.5',
      prompt: 'studio lookbook',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
    });
    expect(j1.ok).toBe(true);
    if (j1.ok) {
      await sql.query(
        `update brand_studio_jobs
            set status = 'succeeded', usage_krw = 510000, estimate_krw = 510000,
                created_at = $2::timestamptz, finished_at = $2::timestamptz
          where id = $1`,
        [j1.job.id, '2026-11-19T05:00:00.000Z'],
      );
    }

    for (let i = 0; i < 2; i++) {
      const jf = await createStudioJob(deps, viewerOf(ids.ownerA), {
        kind: 'image',
        organizationId: orgA,
        requestId: randomUUID(),
        model: 'seedream-5.5',
        prompt: `fail ${i}`,
        aspect: '1:1',
        resolution: '2K',
        count: 1,
      });
      expect(jf.ok).toBe(true);
      if (jf.ok) {
        await sql.query(
          `update brand_studio_jobs
              set status = 'failed', error_code = 'provider_unavailable', usage_krw = 0, estimate_krw = 70,
                  created_at = $2::timestamptz, finished_at = $2::timestamptz
            where id = $1`,
          [jf.job.id, `2026-11-19T0${i + 1}:00:00.000Z`],
        );
      }
    }

    // Discounts: Org A 40% x 3 (1 used -> 2 left), Org B 20% ongoing
    await grantBrandDiscount({ sql, now: () => now }, admin, {
      organizationId: orgA,
      percent: 40,
      invoicesTotal: 3,
      memo: 'Intro 40%',
    });
    await grantBrandDiscount({ sql, now: () => now }, admin, {
      organizationId: orgB,
      percent: 20,
      invoicesTotal: null,
      memo: 'Partner ongoing',
    });

    // Invoices: Org A issued & backdated 16 days ago -> consumes 1 discount use + becomes overdue
    const invA = await draftBrandInvoice({ sql, now: () => now }, admin, {
      organizationId: orgA,
      period: '2026-10',
      prorate: false,
    });
    expect(invA.ok).toBe(true);
    if (invA.ok) {
      await issueBrandInvoice({ sql, now: () => now }, admin, { invoiceId: invA.invoice.id });
      await sql.query(`update brand_invoices set issued_at = $2::timestamptz where id = $1`, [
        invA.invoice.id,
        '2026-11-04T00:00:00.000Z', // 16 days before 2026-11-20
      ]);
    }
    // Org B issued recently (unpaid = 1, not yet overdue = 0)
    const invB = await draftBrandInvoice({ sql, now: () => now }, admin, {
      organizationId: orgB,
      period: '2026-11',
      prorate: false,
    });
    expect(invB.ok).toBe(true);
    if (invB.ok) {
      await issueBrandInvoice({ sql, now: () => now }, admin, { invoiceId: invB.invoice.id });
    }

    // Org C requests access (waiting_plan)
    await enqueueTeamNotice(sql, 'plan_request', {
      organizationId: orgC,
      sourceTable: 'brand_organizations',
      sourceId: deterministicNoticeSourceId('plan_request', orgC),
      surface: 'brand_home',
      actorLabel: 'Cipher owner',
      preview: 'Requesting b2b_29 onboarding',
      adminPath: `/admin/brand-workspace/organizations/${orgC}`,
    });

    const result = await loadBrandOrgList(sql, admin, brandOrgListFilter({}), { env, now });
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.total).toBe(4);
    const byId = new Map(result.rows.map((r) => [r.id, r]));

    const a = byId.get(orgA)!;
    expect(a.planId).toBe('b2b_49');
    expect(a.planActive).toBe(true);
    expect(a.planInGrace).toBe(false);
    expect(a.planExpired).toBe(false);
    expect(a.allowanceSource).toBe('override');
    expect(a.baseCapKrw).toBe(500_000);
    expect(a.extraKrw).toBe(100_000);
    expect(a.capKrw).toBe(600_000);
    expect(a.usedKrw).toBe(510_000);
    expect(a.usagePercent).toBe(85);
    expect(a.activeDiscount).toEqual({
      percent: 40,
      invoicesTotal: 3,
      invoicesUsed: 1,
      invoicesRemaining: 2,
    });
    expect(a.unpaidInvoiceCount).toBe(1);
    expect(a.overdueInvoiceCount).toBe(1);
    expect(a.memberCount).toBe(2);
    expect(a.failedJobs7d).toBe(2);

    const b = byId.get(orgB)!;
    expect(b.planId).toBe('b2b_29');
    expect(b.planActive).toBe(true);
    expect(b.planInGrace).toBe(true);
    expect(b.planExpired).toBe(false);
    expect(b.allowanceSource).toBe('plan');
    expect(b.baseCapKrw).toBe(150_000);
    expect(b.extraKrw).toBe(50_000);
    expect(b.capKrw).toBe(200_000);
    expect(b.usedKrw).toBe(0);
    expect(b.activeDiscount).toEqual({
      percent: 20,
      invoicesTotal: null,
      invoicesUsed: 1,
      invoicesRemaining: null,
    });
    expect(b.unpaidInvoiceCount).toBe(1);
    expect(b.overdueInvoiceCount).toBe(0);
    expect(b.failedJobs7d).toBe(0);

    const c = byId.get(orgC)!;
    expect(c.planId).toBeNull();
    expect(c.allowanceSource).toBe('default');
    expect(c.baseCapKrw).toBe(250_000);
    expect(c.hasUsageRequest).toBe(true);
    expect(c.failedJobs7d).toBe(0);
    expect(c.activeDiscount).toBeNull();

    const d = byId.get(orgD)!;
    expect(d.planExpired).toBe(true);
    expect(d.planActive).toBe(false);
    expect(d.planInGrace).toBe(false);

    // Filter checks
    expect((await loadBrandOrgList(sql, admin, brandOrgListFilter({ filter: 'no_plan' }), { env, now }))?.rows.map((r) => r.id)).toEqual([orgC]);
    expect((await loadBrandOrgList(sql, admin, brandOrgListFilter({ filter: 'waiting_plan' }), { env, now }))?.rows.map((r) => r.id)).toEqual([orgC]);
    expect((await loadBrandOrgList(sql, admin, brandOrgListFilter({ filter: 'over_80' }), { env, now }))?.rows.map((r) => r.id)).toEqual([orgA]);
    expect((await loadBrandOrgList(sql, admin, brandOrgListFilter({ filter: 'overdue' }), { env, now }))?.rows.map((r) => r.id)).toEqual([orgA]);
    expect((await loadBrandOrgList(sql, admin, brandOrgListFilter({ filter: 'has_failures' }), { env, now }))?.rows.map((r) => r.id)).toEqual([orgA]);
    const recent7d = await loadBrandOrgList(sql, admin, brandOrgListFilter({ filter: 'recent_7d' }), { env, now });
    expect(recent7d?.rows.map((r) => r.id)).not.toContain(orgD);
    expect(recent7d?.total).toBe(3);

    // Search + Sort checks
    const searched = await loadBrandOrgList(sql, admin, brandOrgListFilter({ q: 'boreal' }), { env, now });
    expect(searched?.rows.map((r) => r.name)).toEqual(['Boreal Goods']);
    const alphaSorted = await loadBrandOrgList(sql, admin, brandOrgListFilter({ sort: 'name_asc' }), { env, now });
    expect(alphaSorted?.rows.map((r) => r.name)).toEqual([
      'Aurora Atelier',
      'Boreal Goods',
      'Cipher Studio',
      'Delta Works',
    ]);
  });

  it('executes a single aggregated SQL query per page after schema cache warm-up and paginates accurately', async () => {
    const { sql, ids, admin } = await setupDb();
    for (let i = 1; i <= 27; i++) {
      await createOrg(sql, `Org ${String(i).padStart(2, '0')}`, ids.ownerA);
    }

    const calls: string[] = [];
    const countingSql: SqlRunner = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
        calls.push(text);
        return sql.query<T>(text, params);
      },
      transaction: sql.transaction.bind(sql),
    };

    // Warm schema probe cache on this SqlRunner instance
    const warm = await loadBrandOrgList(countingSql, admin, brandOrgListFilter({ sort: 'name_asc' }));
    expect(warm?.total).toBe(27);
    expect(warm?.rows.length).toBe(BRAND_ORG_PAGE_SIZE);
    calls.length = 0;

    const page1 = await loadBrandOrgList(countingSql, admin, brandOrgListFilter({ sort: 'name_asc', page: '1' }));
    // Expect only isDbAdmin + ONE single aggregated org-list CTE query (no N+1)
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain('count(*) over()');
    expect(page1?.rows.length).toBe(25);
    expect(page1?.totalPages).toBe(2);

    calls.length = 0;
    const page2 = await loadBrandOrgList(countingSql, admin, brandOrgListFilter({ sort: 'name_asc', page: '2' }));
    expect(calls.length).toBe(2);
    expect(page2?.rows.map((r) => r.name)).toEqual(['Org 26', 'Org 27']);
  });

  it('refuses non-admin viewers and degrades gracefully when 0176/0178 billing/studio tables are missing', async () => {
    const { sql, ids, admin } = await setupDb();
    await createOrg(sql, 'Minimal Brand', ids.ownerA);

    expect(await loadBrandOrgList(sql, viewerOf(ids.outsider), brandOrgListFilter({}))).toBeNull();
    expect(
      await loadBrandOrgList(
        sql,
        { tier: 'anon', userId: null, email: null, isAdmin: false, locale: 'en' },
        brandOrgListFilter({}),
      ),
    ).toBeNull();

    await sql.query(
      `drop table if exists
         brand_invoice_events, brand_invoices, brand_discount_code_redemptions, brand_discount_codes,
         brand_discounts, brand_allowance_grants, brand_billing_profiles, brand_plan_allowance_defaults,
         brand_studio_jobs, brand_plan_events, brand_plan_assignments, team_notice_deliveries
       cascade`,
    );

    const degraded = await loadBrandOrgList(sql, admin, brandOrgListFilter({}));
    expect(degraded).not.toBeNull();
    expect(degraded?.total).toBe(1);
    expect(degraded?.rows[0]?.planId).toBeNull();
    expect(degraded?.rows[0]?.unpaidInvoiceCount).toBe(0);
    expect(degraded?.rows[0]?.failedJobs7d).toBe(0);
  });

  it('F1/F2/F8/F10/F11/F13: handles search+page>1 fallback count, 100M bigint over_80, grace=0/7 parity, fan-out safety, and allowance equivalence', async () => {
    const { sql, ids, admin } = await setupDb();
    const deps = studioDeps(sql);
    const now = new Date('2026-11-20T06:00:00.000Z'); // KST 2026-11-20
    const env = { defaultMonthlyKrw: 250_000, planGraceDays: 0 };

    // 1) F13 + F2: Single org with 3 members, 4 jobs (total 85M KRW / 100M cap -> 85%), 3 invoices
    const orgFan = await createOrg(sql, 'Apex Heavy Studio', ids.ownerA, '2026-11-18T00:00:00.000Z');
    await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
      orgFan,
      ids.memberA,
      'editor',
    ]);
    await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
      orgFan,
      ids.ownerB,
      'viewer',
    ]);
    await setPlanAssignment({ sql }, admin, {
      organizationId: orgFan,
      planId: 'b2b_69',
      billingMode: 'invoice',
      startedOn: '2026-11-01',
      expectedRevision: 0,
    });
    await sql.query(
      `insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, note)
       values ($1, 100000000, true, '100M cap')
       on conflict (organization_id) do update set is_override = true, monthly_cap_krw = 100000000`,
      [orgFan],
    );
    const jobAmounts = [30_000_000, 30_000_000, 25_000_000, 70]; // 3 succeeded + 1 failed (excluded from used)
    for (let i = 0; i < jobAmounts.length; i++) {
      const created = await createStudioJob(deps, viewerOf(ids.ownerA), {
        kind: 'image',
        organizationId: orgFan,
        requestId: randomUUID(),
        model: 'seedream-5.5',
        prompt: `heavy ${i}`,
        aspect: '1:1',
        resolution: '2K',
        count: 1,
      });
      if (!created.ok) throw new Error('job failed');
      const isFail = i === 3;
      await sql.query(
        `update brand_studio_jobs
            set status = $2, error_code = $3, estimate_krw = $4, usage_krw = $5,
                created_at = '2026-11-19T01:00:00Z'::timestamptz,
                finished_at = '2026-11-19T01:00:00Z'::timestamptz
          where id = $1`,
        [created.job.id, isFail ? 'failed' : 'succeeded', isFail ? 'failed' : null, jobAmounts[i], isFail ? 0 : jobAmounts[i]],
      );
    }
    for (const period of ['2026-09', '2026-10', '2026-11']) {
      const dr = await draftBrandInvoice({ sql, now: () => now }, admin, {
        organizationId: orgFan,
        period,
        prorate: false,
      });
      if (dr.ok && period !== '2026-11') {
        await issueBrandInvoice({ sql, now: () => now }, admin, { invoiceId: dr.invoice.id });
        if (period === '2026-09') {
          await sql.query("update brand_invoices set issued_at = '2026-10-01T00:00:00Z'::timestamptz where id = $1", [
            dr.invoice.id,
          ]);
        }
      }
    }

    // 2) Plan-default active + grace + ended + grant orgs for F13 allowance equivalence & F10 grace=0 vs 7
    await setPlanAllowanceDefault({ sql, now: () => now }, admin, {
      planId: 'b2b_29',
      monthlyCapKrw: 180_000,
      note: 'b2b29 cap',
      confirm: true,
    });
    const orgPlanActive = await createOrg(sql, 'Boreal Plan Active', ids.ownerB, '2026-11-18T00:00:00.000Z');
    await setPlanAssignment({ sql }, admin, {
      organizationId: orgPlanActive,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-01',
      endsOn: '2026-11-25',
      expectedRevision: 0,
    });
    await grantExtraAllowance({ sql, now: () => now }, admin, {
      organizationId: orgPlanActive,
      amountKrw: 40_000,
      validMonth: '2026-11',
      reason: 'Monthly grant',
    });

    const orgGraceBoundary = await createOrg(sql, 'Cinder Grace Boundary', ids.ownerB, '2026-11-18T00:00:00.000Z');
    await setPlanAssignment({ sql }, admin, {
      organizationId: orgGraceBoundary,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '2026-11-20', // exact endsOn day = todayKst
      expectedRevision: 0,
    });

    const orgEnded = await createOrg(sql, 'Dusk Ended Plan', ids.ownerC, '2026-11-18T00:00:00.000Z');
    await setPlanAssignment({ sql }, admin, {
      organizationId: orgEnded,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '2026-11-01',
      expectedRevision: 0,
    });

    // 3) F8 waiting_plan: plain support question vs usage request vs question surface
    const orgQuestionOnly = await createOrg(sql, 'Echo Question Only', ids.ownerC, '2026-11-19T00:00:00.000Z');
    await sql.query(
      `insert into brand_support_messages (organization_id, created_by, request_id, author_role, body)
       values ($1, $2, $3, 'brand', 'Just asking a general pricing question')`,
      [orgQuestionOnly, ids.ownerC, randomUUID()],
    );
    await enqueueTeamNotice(sql, 'plan_request', {
      organizationId: orgQuestionOnly,
      sourceTable: 'brand_organizations',
      sourceId: randomUUID(),
      surface: 'billing:plan_question:billing_page',
      actorLabel: 'Echo owner',
      preview: 'Plain question surface must NOT count as waiting_plan',
      adminPath: `/admin/brand-workspace/organizations/${orgQuestionOnly}`,
    });

    const orgAllowReq = await createOrg(sql, 'Foxtrot Allowance Request', ids.ownerC, '2026-11-19T00:00:00.000Z');
    await enqueueTeamNotice(sql, 'allowance_request', {
      organizationId: orgAllowReq,
      sourceTable: 'brand_studio_allowances',
      sourceId: randomUUID(),
      surface: 'brand_billing:usage_request',
      actorLabel: 'Foxtrot owner',
      preview: 'Requesting monthly cap increase',
      adminPath: `/admin/brand-workspace/organizations/${orgAllowReq}`,
    });

    // F1: search + page > 1 returning 0 rows must NOT 500 and must report matching total
    const stalePageSearch = await loadBrandOrgList(
      sql,
      admin,
      brandOrgListFilter({ q: 'Apex Heavy', page: '3' }),
      { env, now },
    );
    expect(stalePageSearch).not.toBeNull();
    expect(stalePageSearch?.total).toBe(1);
    expect(stalePageSearch?.rows).toEqual([]);
    expect(stalePageSearch?.totalPages).toBe(1);

    // F2: 100M cap with 85M usage does NOT overflow over_80 filter
    const over80 = await loadBrandOrgList(sql, admin, brandOrgListFilter({ filter: 'over_80' }), { env, now });
    expect(over80?.rows.map((r) => r.id)).toEqual([orgFan]);
    const fanRow = over80?.rows[0]!;
    expect(fanRow.memberCount).toBe(3); // no member x job x invoice fan-out
    expect(fanRow.usedKrw).toBe(85_000_000);
    expect(fanRow.capKrw).toBe(100_000_000);
    expect(fanRow.failedJobs7d).toBe(1);
    expect(fanRow.unpaidInvoiceCount).toBe(2);
    expect(fanRow.overdueInvoiceCount).toBe(1);

    // F8: waiting_plan counts ONLY real allowance_request / non-question plan_request notices
    const waiting = await loadBrandOrgList(sql, admin, brandOrgListFilter({ filter: 'waiting_plan' }), { env, now });
    expect(waiting?.rows.map((r) => r.id)).toEqual([orgAllowReq]);
    expect(waiting?.rows.some((r) => r.id === orgQuestionOnly)).toBe(false);

    // F10 & F13: Compare grace=0 vs grace=7 SQL against planActiveWithGrace AND loadAllowance
    for (const graceDays of [0, 7] as const) {
      const envCheck = { defaultMonthlyKrw: 250_000, planGraceDays: graceDays };
      const list = await loadBrandOrgList(sql, admin, brandOrgListFilter({}), { env: envCheck, now });
      expect(list).not.toBeNull();
      for (const r of list!.rows) {
        const expectedPlan =
          r.planId && r.planStartedOn
            ? planActiveWithGrace({ startedOn: r.planStartedOn, endsOn: r.planEndsOn }, '2026-11-20', graceDays)
            : { active: false, inGrace: false };
        expect(r.planActive).toBe(expectedPlan.active);
        expect(r.planInGrace).toBe(expectedPlan.inGrace);

        const expectedAllow = await loadAllowance(sql, r.id, envCheck, now);
        expect(r.capKrw).toBe(expectedAllow.capKrw);
        expect(r.baseCapKrw).toBe(expectedAllow.baseCapKrw);
        expect(r.extraKrw).toBe(expectedAllow.extraKrw);
        expect(r.usedKrw).toBe(expectedAllow.usedKrw);
        expect(r.allowanceSource).toBe(expectedAllow.source);
      }

      const boundary = list!.rows.find((r) => r.id === orgGraceBoundary)!;
      if (graceDays === 0) {
        expect(boundary.planActive).toBe(false);
        expect(boundary.planInGrace).toBe(false);
        expect(boundary.planExpired).toBe(true);
      } else {
        expect(boundary.planActive).toBe(true);
        expect(boundary.planInGrace).toBe(true);
        expect(boundary.planExpired).toBe(false);
      }
    }

    // F11: usage_desc and failures_desc produce stable ordering across ties
    const usageSorted = await loadBrandOrgList(sql, admin, brandOrgListFilter({ sort: 'usage_desc' }), { env, now });
    const failSorted = await loadBrandOrgList(sql, admin, brandOrgListFilter({ sort: 'failures_desc' }), { env, now });
    expect(usageSorted?.rows.length).toBeGreaterThan(0);
    expect(failSorted?.rows[0]?.id).toBe(orgFan);
  });
});
