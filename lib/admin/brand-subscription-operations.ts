import { recordBrandInvoiceTaxInvoice } from '@/lib/brands/billing';
import {
  cancelSubscription,
  clearPendingPlan,
  reconcileSubscriptionAdmin,
  reissueSubscriptionPeriod,
  scheduleDowngrade,
  startSubscription,
  undoCancelSubscription,
} from '@/lib/brands/subscriptions';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { formatReissueDetail, formatSubscriptionStartDetail } from './billing-preview-detail';
import { isDbAdmin, UUID_RE, withBillingConflicts } from './brand-ops-guard';
import { brandFailure } from './brand-workspace-operations';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import * as f from './form';
import type { AdminOperation } from './operations';

const organizationBillingPath = (id: string) => `/admin/brand-workspace/organizations/${encodeURIComponent(id)}#billing`;
const organizationInvoicesPath = (id: string) =>
  `/admin/brand-workspace/organizations/${encodeURIComponent(id)}#billing-invoices`;

function boolAll(form: FormData, name: string): boolean {
  return form.getAll(name).some((value) => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === '1' || normalized === 'true' || normalized === 'on';
  });
}

function subscriptionFailure(result: { code: string; field?: string; detail?: string }): AdminOutcome {
  if (result.code === 'disabled') return fail('disabled', result.detail ?? 'BRAND_BILLING_AUTO_ISSUE');
  if (result.code === 'not_available_yet') return fail('not_available_yet', result.detail);
  if (result.code === 'unavailable') return fail('unknown', 'subscription tables not migrated');
  if (result.code === 'invalid' && result.field) {
    return fail('invalid', result.detail ? `${result.field}:${result.detail}` : result.field);
  }
  if (result.detail) {
    const base = brandFailure(result.code);
    return fail(base.code, `${result.code}:${result.detail}`);
  }
  return brandFailure(result.code);
}

const subscriptionStart: AdminOperation<{
  organizationId: string;
  planId: string;
  collectionMethod: string;
  activateBeforePayment: boolean;
  confirm: boolean;
  /** The `ConfirmCheck` box (`_confirm`) the invoice-issue form uses: starting a subscription issues an invoice. */
  confirmCheck: boolean;
  /** Item 9: digest from the step-1 preview. */
  previewDigest?: string;
  previewPlanId?: string;
  previewActivateBeforePayment?: boolean;
}> = {
  // Fix round 1, B2: a subscription always starts today (KST); the form sends no date and a posted one is ignored.
  parse(form) {
    const previewPlanId = f.str(form, 'previewPlanId');
    const hasPreviewEarly = form.has('previewActivateBeforePayment');
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        planId: f.str(form, 'planId'),
        collectionMethod: f.str(form, 'collectionMethod') || 'transfer',
        activateBeforePayment: boolAll(form, 'activateBeforePayment'),
        confirm: boolAll(form, 'confirm'),
        confirmCheck: f.str(form, '_confirm') === '1',
        ...(f.str(form, 'previewDigest') ? { previewDigest: f.str(form, 'previewDigest') } : {}),
        ...(previewPlanId ? { previewPlanId } : {}),
        ...(hasPreviewEarly ? { previewActivateBeforePayment: boolAll(form, 'previewActivateBeforePayment') } : {}),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
    if (!brandBillingAutoIssueOpen()) return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');

    // Starting a subscription issues an invoice, so it is always two steps (review round 2, item 9):
    // step 1 previews and returns a digest of the organization, plan, start, proration, discount and amounts;
    // step 2 must send that digest back with the previewed plan / start date / early-access choice (B5) and
    // the ConfirmCheck the invoice-issue form uses. The server recomputes and refuses a stale digest.
    if (input.confirm) {
      if (
        input.previewDigest === undefined ||
        input.previewPlanId === undefined ||
        input.previewActivateBeforePayment === undefined
      ) {
        return fail('invalid', 'preview_required');
      }
      if (
        input.previewPlanId !== input.planId ||
        input.previewActivateBeforePayment !== input.activateBeforePayment
      ) {
        return fail('invalid', 'preview_mismatch');
      }
      if (!input.confirmCheck) return fail('invalid', 'confirmCheck');
    }

    const result = await startSubscription({ sql: ctx.sql }, ctx.viewer, {
      organizationId: input.organizationId,
      planId: input.planId,
      collectionMethod: input.collectionMethod,
      activateBeforePayment: input.activateBeforePayment,
      confirm: input.confirm,
      previewOnly: !input.confirm,
      ...(input.previewDigest !== undefined ? { previewDigest: input.previewDigest } : {}),
    });
    if (!result.ok) return subscriptionFailure(result);
    if (!result.applied) {
      return ok('prepared', {
        detail: formatSubscriptionStartDetail({
          planId: result.preview.planId,
          startedOn: result.preview.startedOn,
          activateBeforePayment: result.preview.activateBeforePayment,
          dueOn: result.preview.dueOn,
          totalKrw: result.preview.totalKrw,
          digest: result.preview.digest,
          shortWindow: result.preview.shortPaymentWindow,
        }),
      });
    }
    return ok('created', {
      detail: result.firstInvoiceId,
      to: organizationBillingPath(result.subscription.organizationId),
    });
  },
};

