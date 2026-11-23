import { studioEnv } from '@/lib/brand-studio/env';
import {
  createBrandDiscountCode,
  disableBrandDiscountCode,
  draftBrandInvoice,
  endBrandDiscount,
  grantBrandDiscount,
  grantExtraAllowance,
  issueBrandInvoice,
  markBrandInvoicePaid,
  revokeExtraAllowance,
  saveBrandBillingProfileAdmin,
  setPlanAllowanceDefault,
  setPlanAndAllowance,
  updateDraftBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import { brandFailure } from './brand-workspace-operations';
import * as f from './form';
import type { AdminOperation, ParseResult } from './operations';

const organizationPath = (id: string) => `/admin/brand-workspace/organizations/${encodeURIComponent(id)}`;

function billingFailure(result: { code: string; field?: string; detail?: string }): AdminOutcome {
  if (result.code === 'unavailable') return fail('unknown', 'billing tables not migrated');
  if (result.code === 'invalid' && result.field) return fail('invalid', result.field);
  if (result.detail) {
    const base = brandFailure(result.code);
    return fail(base.code, `${result.code}:${result.detail}`);
  }
  return brandFailure(result.code);
}

function intField(form: FormData, name: string): { ok: true; value: number } | { ok: false; detail: string } {
  const raw = f.str(form, name).replace(/[,\s]/g, '');
  const n = Number(raw);
  if (raw === '' || !Number.isInteger(n)) return { ok: false, detail: `${name} must be a whole number` };
  return { ok: true, value: n };
}

function optIntField(form: FormData, name: string): { ok: true; value: number | null | undefined } | { ok: false; detail: string } {
  if (!form.has(name)) return { ok: true, value: undefined };
  const raw = f.str(form, name).replace(/[,\s]/g, '');
  if (raw === '') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n)) return { ok: false, detail: `${name} must be a whole number` };
  return { ok: true, value: n };
}

