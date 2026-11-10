import { setFeaturePolicy } from '@/lib/brands/entitlements';
import {
  confirmBrandIdentity,
  draftFromTwingsDefaults,
  saveBrandIdentity,
} from '@/lib/brands/identity/service';
import { setPlanAssignment } from '@/lib/brands/plans';
import type { AdminOperation } from './operations';
import { ok, type AdminContext } from './context';
import { brandFailure } from './brand-workspace-operations';
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
    if (!result.ok) return brandFailure(result.code);
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

export const BRAND_ENGINE_OPERATIONS = {
  'brandEngine.featurePolicy': featurePolicy,
  'brandEngine.plan': plan,
  'brandEngine.identityDraft': identityDraft,
  'brandEngine.identityConfirm': identityConfirm,
};
