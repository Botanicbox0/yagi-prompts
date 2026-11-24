'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  BILLING_REQUEST_INTENTS,
  formatKrwAmount,
  type BillingPlanCatalogueItem,
  type BillingRequestIntent,
} from '@/lib/brands/billing-ui';
import type { BrandBillingCopy } from '@/messages/brand-billing';
import s from './brand-billing.module.css';

export type DesiredPlanChoice = 'undecided' | 'b2b_29' | 'b2b_49' | 'b2b_69';

export interface BillingRequestFormProps {
  organizationId: string;
  copy: BrandBillingCopy['customer']['requestForm'];
  tierNames: BrandBillingCopy['customer']['planSection']['tierNames'];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  vatLabel?: string;
  locale?: 'ko' | 'en';
  initialIntent?: BillingRequestIntent;
  initialDesiredPlan?: DesiredPlanChoice;
  initialNote?: string;
  profileCompleteness?: { filled: number; total: number; complete: boolean } | null;
  billingProfileHref?: string;
  surface?: string;
  neededCredits?: number;
  remainingCredits?: number;
  allowIntentSwitch?: boolean;
  /** Intents left out of the switch (e.g. extra credits before the workspace has any allowance). */
  hiddenIntents?: readonly BillingRequestIntent[];
  onSuccess?: (result: {
    id: string;
    noticeKind: string;
    intent: BillingRequestIntent;
  }) => void;
  onClose?: () => void;
}

function makeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
}

const PAID_PLAN_ORDER: readonly Exclude<DesiredPlanChoice, 'undecided'>[] = [
  'b2b_29',
  'b2b_49',
  'b2b_69',
];

