'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { BillingRequestDialog } from '@/components/brand-billing/billing-request-form';
import s from '@/components/brand-billing/brand-billing.module.css';
import {
  isCycleWindow,
  refillWording,
  windowText,
  withoutLastSentence,
  type AllowanceRefillView,
  type AllowanceWindowView,
} from '@/lib/brand-studio/allowance-window';
import { formatKstDateLabel, type BillingPlanCatalogueItem } from '@/lib/brands/billing-ui';
import { formatCredits } from '@/lib/brand-studio/credits';
import type { BrandBillingCopy } from '@/messages/brand-billing';

function fallbackResetDateKst(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return `${nextY}-${String(nextM).padStart(2, '0')}-01`;
}

// Lightweight fallback used strictly when isolated unit tests mount this component without SSR copy.
function minimalFallbackStudioStates(locale: 'ko' | 'en'): BrandBillingCopy['customer']['studioStates'] {
  return locale === 'en'
    ? {
        closedOneLine: 'Studio creation is not available for this workspace yet. Request a plan to get started.',
        closedCta: 'Request access',
        exhaustedWithQuote:
          'Not enough credits this month ({needed} needed · {left} left). Resets on {resetDate}.',
        exhaustedGeneric: 'This month’s credits are used up. Resets on {resetDate}.',
        // R1 cycle siblings: the same text as `studioStates` in messages/brand-billing.ts.
        exhaustedWithQuoteCycle:
          'Not enough credits for this usage period ({needed} needed · {left} left). Resets on {resetDate}.',
        exhaustedGenericCycle: 'This usage period’s credits are used up. Resets on {resetDate}.',
        exhaustedCta: 'Request extra credits',
        // R4 trial siblings: the same text as `studioStates` in messages/brand-billing.ts.
        exhaustedWithQuoteTrial: 'Not enough trial credits ({needed} needed · {left} left). Please start a plan to continue.',
        exhaustedGenericTrial: "You've used all your trial credits. Please start a plan to continue.",
      }
    : {
        closedOneLine: '이 작업 공간의 제작 기능은 아직 열려 있지 않습니다. 플랜을 신청해 시작해 보세요.',
        closedCta: '이용 신청',
        exhaustedWithQuote: '이번 달 크레딧이 부족합니다 (필요 {needed} · 남음 {left}). 다음 초기화일은 {resetDate}입니다.',
        exhaustedGeneric: '이번 달 크레딧을 모두 사용했습니다. 다음 초기화일은 {resetDate}입니다.',
        // R1 cycle siblings: the same text as `studioStates` in messages/brand-billing.ts.
        exhaustedWithQuoteCycle: '이번 이용 기간 크레딧이 부족합니다 (필요 {needed} · 남음 {left}). 다음 초기화일은 {resetDate}입니다.',
        exhaustedGenericCycle: '이번 이용 기간 크레딧을 모두 사용했습니다. 다음 초기화일은 {resetDate}입니다.',
        exhaustedCta: '추가 크레딧 요청',
        // R4 trial siblings: the same text as `studioStates` in messages/brand-billing.ts.
        exhaustedWithQuoteTrial: '체험 크레딧이 부족합니다 (필요 {needed} · 남음 {left}). 계속 제작하려면 플랜을 시작해 주세요.',
        exhaustedGenericTrial: '체험 크레딧을 모두 사용했습니다. 계속 제작하려면 플랜을 시작해 주세요.',
      };
}

export interface StudioAllowanceNoticeProps {
  kind: 'closed' | 'exhausted';
  organizationId: string;
  organizationName?: string | null;
  locale: 'ko' | 'en';
  billingCopy?: BrandBillingCopy['customer'];
  copy?: BrandBillingCopy['customer'];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  neededCredits?: number | null;
  remainingCredits?: number | null;
  resetsOn?: string | null;
  resetsAt?: string | null;
  /**
   * R1: the allowance window (`StudioAllowanceView.window`). A billing cycle reads "this usage period" and resets on the
   * cycle's end day; without it, or for the calendar month, the words are today's.
   */
  allowanceWindow?: AllowanceWindowView | null;
  /**
   * R4: the refill fact (`StudioAllowanceView.refill`). A trial-only organization reads the trial words (no reset day);
   * extra credits without a trial lose the reset sentence; without it the words are today's.
   */
  allowanceRefill?: AllowanceRefillView | null;
  surface: string;
  solidCta?: boolean;
  className?: string;
}

