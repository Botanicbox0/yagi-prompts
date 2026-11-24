import { studioEnv } from '@/lib/brand-studio/env';
import { STUDIO_LANES, type StudioLane } from '@/lib/brand-studio/models';
import { loadAllowanceRow, setStudioAllowance } from '@/lib/brand-studio/usage';
import {
  createBrandDiscountCode,
  disableBrandDiscountCode,
  draftBrandInvoice,
  endBrandDiscount,
  grantBrandDiscount,
  grantExtraAllowance,
  issueBrandInvoice,
  loadActiveBrandDiscount,
  markBrandInvoicePaid,
  revokeExtraAllowance,
  saveBrandBillingProfileAdmin,
  setPlanAllowanceDefault,
  setPlanAndAllowance,
  updateDraftBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { BRAND_PLAN_GRACE_DAYS_DEFAULT } from '@/lib/brands/billing/math';
import { syncPlanDefaultSnapshot } from '@/lib/brands/billing/snapshot';
import { loadPlanAssignment, subscriptionManagesPlan, SUBSCRIPTION_MANAGED_PLAN } from '@/lib/brands/plans';
import { previewDigest } from '@/lib/brands/subscriptions/service';
import { formatPlanDefaultPreviewDetail } from './billing-preview-detail';
import { isDbAdmin, UUID_RE, withBillingConflicts } from './brand-ops-guard';
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

function boolAll(form: FormData, name: string): boolean {
  return form.getAll(name).some((value) => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === '1' || normalized === 'true' || normalized === 'on';
  });
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
  clearDefault?: true;
  previewDigest?: string;
}> = {
  parse(form) {
    const clearDefault = form.has('clearDefault') && boolAll(form, 'clearDefault');
    if (clearDefault) {
      const digest = f.str(form, 'previewDigest');
      return {
        ok: true,
        value: {
          planId: f.str(form, 'planId'),
          monthlyCapKrw: null,
          note: f.text(form, 'note'),
          confirm: form.has('confirm') ? boolAll(form, 'confirm') : false,
          clearDefault: true,
          ...(digest ? { previewDigest: digest } : {}),
        },
      };
    }
    const cap = intField(form, 'monthlyCapKrw');
    if (!cap.ok) return { ok: false, detail: 'monthlyCapKrw' };
    return {
      ok: true,
      value: {
        planId: f.str(form, 'planId'),
        monthlyCapKrw: cap.value,
        note: f.text(form, 'note'),
        confirm: form.has('confirm') ? boolAll(form, 'confirm') : false,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const serviceInput = { planId: input.planId, monthlyCapKrw: input.monthlyCapKrw, note: input.note, confirm: input.confirm };
    // Review round 2, item 9: clearing a default is bound to the preview the admin saw (affected organizations
    // and their caps). The confirm must carry the step-1 digest; it is recomputed from current data first.
    if (input.clearDefault && input.confirm) {
      if (!input.previewDigest) return fail('invalid', 'preview_required');
      const current = await setPlanAllowanceDefault({ sql: ctx.sql, env: studioEnv() }, ctx.viewer, {
        ...serviceInput,
        confirm: false,
      });
      if (!current.ok) return billingFailure(current);
      if (current.applied || planDefaultPreviewDigest(current) !== input.previewDigest) {
        return fail('invalid', 'preview_stale');
      }
    }
    const result = await setPlanAllowanceDefault({ sql: ctx.sql, env: studioEnv() }, ctx.viewer, serviceInput);
    if (!result.ok) return billingFailure(result);
    if (!result.applied) {
      // R3 item 1: one formatter (lib/admin/billing-preview-detail.ts); the listed names are bounded so the detail —
      // and the clear's digest at its end — always survives the outcome URL.
      return ok('prepared', {
        detail: formatPlanDefaultPreviewDetail({
          planId: result.planId,
          capKrw: result.monthlyCapKrw,
          affected: result.affectedOrganizations,
          ...(input.clearDefault ? { digest: planDefaultPreviewDigest(result) } : {}),
        }),
      });
    }
    return ok('saved', { detail: String(result.affectedCount) });
  },
};

/** Digest of a plan-default preview: the plan, the new cap and every affected organization's before/after. */
function planDefaultPreviewDigest(preview: {
  planId: string;
  monthlyCapKrw: number | null;
  affectedOrganizations: Array<{ organizationId: string; beforeCapKrw: number; afterCapKrw: number }>;
}): string {
  return previewDigest({
    planId: preview.planId,
    monthlyCapKrw: preview.monthlyCapKrw,
    affected: preview.affectedOrganizations
      .map((o) => `${o.organizationId}:${o.beforeCapKrw}->${o.afterCapKrw}`)
      .sort()
      .join(','),
  });
}

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
    if (!UUID_RE.test(input.organizationId)) return fail('invalid', 'organizationId');
    if (!ctx.viewer.userId || !UUID_RE.test(ctx.viewer.userId)) return brandFailure('sign_in_required');
    if (!(await isDbAdmin(ctx.sql, ctx.viewer))) return brandFailure('forbidden');

    if (input.allowanceMode !== 'plan_default' && input.allowanceMode !== 'override') {
      return fail('invalid', 'allowanceMode');
    }
    const targetMode: 'plan_default' | 'override' = input.allowanceMode;
    if (
      input.preferredLane !== undefined &&
      input.preferredLane !== null &&
      !(STUDIO_LANES as readonly string[]).includes(input.preferredLane)
    ) {
      return fail('invalid', 'preferredLane');
    }
    if (input.allowanceNote.length > 500) {
      return fail('invalid', 'allowanceNote');
    }

    const [existingPlan, existingAllowance] = await Promise.all([
      loadPlanAssignment(ctx.sql, input.organizationId).catch(() => null),
      loadAllowanceRow(ctx.sql, input.organizationId).catch(() => null),
    ]);

    const currentMode: 'plan_default' | 'override' = existingAllowance
      ? existingAllowance.isOverride === false
        ? 'plan_default'
        : 'override'
      : 'plan_default';
    const targetLane = (
      input.preferredLane !== undefined ? input.preferredLane : (existingAllowance?.preferredLane ?? null)
    ) as StudioLane | null;
    const existingLane = existingAllowance?.preferredLane ?? null;
    const allowanceUnchanged =
      targetMode === 'override'
        ? existingAllowance !== null &&
          currentMode === 'override' &&
          input.monthlyCapKrw !== null &&
          existingAllowance.monthlyCapKrw === input.monthlyCapKrw &&
          targetLane === existingLane &&
          input.allowanceNote.trim() === existingAllowance.note.trim()
        : currentMode === 'plan_default' &&
          targetLane === existingLane &&
          input.allowanceNote.trim() === (existingAllowance?.note ?? '').trim();

    async function saveAllowanceWithoutPlanChange(): Promise<AdminOutcome> {
      if (targetMode === 'override') {
        if (input.monthlyCapKrw === null || input.monthlyCapKrw < 0 || input.monthlyCapKrw > 100_000_000) {
          return fail('invalid', 'monthlyCapKrw');
        }
        const allowRes = await setStudioAllowance({ sql: ctx.sql }, ctx.viewer, {
          organizationId: input.organizationId,
          monthlyCapKrw: input.monthlyCapKrw,
          preferredLane: targetLane,
          note: input.allowanceNote,
          forceOverride: true,
        });
        if (!allowRes.ok) return billingFailure(allowRes);
        return ok('saved', { to: organizationPath(input.organizationId) });
      }

      const actorId = ctx.viewer.userId!;
      const txOutcome = await ctx.sql.transaction(async (txSql): Promise<AdminOutcome> => {
        const prof = (
          await txSql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for key share', [
            actorId,
          ])
        ).rows[0];
        if (!prof) return brandFailure('sign_in_required');
        if (prof.is_admin !== true) return brandFailure('forbidden');

        const orgExists = (
          await txSql.query('select id from brand_organizations where id = $1 for update', [input.organizationId])
        ).rows[0];
        if (!orgExists) return brandFailure('not_found');

        await syncPlanDefaultSnapshot(txSql, input.organizationId, actorId, {
          graceDays: studioEnv().planGraceDays ?? BRAND_PLAN_GRACE_DAYS_DEFAULT,
        });

        const hasIsOverride =
          (
            await txSql.query(
              `select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'brand_studio_allowances'
                  and column_name = 'is_override'`,
            )
          ).rows.length > 0;

        if (hasIsOverride) {
          await txSql.query(
            `insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note, updated_by)
             values ($1, 0, false, $2, $3, $4)
             on conflict (organization_id) do update
               set is_override = false,
                   preferred_lane = excluded.preferred_lane,
                   note = excluded.note,
                   updated_by = excluded.updated_by,
                   updated_at = now()`,
            [input.organizationId, targetLane, input.allowanceNote, actorId],
          );
        } else {
          await txSql.query(
            `insert into brand_studio_allowances (organization_id, monthly_cap_krw, preferred_lane, note, updated_by)
             values ($1, 0, $2, $3, $4)
             on conflict (organization_id) do update
               set preferred_lane = excluded.preferred_lane,
                   note = excluded.note,
                   updated_by = excluded.updated_by,
                   updated_at = now()`,
            [input.organizationId, targetLane, input.allowanceNote, actorId],
          );
        }

        return ok('saved', { to: organizationPath(input.organizationId) });
      });
      return txOutcome;
    }

    // Allowance-only path when organization has no plan selected (planId === '').
    if (input.planId === '') {
      if (existingPlan !== null) return fail('invalid', 'planId');
      if (input.expectedRevision !== 0) return brandFailure('conflict');
      if (allowanceUnchanged) {
        return ok('saved', { to: organizationPath(input.organizationId), detail: 'no_change' });
      }
      return saveAllowanceWithoutPlanChange();
    }

    // Review round 2, item 5: while a non-ended subscription owns the plan assignment (flag on, 0182 applied),
    // plan id / billing mode / start / end change only through the subscription screen. Allowance-only
    // changes keep working. Flag off: no query.
    const planFieldsChanged =
      existingPlan === null ||
      input.planId !== existingPlan.planId ||
      input.billingMode !== existingPlan.billingMode ||
      input.startedOn !== existingPlan.startedOn ||
      (input.endsOn ?? null) !== (existingPlan.endsOn ?? null);
    if (planFieldsChanged && (await subscriptionManagesPlan(ctx.sql, input.organizationId))) {
      return fail('brandConflict', `conflict:${SUBSCRIPTION_MANAGED_PLAN}`);
    }

    const planUnchanged =
      existingPlan !== null &&
      input.planId === existingPlan.planId &&
      input.billingMode === existingPlan.billingMode &&
      input.startedOn === existingPlan.startedOn &&
      (input.endsOn ?? null) === (existingPlan.endsOn ?? null) &&
      (input.seats ?? null) === (existingPlan.seats ?? null) &&
      input.planNote.trim() === (existingPlan.note ?? '').trim();

    if (planUnchanged) {
      if (input.expectedRevision !== existingPlan.revision) return brandFailure('conflict');
      if (allowanceUnchanged) {
        return ok('saved', { to: organizationPath(input.organizationId), detail: 'no_change' });
      }
      return saveAllowanceWithoutPlanChange();
    }

    const result = await setPlanAndAllowance({ sql: ctx.sql }, ctx.viewer, {
      ...input,
      monthlyCapKrw: targetMode === 'override' ? input.monthlyCapKrw : null,
    });
    if (!result.ok) return billingFailure(result);
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

