import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSubscriptionCompat } from '@/tests/brands/helpers/subscription-confirm';
import { setPlanAllowanceDefault } from '@/lib/brands/billing';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

const ssrMocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/brand-billing',
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => ADMIN_VIEWER,
  getViewer: async () => ADMIN_VIEWER,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ssrMocks.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
  publicHref: (p: string) => `https://twings.app${p}`,
}));

const openClosers: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  while (openClosers.length > 0) {
    const close = openClosers.pop();
    if (close) await close();
  }
});

describe('§7 plan-default admin display bug fixes & §6 flag-gated SSR', () => {
  it('§7-1: /admin/brand-billing shows plan-default preview banner instead of playbook visibility copy', async () => {
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    ssrMocks.sql = sql;
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });

    const ko = getDictionary('ko');
    expect(ko.admin.okPrepared).toContain('공개 등급');

    const BrandBillingPage = (await import('@/app/(admin)/admin/brand-billing/page')).default;
    const html = await new Response(
      (
        await prerender(
          await BrandBillingPage({
            searchParams: Promise.resolve({
              ok: 'prepared',
              detail: 'b2b_29=270000 · 1 (Default Cap Fixture:0->270000)',
            }),
          }),
          { signal: AbortSignal.timeout(5000) },
        )
      ).prelude,
    ).text();

    expect(html).toContain(ko.adminConsole.brandBilling.planDefaultPreviewedBanner);
    expect(html).not.toContain('prepare 완료 — 공개 등급을 확정');
    // Step 1 preview value is retained in the b2b_29 input for step 2 confirmation
    const row29 = html.match(/data-plan-default-row="b2b_29"[\s\S]*?<\/form>/)?.[0] ?? '';
    expect(row29).toContain('value="270000"');
  });

  it('§7-2: stored plan default pre-fills input, shows unset only when null, and empty submit does NOT clear stored cap', async () => {
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    ssrMocks.sql = sql;
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });

    await setPlanAllowanceDefault({ sql }, ADMIN_VIEWER, {
      planId: 'b2b_29',
      monthlyCapKrw: 270_000,
      note: 'Founder fixed cap',
      confirm: true,
    });

    const BrandBillingPage = (await import('@/app/(admin)/admin/brand-billing/page')).default;
    const html = await new Response(
      (await prerender(await BrandBillingPage({ searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) })).prelude,
    ).text();

    const row29 = html.match(/data-plan-default-row="b2b_29"[\s\S]*?<\/form>/)?.[0] ?? '';
    const row49 = html.match(/data-plan-default-row="b2b_49"[\s\S]*?<\/form>/)?.[0] ?? '';

    // Stored value pre-filled and NOT labeled "미설정"
    expect(row29).toContain('value="270000"');
    expect(row29).not.toContain('미설정');
    expect(row29).toContain('270,000원');

    // Truly null b2b_49 shows "미설정" and empty defaultValue
    expect(row49).toContain('미설정');
    expect(row49).not.toContain('미설정 (폴백)');

    // Submitting empty monthlyCapKrw (with confirm=true) is rejected and NEVER clears stored 270,000
    const emptySubmit = await h.run('brandBilling.planDefault.set', {
      planId: 'b2b_29',
      monthlyCapKrw: '',
      note: 'Oops blank',
      confirm: 'true',
    });
    expect(emptySubmit).toMatchObject({ ok: false, code: 'invalid', detail: 'monthlyCapKrw' });

    const persisted = (
      await sql.query<{ monthly_cap_krw: number | null }>(
        "select monthly_cap_krw from brand_plan_allowance_defaults where plan_id = 'b2b_29'",
      )
    ).rows[0];
    expect(persisted?.monthly_cap_krw).toBe(270_000);
  });

  it('§6 Admin UI renders subscription & tax-invoice panels only when BRAND_BILLING_AUTO_ISSUE=on', async () => {
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    ssrMocks.sql = sql;
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
    const orgRes = await createStudioOrganization({ sql }, ADMIN_VIEWER, {
      name: 'Admin UI Fixture',
      requestId: randomUUID(),
    });
    if (!orgRes.ok) throw new Error(orgRes.code);

    const BrandBillingPage = (await import('@/app/(admin)/admin/brand-billing/page')).default;
    const OrgDetailPage = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;

    // Flag OFF -> zero subscription/tax UI rendered
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const offBillingHtml = await new Response(
      (await prerender(await BrandBillingPage({ searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) })).prelude,
    ).text();
    expect(offBillingHtml).not.toContain('id="tax-invoices"');

    const offOrgHtml = await new Response(
      (
        await prerender(
          await OrgDetailPage({ params: Promise.resolve({ id: orgRes.id }), searchParams: Promise.resolve({}) }),
          { signal: AbortSignal.timeout(5000) },
        )
      ).prelude,
    ).text();
    expect(offOrgHtml).not.toContain('data-org-subscription');

    // Flag ON -> subscription panel + tax-invoice panel render
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const onBillingHtml = await new Response(
      (await prerender(await BrandBillingPage({ searchParams: Promise.resolve({ period: '2026-09' }) }), { signal: AbortSignal.timeout(5000) })).prelude,
    ).text();
    expect(onBillingHtml).toContain('id="tax-invoices"');
    // C5: heading must name the selected ?period=, not unconditionally "이번 달"
    expect(onBillingHtml).toContain('2026-09');
    expect(onBillingHtml).not.toContain('이번 달 발행할 세금계산서');

    const onOrgHtml = await new Response(
      (
        await prerender(
          await OrgDetailPage({ params: Promise.resolve({ id: orgRes.id }), searchParams: Promise.resolve({}) }),
          { signal: AbortSignal.timeout(5000) },
        )
      ).prelude,
    ).text();
    expect(onOrgHtml).toContain('data-org-subscription');
    expect(onOrgHtml).toContain('brandSubscription.start');
  });

  it('B6: restored min=1000, updated label, explicit "기본값 해제" two-step clear, and empty submit rejection', async () => {
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    ssrMocks.sql = sql;
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
    const orgRes = await createStudioOrganization({ sql }, ADMIN_VIEWER, {
      name: 'Plan Clear Fixture',
      requestId: randomUUID(),
    });
    if (!orgRes.ok) throw new Error(orgRes.code);

    const { setPlanAssignment } = await import('@/lib/brands/plans');
    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgRes.id,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-01',
      endsOn: null,
      seats: null,
      note: '',
      expectedRevision: 0,
    });
    await setPlanAllowanceDefault({ sql }, ADMIN_VIEWER, {
      planId: 'b2b_29',
      monthlyCapKrw: 270_000,
      note: 'Initial cap',
      confirm: true,
    });

    const BrandBillingPage = (await import('@/app/(admin)/admin/brand-billing/page')).default;
    const html = await new Response(
      (await prerender(await BrandBillingPage({ searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) })).prelude,
    ).text();
    const row29 = html.match(/data-plan-default-row="b2b_29"[\s\S]*?<\/section>|data-plan-default-row="b2b_29"[\s\S]*?(?=data-plan-default-row="b2b_49"|$)/)?.[0] ?? '';
    expect(row29).toContain('min="1000"');
    expect(row29).toContain('기본값 해제');
    expect(row29).toContain('name="clearDefault"');

    // Empty submit WITHOUT clearDefault must still fail
    const emptySubmit = await h.run('brandBilling.planDefault.set', {
      planId: 'b2b_29',
      monthlyCapKrw: '',
      confirm: 'true',
    });
    expect(emptySubmit).toMatchObject({ ok: false, code: 'invalid', detail: 'monthlyCapKrw' });

    // Explicit clearDefault two-step confirm: step 1 previews affected orgs, step 2 stores null
    const previewClear = await h.run('brandBilling.planDefault.set', {
      planId: 'b2b_29',
      clearDefault: '1',
      note: 'Reset to env fallback',
    });
    expect(previewClear).toMatchObject({ ok: true, code: 'prepared' });
    expect(previewClear.detail).toContain('b2b_29=unset');
    expect(previewClear.detail).toContain('Plan Clear Fixture');

    // Round 2, item 9: the clear confirm must carry the digest of the previewed affected organizations.
    const clearWithoutDigest = await h.run('brandBilling.planDefault.set', {
      planId: 'b2b_29',
      clearDefault: '1',
      note: 'Reset to env fallback',
      confirm: 'true',
    });
    expect(clearWithoutDigest).toMatchObject({ ok: false, code: 'invalid', detail: 'preview_required' });
    const clearDigest = /digest=([0-9a-f]{16})/.exec(String(previewClear.detail))?.[1];
    expect(clearDigest).toMatch(/^[0-9a-f]{16}$/);
    const staleClear = await h.run('brandBilling.planDefault.set', {
      planId: 'b2b_29',
      clearDefault: '1',
      note: 'Reset to env fallback',
      confirm: 'true',
      previewDigest: '0000000000000000',
    });
    expect(staleClear).toMatchObject({ ok: false, code: 'invalid', detail: 'preview_stale' });
    const applyClear = await h.run('brandBilling.planDefault.set', {
      planId: 'b2b_29',
      clearDefault: '1',
      note: 'Reset to env fallback',
      confirm: 'true',
      previewDigest: clearDigest,
    });
    expect(applyClear).toMatchObject({ ok: true, code: 'saved' });

    const persisted = (
      await sql.query<{ monthly_cap_krw: number | null }>(
        "select monthly_cap_krw from brand_plan_allowance_defaults where plan_id = 'b2b_29'",
      )
    ).rows[0];
    expect(persisted?.monthly_cap_krw).toBeNull();
  });

  it('B5 & B2: brandSubscription.start carries previewed values, rejects mismatch, uses ConfirmCheck, and admin-voided period shows reissue alert', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    ssrMocks.sql = sql;
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });

    const orgRes = await createStudioOrganization({ sql }, ADMIN_VIEWER, {
      name: 'Subscription Form Fixture',
      requestId: randomUUID(),
    });
    if (!orgRes.ok) throw new Error(orgRes.code);
    const { saveBrandBillingProfileAdmin, voidBrandInvoice } = await import('@/lib/brands/billing');
    await saveBrandBillingProfileAdmin({ sql }, ADMIN_VIEWER, {
      organizationId: orgRes.id,
      companyLegalName: 'Subscription Form Fixture',
      businessRegNo: '111-11-11119',
      representativeName: 'Fixture Owner',
      businessAddress: 'Seoul',
      taxInvoiceEmail: 'billing@fixture.invalid',
      contactName: 'Ops',
      contactPhone: '02-000-0000',
    });

    // Round 2, item 10: no real clock — the operations and the page read `new Date()`, so pin it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T01:00:00Z'));
    const todayKst = '2026-11-10';
    const currentMonth = todayKst.slice(0, 7);
    // The 1st is never in the future (a start date may not lie after today).
    const startDay = `${currentMonth}-01`;

    // Step 1 preview for b2b_49 + early open
    const step1 = await h.run('brandSubscription.start', {
      organizationId: orgRes.id,
      planId: 'b2b_49',
      collectionMethod: 'transfer',
      startedOn: startDay,
      activateBeforePayment: '1',
    });
    expect(step1).toMatchObject({ ok: true, code: 'prepared' });

    const OrgDetailPage = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;
    const step2Html = await new Response(
      (
        await prerender(
          await OrgDetailPage({
            params: Promise.resolve({ id: orgRes.id }),
            searchParams: Promise.resolve({ ok: 'prepared', detail: step1.detail }),
          }),
          { signal: AbortSignal.timeout(5000) },
        )
      ).prelude,
    ).text();

    const startForm = step2Html.match(/value="brandSubscription\.start"[\s\S]*?<\/form>/)?.[0] ?? '';
    const step1Digest = /digest=([0-9a-f]{16})/.exec(String(step1.detail))?.[1] ?? '';
    expect(startForm).toContain(`name="previewDigest" value="${step1Digest}"`);
    expect(startForm).toContain('data-subscription-start-note');
    expect(startForm).toContain('value="b2b_49" selected');
    expect(startForm).toContain(`value="${startDay}"`);
    expect(startForm).toMatch(/name="activateBeforePayment"[^>]*checked/);
    expect(startForm).toContain('data-confirm-check');
    expect(startForm).toContain('name="_confirm"');
    expect(startForm).toContain('name="previewPlanId"');

    // Mismatched confirm vs preview MUST be rejected
    const mismatch = await h.run('brandSubscription.start', {
      organizationId: orgRes.id,
      planId: 'b2b_29',
      collectionMethod: 'transfer',
      startedOn: startDay,
      activateBeforePayment: '1',
      previewPlanId: 'b2b_49',
      previewStartedOn: startDay,
      previewActivateBeforePayment: '1',
      previewDigest: step1Digest,
      confirm: 'true',
      _confirm: '1',
    });
    expect(mismatch).toMatchObject({ ok: false, code: 'invalid', detail: 'preview_mismatch' });

    // Matching confirm succeeds with b2b_49 and activates early
    const step2 = await h.run('brandSubscription.start', {
      organizationId: orgRes.id,
      planId: 'b2b_49',
      collectionMethod: 'transfer',
      startedOn: startDay,
      activateBeforePayment: '1',
      previewPlanId: 'b2b_49',
      previewStartedOn: startDay,
      previewActivateBeforePayment: '1',
      previewDigest: step1Digest,
      confirm: 'true',
      _confirm: '1',
    });
    expect(step2).toMatchObject({ ok: true, code: 'created' });
    const firstInvId = String(step2.detail);

    // B2 UI: admin voids the current period invoice -> org page MUST show voided-period warning & reissuePeriod form
    const voided = await voidBrandInvoice({ sql }, ADMIN_VIEWER, {
      invoiceId: firstInvId,
      reason: 'Wrong amount',
    });
    expect(voided.ok).toBe(true);

    const voidedHtml = await new Response(
      (
        await prerender(
          await OrgDetailPage({
            params: Promise.resolve({ id: orgRes.id }),
            searchParams: Promise.resolve({}),
          }),
          { signal: AbortSignal.timeout(5000) },
        )
      ).prelude,
    ).text();
    // Round 2, item 3: a voided first invoice (nothing paid) leaves the subscription pending without access
    // and shows the persistent alert offering reissue or cancel.
    expect(voidedHtml).toContain('첫 청구서가 취소되었거나 기한이 지나');
    expect(voidedHtml).toContain('data-needs-reissue');
    expect(voidedHtml).toContain('brandSubscription.reissuePeriod');
  });
  it('C6: flag on before 0182 is applied — both admin pages render the neutral "not migrated" state instead of failing', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const { PGlite } = await import('@electric-sql/pglite');
    const { coreMigrationFiles, readMigration } = await import('@/lib/db/migrations');
    const db = new PGlite();
    openClosers.push(() => db.close());
    await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
    for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0182_'))) await db.exec(readMigration(file));
    const sql = runner(db);
    ssrMocks.sql = sql;
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
    const orgRes = await createStudioOrganization({ sql }, ADMIN_VIEWER, { name: 'Unmigrated Fixture', requestId: randomUUID() });
    if (!orgRes.ok) throw new Error(orgRes.code);

    const BrandBillingPage = (await import('@/app/(admin)/admin/brand-billing/page')).default;
    const OrgDetailPage = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;
    const billingHtml = await new Response(
      (await prerender(await BrandBillingPage({ searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) })).prelude,
    ).text();
    expect(billingHtml).toContain('data-tax-invoices-unmigrated');
    const orgHtml = await new Response(
      (
        await prerender(
          await OrgDetailPage({ params: Promise.resolve({ id: orgRes.id }), searchParams: Promise.resolve({}) }),
          { signal: AbortSignal.timeout(5000) },
        )
      ).prelude,
    ).text();
    expect(orgHtml).toContain('data-org-subscription-unmigrated');
    expect(orgHtml).not.toContain('brandSubscription.start');
  });
  it('round 2 items 3, 4, 6, 7: the subscription card shows the waived-month alert, the past waived label, the unpaid-cancel text, the start note and the grace warning', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T01:00:00Z'));
    const h = await adminHarness();
    openClosers.push(() => h.close());
    const sql = runner(h.db);
    ssrMocks.sql = sql;
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
    const { saveBrandBillingProfileAdmin, markBrandInvoicePaid, voidBrandInvoice, listBrandInvoices } = await import('@/lib/brands/billing');
    const { startSubscription, runBrandSubscriptionTick } = await import('@/lib/brands/subscriptions');
    const makeOrg = async (name: string) => {
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
    };
    const OrgDetailPage = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;
    const render = async (id: string) =>
      new Response(
        (
          await prerender(await OrgDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }), {
            signal: AbortSignal.timeout(5000),
          })
        ).prelude,
      ).text();

    // A paid November, December issued and then voided by an admin: waived.
    const paidOrg = await makeOrg('Waived Month Fixture');
    const s = await startSubscriptionCompat({ sql }, ADMIN_VIEWER, { organizationId: paidOrg, planId: 'b2b_29', startedOn: '2026-11-01' });
    if (!s.ok || !s.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
    vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
    await runBrandSubscriptionTick({ sql });
    vi.setSystemTime(new Date('2026-12-01T01:00:00Z'));
    await runBrandSubscriptionTick({ sql });
    const dec = (await listBrandInvoices(sql, { organizationId: paidOrg })).find((i) => i.period === '2026-12')!;
    vi.setSystemTime(new Date('2026-12-05T01:00:00Z'));
    await voidBrandInvoice({ sql }, ADMIN_VIEWER, { invoiceId: dec.id, reason: 'goodwill' });
    const decemberHtml = await render(paidOrg);
    expect(decemberHtml).toContain('이번 달 청구서가 취소되어 이 달은 청구하지 않습니다. 청구하려면 다시 발행하세요.');
    expect(decemberHtml).toContain('brandSubscription.reissuePeriod');
    expect(decemberHtml).toContain('data-org-subscription');
    vi.setSystemTime(new Date('2027-01-05T01:00:00Z'));
    const januaryHtml = await render(paidOrg);
    expect(januaryHtml).not.toContain('이번 달 청구서가 취소되어');
    expect(januaryHtml).toContain('data-waived-period');
    expect(januaryHtml).toContain('취소 — 청구 안 함');
    expect(januaryHtml).toContain('기간 끝 해지를 예약합니다');

    // Nothing paid: the cancel confirmation says the unpaid invoice will be cancelled.
    const unpaidOrg = await makeOrg('Unpaid Cancel Fixture');
    const u = await startSubscriptionCompat({ sql }, ADMIN_VIEWER, { organizationId: unpaidOrg, planId: 'b2b_29', startedOn: '2027-01-05' });
    if (!u.ok || !u.applied) throw new Error('start failed');
    const unpaidHtml = await render(unpaidOrg);
    expect(unpaidHtml).toContain('결제된 청구서가 없어 해지하면 미납 청구서를 취소하고 구독을 바로 종료합니다');
    expect(unpaidHtml).not.toContain('data-subscription-grace-warning');

    // Grace below 1: warning line on the subscription card.
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '0');
    expect(await render(unpaidOrg)).toContain('data-subscription-grace-warning');

    // The start form carries the one-sentence note (item 6).
    const freshOrg = await makeOrg('Start Note Fixture');
    expect(await render(freshOrg)).toContain('첫 청구서는 시작일부터 계산하고, 플랜은 입금이 확인되면 열립니다.');
  });
});
