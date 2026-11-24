import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTCOME_DETAIL_MAX_CHARS, OUTCOME_DETAIL_MAX_ENCODED, outcomeUrl } from '@/lib/admin/dispatch';
import {
  formatPlanDefaultPreviewDetail,
  formatReissueDetail,
  formatSubscriptionStartDetail,
  parsePlanDefaultPreviewDetail,
  parseReissueDetail,
  parseSubscriptionStartDetail,
} from '@/lib/admin/billing-preview-detail';
import { formatPlanUpgradeDetail, parsePlanUpgradeDetail, type PlanUpgradeDetail } from '@/lib/admin/plan-upgrade-detail';
import { draftBrandInvoice, issueBrandInvoice, markBrandInvoicePaid, saveBrandBillingProfileAdmin } from '@/lib/brands/billing';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * R3 item 1: the outcome URL cut every `detail` to 200 characters, so the plan-upgrade preview (~290) lost its tail, the
 * page could not parse it and the confirm button never appeared. Every preview a billing / subscription / upgrade
 * operation can return must survive `outcomeUrl` (the redirect the admin form follows) and parse back to the same value.
 */
const BACK = `/admin/brand-workspace/organizations/${'f'.repeat(8)}-ffff-4fff-8fff-${'f'.repeat(12)}?returnTo=${encodeURIComponent('/admin/brand-workspace?q=x&page=2')}#billing-plan-allowance`;

/** The detail as the page receives it: through the redirect URL and `URLSearchParams`. */
function roundTrip(detail: string): string | null {
  const url = new URL(outcomeUrl(BACK, { ok: true, code: 'prepared', detail }), 'https://admin.twings.app');
  return url.searchParams.get('detail');
}

const WORST_UPGRADE: PlanUpgradeDetail = {
  oldPlanId: 'b2b_29',
  newPlanId: 'b2b_69',
  mode: 'subscription',
  todayKst: '2026-12-31',
  oldCycle: { start: '2026-12-30', end: '2026-12-31', endBefore: '2027-01-30' },
  newCycle: { start: '2026-12-31', end: '2027-01-31' },
  carryKrw: 99_999_990,
  carryValidUntil: '2027-01-30',
  newPlanCapKrw: 100_000_000,
  newPlanCapUnpaidKrw: 50_000_000,
  supplyKrw: 9_999_999,
  vatKrw: 999_999,
  totalKrw: 10_999_998,
  discountPercent: 100,
  dueOn: '2027-01-14',
  scheduledDowngradeCleared: 'b2b_49',
  draftsVoided: 99,
  digest: 'abcdef0123456789',
};

