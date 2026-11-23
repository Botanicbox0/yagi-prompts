import type { BrandPlanId } from '../plans';
import type {
  BrandCollectionMethod,
  BrandInvoiceKind,
  BrandSubscriptionStatus,
} from './engine';

export type BrandSubscriptionFailureCode =
  | 'sign_in_required'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'unavailable'
  | 'disabled'
  | 'not_available_yet';

export type BrandSubscriptionOutcome<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; code: BrandSubscriptionFailureCode; field?: string; detail?: string };

export interface BrandSubscription {
  organizationId: string;
  status: BrandSubscriptionStatus;
  planId: BrandPlanId;
  pendingPlanId: BrandPlanId | null;
  pendingPlanEffectivePeriod: string | null;
  collectionMethod: BrandCollectionMethod;
  startedOn: string;
  prepaidThrough: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  activatedBeforePayment: boolean;
  epoch: number;
  lastReconciledAt: string | null;
  /** Round 3, item 2: consecutive runs with a failed step; reset by a clean run. */
  reconcileFailures: number;
  /** Short code of the last failure (no ids). */
  lastReconcileError: string | null;
  revision: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BrandSubscriptionActorKind = 'admin' | 'system';

export type BrandSubscriptionEventAction =
  | 'started'
  | 'status_changed'
  | 'plan_changed'
  | 'downgrade_scheduled'
  | 'downgrade_cleared'
  | 'cancel_scheduled'
  | 'cancel_undone'
  | 'ended'
  | 'reconciled';

export interface BrandSubscriptionEvent {
  id: string;
  organizationId: string;
  action: BrandSubscriptionEventAction;
  actor: string | null;
  actorKind: BrandSubscriptionActorKind;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export interface ExtendedInvoiceMeta {
  invoiceId: string;
  kind: BrandInvoiceKind;
  coversMonths: number;
  dueOn: string | null;
  collectionMethod: BrandCollectionMethod | null;
  taxInvoiceIssuedOn: string | null;
  taxInvoiceRef: string | null;
  createdVia: BrandSubscriptionActorKind | null;
  issuedVia: BrandSubscriptionActorKind | null;
  subscriptionEpoch: number | null;
}

/** What the admin panel needs beyond the row (review round 2). */
export interface SubscriptionPanelFacts {
  /** `YYYY-MM` of the current cycle's start (or of today while waiting for the first payment). */
  currentPeriod: string;
  /** B1c-2: this cycle `[start, end)`, the next cycle to bill, its draft day, the anchor and access end. */
  currentCycle?: { start: string; end: string } | null;
  nextCycle?: { start: string; end: string } | null;
  nextDraftDay?: string | null;
  anchor?: string | null;
  accessEnd?: string | null;
  oldestUnpaid?: { invoiceId: string; dueOn: string | null } | null;
  /** A first invoice without early access waiting for its payment: its due date and the day it is voided. */
  firstInvoicePending?: { invoiceId: string; dueOn: string; expiresOn: string } | null;
  /** Admin-voided periods after an earlier paid period: covered, not billed. */
  waivedPeriods: string[];
  /** The current cycle was voided by an admin and is waived: show the alert with `reissuePeriod`. */
  currentPeriodWaived: boolean;
  /** Nothing paid and nothing open (voided or expired first invoice): persistent alert, reissue or cancel. */
  needsReissue: boolean;
  /** Nothing paid in this epoch: the cancel confirmation says the unpaid invoice will be voided. */
  nothingPaid: boolean;
  /** Round 3, item 2: periods an older epoch's invoice occupies. */
  blockedByOlderEpoch: string[];
  graceDays: number;
}

export interface BrandSubscriptionTickResult {
  ok: true;
  skipped?: 'disabled' | 'schema_not_ready';
  period?: string;
  checked?: number;
  attempted?: number;
  processed?: number;
  drafted?: number;
  issued?: number;
  /** Invoices the job voided as the system (expired first invoices, stale drafts, null-epoch drafts). */
  voided?: number;
  statusChanged?: number;
  ended?: number;
  skippedIneligible?: number;
  errors?: number;
  noticeEnqueued?: boolean;
  /** Organizations with a failed step in this run (the rest of their reconcile still applied). */
  partialFailures?: number;
  /** Null-epoch issued or paid invoices adopted into a current epoch. */
  adopted?: number;
  /** The daily notice of system voids (from the invoice events of the KST day, whichever path wrote them). */
  voidNoticeEnqueued?: boolean;
  /** Periods held because an older epoch's invoice occupies them. */
  blockedByOlderEpoch?: number;
  /** The daily notice for organizations at 3 or more consecutive failed reconciles (once per KST day + count). */
  failureNoticeEnqueued?: boolean;
  /** B1a-2: the daily notice of suspended subscriptions and pending ones waiting for a reissue. */
  attentionNoticeEnqueued?: boolean;
  /** True when `BRAND_PLAN_GRACE_DAYS` is below 1: access then ends on the due date itself. */
  graceDaysBelowOne?: boolean;
  budgetExhausted?: boolean;
}