const discountGrant: AdminOperation<{
  organizationId: string;
  percent: number;
  invoicesTotal: number | null;
  memo: string;
  confirmReplace: boolean;
}> = {
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
        confirmReplace: boolAll(form, 'confirmReplace'),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    if (!UUID_RE.test(input.organizationId)) return fail('invalid', 'organizationId');
    if (!input.confirmReplace) {
      const existingActive = await loadActiveBrandDiscount(ctx.sql, input.organizationId).catch(() => null);
      if (existingActive) return fail('invalid', 'confirmReplace');
    }
    const result = await grantBrandDiscount({ sql: ctx.sql }, ctx.viewer, {
      organizationId: input.organizationId,
      percent: input.percent,
      invoicesTotal: input.invoicesTotal,
      memo: input.memo,
    });
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

function normalizeValidUntilInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T23:59:59+09:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00+09:00`;
  return trimmed;
}

const discountCodeCreate: AdminOperation<CodeCreateInput> = {
  parse(form) {
    const pct = intField(form, 'percent');
    if (!pct.ok) return pct;
    const total = optIntField(form, 'invoicesTotal');
    if (!total.ok) return total;
    const maxR = optIntField(form, 'maxRedemptions');
    if (!maxR.ok) return maxR;
    const validUntil = normalizeValidUntilInput(f.str(form, 'validUntil'));
    const orgId = f.str(form, 'organizationId');
    const codeRaw = f.str(form, 'code');
    return {
      ok: true,
      value: {
        ...(codeRaw ? { code: codeRaw } : {}),
        percent: pct.value,
        invoicesTotal: total.value ?? null,
        maxRedemptions: maxR.value === undefined ? 1 : maxR.value,
        validUntil,
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
    // B1c: a paid plan organization's form posts `cycle` (current | next) instead of a month.
    const cycle = f.str(form, 'cycle');
    const input: Record<string, unknown> = {
      organizationId: f.str(form, 'organizationId'),
      ...(cycle ? { cycle } : { period: f.str(form, 'period') }),
      memo: f.text(form, 'memo'),
      stay: form.has('stay') ? boolAll(form, 'stay') : false,
    };
    const planId = f.str(form, 'planId');
    if (planId) input.planId = planId;
    if (form.has('applyActiveDiscount')) input.applyActiveDiscount = boolAll(form, 'applyActiveDiscount');
    if (form.has('manualAmounts')) input.manualAmounts = boolAll(form, 'manualAmounts');
    if (form.has('manualReason')) input.manualReason = f.text(form, 'manualReason');
    if (form.has('prorate')) input.prorate = boolAll(form, 'prorate');
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
    const { stay, ...payload } = input;
    const result = await draftBrandInvoice({ sql: ctx.sql }, ctx.viewer, payload);
    if (!result.ok) return billingFailure(result);
    return ok('created', {
      detail: result.invoice.id,
      ...(stay ? {} : { to: organizationPath(result.invoice.organizationId) }),
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
    if (form.has('manualAmounts')) input.manualAmounts = boolAll(form, 'manualAmounts');
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
    return ok('paid', {
      to: organizationPath(result.invoice.organizationId),
      ...(result.accessNotUpdated
        ? { detail: 'subscription_access_not_updated' }
        : result.reconcileDeferred
          ? { detail: 'subscription_reconcile_deferred' }
          : {}),
    });
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
    return ok('saved', {
      to: organizationPath(result.invoice.organizationId),
      ...(result.accessNotUpdated || result.reconcileDeferred ? { detail: 'subscription_void_not_updated' } : {}),
    });
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

/** R3 item 8: every conflict of these operations reads as `billingConflict` (lib/admin/brand-ops-guard.ts). */
export const BRAND_BILLING_OPERATIONS = withBillingConflicts({
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
} as const);
