import { setFeaturePolicy } from '@/lib/brands/entitlements';
import {
  confirmBrandIdentity,
  draftFromTwingsDefaults,
  saveBrandIdentity,
} from '@/lib/brands/identity/service';
import { setPlanAssignment, SUBSCRIPTION_MANAGED_PLAN } from '@/lib/brands/plans';
import {
  adminReconcileOrganizationStorage,
  BYTES_PER_GB,
  setOrganizationStorageQuota,
} from '@/lib/brands/storage-quota';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminContext } from './context';
import { brandFailure } from './brand-workspace-operations';
import { asBillingConflict } from './brand-ops-guard';
import { PLAN_DOWNGRADE_CODES } from '@/lib/brands/billing/cycle-invoices';
import * as f from './form';

/**
 * The brand engine's studio-side controls (docs/BRAND-PRODUCT.md §4, §6): which features an
 * organization may use, and which plan it is on. Both forms live on the admin organization page
 * (app/(admin)/admin/brand-workspace/organizations/[id]) and both return there.
 *
 * Parsing only shapes the form; the services decide (admin check, revision check, catalogue check)
 * and their refusals come back through `brandFailure`, so the banner names what was refused.
 */

const organizationPath = (id: string) => `/admin/brand-workspace/organizations/${encodeURIComponent(id)}`;

function revisionOf(form: FormData): number {
  const raw = f.str(form, 'expectedRevision');
  const value = Number(raw);
  return raw !== '' && Number.isInteger(value) && value >= 0 ? value : NaN;
}

interface PolicyInput {
  organizationId: string;
  denied: string[];
  note: string;
  expectedRevision: number;
}

