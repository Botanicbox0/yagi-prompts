import { approveWorkspace, type BrandTrialGrant, type BrandWorkspaceApproval } from '@/lib/brands/billing/workspace-approval';
import { brandWorkspaceApprovalOpen } from '@/lib/flags';
import { UUID_RE } from './brand-ops-guard';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import * as f from './form';
import type { AdminOperation } from './operations';

/**
 * docs/BRAND-RECURRING-BILLING.md §6.5 (B1b) — `brandWorkspace.approve`: an admin approves a workspace, which records
 * the approval and grants the one-time trial credits (lib/brands/billing/workspace-approval.ts). Behind
 * `BRAND_WORKSPACE_APPROVAL` (refused with `disabled` while it is off). The form carries the `ConfirmCheck` box
 * (`_confirm`), checked here on the server too. The admin card that posts it is a separate task.
 *
 * Success answers carry the approval and the trial grant for the caller; the banner reads `code` and `detail` only
 * (`workspace_approved`, or `already_approved` for a repeat, which grants nothing).
 */
const organizationPath = (id: string) => `/admin/brand-workspace/organizations/${encodeURIComponent(id)}`;

type ApproveInput = { organizationId: string; note: string; confirmCheck: boolean };

export type WorkspaceApproveOutcome = AdminOutcome & {
  approval?: BrandWorkspaceApproval;
  trialGrant?: BrandTrialGrant | null;
};

function approvalFailure(result: { code: string; field?: string; detail?: string }): AdminOutcome {
  switch (result.code) {
    case 'disabled':
      return fail('disabled');
    case 'unavailable':
      return fail('unknown', 'workspace approval tables not migrated');
    case 'invalid':
      return fail('invalid', result.field ?? 'invalid');
    case 'not_found':
      return fail('notFound', 'not_found');
    case 'forbidden':
    case 'sign_in_required':
      return result.detail ? fail('forbidden', result.detail) : fail('forbidden');
    default:
      return fail('invalid', result.code);
  }
}

const approve: AdminOperation<ApproveInput> = {
  parse(form) {
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        note: f.text(form, 'note'),
        confirmCheck: f.str(form, '_confirm') === '1',
      },
    };
  },
  async run(ctx: AdminContext, input): Promise<WorkspaceApproveOutcome> {
    if (!brandWorkspaceApprovalOpen()) return fail('disabled');
    if (!UUID_RE.test(input.organizationId)) return fail('invalid', 'organizationId');
    if (!input.confirmCheck) return fail('invalid', 'confirmCheck');
    const result = await approveWorkspace({ sql: ctx.sql }, ctx.viewer, { organizationId: input.organizationId, note: input.note });
    if (!result.ok) return approvalFailure(result);
    return {
      ...ok(result.created ? 'created' : 'saved', {
        detail: result.created ? 'workspace_approved' : 'already_approved',
        to: organizationPath(input.organizationId),
      }),
      approval: result.approval,
      trialGrant: result.trialGrant,
    };
  },
};

export const BRAND_WORKSPACE_APPROVAL_OPERATIONS = {
  'brandWorkspace.approve': approve,
} as const;