const planDefaultSet: AdminOperation<{
  planId: string;
  monthlyCapKrw: number | null;
  note: string;
  confirm: boolean;
}> = {
  parse(form) {
    const cap = optIntField(form, 'monthlyCapKrw');
    if (!cap.ok) return cap;
    return {
      ok: true,
      value: {
        planId: f.str(form, 'planId'),
        monthlyCapKrw: cap.value ?? null,
        note: f.text(form, 'note'),
        confirm: form.has('confirm') ? f.bool(form, 'confirm') : false,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await setPlanAllowanceDefault({ sql: ctx.sql, env: studioEnv() }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    if (!result.applied) {
      const names = result.affectedOrganizations.map((o) => `${o.name}:${o.beforeCapKrw}->${o.afterCapKrw}`).join(',');
      return ok('prepared', {
        detail: `${result.affectedCount}${names ? ` (${names})` : ''}`,
      });
    }
    return ok('saved', { detail: String(result.affectedCount) });
  },
};

interface PlanAndAllowanceInput {
  organizationId: string;
  planId: string;
  billingMode: string;
  startedOn: string;
  endsOn: string | null;
  seats: number | null;
  planNote: string;
  expectedRevision: number;
  allowanceMode: string;
  monthlyCapKrw: number | null;
  preferredLane?: string | null;
  allowanceNote: string;
}

const planAndAllowanceSet: AdminOperation<PlanAndAllowanceInput> = {
  parse(form) {
    const rev = intField(form, 'expectedRevision');
    if (!rev.ok || rev.value < 0) return { ok: false, detail: 'expectedRevision must be a whole number' };
    const seats = optIntField(form, 'seats');
    if (!seats.ok) return seats;
    const cap = optIntField(form, 'monthlyCapKrw');
    if (!cap.ok) return cap;
    const endsOn = f.str(form, 'endsOn');
    const hasLane = form.has('preferredLane');
    const laneRaw = f.str(form, 'preferredLane');
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        planId: f.str(form, 'planId'),
        billingMode: f.str(form, 'billingMode') || 'invoice',
        startedOn: f.str(form, 'startedOn'),
        endsOn: endsOn === '' ? null : endsOn,
        seats: seats.value ?? null,
        planNote: f.text(form, 'planNote'),
        expectedRevision: rev.value,
        allowanceMode: f.str(form, 'allowanceMode'),
        monthlyCapKrw: cap.value ?? null,
        ...(hasLane ? { preferredLane: laneRaw === '' ? null : laneRaw } : {}),
        allowanceNote: f.text(form, 'allowanceNote'),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await setPlanAndAllowance({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

const discountGrant: AdminOperation<{ organizationId: string; percent: number; invoicesTotal: number | null; memo: string }> = {
  parse(form) {
    const pct = intField(form, 'percent');
    if (!pct.ok) return pct;
    const total = optIntField(form, 'invoicesTotal');
    if (!total.ok) return total;
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        percent: pct.value,
        invoicesTotal: total.value ?? null,
        memo: f.text(form, 'memo'),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await grantBrandDiscount({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(result.discount.organizationId) });
  },
};

const discountEnd: AdminOperation<{ organizationId: string; discountId?: string; reason: string }> = {
  parse(form) {
    const discountId = f.str(form, 'discountId');
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        ...(discountId ? { discountId } : {}),
        reason: f.text(form, 'reason') || 'ended_by_admin',
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await endBrandDiscount({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(result.discount.organizationId) });
  },
};

interface CodeCreateInput {
  code?: string;
  percent: number;
  invoicesTotal: number | null;
  maxRedemptions: number | null;
  validUntil: string | null;
  organizationId: string | null;
  memo: string;
}

const discountCodeCreate: AdminOperation<CodeCreateInput> = {
  parse(form) {
    const pct = intField(form, 'percent');
    if (!pct.ok) return pct;
    const total = optIntField(form, 'invoicesTotal');
    if (!total.ok) return total;
    const maxR = optIntField(form, 'maxRedemptions');
    if (!maxR.ok) return maxR;
    const validUntil = f.str(form, 'validUntil');
    const orgId = f.str(form, 'organizationId');
    const codeRaw = f.str(form, 'code');
    return {
      ok: true,
      value: {
        ...(codeRaw ? { code: codeRaw } : {}),
        percent: pct.value,
        invoicesTotal: total.value ?? null,
        maxRedemptions: maxR.value === undefined ? 1 : maxR.value,
        validUntil: validUntil === '' ? null : validUntil,
        organizationId: orgId === '' ? null : orgId,
        memo: f.text(form, 'memo'),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await createBrandDiscountCode({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('created', {
      detail: result.discountCode.code,
      ...(input.organizationId ? { to: organizationPath(input.organizationId) } : {}),
    });
  },
};

const discountCodeDisable: AdminOperation<{ codeId?: string; code?: string }> = {
  parse(form) {
    const codeId = f.str(form, 'codeId');
    const code = f.str(form, 'code');
    if (!codeId && !code) return { ok: false, detail: 'codeId or code is required' };
    return { ok: true, value: { ...(codeId ? { codeId } : {}), ...(code ? { code } : {}) } };
  },
  async run(ctx: AdminContext, input) {
    const result = await disableBrandDiscountCode({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved');
  },
};

const profileSet: AdminOperation<Record<string, string>> = {
  parse(form) {
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        companyLegalName: f.str(form, 'companyLegalName'),
        businessRegNo: f.str(form, 'businessRegNo'),
        representativeName: f.str(form, 'representativeName'),
        businessAddress: f.text(form, 'businessAddress'),
        taxInvoiceEmail: f.str(form, 'taxInvoiceEmail'),
        contactName: f.str(form, 'contactName'),
        contactPhone: f.str(form, 'contactPhone'),
        memo: f.text(form, 'memo'),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await saveBrandBillingProfileAdmin({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(result.profile.organizationId) });
  },
};

const invoiceDraft: AdminOperation<Record<string, unknown>> = {
  parse(form) {
    const input: Record<string, unknown> = {
      organizationId: f.str(form, 'organizationId'),
      period: f.str(form, 'period'),
      memo: f.text(form, 'memo'),
    };
    const planId = f.str(form, 'planId');
    if (planId) input.planId = planId;
    if (form.has('applyActiveDiscount')) input.applyActiveDiscount = f.bool(form, 'applyActiveDiscount');
    if (form.has('manualAmounts')) input.manualAmounts = f.bool(form, 'manualAmounts');
    if (form.has('manualReason')) input.manualReason = f.text(form, 'manualReason');
    if (form.has('prorate')) {
      const p = f.str(form, 'prorate');
      if (p === 'false' || p === '0') input.prorate = false;
      else if (p === 'true' || p === '1') input.prorate = true;
    }
    const usedDays = optIntField(form, 'proratedDays');
    const totalDays = optIntField(form, 'periodDays');
    if (!usedDays.ok) return usedDays;
    if (!totalDays.ok) return totalDays;
    if (usedDays.value != null && totalDays.value != null) {
      input.prorate = { usedDays: usedDays.value, totalDays: totalDays.value };
    }
    for (const key of ['baseListKrw', 'listKrw', 'discountPercent', 'discountKrw', 'supplyKrw', 'vatKrw', 'totalKrw']) {
      const parsed = optIntField(form, key);
      if (!parsed.ok) return parsed;
      if (parsed.value !== undefined && parsed.value !== null) input[key] = parsed.value;
    }
    return { ok: true, value: input };
  },
  async run(ctx: AdminContext, input) {
    const result = await draftBrandInvoice({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('created', {
      detail: result.invoice.id,
      to: organizationPath(result.invoice.organizationId),
    });
  },
};

const invoiceUpdateDraft: AdminOperation<Record<string, unknown>> = {
  parse(form) {
    const input: Record<string, unknown> = {
      invoiceId: f.str(form, 'invoiceId'),
    };
    const planId = f.str(form, 'planId');
    if (planId) input.planId = planId;
    if (form.has('manualAmounts')) input.manualAmounts = f.bool(form, 'manualAmounts');
    if (form.has('manualReason')) input.manualReason = f.text(form, 'manualReason');
    if (form.has('discountId')) {
      const d = f.str(form, 'discountId');
      input.discountId = d === '' ? null : d;
    }
    if (form.has('memo')) input.memo = f.text(form, 'memo');
    for (const key of ['baseListKrw', 'listKrw', 'discountPercent', 'discountKrw', 'supplyKrw', 'vatKrw', 'totalKrw']) {
      const parsed = optIntField(form, key);
      if (!parsed.ok) return parsed;
      if (parsed.value !== undefined && parsed.value !== null) input[key] = parsed.value;
    }
    for (const key of ['proratedDays', 'periodDays']) {
      const parsed = optIntField(form, key);
      if (!parsed.ok) return parsed;
      if (parsed.value !== undefined) input[key] = parsed.value;
    }
    return { ok: true, value: input };
  },
  async run(ctx: AdminContext, input) {
    const result = await updateDraftBrandInvoice({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(result.invoice.organizationId) });
  },
};

const invoiceIssue: AdminOperation<{ invoiceId: string; memo?: string }> = {
  parse(form) {
    const memo = form.has('memo') ? f.text(form, 'memo') : undefined;
    return {
      ok: true,
      value: {
        invoiceId: f.str(form, 'invoiceId'),
        ...(memo !== undefined ? { memo } : {}),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await issueBrandInvoice({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(result.invoice.organizationId) });
  },
};

const invoiceMarkPaid: AdminOperation<{ invoiceId: string; paidAt?: string; paidMethod: string; memo?: string }> = {
  parse(form) {
    const paidAt = f.str(form, 'paidAt');
    const memo = form.has('memo') ? f.text(form, 'memo') : undefined;
    return {
      ok: true,
      value: {
        invoiceId: f.str(form, 'invoiceId'),
        ...(paidAt ? { paidAt } : {}),
        paidMethod: f.text(form, 'paidMethod'),
        ...(memo !== undefined ? { memo } : {}),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await markBrandInvoicePaid({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('paid', { to: organizationPath(result.invoice.organizationId) });
  },
};

const invoiceVoid: AdminOperation<{ invoiceId: string; reason: string }> = {
  parse(form) {
    return {
      ok: true,
      value: {
        invoiceId: f.str(form, 'invoiceId'),
        reason: f.text(form, 'reason'),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await voidBrandInvoice({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(result.invoice.organizationId) });
  },
};

const grantCreate: AdminOperation<{
  organizationId: string;
  amountKrw: number;
  validMonth: string;
  reason: string;
}> = {
  parse(form) {
    const amount = intField(form, 'amountKrw');
    if (!amount.ok) return amount;
    if (form.has('expiresOn') && f.str(form, 'expiresOn') !== '') {
      return { ok: false, detail: 'expiresOn is not supported; pass validMonth' };
    }
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        amountKrw: amount.value,
        validMonth: f.str(form, 'validMonth'),
        reason: f.text(form, 'reason'),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await grantExtraAllowance({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('created', { detail: result.id, to: organizationPath(input.organizationId) });
  },
};

const grantRevoke: AdminOperation<{ grantId: string; organizationId?: string }> = {
  parse(form) {
    const organizationId = f.str(form, 'organizationId');
    return {
      ok: true,
      value: {
        grantId: f.str(form, 'grantId'),
        ...(organizationId ? { organizationId } : {}),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await revokeExtraAllowance({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(result.organizationId) });
  },
};

export const BRAND_BILLING_OPERATIONS = {
  'brandBilling.planDefault.set': planDefaultSet,
  'brandBilling.planAndAllowance.set': planAndAllowanceSet,
  'brandBilling.discount.grant': discountGrant,
  'brandBilling.discount.end': discountEnd,
  'brandBilling.discountCode.create': discountCodeCreate,
  'brandBilling.discountCode.disable': discountCodeDisable,
  'brandBilling.profile.set': profileSet,
  'brandBilling.invoice.draft': invoiceDraft,
  'brandBilling.invoice.updateDraft': invoiceUpdateDraft,
  'brandBilling.invoice.issue': invoiceIssue,
  'brandBilling.invoice.markPaid': invoiceMarkPaid,
  'brandBilling.invoice.void': invoiceVoid,
  'brandBilling.grant.create': grantCreate,
  'brandBilling.grant.revoke': grantRevoke,
} as const;
