'use client';

import { useState } from 'react';
import { scopedHref } from '@/lib/brands/workspace/selection';
import type { FirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { homeChecklistDismissCookieName } from '@/lib/brands/workspace/home-checklist-cookie';
import type { BrandHomeCopy } from '@/messages/brand-home';
import { buildClosedAllowanceDraft, openBrandSupport } from '../support-trigger';
import s from './home.module.css';

export interface FirstRunChecklistProps {
  organizationId: string;
  organizationName: string;
  checklist: FirstRunChecklistState;
  copy: BrandHomeCopy['checklist'];
  closedRequestDraft?: string;
  closedRequestOrgFallback?: string;
}

function writeDismissedCookie(organizationId: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${homeChecklistDismissCookieName(organizationId)}=1; path=/; max-age=31536000; samesite=lax`;
}

export function FirstRunChecklist({
  organizationId,
  organizationName,
  checklist,
  copy,
  closedRequestDraft = '{organization}',
  closedRequestOrgFallback = 'Brand',
}: FirstRunChecklistProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!checklist.show || dismissed) return null;

  const scope = (path: string) => scopedHref(path, { id: organizationId });
  const requestDraft = buildClosedAllowanceDraft(
    { closedRequestDraft, closedRequestOrgFallback },
    organizationName,
  );
  const assetsDone = checklist.hasLogo && checklist.hasUploads;

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

        <li className={s.checklistItem} data-checklist-done={checklist.usageApproved ? 'true' : 'false'}>
          <div className={s.checklistItemHead}>
            <span className={s.checklistItemTitle}>{copy.usage.title}</span>
            {checklist.usageApproved ? <span className={s.checklistDone}>{copy.doneLabel}</span> : null}
          </div>
          <p className={s.checklistItemBody}>
            {checklist.usageApproved ? copy.usage.readyBody : copy.usage.pendingBody}
          </p>
          {!checklist.usageApproved ? (
            <div className={s.checklistActions}>
              <button
                type="button"
                className={s.checklistLink}
                onClick={() => openBrandSupport({ organizationId, draft: requestDraft })}
                data-home-checklist-request
              >
                {copy.usage.pendingAction}
              </button>
            </div>
          ) : null}
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
    </section>
  );
}
