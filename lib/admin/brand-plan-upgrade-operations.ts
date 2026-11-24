import { upgradeManualPlan, upgradeSubscriptionPlan, type PlanUpgradeOutcome } from '@/lib/brands/billing/plan-upgrade-apply';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { isDbAdmin, withBillingConflicts } from './brand-ops-guard';
import { brandFailure } from './brand-workspace-operations';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import * as f from './form';
import type { AdminOperation } from './operations';
import { formatPlanUpgradeDetail } from './plan-upgrade-detail';

/**
 * B1c-3: the mid-cycle plan upgrade (docs/BRAND-RECURRING-BILLING.md §5.10), two operations on the organization page:
 * - `brandSubscription.upgrade`: a subscribed organization (BRAND_BILLING_AUTO_ISSUE on); the new invoice is issued at once;
 * - `brandBilling.planUpgrade`: a manual plan organization (no flag); the new cycle gets a draft for the admin to issue.
 * Both are two steps: step 1 returns the preview (`prepared`, detail = `formatPlanUpgradeDetail`); step 2 sends back its
 * digest with the previewed plan and the confirm box. The service recomputes and refuses a stale digest.
 */

const organizationBillingPath = (id: string) => `/admin/brand-workspace/organizations/${encodeURIComponent(id)}#billing`;

interface UpgradeInput {
  organizationId: string;
  planId: string;
  confirm: boolean;
  confirmCheck: boolean;
  previewDigest?: string;
  previewPlanId?: string;
}

function truthy(form: FormData, name: string): boolean {
  return form.getAll(name).some((value) => ['1', 'true', 'on'].includes(typeof value === 'string' ? value.trim().toLowerCase() : ''));
}

/**
 * Fix round 1: every refusal of the two upgrade operations carries the `upgrade:` prefix, so the upgrade lines
 * (lib/admin/plan-upgrade-detail.ts) apply to them only and shared codes of other operations keep their own lines.
 */
const UPGRADE = 'upgrade:';

function failure(result: Extract<PlanUpgradeOutcome, { ok: false }>): AdminOutcome {
  if (result.code === 'disabled') return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');
  if (result.code === 'unavailable') return fail('unknown', 'billing cycle tables not migrated');
  if (result.code === 'invalid' && result.field) return fail('invalid', `${UPGRADE}${result.detail ? `${result.field}:${result.detail}` : result.field}`);
  if (result.detail) return fail(brandFailure(result.code).code, `${UPGRADE}${result.code}:${result.detail}`);
  return brandFailure(result.code);
}

function upgradeOperation(mode: 'manual' | 'subscription'): AdminOperation<UpgradeInput> {
  return {
    parse(form) {
      const previewDigest = f.str(form, 'previewDigest');
      const previewPlanId = f.str(form, 'previewPlanId');
      return {
        ok: true,
        value: {
          organizationId: f.str(form, 'organizationId'),
          planId: f.str(form, 'planId'),
          confirm: truthy(form, 'confirm'),
          confirmCheck: f.str(form, '_confirm') === '1',
          ...(previewDigest ? { previewDigest } : {}),
          ...(previewPlanId ? { previewPlanId } : {}),
        },
      };
    },
    async run(ctx: AdminContext, input) {
      if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
      if (mode === 'subscription' && !brandBillingAutoIssueOpen()) return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');
      if (input.confirm) {
        if (input.previewDigest === undefined || input.previewPlanId === undefined) return fail('invalid', `${UPGRADE}preview_required`);
        if (input.previewPlanId !== input.planId) return fail('invalid', `${UPGRADE}preview_mismatch`);
        if (!input.confirmCheck) return fail('invalid', `${UPGRADE}upgrade_confirm_check`);
      }
      const run = mode === 'subscription' ? upgradeSubscriptionPlan : upgradeManualPlan;
      const result = await run({ sql: ctx.sql }, ctx.viewer, {
        organizationId: input.organizationId,
        planId: input.planId,
        confirm: input.confirm,
        previewOnly: !input.confirm,
        ...(input.previewDigest !== undefined ? { previewDigest: input.previewDigest } : {}),
      });
      if (!result.ok) return failure(result);
      const p = result.preview;
      if (!result.applied) {
        return ok('prepared', {
          detail: formatPlanUpgradeDetail({
            oldPlanId: p.oldPlanId,
            newPlanId: p.newPlanId,
            mode: p.mode,
            todayKst: p.todayKst,
            oldCycle: p.oldCycle,
            newCycle: p.newCycle,
            carryKrw: p.carryKrw,
            carryValidUntil: p.carryValidUntil,
            newPlanCapKrw: p.newPlanCapKrw,
            newPlanCapUnpaidKrw: p.newPlanCapUnpaidKrw,
            supplyKrw: p.invoice.supplyKrw,
            vatKrw: p.invoice.vatKrw,
            totalKrw: p.invoice.totalKrw,
            discountPercent: p.invoice.discountPercent,
            dueOn: p.invoice.dueOn,
            scheduledDowngradeCleared: p.scheduledDowngradeCleared,
            draftsVoided: p.draftsVoided,
            digest: p.digest,
          }),
        });
      }
      // Fix round 1: a manual upgrade's new invoice is a draft the admin still has to issue; the page says so.
      return ok('saved', {
        detail: mode === 'manual' ? `upgrade_manual_draft:${result.invoiceId}` : result.invoiceId,
        to: organizationBillingPath(input.organizationId),
      });
    },
  };
}

/** R3 item 8: every conflict of these operations reads as `billingConflict` (lib/admin/brand-ops-guard.ts). */
export const BRAND_PLAN_UPGRADE_OPERATIONS = withBillingConflicts({
  'brandSubscription.upgrade': upgradeOperation('subscription'),
  'brandBilling.planUpgrade': upgradeOperation('manual'),
} as const);