const featurePolicy: AdminOperation<PolicyInput> = {
  parse(form) {
    const expectedRevision = revisionOf(form);
    if (Number.isNaN(expectedRevision)) return { ok: false, detail: 'expectedRevision must be a whole number' };
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        // Unchecked boxes post nothing: an empty list means "open everything" and is a valid save.
        denied: form.getAll('denied').filter((v): v is string => typeof v === 'string'),
        note: f.text(form, 'note'),
        expectedRevision,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await setFeaturePolicy({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return brandFailure(result.code);
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

interface PlanInput {
  organizationId: string;
  planId: string;
  billingMode: string;
  startedOn: string;
  endsOn: string | null;
  seats: number | null;
  note: string;
  expectedRevision: number;
}

const plan: AdminOperation<PlanInput> = {
  parse(form) {
    const expectedRevision = revisionOf(form);
    if (Number.isNaN(expectedRevision)) return { ok: false, detail: 'expectedRevision must be a whole number' };
    const seatsRaw = f.str(form, 'seats');
    const seats = seatsRaw === '' ? null : Number(seatsRaw);
    if (seats !== null && !Number.isInteger(seats)) return { ok: false, detail: 'seats must be a whole number' };
    const endsOn = f.str(form, 'endsOn');
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        planId: f.str(form, 'planId'),
        billingMode: f.str(form, 'billingMode') || 'invoice',
        startedOn: f.str(form, 'startedOn'),
        endsOn: endsOn === '' ? null : endsOn,
        seats,
        note: f.text(form, 'note'),
        expectedRevision,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await setPlanAssignment({ sql: ctx.sql }, ctx.viewer, input);
    // R3 item 8: a plan conflict reads as `billingConflict` (neutral), not as the campaign sentence.
    // Review round 2, item 5: a subscription owns this plan (only possible with BRAND_BILLING_AUTO_ISSUE=on).
    if (!result.ok && result.field === SUBSCRIPTION_MANAGED_PLAN) {
      return fail('billingConflict', `conflict:${SUBSCRIPTION_MANAGED_PLAN}`);
    }
    // B1c: moving the start day under an invoiced cycle (void that invoice first).
    if (!result.ok && result.field === 'cycle_already_invoiced') {
      return fail('billingConflict', 'conflict:cycle_already_invoiced');
    }
    // B1c-3 fix round 1: a higher plan mid-cycle goes through "플랜 올림".
    if (!result.ok && result.field === 'plan_upgrade_required') {
      return fail('billingConflict', 'conflict:plan_upgrade_required');
    }
    // R3 item 7 (+ fix round 1): a lower plan waits for the next cycle (the field names why, the detail the day).
    if (!result.ok && (PLAN_DOWNGRADE_CODES as readonly string[]).includes(result.field ?? '')) {
      return fail('billingConflict', `conflict:${result.field}:${result.detail ?? ''}`);
    }
    if (!result.ok) return asBillingConflict(brandFailure(result.code));
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

interface IdentityDraftInput {
  organizationId: string;
  expectedRevision: number;
  identity?: unknown;
}

const identityDraft: AdminOperation<IdentityDraftInput> = {
  parse(form) {
    const rawRev = f.str(form, 'expectedRevision');
    const expectedRevision = rawRev === '' ? 0 : revisionOf(form);
    if (Number.isNaN(expectedRevision)) {
      return { ok: false, detail: 'expectedRevision must be a whole number' };
    }
    const rawJson = f.text(form, 'identityJson').trim();
    let identity: unknown = undefined;
    if (rawJson.length > 0) {
      try {
        identity = JSON.parse(rawJson);
      } catch {
        return { ok: false, detail: 'identityJson must be valid JSON' };
      }
    }
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        expectedRevision,
        ...(identity !== undefined ? { identity } : {}),
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result =
      input.identity !== undefined
        ? await saveBrandIdentity({ sql: ctx.sql }, ctx.viewer, {
            organizationId: input.organizationId,
            expectedRevision: input.expectedRevision,
            identity: input.identity,
            status: 'draft',
          })
        : await draftFromTwingsDefaults({ sql: ctx.sql }, ctx.viewer, {
            organizationId: input.organizationId,
            expectedRevision: input.expectedRevision,
          });
    if (!result.ok) return brandFailure(result.code);
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

interface IdentityConfirmInput {
  organizationId: string;
  expectedRevision: number;
}

const identityConfirm: AdminOperation<IdentityConfirmInput> = {
  parse(form) {
    const expectedRevision = revisionOf(form);
    if (Number.isNaN(expectedRevision) || expectedRevision < 1) {
      return { ok: false, detail: 'expectedRevision must be a positive integer' };
    }
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        expectedRevision,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await confirmBrandIdentity({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return brandFailure(result.code);
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

interface StorageQuotaInput {
  organizationId: string;
  quotaBytes: number | null;
  retentionDays: number | null;
  note: string;
  expectedRevision: number;
}

const storageQuota: AdminOperation<StorageQuotaInput> = {
  parse(form) {
    const expectedRevision = revisionOf(form);
    if (Number.isNaN(expectedRevision)) return { ok: false, detail: 'expectedRevision must be a whole number' };
    const gbRaw = f.str(form, 'quotaGb');
    let quotaBytes: number | null = null;
    if (gbRaw !== '') {
      const gb = Number(gbRaw);
      if (!Number.isFinite(gb) || gb < 0 || gb > 100_000) {
        return { ok: false, detail: 'quotaGb must be between 0 and 100000' };
      }
      quotaBytes = Math.round(gb * BYTES_PER_GB);
    }
    const retRaw = f.str(form, 'retentionDays');
    let retentionDays: number | null = null;
    if (retRaw !== '') {
      const days = Number(retRaw);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        return { ok: false, detail: 'retentionDays must be a whole number between 1 and 3650' };
      }
      retentionDays = days;
    }
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        quotaBytes,
        retentionDays,
        note: f.text(form, 'note'),
        expectedRevision,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await setOrganizationStorageQuota({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return brandFailure(result.code);
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

const storageReconcile: AdminOperation<{ organizationId: string }> = {
  parse(form) {
    const organizationId = f.str(form, 'organizationId');
    if (!organizationId) return { ok: false, detail: 'organizationId is required' };
    return { ok: true, value: { organizationId } };
  },
  async run(ctx: AdminContext, input) {
    const result = await adminReconcileOrganizationStorage({ sql: ctx.sql }, ctx.viewer, input.organizationId);
    if (!result.ok) return brandFailure(result.code);
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

export const BRAND_ENGINE_OPERATIONS = {
  'brandEngine.featurePolicy': featurePolicy,
  'brandEngine.plan': plan,
  'brandEngine.identityDraft': identityDraft,
  'brandEngine.identityConfirm': identityConfirm,
  'brandEngine.storageQuota': storageQuota,
  'brandEngine.storageReconcile': storageReconcile,
};
