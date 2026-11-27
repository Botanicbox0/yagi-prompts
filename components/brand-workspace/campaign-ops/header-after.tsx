'use client';

import { useCallback, useRef, useState } from 'react';
import type { CampaignOpsCopy } from '@/messages/campaign-ops';
import type { ProcessStep } from '../process-stage/model';
import { HowDialog } from './how-dialog';
import s from './campaign-ops.module.css';

export interface CampaignOpsAfterHeaderProps {
  title: string;
  howTitle: string;
  closeLabel: string;
  exampleCaption: string;
  steps: readonly ProcessStep[];
  pic: CampaignOpsCopy['pic'];
  startHref: string;
  ctaLabel: string;
  canRequest: boolean;
}

export function CampaignOpsAfterHeader({
  title,
  howTitle,
  closeLabel,
  exampleCaption,
  steps,
  pic,
  startHref,
  ctaLabel,
  canRequest,
}: CampaignOpsAfterHeaderProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <header className={s.afterHeader} data-campaign-ops-header="">
        <div className={s.afterTitleGroup}>
          <h1 className={s.pageTitle}>{title}</h1>
          <button
            ref={triggerRef}
            type="button"
            className={s.howLink}
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-how-dialog-trigger=""
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className={s.howIcon}>
              <circle cx="8" cy="8" r="6.25" />
              <path d="M6.4 6.2a1.7 1.7 0 0 1 3.2.7c0 1.1-1.6 1.3-1.6 2.3M8 11.4v.1" />
            </svg>
            <span>{howTitle}</span>
          </button>
        </div>
        {canRequest ? (
          <a href={startHref} className="bs-btn" data-variant="solid" data-size="md" data-campaign-ops-start="">
            {ctaLabel}
          </a>
        ) : null}
      </header>

      <HowDialog
        open={open}
        title={howTitle}
        closeLabel={closeLabel}
        exampleCaption={exampleCaption}
        steps={steps}
        pic={pic}
        returnFocusTo={triggerRef}
        onClose={close}
      />
    </>
  );
}