export function BillingRequestForm({
  organizationId,
  copy,
  tierNames,
  planCatalogue,
  vatLabel,
  locale = 'ko',
  initialIntent = 'plan_request',
  initialDesiredPlan = 'undecided',
  initialNote = '',
  profileCompleteness,
  billingProfileHref,
  surface = 'billing_page',
  neededCredits,
  remainingCredits,
  allowIntentSwitch = true,
  hiddenIntents,
  onSuccess,
  onClose,
}: BillingRequestFormProps) {
  const [intent, setIntent] = useState<BillingRequestIntent>(initialIntent);
  const [desiredPlan, setDesiredPlan] = useState<DesiredPlanChoice>(initialDesiredPlan);
  const [note, setNote] = useState(initialNote);
  const [requestId, setRequestId] = useState<string>(() => makeRequestId());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const noteId = useId();

  useEffect(() => {
    setIntent(initialIntent);
    setRequestId(makeRequestId());
  }, [initialIntent]);

  useEffect(() => {
    setDesiredPlan(initialDesiredPlan);
    setRequestId(makeRequestId());
  }, [initialDesiredPlan]);

  const intentLabels: Record<BillingRequestIntent, string> = {
    plan_request: copy.titlePlanRequest,
    allowance_request: copy.titleAllowanceRequest,
    plan_question: copy.titlePlanQuestion,
  };

  const vatText = vatLabel ?? (locale === 'en' ? 'excl. VAT' : '부가세 별도');
  const targetProfileHref =
    billingProfileHref ??
    `/brand/billing?organizationId=${encodeURIComponent(organizationId)}#billing-profile`;

  const priceByPlan = new Map<string, number>();
  for (const item of planCatalogue ?? []) {
    priceByPlan.set(item.id, item.monthlyKrw);
  }

  function selectIntent(next: BillingRequestIntent) {
    setIntent(next);
    setError(null);
    setRequestId(makeRequestId());
  }

  function selectDesiredPlan(next: DesiredPlanChoice) {
    setDesiredPlan(next);
    setError(null);
    setRequestId(makeRequestId());
  }

  function handleNoteChange(next: string) {
    setNote(next);
    if (error) {
      setError(null);
    }
    setRequestId(makeRequestId());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/brand-billing/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          intent,
          desiredPlan: intent === 'allowance_request' ? undefined : desiredPlan,
          note: note.trim(),
          surface,
          neededCredits,
          remainingCredits,
          requestId,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        noticeKind?: string;
        code?: string;
      };
      if (!res.ok || !json.ok) {
        if (res.status === 429 || json.code === 'rate_limited') {
          setError(copy.rateLimitedError);
        } else {
          setError(copy.genericError);
        }
        return;
      }
      setSubmitted(true);
      setRequestId(makeRequestId());
      onSuccess?.({
        id: String(json.id ?? ''),
        noticeKind: String(json.noticeKind ?? 'plan_request'),
        intent,
      });
    } catch {
      setError(copy.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className={s.well} data-billing-request-submitted="true" role="status">
        <div className={s.noticeSuccess}>
          <strong>{copy.submittedTitle}</strong>
          <div>{copy.submittedBody}</div>
        </div>
        {onClose ? (
          <div className={s.actionsRow}>
            <button type="button" className={s.ctaSecondary} onClick={onClose}>
              {copy.cancel}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form className={s.field} onSubmit={handleSubmit} data-billing-request-form>
      {allowIntentSwitch ? (
        <div className={s.field}>
          <div className={s.pillGroup} role="radiogroup" aria-label={intentLabels[intent]}>
            {BILLING_REQUEST_INTENTS.filter((item) => !hiddenIntents?.includes(item)).map((item) => {
              const active = intent === item;
              return (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-billing-intent={item}
                  className={active ? `${s.pillOption} ${s.pillOptionActive}` : s.pillOption}
                  onClick={() => selectIntent(item)}
                >
                  {intentLabels[item]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {intent !== 'allowance_request' ? (
        <div className={s.field}>
          <span className={s.fieldLabel}>{copy.desiredPlanLabel}</span>
          <div className={s.pillGroup} role="radiogroup" aria-label={copy.desiredPlanLabel}>
            <button
              type="button"
              role="radio"
              aria-checked={desiredPlan === 'undecided'}
              className={
                desiredPlan === 'undecided'
                  ? `${s.pillOption} ${s.pillOptionActive}`
                  : s.pillOption
              }
              onClick={() => selectDesiredPlan('undecided')}
            >
              {copy.desiredPlanNone}
            </button>
            {PAID_PLAN_ORDER.map((planId) => {
              const active = desiredPlan === planId;
              const monthlyKrw = priceByPlan.get(planId);
              const label =
                typeof monthlyKrw === 'number' && monthlyKrw > 0
                  ? `${tierNames[planId]} · ${formatKrwAmount(monthlyKrw, locale)} (${vatText})`
                  : tierNames[planId];
              return (
                <button
                  key={planId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-desired-plan={planId}
                  className={active ? `${s.pillOption} ${s.pillOptionActive}` : s.pillOption}
                  onClick={() => selectDesiredPlan(planId)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className={s.field}>
        <label className={s.fieldLabel} htmlFor={noteId}>
          {copy.notesLabel}
        </label>
        <textarea
          id={noteId}
          rows={4}
          className={s.textarea}
          value={note}
          placeholder={copy.notesPlaceholder}
          onChange={(e) => handleNoteChange(e.target.value)}
          data-billing-request-note
        />
        <span className={s.dateMeta}>{copy.workspaceReplyNote}</span>
      </div>

      {profileCompleteness ? (
        <div
          className={profileCompleteness.complete ? s.noticeBox : s.noticeWarn}
          data-profile-completeness-status={profileCompleteness.complete ? 'complete' : 'incomplete'}
        >
          <div>
            {profileCompleteness.complete
              ? copy.profileStatusComplete
              : copy.profileStatusIncomplete.replace(
                  '{missing}',
                  String(profileCompleteness.total - profileCompleteness.filled),
                )}
          </div>
          {!profileCompleteness.complete ? (
            <div>
              <a href={targetProfileHref} onClick={onClose}>
                {copy.profileEditLink}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className={s.noticeWarn} role="alert" data-billing-request-error>
          {error}
        </div>
      ) : null}

      <div className={s.actionsRow}>
        {onClose ? (
          <button type="button" className={s.ctaGhost} onClick={onClose}>
            {copy.cancel}
          </button>
        ) : null}
        <button
          type="submit"
          className={s.ctaPrimary}
          disabled={submitting}
          data-variant="solid"
          data-billing-request-submit
        >
          {submitting ? copy.submitting : copy.submitCta}
        </button>
      </div>
    </form>
  );
}

export interface BillingRequestDialogProps extends BillingRequestFormProps {
  open: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BillingRequestDialog({
  open,
  onClose,
  ...formProps
}: BillingRequestDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const panel = panelRef.current;
    if (panel) {
      const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      const preferred =
        panel.querySelector<HTMLElement>('[data-billing-request-note]') ?? focusables[0] ?? panel;
      preferred?.focus?.();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !panel.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const heading =
    formProps.initialIntent === 'allowance_request'
      ? formProps.copy.titleAllowanceRequest
      : formProps.initialIntent === 'plan_question'
        ? formProps.copy.titlePlanQuestion
        : formProps.copy.titlePlanRequest;

  return (
    <div
      className={s.modalBackdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={s.modalPanel}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        data-billing-request-dialog
      >
        <div className={s.modalHead}>
          <h2 className={s.modalTitle}>{heading}</h2>
          <button
            type="button"
            className={s.modalClose}
            aria-label={formProps.copy.cancel}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <BillingRequestForm {...formProps} onClose={onClose} />
      </div>
    </div>
  );
}
