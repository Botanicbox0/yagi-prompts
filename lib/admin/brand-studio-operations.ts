import { setStudioAllowance } from '@/lib/brand-studio/usage';
import type { AdminOperation } from './operations';
import { ok, type AdminContext } from './context';
import { brandFailure } from './brand-workspace-operations';
import * as f from './form';

/**
 * Brand studio v2 allowance (docs/BRAND-STUDIO-V2.md §9): the monthly usage cap in KRW and the
 * preferred execution lane for one organization. The form lives on the admin organization page
 * (lib/admin/brand-studio-allowance-panel.tsx) and returns there. The service re-checks the admin flag
 * on the profile row, the organization and every value.
 */

interface AllowanceInput {
  organizationId: string;
  monthlyCapKrw: number;
  preferredLane: string | null;
  note: string;
}

const organizationPath = (id: string) => `/admin/brand-workspace/organizations/${encodeURIComponent(id)}`;

const allowanceSet: AdminOperation<AllowanceInput> = {
  parse(form) {
    const raw = f.str(form, 'monthlyCapKrw').replace(/[,\s]/g, '');
    const cap = Number(raw);
    if (raw === '' || !Number.isInteger(cap) || cap < 0) return { ok: false, detail: 'monthlyCapKrw must be a whole number of won' };
    const lane = f.str(form, 'preferredLane');
    return {
      ok: true,
      value: { organizationId: f.str(form, 'organizationId'), monthlyCapKrw: cap, preferredLane: lane === '' ? null : lane, note: f.text(form, 'note') },
    };
  },
  async run(ctx: AdminContext, input) {
    const result = await setStudioAllowance({ sql: ctx.sql }, ctx.viewer, input);
    if (!result.ok) return brandFailure(result.code);
    return ok('saved', { to: organizationPath(input.organizationId) });
  },
};

export const BRAND_STUDIO_OPERATIONS = {
  'brand_studio.allowance.set': allowanceSet,
};
