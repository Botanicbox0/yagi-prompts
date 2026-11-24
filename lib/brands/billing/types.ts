import type { BrandBillingMode, BrandPlanId } from '../plans';
import type { AllowanceRefillView, AllowanceWindowView } from '@/lib/brand-studio/allowance-window';
import type { StudioLane } from '@/lib/brand-studio/models';
import type { AllowanceSource } from '@/lib/brand-studio/usage';
import type { PaidBrandPlanId } from './math';

export type BrandBillingFailureCode =
  | 'sign_in_required'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'unavailable'
  | 'rate_limited'
  | 'code_unavailable'
  | 'disabled'
  | 'not_available_yet';

export type BrandBillingOutcome<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; code: BrandBillingFailureCode; field?: string; detail?: string };

export interface BrandPlanAllowanceDefault {
  planId: PaidBrandPlanId;
  monthlyCapKrw: number | null;
  affectedOrgCount: number;
  note: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface BrandPlanDefaultAffectedOrg {
  organizationId: string;
  name: string;
  beforeCapKrw: number;
  afterCapKrw: number;
}

export type BrandDiscountStatus = 'active' | 'ended';
export type BrandDiscountSource = 'admin' | 'code';

export interface BrandDiscount {
  id: string;
  organizationId: string;
  percent: number;
  invoicesTotal: number | null;
  invoicesUsed: number;
  invoicesRemaining: number | null;
  status: BrandDiscountStatus;
  memo: string;
  source: BrandDiscountSource;
  codeId: string | null;
  createdBy: string | null;
  createdAt: string;
  endedAt: string | null;
  endedBy: string | null;
  endReason: string;
}

export interface BrandDiscountCode {
  id: string;
  code: string;
  percent: number;
  invoicesTotal: number | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  validUntil: string | null;
  organizationId: string | null;
  memo: string;
  disabled: boolean;
  disabledBy: string | null;
  disabledAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface BrandBillingProfile {
  organizationId: string;
  companyLegalName: string;
  businessRegNo: string;
  representativeName: string;
  businessAddress: string;
  taxInvoiceEmail: string;
  contactName: string;
  contactPhone: string;
  memo: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export type BrandInvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';
export type BrandInvoiceEventAction =
  | 'drafted'
  | 'edited'
  | 'issued'
  | 'paid'
  | 'voided'
  | 'tax_invoice_recorded'
  | 'adopted';

export interface BrandInvoice {
  id: string;
  organizationId: string;
  period: string;
  planId: BrandPlanId;
  baseListKrw: number;
  listKrw: number;
  proratedDays: number | null;
  periodDays: number | null;
  discountId: string | null;
  discountPercent: number;
  discountKrw: number;
  supplyKrw: number;
  vatKrw: number;
  totalKrw: number;
  manualAmounts: boolean;
  manualReason: string;
  status: BrandInvoiceStatus;
  overdue: boolean;
  issuedAt: string | null;
  issuedBy: string | null;
  paidAt: string | null;
  paidBy: string | null;
  paidMethod: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string;
  memo: string;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  /** B1c: the billing cycle a cycle invoice covers (KST days, end exclusive); absent on calendar-month invoices. */
  cycleStart?: string;
  cycleEnd?: string;
  /** 0182: present only on a non-subscription invoice (adjustment, prepay, credit pack), which covers no days. */
  kind?: string;
}

export interface BrandInvoiceEvent {
  id: string;
  invoiceId: string;
  organizationId: string;
  action: BrandInvoiceEventAction;
  fromStatus: BrandInvoiceStatus | null;
  toStatus: BrandInvoiceStatus;
  snapshot: Record<string, unknown>;
  note: string;
  actorId: string | null;
  createdAt: string;
}

/** `extra`: a manual grant (the column default). `trial`: the workspace-approval trial or its carry. `pack`: reserved. */
export type BrandAllowanceGrantKind = 'extra' | 'trial' | 'pack';

export interface BrandAllowanceGrant {
  id: string;
  organizationId: string;
  amountKrw: number;
  validMonth: string;
  reason: string;
  activeNow: boolean;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  /** Present only with `BRAND_WORKSPACE_APPROVAL=on` on a migrated schema (0184). */
  kind?: BrandAllowanceGrantKind;
  /** The grant this one carries into the next month; present with `kind`. */
  carriedFrom?: string | null;
}

export interface CustomerBrandBillingView {
  organizationId: string;
  plan: {
    id: BrandPlanId;
    name: string;
    monthlyListKrw: number;
    billingMode: BrandBillingMode;
    startedOn: string;
    endsOn: string | null;
    active: boolean;
    inGrace: boolean;
    seats: number | null;
  } | null;
  allowance: {
    capKrw: number;
    baseCapKrw: number;
    extraKrw: number;
    usedKrw: number;
    capCredits: number;
    baseCapCredits: number;
    extraCredits: number;
    usedCredits: number;
    remainingCredits: number;
    source: AllowanceSource;
    resetsOn: string;
    resetsAt: string;
    preferredLane?: StudioLane | null;
    /** R1: the window the allowance runs on (billing cycle or calendar month); decides the usage section's words. */
    window?: AllowanceWindowView;
    /**
     * R4 (lib/brand-studio/allowance-refill.ts): present only when the base cap is 0 and the cap comes from grants —
     * nothing resets on a date; a trial-only organization's trial last day. Absent: today's words.
     */
    refill?: AllowanceRefillView;
  };
  activeDiscount: {
    id: string;
    percent: number;
    invoicesTotal: number | null;
    invoicesUsed: number;
    invoicesRemaining: number | null;
    openEnded: boolean;
    source: BrandDiscountSource;
  } | null;
  invoices: Array<{
    id: string;
    period: string;
    planId: BrandPlanId;
    planName: string;
    baseListKrw: number;
    listKrw: number;
    proratedDays: number | null;
    periodDays: number | null;
    discountPercent: number;
    discountKrw: number;
    supplyKrw: number;
    vatKrw: number;
    totalKrw: number;
    status: Exclude<BrandInvoiceStatus, 'draft'>;
    overdue: boolean;
    issuedAt: string | null;
    paidAt: string | null;
    voidedAt: string | null;
  }>;
  billingProfile: Omit<BrandBillingProfile, 'memo' | 'updatedBy'> | null;
}
