import {
  addCalendarDays,
  BRAND_INVOICE_OVERDUE_DAYS,
  daysInYearMonth,
  isInvoiceOverdue,
  isValidCalendarDay,
  isValidYearMonth,
  kstDayOf,
  PAID_BRAND_PLAN_IDS,
  planActiveWithGrace,
  type PaidBrandPlanId,
} from '@/lib/brands/billing/math';
import type { BrandBillingMode, BrandPlanAssignment, BrandPlanId } from '@/lib/brands/plans';

/**
 * Pure B2B subscription state machine & calendar engine (docs/BRAND-RECURRING-BILLING.md §5, B1a).
 *
 * Strictly pure: no DB calls, no `process.env`, no `Date.now()`. Every date/grace-day input is
 * passed explicitly so the engine and `planActiveWithGrace` agree by construction.
 *
 * Rules (review rounds 1 and 2):
 * - Only invoices of the subscription's current `epoch` are read (A1).
 * - Covered periods: paid periods and *waived* periods (the latest invoice was voided by an admin after it was
 *   issued, and an earlier period of the epoch is paid). Payments count from their `paid_at` KST day.
 * - Access end (`brand_plan_assignments.ends_on`, exclusive, day 0 of grace in `planActiveWithGrace`):
 *   an unpaid issued invoice -> the `due_on` of the oldest unpaid one; otherwise the first day after the latest
 *   covered period. Nothing paid -> no access, unless access was opened early AND an unpaid invoice exists.
 * - Status is derived from that assignment through `planActiveWithGrace`: not active -> `suspended` (or `ended`
 *   when cancel-flagged); an unpaid invoice past `due_on` -> `past_due`; nothing paid yet -> `pending`.
 * - Billing (draft at D-7, issue on the 1st, resume) runs only when the subscription is billable: not
 *   cancel-flagged, started, paid at least once (or opened early with an unpaid invoice), and in good standing
 *   once the current period's own invoice is issued.
 * - Review round 4: the job owns every subscription draft of the epoch (admins cannot create one or change its
 *   amounts), refreshes it on issue day and issues it. Admin-voided (after issue) periods are never billed.
 * - The job voids (as the system) a never-paid first invoice without early access once its period ended more
 *   than `FIRST_INVOICE_EXPIRY_MARGIN_DAYS` days ago, and its unissued drafts of past periods.
 * - A pending downgrade applies as soon as its period has started and that period's issued or paid invoice
 *   carries the new plan, whoever issued it.
 * - The current period's invoice is a full month when the subscription was billable on that period's 1st
 *   (evaluated from invoices and dates as they were that day), otherwise prorated from today (B4.4). A
 *   pending downgrade applies only with such a full-month invoice (B4.3).
 */

export const SUBSCRIPTION_DRAFT_LEAD_DAYS = 7 as const;
export const TRANSFER_DUE_DAYS = 14 as const;
/** Review round 4, B3: an unpaid first invoice expires only after its period ended this many days ago. */
export const FIRST_INVOICE_EXPIRY_MARGIN_DAYS = 7 as const;

export type BrandSubscriptionStatus = 'pending' | 'active' | 'past_due' | 'suspended' | 'ended';
export type BrandCollectionMethod = 'transfer' | 'card';
export type BrandInvoiceKind = 'subscription' | 'adjustment' | 'prepay' | 'credit_pack';

export interface EngineSubscription {
  status: BrandSubscriptionStatus;
  planId: BrandPlanId;
  pendingPlanId: BrandPlanId | null;
  pendingPlanEffectivePeriod?: string | null;
  collectionMethod: BrandCollectionMethod;
  startedOn: string;
  cancelAtPeriodEnd: boolean;
  activatedBeforePayment: boolean;
  epoch: number;
}

export interface EngineInvoice {
  id: string;
  period: string;
  kind: BrandInvoiceKind;
  coversMonths: number;
  status: 'draft' | 'issued' | 'paid' | 'void';
  planId: BrandPlanId;
  dueOn: string | null;
  issuedAt: string | null;
  subscriptionEpoch: number | null;
  manualAmounts?: boolean;
  paidAt?: string | null;
  voidedAt?: string | null;
  voidedBy?: 'admin' | 'system' | null;
  createdAt?: string | null;
  /** Who created the row (informational; the job owns every subscription draft of the epoch). */
  createdVia?: 'admin' | 'system' | null;
}

export interface SubscriptionCalendar {
  todayKst: string;
  currentPeriod: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextPeriod: string;
  nextIssueDay: string;
  nextDraftOpenDay: string;
  dueOnForToday: string;
}

export type SubscriptionAction =
  | { type: 'applyPendingPlan'; fromPlanId: BrandPlanId; toPlanId: BrandPlanId }
  | { type: 'draft'; period: string; planId: PaidBrandPlanId; prorateFromDay: string | null }
  | { type: 'issue'; period: string; prorateFromDay: string | null; dueOn: string }
  | {
      type: 'syncAssignment';
      planId: PaidBrandPlanId;
      billingMode: BrandBillingMode;
      startedOn: string;
      endsOn: string;
    }
  | { type: 'clearAssignment' }
  | { type: 'void'; invoiceId: string; period: string; reason: 'first_invoice_expired' | 'stale_system_draft' }
  | { type: 'setStatus'; from: BrandSubscriptionStatus; to: Exclude<BrandSubscriptionStatus, 'ended'> }
  | { type: 'end'; reason: string };

