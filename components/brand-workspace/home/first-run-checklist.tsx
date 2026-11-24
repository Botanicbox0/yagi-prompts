'use client';

import { useState } from 'react';
import { BillingRequestDialog } from '@/components/brand-billing/billing-request-form';
import { windowText, type AllowanceWindowView } from '@/lib/brand-studio/allowance-window';
import type { BillingPlanCatalogueItem } from '@/lib/brands/billing-ui';
import type { ChecklistUsageState, FirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { homeChecklistDismissCookieName } from '@/lib/brands/workspace/home-checklist-cookie';
import { scopedHref } from '@/lib/brands/workspace/selection';
import type { BrandBillingCopy } from '@/messages/brand-billing';
import type { BrandHomeCopy } from '@/messages/brand-home';
import s from './home.module.css';

export interface FirstRunChecklistProps {
  organizationId: string;
  organizationName?: string;
  locale?: 'ko' | 'en';
  checklist?: FirstRunChecklistState;
  state?: FirstRunChecklistState;
  copy: BrandHomeCopy['checklist'];
  billingCopy?: BrandBillingCopy['customer'];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  canOpenBilling?: boolean;
  hrefs?: { members?: string; studio?: string; billing?: string };
  closedRequestDraft?: string;
  closedRequestOrgFallback?: string;
  /** R1: the allowance window when the page loaded one; a billing cycle drops "this month" from the ready line. */
  allowanceWindow?: Pick<AllowanceWindowView, 'kind'> | null;
}

function writeDismissedCookie(organizationId: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${homeChecklistDismissCookieName(organizationId)}=1; path=/; max-age=31536000; samesite=lax`;
}

export function FirstRunChecklist({
  organizationId,
  locale,
  checklist: checklistProp,
  state: stateProp,
  copy,
  billingCopy,
  planCatalogue,
  canOpenBilling = true,
  allowanceWindow,
}: FirstRunChecklistProps) {
  const [dismissed, setDismissed] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [localRequested, setLocalRequested] = useState(false);

  const checklist = checklistProp ?? stateProp;
  if (!checklist || !checklist.show || dismissed) return null;

  const scope = (path: string) => scopedHref(path, { id: organizationId });
  const assetsDone = checklist.hasLogo && checklist.hasUploads;
  const resolvedLocale: 'ko' | 'en' = locale ?? (!/[가-힣]/.test(copy.title) ? 'en' : 'ko');
  const usageState: ChecklistUsageState = checklist.usageApproved
    ? 'ready'
    : checklist.usageState === 'requested' || checklist.usageRequestSent || localRequested
      ? 'requested'
      : 'not_requested';

  const usageStatusLabel =
    usageState === 'ready'
      ? copy.usage.readyStatus
      : usageState === 'requested'
        ? copy.usage.requestedStatus
        : copy.usage.pendingStatus;

  const usageBodyText =
    usageState === 'ready'
      ? windowText(allowanceWindow, copy.usage.readyBody, copy.usage.readyBodyCycle)
      : usageState === 'requested'
        ? copy.usage.requestedBody
        : copy.usage.pendingBody;

  const showRequestAction = !checklist.usageApproved;

  return (
    <section className={s.checklist} aria-label={copy.title} data-home-first-run>
      <div className={s.checklistHead}>
        <div>
          <h2 className={s.checklistTitle}>{copy.title}</h2>
          <p className={s.checklistSub}>{copy.subtitle}</p>
        </div>
        <button
          type="button"
          className={s.checklistDismiss}
          onClick={() => {
            writeDismissedCookie(organizationId);
            setDismissed(true);
          }}
          data-home-checklist-dismiss
        >
          {copy.dismiss}
        </button>
      </div>

      <ol className={s.checklistGrid}>
        <li className={s.checklistItem} data-checklist-done={checklist.hasTeammate ? 'true' : 'false'}>
          <div className={s.checklistItemHead}>
            <span className={s.checklistItemTitle}>{copy.invite.title}</span>
            {checklist.hasTeammate ? <span className={s.checklistDone}>{copy.doneLabel}</span> : null}
          </div>
          <p className={s.checklistItemBody}>{copy.invite.body}</p>
          <div className={s.checklistActions}>
            <a href={scope('/brand/members')} className={s.checklistLink}>
              {copy.invite.action}
            </a>
          </div>
        </li>

        <li className={s.checklistItem} data-checklist-done={assetsDone ? 'true' : 'false'}>
          <div className={s.checklistItemHead}>
            <span className={s.checklistItemTitle}>{copy.assets.title}</span>
            {assetsDone ? <span className={s.checklistDone}>{copy.doneLabel}</span> : null}
          </div>
          <p className={s.checklistItemBody}>{copy.assets.body}</p>
          <div className={s.checklistActions}>
            <a href={scope('/brand/settings')} className={s.checklistLink}>
              {copy.assets.logoAction}
            </a>
            <a href={scope('/brand/library')} className={s.checklistLink}>
              {copy.assets.uploadAction}
            </a>
          </div>
        </li>

        <li
          className={s.checklistItem}
          data-checklist-done={checklist.usageApproved ? 'true' : 'false'}
          data-checklist-usage-state={usageState}
        >
          <div className={s.checklistItemHead}>
            <span className={s.checklistItemTitle}>{copy.usage.title}</span>
            <span
              className={checklist.usageApproved ? s.checklistDone : s.checklistStatus}
              data-home-checklist-usage-status={usageState}
            >
              {usageStatusLabel}
            </span>
          </div>
          <p className={s.checklistItemBody}>{usageBodyText}</p>
          <div className={s.checklistActions}>
            {showRequestAction ? (
              <button
                type="button"
                className={s.checklistLink}
                onClick={() => {
                  if (billingCopy) {
                    setRequestOpen(true);
                  } else if (typeof window !== 'undefined') {
                    window.location.assign(scope('/brand/billing'));
                  }
                }}
                data-home-checklist-request
              >
                {usageState === 'requested' ? copy.usage.requestedAction : copy.usage.pendingAction}
              </button>
            ) : null}
            {canOpenBilling ? (
              <a
                href={scope('/brand/billing')}
                className={s.checklistLink}
                data-home-checklist-link="billing"
              >
                {copy.usage.billingLink}
              </a>
            ) : null}
          </div>
        </li>

        <li className={s.checklistItem} data-checklist-done={checklist.hasFirstImage ? 'true' : 'false'}>
          <div className={s.checklistItemHead}>
            <span className={s.checklistItemTitle}>{copy.firstImage.title}</span>
            {checklist.hasFirstImage ? <span className={s.checklistDone}>{copy.doneLabel}</span> : null}
          </div>
          <p className={s.checklistItemBody}>{copy.firstImage.body}</p>
          <div className={s.checklistActions}>
            <a href={scope('/brand/studio')} className={s.checklistLink}>
              {copy.firstImage.action}
            </a>
          </div>
        </li>
      </ol>

      {billingCopy ? (
        <BillingRequestDialog
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          organizationId={organizationId}
          copy={billingCopy.requestForm}
          tierNames={billingCopy.planSection.tierNames}
          planCatalogue={planCatalogue}
          vatLabel={billingCopy.planSection.vatSeparate}
          locale={resolvedLocale}
          initialIntent="plan_request"
          surface="home_checklist"
          onSuccess={({ intent }) => {
            if (intent !== 'plan_question') setLocalRequested(true);
          }}
        />
      ) : null}
    </section>
  );
}
