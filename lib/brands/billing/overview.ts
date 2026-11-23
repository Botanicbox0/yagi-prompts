import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { creditsLeft, creditsOf } from '@/lib/brand-studio/credits';
import type { StudioEnv } from '@/lib/brand-studio/env';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { BRAND_PLANS, loadPlanAssignment } from '../plans';
import { BrandBillingDenied, requireBrandBillingSeat } from './access';
import { loadActiveBrandDiscount } from './discounts';
import { listBrandInvoices, loadBrandBillingProfile } from './invoices';
import { kstDayOf, planActiveWithGrace } from './math';
import type { BrandBillingOutcome, CustomerBrandBillingView } from './types';

/**
 * Customer-facing billing overview JSON for an organization owner/admin (`GET /api/brand-billing`).
 * Strictly scoped to the authenticated seat's organization; never returns draft invoices, admin memos,
 * or any data from another organization.
 */
export async function loadCustomerBrandBilling(
  deps: {
    sql: SqlRunner;
    env: Pick<StudioEnv, 'defaultMonthlyKrw' | 'planGraceDays'>;
    now?: () => Date;
  },
  viewer: Viewer,
  organizationId: string,
): Promise<BrandBillingOutcome<{ billing: CustomerBrandBillingView }>> {
  const now = deps.now?.() ?? new Date();
  const locale = viewer.locale === 'en' ? 'en' : 'ko';
  const dict = getDictionary(locale);

  try {
    return await deps.sql.transaction(async (sql) => {
      const seat = await requireBrandBillingSeat(sql, viewer, organizationId);
      const [assignment, allowance, activeDiscount, allInvoices, profile] = await Promise.all([
        loadPlanAssignment(sql, seat.organizationId),
        loadAllowance(sql, seat.organizationId, deps.env, now),
        loadActiveBrandDiscount(sql, seat.organizationId),
        listBrandInvoices(sql, { organizationId: seat.organizationId, now }),
        loadBrandBillingProfile(sql, seat.organizationId),
      ]);

      const today = kstDayOf(now);
      const graceDays = deps.env.planGraceDays ?? 7;
      const planStatus = planActiveWithGrace(assignment, today, graceDays);

      const plan = assignment
        ? {
            id: assignment.planId,
            name: dict.brandWorkspace.planNames[assignment.planId],
            monthlyListKrw: BRAND_PLANS[assignment.planId].monthlyKrw,
            billingMode: assignment.billingMode,
            startedOn: assignment.startedOn,
            endsOn: assignment.endsOn,
            active: planStatus.active,
            inGrace: planStatus.inGrace,
            seats: assignment.seats,
          }
        : null;

      const invoices = allInvoices
        .filter((inv) => inv.status !== 'draft')
        .map((inv) => ({
          id: inv.id,
          period: inv.period,
          planId: inv.planId,
          planName: dict.brandWorkspace.planNames[inv.planId],
          baseListKrw: inv.baseListKrw,
          listKrw: inv.listKrw,
          proratedDays: inv.proratedDays,
          periodDays: inv.periodDays,
          discountPercent: inv.discountPercent,
          discountKrw: inv.discountKrw,
          supplyKrw: inv.supplyKrw,
          vatKrw: inv.vatKrw,
          totalKrw: inv.totalKrw,
          status: inv.status as 'issued' | 'paid' | 'void',
          overdue: inv.overdue,
          issuedAt: inv.issuedAt,
          paidAt: inv.paidAt,
          voidedAt: inv.voidedAt,
        }));

      const billingProfile = profile
        ? {
            organizationId: profile.organizationId,
            companyLegalName: profile.companyLegalName,
            businessRegNo: profile.businessRegNo,
            representativeName: profile.representativeName,
            businessAddress: profile.businessAddress,
            taxInvoiceEmail: profile.taxInvoiceEmail,
            contactName: profile.contactName,
            contactPhone: profile.contactPhone,
            updatedAt: profile.updatedAt,
          }
        : null;

      return {
        ok: true as const,
        billing: {
          organizationId: seat.organizationId,
          plan,
          allowance: {
            capKrw: allowance.capKrw,
            baseCapKrw: allowance.baseCapKrw,
            extraKrw: allowance.extraKrw,
            usedKrw: allowance.usedKrw,
            capCredits: creditsOf(allowance.capKrw),
            baseCapCredits: creditsOf(allowance.baseCapKrw),
            extraCredits: creditsOf(allowance.extraKrw),
            usedCredits: creditsOf(allowance.usedKrw),
            remainingCredits: creditsLeft(allowance.capKrw, allowance.usedKrw),
            source: allowance.source,
            resetsOn: kstDayOf(new Date(allowance.resetsAt)),
            resetsAt: allowance.resetsAt,
          },
          activeDiscount: activeDiscount
            ? {
                id: activeDiscount.id,
                percent: activeDiscount.percent,
                invoicesTotal: activeDiscount.invoicesTotal,
                invoicesUsed: activeDiscount.invoicesUsed,
                invoicesRemaining: activeDiscount.invoicesRemaining,
                openEnded: activeDiscount.invoicesTotal === null,
                source: activeDiscount.source,
              }
            : null,
          invoices,
          billingProfile,
        },
      };
    });
  } catch (error) {
    if (error instanceof BrandBillingDenied) return { ok: false, code: error.code };
    throw error;
  }
}