export interface SubscriptionEvaluation {
  calendar: SubscriptionCalendar;
  status: BrandSubscriptionStatus;
  /** Exclusive end day (YYYY-MM-DD) written to `brand_plan_assignments.ends_on`, or null when no assignment. */
  accessEnd: string | null;
  hasPlanAccess: boolean;
  oldestUnpaid: EngineInvoice | null;
  /** Exclusive end day of paid subscription coverage (`nextPeriodOf(lastPaidPeriod)-01`). */
  latestPaidEndDay: string | null;
  /** Periods an older epoch's non-void invoice occupies: never drafted, shown to the admin. */
  blockedByOlderEpoch: string[];
  adminVoidedPeriods: string[];
  /** Admin-voided periods after an earlier paid period: covered, never billed (review round 2, item 3). */
  waivedPeriods: string[];
  /** Nothing paid and nothing unpaid in this epoch: only `reissuePeriod` or `cancel` moves it on. */
  needsReissue: boolean;
  actions: SubscriptionAction[];
  skippedReason?: 'sandboxed' | 'project_only';
}

export function isPaidPlanId(planId: string): planId is PaidBrandPlanId {
  return (PAID_BRAND_PLAN_IDS as readonly string[]).includes(planId);
}

/** Extract `YYYY-MM` from `YYYY-MM-DD`. */
export function periodOfDay(day: string): string {
  if (!isValidCalendarDay(day)) throw new RangeError(`invalid calendar day: ${day}`);
  return day.slice(0, 7);
}

export function firstDayOfPeriod(period: string): string {
  if (!isValidYearMonth(period)) throw new RangeError(`invalid period: ${period}`);
  return `${period}-01`;
}

export function lastDayOfPeriod(period: string): string {
  if (!isValidYearMonth(period)) throw new RangeError(`invalid period: ${period}`);
  const days = daysInYearMonth(period);
  return `${period}-${String(days).padStart(2, '0')}`;
}