describe('R3 item 1: every preview detail survives the outcome URL', () => {
  it('the worst-case plan-upgrade detail (both modes, longest plan ids, 8–9 digit amounts, flags) parses back unchanged', () => {
    for (const mode of ['subscription', 'manual'] as const) {
      const p: PlanUpgradeDetail = { ...WORST_UPGRADE, mode, newPlanCapUnpaidKrw: mode === 'manual' ? null : WORST_UPGRADE.newPlanCapUnpaidKrw };
      const detail = formatPlanUpgradeDetail(p);
      expect(detail.length, 'longer than the old 200-character cut').toBeGreaterThan(200);
      expect(parsePlanUpgradeDetail(roundTrip(detail))).toEqual(p);
    }
  });

  it('the worst-case subscription start and reissue details parse back unchanged', () => {
    for (const early of [true, false]) {
      const start = {
        planId: 'b2b_69' as const,
        startedOn: '2026-12-31',
        activateBeforePayment: early,
        dueOn: '2027-01-14',
        totalKrw: 99_999_999,
        digest: '0123456789abcdef',
        shortWindow: true,
      };
      expect(parseSubscriptionStartDetail(roundTrip(formatSubscriptionStartDetail(start)))).toEqual(start);
    }
    for (const prorateFromDay of ['2026-12-31', null]) {
      const reissue = {
        period: '2026-12',
        planId: 'b2b_69' as const,
        prorateFromDay,
        dueOn: '2027-01-14',
        totalKrw: 99_999_999,
        digest: 'fedcba9876543210',
        shortWindow: true,
      };
      expect(parseReissueDetail(roundTrip(formatReissueDetail(reissue)))).toEqual(reissue);
    }
  });

  it('the plan-default preview keeps its digest however many long-named organizations it affects', () => {
    const affected = Array.from({ length: 400 }, (_, i) => ({
      name: `테스트 브랜드 조직 이름이 아주 긴 경우 ${i} — (주)픽스처 컴퍼니 글로벌 마케팅 본부`,
      beforeCapKrw: 100_000_000,
      afterCapKrw: 99_999_990,
    }));
    for (const capKrw of [100_000_000, null]) {
      const detail = formatPlanDefaultPreviewDetail({ planId: 'b2b_69', capKrw, affected, digest: '0011223344556677' });
      const back = roundTrip(detail);
      expect(back).toBe(detail);
      expect(parsePlanDefaultPreviewDetail(back)).toMatchObject({
        planId: 'b2b_69',
        capKrw,
        affectedCount: 400,
        digest: '0011223344556677',
      });
    }
  });

  it('the cut is bounded for the transport: characters and the URL-encoded length', () => {
    expect(OUTCOME_DETAIL_MAX_CHARS).toBeGreaterThanOrEqual(1000);
    const huge = '가'.repeat(5000);
    const back = roundTrip(huge) ?? '';
    expect(back.length).toBeLessThanOrEqual(OUTCOME_DETAIL_MAX_CHARS);
    expect(encodeURIComponent(back).length).toBeLessThanOrEqual(OUTCOME_DETAIL_MAX_ENCODED);
    // A surrogate pair is never split.
    const emoji = '😀'.repeat(3000);
    expect(roundTrip(emoji)).toMatch(/^(?:😀)+$/u);
  });
});

describe('R3 item 1: the real manual upgrade preview through dispatch and the redirect', () => {
  let h: AdminHarness;
  let sql: SqlRunner;

  beforeEach(async () => {
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
    h = await adminHarness();
    sql = runner(h.db);
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
    await sql.query(
      "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000) on conflict (plan_id) do update set monthly_cap_krw = excluded.monthly_cap_krw",
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await h.close();
  });

  it('step 1 of "플랜 올림" comes back parseable, with the digest the confirm needs', async () => {
    const created = await createStudioOrganization({ sql }, ADMIN_VIEWER, { name: 'Roundtrip Upgrade Fixture', requestId: randomUUID() });
    if (!created.ok) throw new Error(created.code);
    const orgId = created.id;
    expect(
      (
        await saveBrandBillingProfileAdmin({ sql }, ADMIN_VIEWER, {
          organizationId: orgId,
          companyLegalName: 'Roundtrip Upgrade Fixture',
          businessRegNo: '111-11-11119',
          representativeName: 'Fixture Owner',
          businessAddress: 'Seoul',
          taxInvoiceEmail: 'billing@fixture.invalid',
          contactName: 'Ops',
          contactPhone: '02-000-0000',
        })
      ).ok,
    ).toBe(true);
    await sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-17', null, 1)",
      [orgId],
    );
    const now = () => new Date('2026-11-17T01:00:00Z');
    const drafted = await draftBrandInvoice({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, cycle: 'current' });
    if (!drafted.ok) throw new Error(drafted.code);
    await issueBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
    await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id, paidMethod: 'transfer' });

    const step1 = await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_69' });
    expect(step1).toMatchObject({ ok: true, code: 'prepared' });
    const parsed = parsePlanUpgradeDetail(roundTrip(step1.detail ?? ''));
    expect(parsed).toMatchObject({ oldPlanId: 'b2b_29', newPlanId: 'b2b_69', mode: 'manual', todayKst: '2026-11-25' });
    expect(parsed?.digest).toMatch(/^[0-9a-f]{16}$/);
  });
});
