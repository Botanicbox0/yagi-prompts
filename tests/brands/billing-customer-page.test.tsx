import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { BillingPageClient } from '@/components/brand-billing/billing-page-client';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { StaffNotice } from '@/components/brand-workspace/staff-notice';
import {
  draftBrandInvoice,
  grantBrandDiscount,
  grantExtraAllowance,
  issueBrandInvoice,
  markBrandInvoicePaid,
  revokeExtraAllowance,
  saveBrandBillingProfileCustomer,
  setPlanAndAllowance,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import {
  billingPlanCatalogue,
  loadBillingProfileCompletenessForOrg,
  loadBrandBillingPageState,
} from '@/lib/brands/billing-page-data';
import {
  billingProfileCompleteness,
  emptyBillingProfileValues,
  isValidBillingEmail,
  validateBillingProfileFieldError,
} from '@/lib/brands/billing-ui';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { billingVisible, sectionVisibility } from '@/lib/brands/workspace/selection';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { runner } from '@/tests/helpers/pglite';
import {
  studioDeps,
  studioFixture,
  viewerOf,
  type StudioFixture,
} from '@/tests/brand-studio/server/helpers';

const fixtures: StudioFixture[] = [];
const sandboxedOrgId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;

afterEach(async () => {
  vi.restoreAllMocks();
  while (fixtures.length > 0) {
    await fixtures.pop()!.db.close();
  }
});

describe('customer billing page state & components', () => {
  it('enforces access control: sandboxed -> not_found, non-owner/admin -> forbidden, missing 0176 -> unavailable, staff -> readOnly', async () => {
    const f = await studioFixture();
    fixtures.push(f);
    const deps = studioDeps(f.sql);
    const staffViewer: Viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
    const ownerViewer = viewerOf(f.ids.owner);
    const editorViewer = viewerOf(f.ids.editor);
    const viewerMemberViewer = viewerOf(f.ids.viewer);

    const sandboxedState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env },
      ownerViewer,
      { id: sandboxedOrgId, name: 'Demo', role: 'owner' },
    );
    expect(sandboxedState.kind).toBe('not_found');

    const morphicByName = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env },
      ownerViewer,
      { id: randomUUID(), name: 'Morphic', role: 'owner' },
    );
    expect(morphicByName.kind).toBe('not_found');

    const editorState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env },
      editorViewer,
      { id: f.orgId, name: 'Brand', role: 'editor' },
    );
    expect(editorState.kind).toBe('forbidden');

    const viewerState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env },
      viewerMemberViewer,
      { id: f.orgId, name: 'Brand', role: 'viewer' },
    );
    expect(viewerState.kind).toBe('forbidden');

    const guestState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env },
      ownerViewer,
      { id: f.orgId, name: 'Brand', role: 'guest' },
    );
    expect(guestState.kind).toBe('forbidden');

    const staffState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env },
      staffViewer,
      { id: f.orgId, name: 'Brand', role: 'studio' },
    );
    expect(staffState.kind).toBe('ready');
    if (staffState.kind === 'ready') {
      expect(staffState.staffReadOnly).toBe(true);
      const dict = getDictionary('ko');
      const html = renderToStaticMarkup(
        <BillingPageClient
          organizationId={f.orgId}
          organizationName="아틀리에 모네"
          initialBilling={staffState.billing}
          copy={dict.brandBilling.customer}
          locale="ko"
          readOnly
          notice={
            <StaffNotice
              b={dict.brandWorkspace}
              manageHref={`/admin/brand-workspace/organizations/${f.orgId}`}
            />
          }
        />,
      );
      expect(html).toContain('data-brand-billing-page');
      expect(html).toContain('data-brand-staff-view');
      expect(html).not.toContain('data-billing-plan-request');
      expect(html).not.toContain('data-billing-profile-submit');
    }

    // Missing 0176 tables -> calm unavailable state without throwing
    const pre0176Db = new PGlite();
    const pre0176Sql = runner(pre0176Db);
    try {
      await pre0176Db.exec(
        'create schema if not exists auth; create table if not exists auth.users (id uuid primary key);',
      );
      for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0176_'))) {
        await pre0176Db.exec(readMigration(file));
      }
      const missingTablesState = await loadBrandBillingPageState(
        { sql: pre0176Sql, env: deps.env },
        ownerViewer,
        { id: f.orgId, name: 'Brand', role: 'owner' },
      );
      expect(missingTablesState.kind).toBe('unavailable');
    } finally {
      await pre0176Db.close();
    }
  });

  it('renders plan, credit-only usage with grant expiry (no admin reasons or KRW), discount summary, read-only invoices with 취소 status, and tax profile', async () => {
    const f = await studioFixture();
    fixtures.push(f);
    const deps = studioDeps(f.sql);
    const adminViewer: Viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
    const ownerViewer = viewerOf(f.ids.owner);

    const now = new Date('2026-11-15T05:00:00.000Z');
    const currentMonth = '2026-11';
    const nextMonth = '2026-12';

    const planRes = await setPlanAndAllowance({ sql: f.sql }, adminViewer, {
      organizationId: f.orgId,
      planId: 'b2b_49',
      monthlyCapKrw: 100_000,
      // B1c: from October, so the October invoice below is a cycle of this plan.
      startedOn: '2026-10-01',
      expectedRevision: 0,
      allowanceMode: 'override',
      planNote: 'Launch assign',
    });
    expect(planRes.ok).toBe(true);

    await grantExtraAllowance({ sql: f.sql, now: () => now }, adminViewer, {
      organizationId: f.orgId,
      amountKrw: 50_000,
      validMonth: currentMonth,
      reason: 'INTERNAL_SECRET_CAMP_MAKEGOOD',
    });
    const revokedGrant = await grantExtraAllowance({ sql: f.sql, now: () => now }, adminViewer, {
      organizationId: f.orgId,
      amountKrw: 30_000,
      validMonth: currentMonth,
      reason: 'SHOULD_NOT_APPEAR_REVOKED',
    });
    if (revokedGrant.ok) {
      await revokeExtraAllowance({ sql: f.sql }, adminViewer, {
        grantId: revokedGrant.id,
        organizationId: f.orgId,
      });
    }

    await grantBrandDiscount({ sql: f.sql, now: () => now }, adminViewer, {
      organizationId: f.orgId,
      percent: 40,
      invoicesTotal: 3,
      memo: 'INTERNAL_DISCOUNT_MEMO',
    });

    // Draft + Issued + Paid + Void invoices
    const d1 = await draftBrandInvoice({ sql: f.sql, now: () => now }, adminViewer, {
      organizationId: f.orgId,
      period: currentMonth,
      memo: 'DRAFT_INTERNAL',
    });
    expect(d1.ok).toBe(true);
    if (d1.ok) {
      await issueBrandInvoice({ sql: f.sql, now: () => now }, adminViewer, {
        invoiceId: d1.invoice.id,
      });
    }

    const d2 = await draftBrandInvoice({ sql: f.sql, now: () => now }, adminViewer, {
      organizationId: f.orgId,
      period: nextMonth,
    });
    expect(d2.ok).toBe(true);
    if (d2.ok) {
      await issueBrandInvoice({ sql: f.sql, now: () => now }, adminViewer, {
        invoiceId: d2.invoice.id,
      });
      await markBrandInvoicePaid({ sql: f.sql, now: () => now }, adminViewer, {
        invoiceId: d2.invoice.id,
        paidMethod: 'wire',
      });
    }

    // B1c: drafted while October's cycle was current (the plan starts in October here, see the assignment above).
    const d3 = await draftBrandInvoice({ sql: f.sql, now: () => new Date('2026-10-15T01:00:00Z') }, adminViewer, {
      organizationId: f.orgId,
      period: '2026-10',
    });
    expect(d3.ok).toBe(true);
    if (d3.ok) {
      await issueBrandInvoice({ sql: f.sql, now: () => now }, adminViewer, {
        invoiceId: d3.invoice.id,
      });
      await voidBrandInvoice({ sql: f.sql, now: () => now }, adminViewer, {
        invoiceId: d3.invoice.id,
        reason: 'duplicate',
      });
    }

    const state = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env, now: () => now },
      ownerViewer,
      { id: f.orgId, name: '스튜디오 테스트', role: 'owner' },
    );
    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') return;

    const dict = getDictionary('ko');
    const html = renderToStaticMarkup(
      <BillingPageClient
        organizationId={f.orgId}
        organizationName="스튜디오 테스트"
        initialBilling={state.billing}
        copy={dict.brandBilling.customer}
        locale="ko"
      />,
    );

    // 1. Plan & Usage
    expect(html).toContain('490,000원');
    expect(html).toContain('부가세 별도');
    const usageMatch = html.match(/data-billing-section="usage"[\s\S]*?<\/section>/);
    expect(usageMatch).toBeTruthy();
    const usageSectionHtml = usageMatch![0]!;
    expect(usageSectionHtml).not.toMatch(/원|₩|KRW/);
    expect(usageSectionHtml).toContain('2026-11-30');
    expect(html).not.toContain('INTERNAL_SECRET_CAMP_MAKEGOOD');
    expect(html).not.toContain('SHOULD_NOT_APPEAR_REVOKED');
    expect(html).not.toContain('INTERNAL_DISCOUNT_MEMO');
    expect(html).not.toContain('DRAFT_INTERNAL');

    // 2. Discount summary
    expect(html).toContain('40%');

    // 3. Invoices (no payment controls, uses 취소 instead of 무효)
    expect(html).toContain('발행됨');
    expect(html).toContain('입금 확인');
    expect(html).toContain('취소');
    expect(html).not.toContain('무효');
    expect(html).toContain(dict.brandBilling.customer.invoiceSection.paymentNote);
    const FORBIDDEN_PAYMENT_WORDING = /카드|card|결제하기|checkout|pay\s*now|자동\s*결제|auto-?charge/i;
    expect(html).not.toMatch(FORBIDDEN_PAYMENT_WORDING);

    const collectStrings = (node: unknown, prefix = ''): Array<{ path: string; value: string }> => {
      if (typeof node === 'string') return [{ path: prefix, value: node }];
      if (node && typeof node === 'object') {
        return Object.entries(node).flatMap(([k, v]) => collectStrings(v, prefix ? `${prefix}.${k}` : k));
      }
      return [];
    };
    for (const loc of ['ko', 'en'] as const) {
      const customerDict = getDictionary(loc).brandBilling.customer;
      for (const leaf of collectStrings(customerDict)) {
        expect(leaf.value, `${loc}.${leaf.path}`).not.toMatch(FORBIDDEN_PAYMENT_WORDING);
      }
      const locHtml = renderToStaticMarkup(
        <BillingPageClient
          organizationId={f.orgId}
          organizationName="스튜디오 테스트"
          initialBilling={state.billing}
          copy={customerDict}
          locale={loc}
        />,
      );
      expect(locHtml, `page markup (${loc})`).not.toMatch(FORBIDDEN_PAYMENT_WORDING);
    }

    // 4. Profile completeness & live validators
    const comp0 = await loadBillingProfileCompletenessForOrg(f.sql, f.orgId);
    expect(comp0.complete).toBe(false);
    expect(comp0.filled).toBe(0);

    const savedProfile = await saveBrandBillingProfileCustomer({ sql: f.sql }, ownerViewer, {
      organizationId: f.orgId,
      companyLegalName: '주식회사 야기테스트',
      businessRegNo: '111-11-11119',
      representativeName: '김대표',
      businessAddress: '서울시 강남구',
      taxInvoiceEmail: 'tax@example.com',
      contactName: '박담당',
      contactPhone: '010-1234-5678',
    });
    expect(savedProfile.ok).toBe(true);
    const comp7 = await loadBillingProfileCompletenessForOrg(f.sql, f.orgId);
    expect(comp7.complete).toBe(true);
    expect(comp7.filled).toBe(7);

    expect(isValidBillingEmail('bad-email')).toBe(false);
    expect(isValidBillingEmail('tax@example.com')).toBe(true);
    expect(
      validateBillingProfileFieldError(
        emptyBillingProfileValues({
          businessRegNo: '111-11-11111',
          taxInvoiceEmail: 'invalid',
        }),
      ),
    ).toEqual({
      businessRegNoInvalid: true,
      taxInvoiceEmailInvalid: true,
    });
    expect(billingProfileCompleteness(null).filled).toBe(0);
  });

  it('shows 29/49/69 plan catalogue when no plan assigned and keeps navigation omitted for sandboxed/guest orgs', async () => {
    const f = await studioFixture();
    fixtures.push(f);
    const deps = studioDeps(f.sql);
    const state = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env },
      viewerOf(f.ids.owner),
      { id: f.orgId, name: '신규 브랜드', role: 'owner' },
    );
    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') return;
    expect(state.billing.plan).toBeNull();

    const dict = getDictionary('ko');
    const html = renderToStaticMarkup(
      <BillingPageClient
        organizationId={f.orgId}
        organizationName="신규 브랜드"
        initialBilling={state.billing}
        planCatalogue={billingPlanCatalogue()}
        copy={dict.brandBilling.customer}
        locale="ko"
      />,
    );
    expect(html).toContain('290,000원');
    expect(html).toContain('490,000원');
    expect(html).toContain('690,000원');
    expect(html).toContain('이용 신청');
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);

    // Navigation visibility & exact sectionVisibility 4-key contract
    expect(sectionVisibility({ id: f.orgId, name: '신규 브랜드', role: 'owner' })).toEqual({
      studio: true,
      identity: true,
      settings: true,
      members: true,
    });
    expect(billingVisible({ id: f.orgId, name: '신규 브랜드', role: 'owner' })).toBe(true);
    expect(billingVisible({ id: f.orgId, name: '신규 브랜드', role: 'guest' })).toBe(false);
    expect(billingVisible({ id: sandboxedOrgId, name: 'Demo', role: 'owner' })).toBe(false);

    const navHtmlOwner = renderToStaticMarkup(
      <WorkspaceNavigation
        home="홈"
        members="팀"
        settings="설정"
        billing="플랜 및 청구"
        library="라이브러리"
        studio="스튜디오"
        scope={{
          selectedId: f.orgId,
          choices: [{ id: f.orgId, name: '신규 브랜드', role: 'owner' }],
          projectOrganizations: {},
        } as never}
      />,
    );
    expect(navHtmlOwner).toContain('/brand/billing');

    const navHtmlSandboxed = renderToStaticMarkup(
      <WorkspaceNavigation
        home="홈"
        members="팀"
        settings="설정"
        billing="플랜 및 청구"
        library="라이브러리"
        studio="스튜디오"
        scope={{
          selectedId: sandboxedOrgId,
          choices: [{ id: sandboxedOrgId, name: 'Morphic', role: 'owner' }],
          projectOrganizations: {},
        } as never}
      />,
    );
    expect(navHtmlSandboxed).not.toContain('/brand/billing');
  });

  it('F1: distinguishes upcoming startsOn, endingOn future, inGrace with grace end date, active without end date, and expired ended states', async () => {
    const f = await studioFixture();
    fixtures.push(f);
    const deps = studioDeps(f.sql);
    const ownerViewer = viewerOf(f.ids.owner);
    const adminViewer: Viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
    const dict = getDictionary('ko');
    const now = new Date('2026-11-20T03:00:00Z'); // KST 2026-11-20
    const catalogue = billingPlanCatalogue();

    // 1) Upcoming scheduled start (startedOn > todayKst)
    const p1 = await setPlanAndAllowance({ sql: f.sql }, adminViewer, {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-12-01',
      endsOn: null,
      allowanceMode: 'override',
      monthlyCapKrw: 100_000,
      expectedRevision: 0,
    });
    expect(p1.ok).toBe(true);
    const upcomingState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env, now: () => now },
      ownerViewer,
      { id: f.orgId, name: '예정 브랜드', role: 'owner' },
    );
    expect(upcomingState.kind).toBe('ready');
    if (upcomingState.kind !== 'ready') return;
    const upcomingHtml = renderToStaticMarkup(
      <BillingPageClient
        organizationId={f.orgId}
        organizationName="예정 브랜드"
        initialBilling={upcomingState.billing}
        planCatalogue={catalogue}
        todayKst={upcomingState.todayKst}
        graceDays={upcomingState.graceDays}
        copy={dict.brandBilling.customer}
        locale="ko"
      />,
    );
    expect(upcomingHtml).toContain('2026-12-01 시작 예정');
    expect(upcomingHtml).not.toContain('플랜 기간 종료');

    // 2) Grace period (endsOn = 2026-11-19 < todayKst = 2026-11-20 -> inGrace until 2026-11-26)
    const p2 = await setPlanAndAllowance({ sql: f.sql }, adminViewer, {
      organizationId: f.orgId,
      planId: 'b2b_49',
      startedOn: '2026-10-01',
      endsOn: '2026-11-19',
      allowanceMode: 'override',
      monthlyCapKrw: 100_000,
      expectedRevision: 1,
    });
    expect(p2.ok).toBe(true);
    const graceState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env, now: () => now },
      ownerViewer,
      { id: f.orgId, name: '유예 브랜드', role: 'owner' },
    );
    expect(graceState.kind).toBe('ready');
    if (graceState.kind !== 'ready') return;
    expect(graceState.billing.plan?.inGrace).toBe(true);
    const graceHtml = renderToStaticMarkup(
      <BillingPageClient
        organizationId={f.orgId}
        organizationName="유예 브랜드"
        initialBilling={graceState.billing}
        planCatalogue={catalogue}
        todayKst={graceState.todayKst}
        graceDays={graceState.graceDays}
        copy={dict.brandBilling.customer}
        locale="ko"
      />,
    );
    expect(graceHtml).toContain('2026-11-19 종료 · 2026-11-26까지 유예');
    expect(graceHtml).not.toContain('2026-11-19 종료 예정');

    // 3) Future endsOn -> active without grace
    const p3 = await setPlanAndAllowance({ sql: f.sql }, adminViewer, {
      organizationId: f.orgId,
      planId: 'b2b_49',
      startedOn: '2026-10-01',
      endsOn: '2026-11-30',
      allowanceMode: 'override',
      monthlyCapKrw: 100_000,
      expectedRevision: 2,
    });
    expect(p3.ok).toBe(true);
    const futureEndState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env, now: () => now },
      ownerViewer,
      { id: f.orgId, name: '유지 브랜드', role: 'owner' },
    );
    expect(futureEndState.kind).toBe('ready');
    if (futureEndState.kind !== 'ready') return;
    const futureEndHtml = renderToStaticMarkup(
      <BillingPageClient
        organizationId={f.orgId}
        organizationName="유지 브랜드"
        initialBilling={futureEndState.billing}
        planCatalogue={catalogue}
        todayKst={futureEndState.todayKst}
        graceDays={futureEndState.graceDays}
        copy={dict.brandBilling.customer}
        locale="ko"
      />,
    );
    expect(futureEndHtml).toContain('2026-11-30 종료 예정');

    // 4) Expired past grace (endsOn = 2026-11-01)
    const p4 = await setPlanAndAllowance({ sql: f.sql }, adminViewer, {
      organizationId: f.orgId,
      planId: 'b2b_49',
      startedOn: '2026-10-01',
      endsOn: '2026-11-01',
      allowanceMode: 'override',
      monthlyCapKrw: 0,
      expectedRevision: 3,
    });
    expect(p4.ok).toBe(true);
    const endedState = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env, now: () => now },
      ownerViewer,
      { id: f.orgId, name: '만료 브랜드', role: 'owner' },
    );
    expect(endedState.kind).toBe('ready');
    if (endedState.kind !== 'ready') return;
    const endedHtml = renderToStaticMarkup(
      <BillingPageClient
        organizationId={f.orgId}
        organizationName="만료 브랜드"
        initialBilling={endedState.billing}
        planCatalogue={catalogue}
        todayKst={endedState.todayKst}
        graceDays={endedState.graceDays}
        copy={dict.brandBilling.customer}
        locale="ko"
      />,
    );
    expect(endedHtml).toContain('플랜 기간 종료');
  });

  it('F2 & F11 & F10: handles real redeem response (activeDiscount / code_unavailable) and blocks invalid profile submit in real DOM without raw hex tokens', async () => {
    const f = await studioFixture();
    fixtures.push(f);
    const deps = studioDeps(f.sql);
    const state = await loadBrandBillingPageState(
      { sql: f.sql, env: deps.env },
      viewerOf(f.ids.owner),
      { id: f.orgId, name: '인터랙션 브랜드', role: 'owner' },
    );
    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') return;

    const { mountDom } = await import('@/tests/brands/_dom-harness');
    let latestDiscount: (typeof state.billing)['activeDiscount'] = state.billing.activeDiscount;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/brand-billing/redeem')) {
        latestDiscount = {
          id: 'disc-1',
          percent: 35,
          invoicesTotal: 3,
          invoicesUsed: 0,
          invoicesRemaining: 3,
          openEnded: false,
          source: 'code',
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            activeDiscount: latestDiscount,
            replaced: false,
          }),
        };
      }
      if (url.includes('/api/brand-billing?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...state.billing, activeDiscount: latestDiscount }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const dict = getDictionary('ko');
    const dom = await mountDom(
      <BillingPageClient
        organizationId={f.orgId}
        organizationName="인터랙션 브랜드"
        initialBilling={state.billing}
        planCatalogue={billingPlanCatalogue()}
        todayKst={state.todayKst}
        graceDays={state.graceDays}
        copy={dict.brandBilling.customer}
        locale="ko"
      />,
    );

    try {
      // 1) Redeem valid promo code -> reads json.activeDiscount.percent (not json.discount)
      const promoInput = dom.query('input[name="code"]');
      expect(promoInput).toBeTruthy();
      await dom.setValue(promoInput!, 'YAGI-FALL-35');
      await dom.submit('[data-billing-redeem-form]');
      expect(dom.container.textContent).toContain('35%');

      // 1b) Replace active promo code -> feedback uses json.activeDiscount.percent
      fetchMock.mockImplementationOnce(async () => {
        latestDiscount = {
          id: 'disc-2',
          percent: 50,
          invoicesTotal: 2,
          invoicesUsed: 0,
          invoicesRemaining: 2,
          openEnded: false,
          source: 'code',
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            activeDiscount: latestDiscount,
            replaced: true,
          }),
        };
      });
      await dom.setValue('input[name="code"]', 'YAGI-VIP-50');
      await dom.submit('[data-billing-redeem-form]');
      expect(dom.container.textContent).toContain('50%');

      // 2) Redeem unavailable promo code -> shows code_unavailable error
      fetchMock.mockImplementationOnce(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, code: 'code_unavailable' }),
      }));
      await dom.setValue('input[name="code"]', 'EXPIRED-CODE-1');
      await dom.submit('[data-billing-redeem-form]');
      expect(dom.container.textContent).toContain(dict.brandBilling.customer.discountSection.errors.code_unavailable);

      // 3) Invalid business reg no + invalid email blocks PUT /api/brand-billing/profile and renders field errors
      const regInput = dom.query('input[name="businessRegNo"]');
      const emailInput = dom.query('input[name="taxInvoiceEmail"]');
      expect(regInput).toBeTruthy();
      expect(emailInput).toBeTruthy();
      await dom.setValue(regInput!, '111-11-11111');
      await dom.setValue(emailInput!, 'not-an-email');
      await dom.submit('[data-billing-profile-form]');
      const profileCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/brand-billing/profile'));
      expect(profileCalls).toHaveLength(0);
      expect(dom.container.textContent).toContain(dict.brandBilling.customer.profileInvalidRegNo);
      expect(dom.container.textContent).toContain(dict.brandBilling.customer.profileSection.invalidEmail);
    } finally {
      await dom.unmount();
    }
  });
});