export function addMonthsToPeriod(period: string, deltaMonths: number): string {
  if (!isValidYearMonth(period) || !Number.isInteger(deltaMonths)) {
    throw new RangeError(`invalid period addition: ${period}, ${deltaMonths}`);
  }
  const year = Number(period.slice(0, 4));
  const monthIdx = Number(period.slice(5, 7)) - 1;
  const total = year * 12 + monthIdx + deltaMonths;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

export function nextPeriodOf(period: string): string {
  return addMonthsToPeriod(period, 1);
}

/** Compute invoice `due_on` (`YYYY-MM-DD`) from issue day (`YYYY-MM-DD`) and collection method. */
export function dueOnForMethod(issueDay: string, method: BrandCollectionMethod): string {
  if (!isValidCalendarDay(issueDay)) throw new RangeError(`invalid issueDay: ${issueDay}`);
  return method === 'transfer' ? addCalendarDays(issueDay, TRANSFER_DUE_DAYS) : issueDay;
}

/**
 * Due date of an invoice (review round 3, items 1 and 3).
 * - A FIRST invoice without early access: `min(max(started_on, issue day, first day of its period) + 14, last
 *   day of its period)`, so the due date never crosses the month end and the first-invoice expiry can never
 *   fire before it. Used at start, at a reissue of a never-paid subscription and when an admin issues a draft by
 *   hand while nothing is paid (see `firstInvoiceRuleApplies`).
 * - Every other invoice (job-issued, hand-issued, first invoice with early access): `max(issue day, first day of
 *   its period) + 14`, so issuing a future month early never makes it due before that month starts.
 * Card (not in this slice) is due on that base day itself.
 */
export function dueOnForInvoice(params: {
  issueDay: string;
  period: string;
  method: BrandCollectionMethod;
  firstInvoiceWithoutEarlyAccess?: { startedOn: string };
}): string {
  const { issueDay, period, method } = params;
  if (!isValidCalendarDay(issueDay)) throw new RangeError(`invalid issueDay: ${issueDay}`);
  const days = method === 'transfer' ? TRANSFER_DUE_DAYS : 0;
  if (params.firstInvoiceWithoutEarlyAccess) {
    const startedOn = params.firstInvoiceWithoutEarlyAccess.startedOn;
    const firstDay = firstDayOfPeriod(period);
    const from = [startedOn, issueDay, firstDay].sort().at(-1)!;
    const due = addCalendarDays(from, days);
    const last = lastDayOfPeriod(period);
    return due < last ? due : last;
  }
  const firstDay = firstDayOfPeriod(period);
  return addCalendarDays(issueDay > firstDay ? issueDay : firstDay, days);
}

/**
 * The first-invoice due rule applies while the epoch has nothing paid and no early access — exactly when an
 * issued invoice expires the day after its period (step 0 of `evaluateSubscription`).
 */
export function firstInvoiceRuleApplies(
  subscription: Pick<EngineSubscription, 'activatedBeforePayment' | 'epoch'>,
  invoices: readonly EngineInvoice[],
): boolean {
  return !subscription.activatedBeforePayment && !invoicesForEpoch(subscription, invoices).some(isPaidCover);
}

/** Proration of `period` starting on `fromDay` (same rule as `proposeProration`); null = full month. */
export function prorationFromDay(
  fromDay: string | null,
  period: string,
): { usedDays: number; totalDays: number } | null {
  if (!fromDay || !isValidCalendarDay(fromDay) || !isValidYearMonth(period)) return null;
  if (!fromDay.startsWith(`${period}-`)) return null;
  const startDay = Number(fromDay.slice(8, 10));
  if (startDay <= 1) return null;
  const totalDays = daysInYearMonth(period);
  return { usedDays: Math.max(1, totalDays - startDay + 1), totalDays };
}

export function subscriptionCalendarForDay(
  todayKst: string,
  method: BrandCollectionMethod = 'transfer',
): SubscriptionCalendar {
  const currentPeriod = periodOfDay(todayKst);
  const currentPeriodStart = firstDayOfPeriod(currentPeriod);
  const currentPeriodEnd = lastDayOfPeriod(currentPeriod);
  const nextPeriod = nextPeriodOf(currentPeriod);
  const nextIssueDay = firstDayOfPeriod(nextPeriod);
  const nextDraftOpenDay = addCalendarDays(nextIssueDay, -SUBSCRIPTION_DRAFT_LEAD_DAYS);
  const dueOnForToday = dueOnForMethod(todayKst, method);
  return {
    todayKst,
    currentPeriod,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriod,
    nextIssueDay,
    nextDraftOpenDay,
    dueOnForToday,
  };
}

function stampKstDay(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return null;
  return kstDayOf(new Date(ms));
}

/** Fallback `due_on` for issued invoices without an explicit `due_on` (legacy 14-day rule from the KST issue day). */
export function effectiveInvoiceDueOn(
  invoice: Pick<EngineInvoice, 'dueOn' | 'issuedAt'>,
): string | null {
  if (invoice.dueOn && isValidCalendarDay(invoice.dueOn)) return invoice.dueOn;
  const issuedDay = stampKstDay(invoice.issuedAt);
  return issuedDay ? addCalendarDays(issuedDay, BRAND_INVOICE_OVERDUE_DAYS) : null;
}

/**
 * Overdue check using `due_on` when present (`todayKst > due_on`), falling back to the legacy
 * 14-day elapsed check (`isInvoiceOverdue`) when `due_on` is null.
 */
export function isInvoiceOverdueWithDueOn(
  invoice: { status: string; issuedAt: string | null; dueOn: string | null },
  todayKst: string,
  now: Date,
): boolean {
  if (invoice.status !== 'issued') return false;
  if (invoice.dueOn && isValidCalendarDay(invoice.dueOn)) {
    return todayKst > invoice.dueOn;
  }
  return isInvoiceOverdue({ status: invoice.status, issuedAt: invoice.issuedAt }, now);
}

/** A1: only invoices of the subscription's current epoch; null-epoch and older-epoch invoices are ignored. */
export function invoicesForEpoch(
  subscription: Pick<EngineSubscription, 'epoch'>,
  invoices: readonly EngineInvoice[],
): EngineInvoice[] {
  return invoices.filter(
    (inv) => inv.subscriptionEpoch !== null && inv.subscriptionEpoch === subscription.epoch,
  );
}

/**
 * Review round 3, item 2: non-void subscription invoices WITHOUT an epoch whose period is at or after the
 * start of the current epoch (for example a month an admin drafted while the flag was off) are adopted into
 * the current epoch before the engine runs. Older non-null epochs are never adopted.
 */
export function invoicesToAdopt(
  subscription: Pick<EngineSubscription, 'startedOn'>,
  invoices: readonly EngineInvoice[],
): EngineInvoice[] {
  const startPeriod = periodOfDay(subscription.startedOn);
  return invoices.filter(
    (inv) => inv.subscriptionEpoch === null && inv.kind === 'subscription' && inv.status !== 'void' && inv.period >= startPeriod,
  );
}

/** Periods from the epoch start onward that a non-void invoice of an OLDER epoch occupies (never adopted). */
export function periodsHeldByOlderEpoch(
  subscription: Pick<EngineSubscription, 'startedOn' | 'epoch'>,
  invoices: readonly EngineInvoice[],
): string[] {
  const startPeriod = periodOfDay(subscription.startedOn);
  return [
    ...new Set(
      invoices
        .filter(
          (inv) =>
            inv.subscriptionEpoch !== null &&
            inv.subscriptionEpoch !== subscription.epoch &&
            inv.kind === 'subscription' &&
            inv.status !== 'void' &&
            inv.period >= startPeriod,
        )
        .map((inv) => inv.period),
    ),
  ].sort();
}

function sortByCreation(list: readonly EngineInvoice[]): EngineInvoice[] {
  return [...list].sort((a, b) => {
    const ca = a.createdAt ?? '';
    const cb = b.createdAt ?? '';
    if (ca !== cb) return ca.localeCompare(cb);
    return a.id.localeCompare(b.id);
  });
}

function coveredMonths(inv: EngineInvoice): number {
  return Math.max(1, Math.min(12, Math.floor(inv.coversMonths || 1)));
}

function isPaidCover(inv: EngineInvoice): boolean {
  return inv.status === 'paid' && (inv.kind === 'subscription' || inv.kind === 'prepay');
}

function periodPaid(epochInvoices: readonly EngineInvoice[], period: string): boolean {
  return epochInvoices.some(
    (inv) => isPaidCover(inv) && inv.period <= period && period <= addMonthsToPeriod(inv.period, coveredMonths(inv) - 1),
  );
}

/**
 * Periods whose most recent subscription invoice of the current epoch an admin voided AFTER it was issued
 * (round 3, item 4). The job never bills such a period by itself. An admin voiding a DRAFT blocks nothing:
 * the period is simply unbilled again.
 */
export function findAdminVoidedPeriods(epochInvoices: readonly EngineInvoice[]): string[] {
  const byPeriod = new Map<string, EngineInvoice[]>();
  for (const inv of epochInvoices) {
    if (inv.kind !== 'subscription') continue;
    const list = byPeriod.get(inv.period) ?? [];
    list.push(inv);
    byPeriod.set(inv.period, list);
  }
  const blocked: string[] = [];
  for (const [period, list] of byPeriod.entries()) {
    const last = sortByCreation(list).at(-1);
    if (last && last.status === 'void' && last.voidedBy === 'admin' && last.issuedAt) blocked.push(period);
  }
  return blocked.sort();
}

function currentSubscriptionInvoice(epochInvoices: readonly EngineInvoice[], period: string): EngineInvoice | null {
  const live = epochInvoices.filter((inv) => inv.kind === 'subscription' && inv.period === period && inv.status !== 'void');
  return sortByCreation(live).at(-1) ?? null;
}

/** Virtual due date of a period an older epoch occupies (round 3, item 2): the 1st of its period + 14 days. */
export function blockedPeriodVirtualDueOn(period: string): string {
  return addCalendarDays(firstDayOfPeriod(period), TRANSFER_DUE_DAYS);
}

/** Review round 4, B3: the first day on which an unpaid first invoice of `period` is expired. */
export function firstInvoiceExpiryDay(period: string): string {
  return addCalendarDays(lastDayOfPeriod(period), FIRST_INVOICE_EXPIRY_MARGIN_DAYS + 1);
}

interface Ledger {
  hasPaid: boolean;
  /** An issued (really sent) invoice is outstanding — older-epoch holds do not count here. */
  hasIssuedUnpaid: boolean;
  /** Oldest unpaid: issued invoices, plus older-epoch holds of started periods. */
  oldestUnpaid: EngineInvoice | null;
  /** Admin voided after issue: never billed by the job. */
  blocked: Set<string>;
  /** Admin voided after issue, after an earlier paid period: covered like a paid period. */
  waived: Set<string>;
  /** Exclusive end of the latest covered period (paid or waived). */
  coverageEnd: string | null;
}

function ledgerOf(
  epochInvoices: readonly EngineInvoice[],
  todayKst: string,
  olderEpochPeriods: ReadonlySet<string> = new Set(),
): Ledger {
  const paid = epochInvoices.filter(isPaidCover);
  const earliestPaid = paid.length > 0 ? [...paid].map((inv) => inv.period).sort()[0]! : null;
  const blocked = new Set(findAdminVoidedPeriods(epochInvoices));
  const waived = new Set([...blocked].filter((period) => earliestPaid !== null && earliestPaid < period));
  const todayPeriod = periodOfDay(todayKst);
  // Unpaid for access and status: issued invoices; older-epoch holds once their period started.
  const unpaid: EngineInvoice[] = epochInvoices.filter(
    (inv) => inv.status === 'issued' && (inv.kind === 'subscription' || inv.kind === 'adjustment'),
  );
  const hasIssuedUnpaid = unpaid.length > 0;
  for (const period of olderEpochPeriods) {
    if (period <= todayPeriod && !periodPaid(epochInvoices, period)) {
      unpaid.push({
        id: `older-epoch-${period}`,
        period,
        kind: 'subscription',
        coversMonths: 1,
        status: 'issued',
        planId: 'b2b_29',
        dueOn: blockedPeriodVirtualDueOn(period),
        issuedAt: null,
        subscriptionEpoch: null,
      });
    }
  }
  const oldestUnpaid =
    unpaid.length === 0
      ? null
      : [...unpaid].sort((a, b) => {
          const dueA = unpaidDueOf(a);
          const dueB = unpaidDueOf(b);
          if (dueA !== dueB) return dueA.localeCompare(dueB);
          if (a.period !== b.period) return a.period.localeCompare(b.period);
          return a.id.localeCompare(b.id);
        })[0]!;
  let coverageEnd: string | null = null;
  const extend = (lastPeriod: string) => {
    const end = firstDayOfPeriod(nextPeriodOf(lastPeriod));
    if (coverageEnd === null || end > coverageEnd) coverageEnd = end;
  };
  for (const inv of paid) extend(addMonthsToPeriod(inv.period, coveredMonths(inv) - 1));
  for (const period of waived) extend(period);
  return { hasPaid: paid.length > 0, hasIssuedUnpaid, oldestUnpaid, blocked, waived, coverageEnd };
}

/** Oldest unpaid = earliest `due_on` (legacy rows without one: issue day + 14), then period, then id. */
function unpaidDueOf(inv: EngineInvoice): string {
  return effectiveInvoiceDueOn(inv) ?? firstDayOfPeriod(inv.period);
}

/** The plan assignment row for an exclusive end day; `started_on` always stays before `ends_on`. */
function assignmentWindow(startedOn: string, endsOn: string): { startedOn: string; endsOn: string } {
  return { startedOn: startedOn < endsOn ? startedOn : addCalendarDays(endsOn, -1), endsOn };
}

interface Standing {
  ledger: Ledger;
  /** The assignment `ends_on` per B4.1, or null when no assignment should exist. */
  endsOn: string | null;
  status: BrandSubscriptionStatus;
}

/**
 * Access opens only after a payment, or early when an admin allowed it and an ISSUED invoice is outstanding.
 * An older-epoch hold counts as unpaid (it shortens access) but never opens access by itself.
 */
function hasAccessBasis(sub: Pick<EngineSubscription, 'activatedBeforePayment'>, ledger: Ledger): boolean {
  return ledger.hasPaid || (sub.activatedBeforePayment && ledger.hasIssuedUnpaid);
}

/** B4.1 status and access end for an invoice set, computed only from invoices and dates. */
function standingOf(
  sub: Pick<EngineSubscription, 'startedOn' | 'cancelAtPeriodEnd' | 'activatedBeforePayment'>,
  epochInvoices: readonly EngineInvoice[],
  todayKst: string,
  graceDays: number,
  olderEpochPeriods: ReadonlySet<string> = new Set(),
): Standing {
  const ledger = ledgerOf(epochInvoices, todayKst, olderEpochPeriods);
  if (!hasAccessBasis(sub, ledger)) {
    // Nothing paid (and no early access with an outstanding invoice): no access; a cancel ends at once.
    return { ledger, endsOn: null, status: sub.cancelAtPeriodEnd ? 'ended' : 'pending' };
  }
  if (!ledger.hasPaid && sub.cancelAtPeriodEnd) return { ledger, endsOn: null, status: 'ended' };
  const unpaidDue = ledger.oldestUnpaid ? unpaidDueOf(ledger.oldestUnpaid) : null;
  const endsOn = unpaidDue ?? ledger.coverageEnd;
  const active = endsOn !== null && planActiveWithGrace(assignmentWindow(sub.startedOn, endsOn), todayKst, graceDays).active;
  if (sub.cancelAtPeriodEnd) {
    if (!active) return { ledger, endsOn: null, status: 'ended' };
    if (!ledger.oldestUnpaid && ledger.coverageEnd !== null && todayKst >= ledger.coverageEnd) {
      return { ledger, endsOn: null, status: 'ended' };
    }
  }
  if (!active) return { ledger, endsOn, status: 'suspended' };
  if (unpaidDue !== null && todayKst > unpaidDue) return { ledger, endsOn, status: 'past_due' };
  if (!ledger.hasPaid) return { ledger, endsOn, status: 'pending' };
  return { ledger, endsOn, status: 'active' };
}

function safeGraceDays(graceDays: number): number {
  return Number.isInteger(graceDays) && graceDays >= 0 ? graceDays : 0;
}

/**
 * Target `brand_plan_assignments.ends_on` (exclusive YYYY-MM-DD) for a subscription, or null when no plan
 * assignment should exist. `todayKst` decides which older-epoch holds already count as unpaid (default: none).
 */
export function computeAccessEnd(params: {
  subscription: Pick<EngineSubscription, 'status' | 'planId' | 'activatedBeforePayment' | 'epoch'>;
  invoices: readonly EngineInvoice[];
  todayKst?: string;
}): string | null {
  const { subscription } = params;
  if (subscription.status === 'ended' || !isPaidPlanId(subscription.planId)) return null;
  const ledger = ledgerOf(invoicesForEpoch(subscription, params.invoices), params.todayKst ?? '0001-01-01');
  if (!hasAccessBasis(subscription, ledger)) return null;
  return ledger.oldestUnpaid ? unpaidDueOf(ledger.oldestUnpaid) : ledger.coverageEnd;
}

/** B4.1 status for `todayKst`, derived from the assignment the engine would write. */
export function computeSubscriptionStatus(params: {
  todayKst: string;
  graceDays: number;
  subscription: Pick<
    EngineSubscription,
    'status' | 'planId' | 'startedOn' | 'cancelAtPeriodEnd' | 'activatedBeforePayment' | 'epoch'
  >;
  invoices: readonly EngineInvoice[];
}): BrandSubscriptionStatus {
  const { subscription } = params;
  if (subscription.status === 'ended') return 'ended';
  if (!isPaidPlanId(subscription.planId)) return subscription.status;
  return standingOf(
    subscription,
    invoicesForEpoch(subscription, params.invoices),
    params.todayKst,
    safeGraceDays(params.graceDays),
  ).status;
}

/** Rebuild the current-epoch invoices as they stood at the end of `targetDay` (KST) from their timestamps. */
export function invoicesAsOfDay(epochInvoices: readonly EngineInvoice[], targetDay: string): EngineInvoice[] {
  const out: EngineInvoice[] = [];
  for (const inv of epochInvoices) {
    const createdDay = stampKstDay(inv.createdAt);
    if (createdDay && createdDay > targetDay) continue;
    const issuedDay = stampKstDay(inv.issuedAt);
    const wasIssued = issuedDay !== null && issuedDay <= targetDay;
    const asDraft: EngineInvoice = { ...inv, status: 'draft', issuedAt: null, dueOn: null, paidAt: null, voidedAt: null, voidedBy: null };
    const asIssued: EngineInvoice = { ...inv, status: 'issued', paidAt: null, voidedAt: null, voidedBy: null };
    if (inv.status === 'paid') {
      const paidDay = stampKstDay(inv.paidAt);
      if (paidDay === null || paidDay <= targetDay) out.push(inv);
      else out.push(wasIssued ? asIssued : asDraft);
    } else if (inv.status === 'void') {
      const voidedDay = stampKstDay(inv.voidedAt);
      if (voidedDay === null || voidedDay <= targetDay) out.push(inv);
      else out.push(wasIssued ? asIssued : asDraft);
    } else if (inv.status === 'issued') {
      out.push(issuedDay !== null && issuedDay > targetDay ? asDraft : inv);
    } else {
      out.push(inv);
    }
  }
  return out;
}

type CurrentPeriodPlan = { kind: 'none' } | { kind: 'draftAndIssue' } | { kind: 'issueDraft'; draft: EngineInvoice };

/**
 * What the job would do with `period` on its own: never a period an admin voided after issue, never a period
 * an older epoch occupies or a period whose billing failed in this run. Every draft of the epoch is the job's.
 */
function planForPeriod(
  epochInvoices: readonly EngineInvoice[],
  ledger: Ledger,
  period: string,
  excluded: ReadonlySet<string> = new Set(),
): CurrentPeriodPlan {
  if (ledger.blocked.has(period) || excluded.has(period) || periodPaid(epochInvoices, period)) return { kind: 'none' };
  const inv = currentSubscriptionInvoice(epochInvoices, period);
  if (!inv) return { kind: 'draftAndIssue' };
  if (inv.status !== 'draft') return { kind: 'none' };
  return { kind: 'issueDraft', draft: inv };
}

function withIssued(
  epochInvoices: readonly EngineInvoice[],
  replaced: EngineInvoice | null,
  issued: EngineInvoice,
): EngineInvoice[] {
  return [...epochInvoices.filter((inv) => inv !== replaced), issued];
}

function hypotheticalIssue(
  sub: Pick<EngineSubscription, 'collectionMethod' | 'epoch'>,
  base: EngineInvoice | null,
  period: string,
  planId: BrandPlanId,
  day: string,
): EngineInvoice {
  return {
    id: base?.id ?? `engine-issue-${period}`,
    period,
    kind: 'subscription',
    coversMonths: 1,
    status: 'issued',
    planId,
    dueOn: dueOnForInvoice({ issueDay: day, period, method: sub.collectionMethod }),
    issuedAt: `${day}T00:00:00+09:00`,
    subscriptionEpoch: sub.epoch,
    manualAmounts: false,
    createdAt: base?.createdAt ?? `${day}T00:00:00+09:00`,
    createdVia: 'system',
  };
}

/**
 * Billable on `day` (B4.2): not cancel-flagged, started, paid once (or opened early with an outstanding
 * invoice), and in good standing once the day's own period invoice is issued.
 */
function billableOnDayFromFacts(
  sub: Pick<EngineSubscription, 'startedOn' | 'cancelAtPeriodEnd' | 'activatedBeforePayment' | 'collectionMethod' | 'epoch' | 'planId'>,
  epochInvoices: readonly EngineInvoice[],
  day: string,
  graceDays: number,
  olderEpochPeriods: ReadonlySet<string> = new Set(),
): boolean {
  if (sub.cancelAtPeriodEnd) return false;
  if (day < sub.startedOn) return false;
  const ledger = ledgerOf(epochInvoices, day, olderEpochPeriods);
  if (!hasAccessBasis(sub, ledger)) return false;
  const period = periodOfDay(day);
  const plan = planForPeriod(epochInvoices, ledger, period, olderEpochPeriods);
  let effective: readonly EngineInvoice[] = epochInvoices;
  if (plan.kind === 'draftAndIssue') {
    effective = withIssued(epochInvoices, null, hypotheticalIssue(sub, null, period, sub.planId, day));
  } else if (plan.kind === 'issueDraft') {
    effective = withIssued(epochInvoices, plan.draft, hypotheticalIssue(sub, plan.draft, period, plan.draft.planId, day));
  }
  const status = standingOf({ ...sub, cancelAtPeriodEnd: false }, effective, day, graceDays, olderEpochPeriods).status;
  return status === 'active' || status === 'past_due' || (status === 'pending' && sub.activatedBeforePayment);
}

/**
 * B4.4: was the subscription billable on `targetDay`, evaluated from the current-epoch invoices as they
 * stood that day (never from the stored status)?
 */
export function wasBillableOnDay(params: {
  targetDay: string;
  graceDays: number;
  subscription: Pick<
    EngineSubscription,
    'planId' | 'startedOn' | 'cancelAtPeriodEnd' | 'activatedBeforePayment' | 'epoch'
  > &
    Partial<Pick<EngineSubscription, 'collectionMethod'>>;
  invoices: readonly EngineInvoice[];
  olderEpochPeriods?: readonly string[];
}): boolean {
  const { targetDay, subscription } = params;
  if (!isPaidPlanId(subscription.planId)) return false;
  const asOf = invoicesAsOfDay(invoicesForEpoch(subscription, params.invoices), targetDay);
  return billableOnDayFromFacts(
    { ...subscription, collectionMethod: subscription.collectionMethod ?? 'transfer' },
    asOf,
    targetDay,
    safeGraceDays(params.graceDays),
    new Set(params.olderEpochPeriods ?? []),
  );
}

/** Nothing paid and nothing outstanding in this epoch (a voided or expired first invoice). */
export function subscriptionNeedsReissue(
  subscription: Pick<EngineSubscription, 'status' | 'epoch'>,
  invoices: readonly EngineInvoice[],
  todayKst = '9999-12-31',
): boolean {
  if (subscription.status === 'ended') return false;
  const ledger = ledgerOf(invoicesForEpoch(subscription, invoices), todayKst);
  return !ledger.hasPaid && ledger.oldestUnpaid === null;
}

/** Waived periods of the current epoch (voided by an admin after issue, after an earlier paid period). */
export function findWaivedPeriods(
  subscription: Pick<EngineSubscription, 'epoch'>,
  invoices: readonly EngineInvoice[],
): string[] {
  const epoch = invoicesForEpoch(subscription, invoices);
  return [...ledgerOf(epoch, '0001-01-01').waived].sort();
}

function pendingPlanEffectiveFrom(sub: EngineSubscription): string {
  return sub.pendingPlanEffectivePeriod ?? nextPeriodOf(periodOfDay(sub.startedOn));
}

function pendingPlanAppliesTo(sub: EngineSubscription, period: string): sub is EngineSubscription & { pendingPlanId: PaidBrandPlanId } {
  return (
    sub.pendingPlanId !== null &&
    isPaidPlanId(sub.pendingPlanId) &&
    sub.pendingPlanId !== sub.planId &&
    period >= pendingPlanEffectiveFrom(sub)
  );
}

/**
 * Review round 4, B1: a pending downgrade is due as soon as its period has started and an issued or paid
 * subscription invoice of a period from the effective period up to today carries the new plan — whoever issued
 * it. Returns the plan to switch to, or null.
 */
export function pendingPlanCarriedByInvoice(
  sub: Pick<EngineSubscription, 'planId' | 'pendingPlanId' | 'pendingPlanEffectivePeriod' | 'startedOn' | 'epoch'>,
  invoices: readonly EngineInvoice[],
  todayKst: string,
): PaidBrandPlanId | null {
  const pending = sub.pendingPlanId;
  if (pending === null || !isPaidPlanId(pending) || pending === sub.planId) return null;
  const from = sub.pendingPlanEffectivePeriod ?? nextPeriodOf(periodOfDay(sub.startedOn));
  const today = periodOfDay(todayKst);
  const carried = invoicesForEpoch(sub, invoices).some(
    (inv) =>
      inv.kind === 'subscription' &&
      (inv.status === 'issued' || inv.status === 'paid') &&
      inv.period >= from &&
      inv.period <= today &&
      inv.planId === pending,
  );
  return carried ? pending : null;
}

/**
 * Review round 4, B3: the day billing of `period` starts when the subscription was not billable on its 1st —
 * the first day (up to today) on which it was billable from the facts as they stood that day (for example the
 * KST day of a late payment), else today.
 */
export function billingStartDayInPeriod(params: {
  todayKst: string;
  graceDays: number;
  subscription: Pick<EngineSubscription, 'planId' | 'startedOn' | 'cancelAtPeriodEnd' | 'activatedBeforePayment' | 'epoch'> &
    Partial<Pick<EngineSubscription, 'collectionMethod'>>;
  invoices: readonly EngineInvoice[];
  olderEpochPeriods?: readonly string[];
}): string | null {
  const period = periodOfDay(params.todayKst);
  if (wasBillableOnDay({ ...params, targetDay: firstDayOfPeriod(period) })) return null;
  for (let day = addCalendarDays(firstDayOfPeriod(period), 1); day < params.todayKst; day = addCalendarDays(day, 1)) {
    if (wasBillableOnDay({ ...params, targetDay: day })) return day;
  }
  return params.todayKst;
}

function endReason(standing: Standing): string {
  if (!standing.ledger.hasPaid) return 'canceled_unpaid';
  return standing.ledger.oldestUnpaid ? 'canceled_unpaid_past_grace' : 'canceled_period_ended';
}

function skipped(
  calendar: SubscriptionCalendar,
  status: BrandSubscriptionStatus,
  accessEnd: string | null,
  skippedReason?: 'sandboxed' | 'project_only',
): SubscriptionEvaluation {
  return {
    calendar,
    status,
    accessEnd,
    hasPlanAccess: false,
    oldestUnpaid: null,
    latestPaidEndDay: null,
    adminVoidedPeriods: [],
    waivedPeriods: [],
    blockedByOlderEpoch: [],
    needsReissue: false,
    actions: [],
    ...(skippedReason ? { skippedReason } : {}),
  };
}

export function evaluateSubscription(params: {
  todayKst: string;
  graceDays: number;
  subscription: EngineSubscription;
  invoices: readonly EngineInvoice[];
  assignment: Pick<BrandPlanAssignment, 'planId' | 'billingMode' | 'startedOn' | 'endsOn'> | null;
  sandboxed?: boolean;
  /** Round 3, item 2: periods an older epoch's non-void invoice occupies (never drafted; counted). */
  olderEpochPeriods?: readonly string[];
  /** Round 3, item 2: periods whose draft/issue failed in this run (not retried; facts still applied). */
  suppressBillingFor?: readonly string[];
  /** Invoice ids whose system void failed in this run. */
  suppressVoidOf?: readonly string[];
}): SubscriptionEvaluation {
  const { todayKst, subscription: sub, assignment, sandboxed = false } = params;
  const calendar = subscriptionCalendarForDay(todayKst, sub.collectionMethod);
  const graceDays = safeGraceDays(params.graceDays);

  // A2: an ended subscription never reads further and never acts.
  if (sub.status === 'ended') return skipped(calendar, 'ended', null);
  if (sandboxed) return skipped(calendar, sub.status, assignment?.endsOn ?? null, 'sandboxed');
  if (!isPaidPlanId(sub.planId)) return skipped(calendar, sub.status, null, 'project_only');

  const olderEpoch = new Set(params.olderEpochPeriods ?? []);
  const excluded = new Set([...olderEpoch, ...(params.suppressBillingFor ?? [])]);
  const suppressVoid = new Set(params.suppressVoidOf ?? []);
  const actions: SubscriptionAction[] = [];
  let working: EngineInvoice[] = invoicesForEpoch(sub, params.invoices);
  let planId: PaidBrandPlanId = sub.planId;

  // 0. System voids: a never-paid first invoice without early access expires once its period ended more than
  //    FIRST_INVOICE_EXPIRY_MARGIN_DAYS ago (its due date is inside that period; a payment made on time can
  //    still be recorded until then); unissued drafts of past periods.
  const nothingPaid = !working.some(isPaidCover);
  for (const inv of [...working]) {
    if (inv.kind !== 'subscription' || inv.period >= calendar.currentPeriod || suppressVoid.has(inv.id)) continue;
    let reason: 'first_invoice_expired' | 'stale_system_draft' | null = null;
    if (inv.status === 'issued' && nothingPaid && !sub.activatedBeforePayment) {
      if (todayKst >= firstInvoiceExpiryDay(inv.period)) reason = 'first_invoice_expired';
    } else if (inv.status === 'draft') reason = 'stale_system_draft';
    if (reason === null) continue;
    actions.push({ type: 'void', invoiceId: inv.id, period: inv.period, reason });
    working = working.map((x) =>
      x === inv ? { ...x, status: 'void', voidedBy: 'system', voidedAt: `${todayKst}T00:00:00+09:00` } : x,
    );
  }

  // 0b. Review round 4, B1: a downgrade follows the invoice that carries it, whoever issued it.
  const carriedPlan = pendingPlanCarriedByInvoice(sub, working, todayKst);
  let pendingApplied = false;
  if (carriedPlan !== null && !excluded.has(calendar.currentPeriod)) {
    actions.push({ type: 'applyPendingPlan', fromPlanId: sub.planId, toPlanId: carriedPlan });
    planId = carriedPlan;
    pendingApplied = true;
  }

  const ledger = ledgerOf(working, todayKst, olderEpoch);
  const billableNow = billableOnDayFromFacts(sub, working, todayKst, graceDays, olderEpoch);
  const current = planForPeriod(working, ledger, calendar.currentPeriod, excluded);

  // 1. The current period's invoice: draft if missing, then issue (B4.3, B4.4).
  if (billableNow && (current.kind === 'draftAndIssue' || current.kind === 'issueDraft')) {
    const fullMonth = wasBillableOnDay({
      targetDay: calendar.currentPeriodStart,
      graceDays,
      subscription: sub,
      invoices: working,
      olderEpochPeriods: [...olderEpoch],
    });
    // B3: a month not billable on its 1st starts on the first billable day from the facts (a late payment's day).
    const prorateFromDay = fullMonth
      ? null
      : billingStartDayInPeriod({ todayKst, graceDays, subscription: sub, invoices: working, olderEpochPeriods: [...olderEpoch] });
    if (fullMonth && !pendingApplied && pendingPlanAppliesTo(sub, calendar.currentPeriod)) {
      actions.push({ type: 'applyPendingPlan', fromPlanId: sub.planId, toPlanId: sub.pendingPlanId });
      planId = sub.pendingPlanId;
    }
    if (current.kind === 'draftAndIssue') {
      actions.push({ type: 'draft', period: calendar.currentPeriod, planId, prorateFromDay });
    }
    const dueOn = dueOnForInvoice({ issueDay: todayKst, period: calendar.currentPeriod, method: sub.collectionMethod });
    actions.push({ type: 'issue', period: calendar.currentPeriod, prorateFromDay, dueOn });
    const base = current.kind === 'issueDraft' ? current.draft : null;
    working = withIssued(working, base, hypotheticalIssue(sub, base, calendar.currentPeriod, planId, todayKst));
  }

  // 2. Next period's draft from D-7 (B4.3: a due downgrade is drafted at the new plan).
  if (billableNow && todayKst >= calendar.nextDraftOpenDay) {
    const next = planForPeriod(working, ledgerOf(working, todayKst, olderEpoch), calendar.nextPeriod, excluded);
    if (next.kind === 'draftAndIssue') {
      const appliedSub: EngineSubscription = planId === sub.planId ? sub : { ...sub, planId, pendingPlanId: null };
      const draftPlan = pendingPlanAppliesTo(appliedSub, calendar.nextPeriod) ? appliedSub.pendingPlanId : planId;
      actions.push({ type: 'draft', period: calendar.nextPeriod, planId: draftPlan, prorateFromDay: null });
      working = [
        ...working,
        {
          id: `engine-draft-${calendar.nextPeriod}`,
          period: calendar.nextPeriod,
          kind: 'subscription',
          coversMonths: 1,
          status: 'draft',
          planId: draftPlan,
          dueOn: null,
          issuedAt: null,
          subscriptionEpoch: sub.epoch,
          manualAmounts: false,
          createdAt: `${todayKst}T00:00:00+09:00`,
          createdVia: 'system',
        },
      ];
    }
  }

  // 3. Status and the plan assignment, both from the invoices after the actions above (B4.1).
  const standing = standingOf(sub, working, todayKst, graceDays, olderEpoch);
  const target =
    standing.status === 'ended' || standing.endsOn === null
      ? null
      : { planId, billingMode: 'invoice' as const, ...assignmentWindow(sub.startedOn, standing.endsOn) };

  if (target === null) {
    if (assignment !== null) actions.push({ type: 'clearAssignment' });
  } else if (
    assignment === null ||
    assignment.planId !== target.planId ||
    assignment.billingMode !== target.billingMode ||
    assignment.startedOn !== target.startedOn ||
    assignment.endsOn !== target.endsOn
  ) {
    actions.push({ type: 'syncAssignment', ...target });
  }

  if (standing.status === 'ended') {
    actions.push({ type: 'end', reason: endReason(standing) });
  } else if (standing.status !== sub.status) {
    actions.push({ type: 'setStatus', from: sub.status, to: standing.status });
  }

  return {
    calendar,
    status: standing.status,
    accessEnd: target?.endsOn ?? null,
    hasPlanAccess: target !== null && planActiveWithGrace(target, todayKst, graceDays).active,
    oldestUnpaid: standing.ledger.oldestUnpaid,
    latestPaidEndDay: standing.ledger.coverageEnd,
    adminVoidedPeriods: [...standing.ledger.blocked].sort(),
    waivedPeriods: [...standing.ledger.waived].sort(),
    blockedByOlderEpoch: [...olderEpoch].filter((p) => p <= calendar.nextPeriod).sort(),
    needsReissue:
      standing.status !== 'ended' &&
      !standing.ledger.hasPaid &&
      standing.ledger.oldestUnpaid === null,
    actions,
  };
}
