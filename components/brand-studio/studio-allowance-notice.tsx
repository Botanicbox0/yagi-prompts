'use client';

import { useState } from 'react';
import { BillingRequestDialog } from '@/components/brand-billing/billing-request-form';
import s from '@/components/brand-billing/brand-billing.module.css';
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
        exhaustedCta: 'Request extra credits',
      }
    : {
        closedOneLine: '이 작업 공간의 제작 기능은 아직 열려 있지 않습니다. 플랜을 신청해 시작해 보세요.',
        closedCta: '이용 신청',
        exhaustedWithQuote: '이번 달 크레딧이 부족합니다 (필요 {needed} · 남음 {left}). 다음 초기화일은 {resetDate}입니다.',
        exhaustedGeneric: '이번 달 크레딧을 모두 사용했습니다. 다음 초기화일은 {resetDate}입니다.',
        exhaustedCta: '추가 크레딧 요청',
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
  surface,
  solidCta = false,
  className,
}: StudioAllowanceNoticeProps) {
  const [open, setOpen] = useState(false);
  const c = billingCopy ?? copy;
  const statesCopy = c?.studioStates ?? minimalFallbackStudioStates(locale);
  const rawReset = resetsOn?.trim() || (resetsAt ? formatKstDateLabel(resetsAt) : '');
  const resetDate = rawReset && rawReset !== '-' ? rawReset : fallbackResetDateKst();

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
    if (typeof neededCredits === 'number' && typeof remainingCredits === 'number') {
      message = statesCopy.exhaustedWithQuote
        .replace('{needed}', formatCredits(neededCredits, locale))
        .replace('{left}', formatCredits(remainingCredits, locale))
        .replace('{resetDate}', resetDate);
    } else {
      message = statesCopy.exhaustedGeneric.replace('{resetDate}', resetDate);
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
      {c ? (
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
      ) : null}
    </div>
  );
}
