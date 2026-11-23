import { BUTTON_PRIMARY, ConfirmCheck, INPUT, OpForm, Panel } from '@/components/admin/chrome';
import { StatusPill } from '@/components/admin/patterns';
import { formatAdminTime } from '@/lib/admin/format';
import type { BrandTrialGrantView, BrandWorkspaceApprovalPanel } from '@/lib/brands/billing/workspace-approval';
import { BRAND_TRIAL_CREDITS } from '@/lib/brands/billing/plan-credits';
import { interpolate } from '@/lib/i18n/format';
import type { adminConsoleEn } from '@/messages/admin-console';

type Copy = (typeof adminConsoleEn)['brandOrgDetail']['workspaceApproval'];

/**
 * docs/BRAND-RECURRING-BILLING.md §6.5 (B1b) — the admin organization page's "워크스페이스 승인" card: approved or not
 * (date, who), the trial grant (credits, month, carried remainder, usable-through date, revoked state) and, while not
 * approved, the approve form (`brandWorkspace.approve`, optional memo, confirm check). The page renders it only with
 * `BRAND_WORKSPACE_APPROVAL` on; before migration 0184 it shows the neutral "not migrated" line. Admin-only copy.
 */
export function BrandWorkspaceApprovalCard({
  panel,
  sandboxed,
  organizationId,
  back,
  copy,
  locale,
}: {
  panel: BrandWorkspaceApprovalPanel;
  sandboxed: boolean;
  organizationId: string;
  back: string;
  copy: Copy;
  locale: string;
}) {
  if (!panel.enabled) return null;
  if (!panel.schemaReady) {
    return (
      <Panel title={copy.heading} id="billing-workspace-approval">
        <p className="admin-notice" data-org-approval-unmigrated>
          {copy.unmigrated}
        </p>
      </Panel>
    );
  }
  const { approval, trial } = panel;
  const grantLine = (grant: BrandTrialGrantView, text: string, marker: string) => (
    <div className="flex flex-wrap items-center gap-2" {...{ [marker]: grant.id }}>
      <span>{text}</span>
      <StatusPill tone={grant.revokedAt ? 'hold' : grant.activeNow ? 'done' : 'progress'}>
        {grant.revokedAt ? copy.trialRevoked : grant.activeNow ? copy.trialActive : grant.validMonth}
      </StatusPill>
      {grant.activeNow && <span className="admin-cell-sub">{interpolate(copy.trialDaysLeft, { days: String(grant.daysLeft) })}</span>}
    </div>
  );
  const original = trial.original;
  const carried = trial.carried;

  return (
    <Panel title={copy.heading} id="billing-workspace-approval">
      <div className="grid gap-3 text-xs" data-org-workspace-approval data-approval-state={approval ? 'approved' : 'not_approved'}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={approval ? 'done' : 'hold'}>{approval ? copy.approved : copy.notApproved}</StatusPill>
          {approval && (
            <span>
              {panel.approverEmail
                ? interpolate(copy.approvedBy, { date: formatAdminTime(approval.approvedAt, locale), who: panel.approverEmail })
                : interpolate(copy.approvedByUnknown, { date: formatAdminTime(approval.approvedAt, locale) })}
            </span>
          )}
        </div>
        {approval?.note && (
          <p>
            <span className="opacity-70">{copy.note}: </span>
            {approval.note}
          </p>
        )}

        {approval && (
          <div className="grid gap-1 rounded border border-hairline p-3" data-org-trial>
            <strong>{copy.trialHeading}</strong>
            {original ? (
              <>
                {grantLine(original, interpolate(copy.trialOriginal, { month: original.validMonth, credits: String(original.credits) }), 'data-trial-original')}
                {carried &&
                  grantLine(carried, interpolate(copy.trialCarried, { month: carried.validMonth, credits: String(carried.credits) }), 'data-trial-carried')}
                {!carried && !original.revokedAt && original.carryCheckedAt === null && (
                  <span className="admin-cell-sub">{interpolate(copy.trialCarryPending, { month: original.validMonth })}</span>
                )}
                {!carried && !original.revokedAt && original.carryCheckedAt !== null && (
                  <span className="admin-cell-sub">{copy.trialNothingLeft}</span>
                )}
                <span data-trial-usable-through={trial.usableThrough ?? ''}>
                  {trial.usableThrough ? interpolate(copy.trialUsableThrough, { date: trial.usableThrough }) : copy.trialEnded}
                </span>
              </>
            ) : (
              <span className="admin-empty">{copy.trialNone}</span>
            )}
          </div>
        )}

        {sandboxed ? (
          <p className="admin-notice" data-org-approval-sandboxed>
            {copy.sandboxed}
          </p>
        ) : (
          !approval && (
            <OpForm op="brandWorkspace.approve" back={back} className="grid gap-3">
              <input type="hidden" name="organizationId" value={organizationId} />
              <label className="text-xs">
                <span className="font-semibold block mb-1">{copy.note}</span>
                <input name="note" maxLength={500} className={INPUT} />
              </label>
              <ConfirmCheck label={interpolate(copy.confirm, { credits: String(BRAND_TRIAL_CREDITS) })} />
              <div>
                <button type="submit" className={BUTTON_PRIMARY} data-approval-submit>
                  {copy.approve}
                </button>
              </div>
            </OpForm>
          )
        )}
      </div>
    </Panel>
  );
}