const subscriptionCancel: AdminOperation<{ organizationId: string }> = {
  parse(form) {
    return { ok: true, value: { organizationId: f.str(form, 'organizationId') } };
  },
  async run(ctx: AdminContext, input) {
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
    if (!brandBillingAutoIssueOpen()) return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');
    const result = await cancelSubscription({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return subscriptionFailure(result);
    return ok('saved', { to: organizationBillingPath(result.subscription.organizationId) });
  },
};

const subscriptionUndoCancel: AdminOperation<{ organizationId: string }> = {
  parse(form) {
    return { ok: true, value: { organizationId: f.str(form, 'organizationId') } };
  },
  async run(ctx: AdminContext, input) {
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
    if (!brandBillingAutoIssueOpen()) return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');
    const result = await undoCancelSubscription({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return subscriptionFailure(result);
    return ok('saved', { to: organizationBillingPath(result.subscription.organizationId) });
  },
};

const subscriptionScheduleDowngrade: AdminOperation<{ organizationId: string; planId: string }> = {
  parse(form) {
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        planId: f.str(form, 'planId'),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
    if (!brandBillingAutoIssueOpen()) return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');
    const result = await scheduleDowngrade({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return subscriptionFailure(result);
    return ok('saved', { to: organizationBillingPath(result.subscription.organizationId) });
  },
};

const subscriptionClearPendingPlan: AdminOperation<{ organizationId: string }> = {
  parse(form) {
    return { ok: true, value: { organizationId: f.str(form, 'organizationId') } };
  },
  async run(ctx: AdminContext, input) {
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
    if (!brandBillingAutoIssueOpen()) return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');
    const result = await clearPendingPlan({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return subscriptionFailure(result);
    return ok('saved', { to: organizationBillingPath(result.subscription.organizationId) });
  },
};

const subscriptionReissuePeriod: AdminOperation<{
  organizationId: string;
  period: string;
  confirm: boolean;
  previewDigest?: string;
}> = {
  parse(form) {
    const digest = f.str(form, 'previewDigest');
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        period: f.str(form, 'period'),
        confirm: boolAll(form, 'confirm'),
        ...(digest ? { previewDigest: digest } : {}),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
    if (!brandBillingAutoIssueOpen()) return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');
    // Item 9: a confirm without the step-1 digest is refused; the service refuses a stale one.
    if (input.confirm && input.previewDigest === undefined) return fail('invalid', 'preview_required');
    // Round 4, B8: step 1 is an explicit preview; step 2 confirms with the digest.
    const result = await reissueSubscriptionPeriod({ sql: ctx.sql }, ctx.viewer, { ...input, previewOnly: !input.confirm });
    if (!result.ok) return subscriptionFailure(result);
    if (!result.applied) {
      return ok('prepared', {
        detail: formatReissueDetail({
          period: result.preview.period,
          planId: result.preview.planId,
          prorateFromDay: result.preview.prorateFromDay,
          dueOn: result.preview.dueOn,
          totalKrw: result.preview.totalKrw,
          digest: result.preview.digest,
          shortWindow: result.preview.shortPaymentWindow,
        }),
      });
    }
    return ok('saved', {
      detail: result.invoice.id,
      to: organizationInvoicesPath(result.subscription.organizationId),
    });
  },
};

const subscriptionReconcile: AdminOperation<{ organizationId: string }> = {
  parse(form) {
    return { ok: true, value: { organizationId: f.str(form, 'organizationId') } };
  },
  async run(ctx: AdminContext, input) {
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
    if (!brandBillingAutoIssueOpen()) return fail('disabled', 'BRAND_BILLING_AUTO_ISSUE');
    if (!UUID_RE.test(input.organizationId)) return fail('invalid', 'organizationId');
    const result = await reconcileSubscriptionAdmin({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return subscriptionFailure(result);
    return ok('saved', { to: organizationBillingPath(input.organizationId) });
  },
};

const invoiceRecordTaxInvoice: AdminOperation<{
  invoiceId: string;
  issuedOn: string;
  ref: string;
  stay: boolean;
}> = {
  parse(form) {
    return {
      ok: true,
      value: {
        invoiceId: f.str(form, 'invoiceId'),
        issuedOn: f.str(form, 'issuedOn'),
        ref: f.str(form, 'ref'),
        stay: form.has('stay') ? boolAll(form, 'stay') : false,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');
    // R3 item 2: recording the Hometax date and reference is manual bookkeeping on an issued or paid invoice, so it is
    // open with BRAND_BILLING_AUTO_ISSUE off too (the manual path). Schema, sandbox and state checks are the service's.
    const result = await recordBrandInvoiceTaxInvoice({ sql: ctx.sql }, ctx.viewer, {
      invoiceId: input.invoiceId,
      issuedOn: input.issuedOn,
      ref: input.ref,
    });
    if (!result.ok) return subscriptionFailure(result);
    return ok('saved', {
      ...(input.stay ? {} : { to: organizationInvoicesPath(result.invoice.organizationId) }),
    });
  },
};

/** R3 item 8: every conflict of these operations reads as `billingConflict` (lib/admin/brand-ops-guard.ts). */
export const BRAND_SUBSCRIPTION_OPERATIONS = withBillingConflicts({
  'brandSubscription.start': subscriptionStart,
  'brandSubscription.cancel': subscriptionCancel,
  'brandSubscription.undoCancel': subscriptionUndoCancel,
  'brandSubscription.scheduleDowngrade': subscriptionScheduleDowngrade,
  'brandSubscription.clearPendingPlan': subscriptionClearPendingPlan,
  'brandSubscription.reissuePeriod': subscriptionReissuePeriod,
  'brandSubscription.reconcile': subscriptionReconcile,
  'brandBilling.invoice.recordTaxInvoice': invoiceRecordTaxInvoice,
} as const);
