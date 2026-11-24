import {
  addCalendarDays,
  BRAND_PLAN_GRACE_DAYS_DEFAULT,
  daysInYearMonth,
  formatBusinessRegNo,
  isValidCalendarDay,
  isValidKoreanBusinessRegNo,
  normalizeBusinessRegNo,
  type PaidBrandPlanId,
} from '@/lib/brands/billing/math';
import type { CustomerBrandBillingView } from '@/lib/brands/billing/types';

export interface BillingPlanCatalogueItem {
  id: PaidBrandPlanId;
  monthlyKrw: number;
  rank: 1 | 2 | 3;
}

export type PlanLifecycleState = 'upcoming' | 'active' | 'ending_on' | 'in_grace' | 'ended';

export function resolvePlanLifecycle(
  plan: { startedOn: string; endsOn: string | null; active: boolean; inGrace: boolean },
  todayKst: string,
  graceDays: number = BRAND_PLAN_GRACE_DAYS_DEFAULT,
): { state: PlanLifecycleState; graceUntil: string | null } {
  if (plan.startedOn > todayKst) {
    return { state: 'upcoming', graceUntil: null };
  }
  if (plan.inGrace && plan.endsOn && isValidCalendarDay(plan.endsOn)) {
    const safeGrace = Number.isInteger(graceDays) && graceDays > 0 ? graceDays : 0;
    return {
      state: 'in_grace',
      graceUntil: safeGrace > 0 ? addCalendarDays(plan.endsOn, safeGrace) : plan.endsOn,
    };
  }
  if (plan.active) {
    return {
      state: plan.endsOn ? 'ending_on' : 'active',
      graceUntil: null,
    };
  }
  return { state: 'ended', graceUntil: null };
}

export const BILLING_REQUEST_INTENTS = [
  'plan_request',
  'allowance_request',
  'plan_question',
] as const;
export type BillingRequestIntent = (typeof BILLING_REQUEST_INTENTS)[number];

export interface CustomerExtraGrantView {
  id: string;
  credits: number;
  validMonth: string;
  expiresOn: string;
  /** R4: present only on a trial grant (the original or its carry); `expiresOn` is then the trial's last usable day. */
  kind?: 'trial';
}

export interface CustomerBrandBillingPayload extends CustomerBrandBillingView {
  extraGrants?: CustomerExtraGrantView[];
}

export interface CustomerBillingProfileValues {
  companyLegalName: string;
  businessRegNo: string;
  representativeName: string;
  businessAddress: string;
  taxInvoiceEmail: string;
  contactName: string;
  contactPhone: string;
}

export const BILLING_PROFILE_FIELDS: readonly (keyof CustomerBillingProfileValues)[] = [
  'companyLegalName',
  'businessRegNo',
  'representativeName',
  'businessAddress',
  'taxInvoiceEmail',
  'contactName',
  'contactPhone',
];

export function emptyBillingProfileValues(
  profile?: Partial<CustomerBillingProfileValues> | null,
): CustomerBillingProfileValues {
  return {
    companyLegalName: profile?.companyLegalName ?? '',
    businessRegNo: profile?.businessRegNo ? formatBusinessRegNo(profile.businessRegNo) : '',
    representativeName: profile?.representativeName ?? '',
    businessAddress: profile?.businessAddress ?? '',
    taxInvoiceEmail: profile?.taxInvoiceEmail ?? '',
    contactName: profile?.contactName ?? '',
    contactPhone: profile?.contactPhone ?? '',
  };
}

export function billingProfileCompleteness(
  profile: Partial<CustomerBillingProfileValues> | null | undefined,
): {
  filled: number;
  total: number;
  complete: boolean;
  missingFields: (keyof CustomerBillingProfileValues)[];
} {
  const missingFields: (keyof CustomerBillingProfileValues)[] = [];
  for (const field of BILLING_PROFILE_FIELDS) {
    const raw = String(profile?.[field] ?? '').trim();
    const ok =
      field === 'businessRegNo'
        ? normalizeBusinessRegNo(raw).length === 10
        : raw.length > 0;
    if (!ok) missingFields.push(field);
  }
  const filled = BILLING_PROFILE_FIELDS.length - missingFields.length;
  return {
    filled,
    total: BILLING_PROFILE_FIELDS.length,
    complete: missingFields.length === 0,
    missingFields,
  };
}

export function isValidBillingEmail(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export function validateBillingProfileFieldError(
  values: CustomerBillingProfileValues,
): {
  businessRegNoInvalid: boolean;
  taxInvoiceEmailInvalid: boolean;
} {
  const normalizedReg = normalizeBusinessRegNo(values.businessRegNo);
  const hasAnyRegText = values.businessRegNo.trim().length > 0;
  const businessRegNoInvalid =
    hasAnyRegText && (!/^\d{10}$/.test(normalizedReg) || !isValidKoreanBusinessRegNo(normalizedReg));
  const taxInvoiceEmailInvalid = !isValidBillingEmail(values.taxInvoiceEmail);
  return { businessRegNoInvalid, taxInvoiceEmailInvalid };
}

export function grantExpiryDay(validMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(validMonth)) return validMonth;
  return `${validMonth}-${String(daysInYearMonth(validMonth)).padStart(2, '0')}`;
}

export function formatKrwAmount(amountKrw: number, locale: 'ko' | 'en'): string {
  const rounded = Math.round(Number(amountKrw) || 0);
  if (locale === 'en') {
    return `KRW ${rounded.toLocaleString('en-US')}`;
  }
  return `${rounded.toLocaleString('ko-KR')}원`;
}

export function formatKstDateLabel(value: string | null | undefined): string {
  if (!value) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