export function StudioAllowanceNotice({
  kind,
  organizationId,
  locale,
  billingCopy,
  copy,
  planCatalogue,
  neededCredits,
  remainingCredits,
  resetsOn,
  resetsAt,
  allowanceWindow,
  allowanceRefill,
  surface,
  solidCta = false,
  className,
}: StudioAllowanceNoticeProps) {
  const [open, setOpen] = useState(false);
  const c = billingCopy ?? copy;
  const statesCopy = c?.studioStates ?? minimalFallbackStudioStates(locale);
  const cycle = isCycleWindow(allowanceWindow);
  const rawReset = resetsOn?.trim() || (resetsAt ? formatKstDateLabel(resetsAt) : '');
  // A cycle refills on its own end day, never on the calendar's next 1st.
  const resetDate =
    rawReset && rawReset !== '-' ? rawReset : cycle && allowanceWindow?.end ? allowanceWindow.end : fallbackResetDateKst();

  let message: string;
  let ctaLabel: string;
  let intent: 'plan_request' | 'allowance_request';

  if (kind === 'closed') {
    message = statesCopy.closedOneLine;
    ctaLabel = statesCopy.closedCta;
    intent = 'plan_request';
  } else {
    intent = 'allowance_request';
    ctaLabel = statesCopy.exhaustedCta;
    // R4: the trial's words for a trial-only organization; no reset sentence when nothing refills; else today's.
    const refill = refillWording(allowanceRefill);
    const words = (month: string, cycleWords: string, trial: string) =>
      refill.kind === 'trial'
        ? trial
        : refill.kind === 'hidden'
          ? withoutLastSentence(windowText(allowanceWindow, month, cycleWords))
          : windowText(allowanceWindow, month, cycleWords);
    if (typeof neededCredits === 'number' && typeof remainingCredits === 'number') {
      message = words(statesCopy.exhaustedWithQuote, statesCopy.exhaustedWithQuoteCycle, statesCopy.exhaustedWithQuoteTrial)
        .replace('{needed}', formatCredits(neededCredits, locale))
        .replace('{left}', formatCredits(remainingCredits, locale))
        .replace('{resetDate}', resetDate);
    } else {
      message = words(statesCopy.exhaustedGeneric, statesCopy.exhaustedGenericCycle, statesCopy.exhaustedGenericTrial).replace(
        '{resetDate}',
        resetDate,
      );
    }
  }

  return (
    <div
      className={className ? `${s.studioNotice} ${className}` : s.studioNotice}
      role="status"
      data-studio-allowance-notice={kind}
    >
      <p className={s.studioNoticeText}>{message}</p>
      <button
        type="button"
        className={solidCta ? s.ctaPrimary : s.ctaSecondary}
        data-variant={solidCta ? 'solid' : 'ghost'}
        data-studio-allowance-cta={kind}
        onClick={() => {
          if (c) {
            setOpen(true);
          } else if (typeof window !== 'undefined' && organizationId) {
            window.location.assign(`/brand/billing?organizationId=${encodeURIComponent(organizationId)}`);
          }
        }}
      >
        {ctaLabel}
      </button>
      {/*
        The request dialog has its own <form>. This notice sits inside the prompt bar's <form>, and a form
        nested in a form is submitted as the outer one: "요청 전달" pressed 만들기 instead and the request was
        never sent. So the dialog is drawn under <body>, and its submit stops here (React events still climb
        from a portal to the prompt bar).
      */}
      {c && open && typeof document !== 'undefined'
        ? createPortal(
            <div style={{ display: 'contents' }} data-studio-allowance-dialog onSubmit={(event) => event.stopPropagation()}>
              <BillingRequestDialog
                open={open}
                onClose={() => setOpen(false)}
                organizationId={organizationId}
                copy={c.requestForm}
                tierNames={c.planSection.tierNames}
                planCatalogue={planCatalogue}
                vatLabel={c.planSection.vatSeparate}
                locale={locale}
                initialIntent={intent}
                allowIntentSwitch={kind === 'closed'}
                neededCredits={typeof neededCredits === 'number' ? neededCredits : undefined}
                remainingCredits={typeof remainingCredits === 'number' ? remainingCredits : undefined}
                surface={surface}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
