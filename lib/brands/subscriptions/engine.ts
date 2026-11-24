import { cycleContaining, cycleStartAt } from '@/lib/brands/billing/cycle';
import {
  addCalendarDays,
  BRAND_INVOICE_OVERDUE_DAYS,
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
 * Pure B2B subscription engine on PLAN-START-DAY CYCLES (docs/BRAND-RECURRING-BILLING.md §5.8, founder decision
 * 2026-11-24; B1c-2). Strictly pure: no DB calls, no `process.env`, no `Date.now()`.
 *
 * - A cycle is one month from the anchor day (`lib/brands/billing/cycle.ts`, KST `[start, end)`), month-end clamp
 *   returning to the anchor day. Invoices carry `cycleStart`/`cycleEnd`; `period` is the `YYYY-MM` of the start.
 * - No proration anywhere: every invoice is the plan's full monthly price.
 * - Due date: `max(issue day, cycle start) + 14` (transfer); a first invoice without a cycle: issue day + 14.
 * - Anchor = the start of the latest run of contiguous cycle invoices of the epoch; the plan assignment's
 *   `started_on` is the anchor (the engine writes it).
 * - First invoice without early access: issued with NO cycle and no access. Paid on KST day P → its cycle becomes
 *   `[P, one month later)` (`setInvoiceCycle`), anchor P. Unpaid when `today > due + 14` → system void.
 * - Early access: cycle 0 starts on the start day; normal unpaid flow (no expiry).
 * - Next cycle: drafted from 7 days before the current cycle's end, issued on/after that boundary while billable
 *   (`active` or `past_due`). Not billable: suspended, ended, cancel-flagged, pending.
 * - Resume: when the subscription was not billable on the boundary (from the facts of that day) and is billable
 *   now, a NEW cycle starts on the first billable day since the boundary (the paid day): new anchor; drafts of
 *   the old anchor are voided. Days in between are never billed.
 * - Access (B4.1): unpaid issued invoice → `ends_on` = due of the oldest unpaid one; otherwise the end of the latest
 *   paid or waived cycle. Status from `planActiveWithGrace`.
 * - Waived: an admin void of an ISSUED cycle invoice after an earlier paid cycle covers that cycle; never billed.
 * - Downgrade: the first cycle starting after it was scheduled carries the new plan; applied when that cycle has
 *   started and its issued/paid invoice carries it.
 */

export const SUBSCRIPTION_DRAFT_LEAD_DAYS = 7 as const;
export const TRANSFER_DUE_DAYS = 14 as const;
/** An unpaid first invoice without early access expires when `today > due_on + 14`. */
export const FIRST_INVOICE_EXPIRY_DAYS = 14 as const;

export type BrandSubscriptionStatus = 'pending' | 'active' | 'past_due' | 'suspended' | 'ended';
export type BrandCollectionMethod = 'transfer' | 'card';
export type BrandInvoiceKind = 'subscription' | 'adjustment' | 'prepay' | 'credit_pack';

export interface EngineSubscription {
  status: BrandSubscriptionStatus;
  planId: BrandPlanId;
  pendingPlanId: BrandPlanId | null;
  /** `YYYY-MM` of the start of the first cycle the downgrade applies to. */
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
  /** First KST day of the invoice's cycle (null: a first invoice still waiting for its payment, or legacy). */
  cycleStart?: string | null;
  /** Exclusive end of the cycle. */
  cycleEnd?: string | null;
  manualAmounts?: boolean;
  paidAt?: string | null;
  voidedAt?: string | null;
  voidedBy?: 'admin' | 'system' | null;
  createdAt?: string | null;
  createdVia?: 'admin' | 'system' | null;
}

export interface Cycle {
  start: string;
  end: string;
}

export interface SubscriptionCycleInfo {
  todayKst: string;
  /** Start of the current run (= plan assignment `started_on`); null before the first payment without a cycle. */
  anchor: string | null;
  /** The cycle of the anchor containing today. */
  currentCycle: Cycle | null;
  /** The next cycle to bill (its start is the next billing day). */
  nextCycle: Cycle | null;
  nextDraftDay: string | null;
}

export type SubscriptionAction =
  | { type: 'setInvoiceCycle'; invoiceId: string; cycleStart: string; cycleEnd: string }
  /** `cycleStart`: the cycle whose invoice carries the new plan (fix round 1, B6: a failure holds that cycle). */
  | { type: 'applyPendingPlan'; fromPlanId: BrandPlanId; toPlanId: BrandPlanId; cycleStart: string }
  | { type: 'draft'; cycleStart: string; cycleEnd: string; period: string; planId: PaidBrandPlanId }
  | { type: 'issue'; cycleStart: string; period: string; dueOn: string }
  | {
      type: 'syncAssignment';
      planId: PaidBrandPlanId;
      billingMode: BrandBillingMode;
      startedOn: string;
      endsOn: string;
    }
  | { type: 'clearAssignment' }
  | {
      type: 'void';
      invoiceId: string;
      period: string;
      cycleStart: string | null;
      reason: 'first_invoice_expired' | 'stale_system_draft';
    }
  | { type: 'setStatus'; from: BrandSubscriptionStatus; to: Exclude<BrandSubscriptionStatus, 'ended'> }
  | { type: 'end'; reason: string };

export interface SubscriptionEvaluation {
  cycle: SubscriptionCycleInfo;
  status: BrandSubscriptionStatus;
  /** Exclusive end day written to `brand_plan_assignments.ends_on`, or null when no assignment. */
  accessEnd: string | null;
  hasPlanAccess: boolean;
  oldestUnpaid: EngineInvoice | null;
  /** Exclusive end of the latest paid or waived cycle. */
  latestPaidEndDay: string | null;
  /** Cycle starts whose latest invoice an admin voided after issue. */
  adminVoidedCycles: string[];
  /** Admin-voided cycles after an earlier paid cycle: covered, never billed. */
  waivedCycles: string[];
  /** Cycle starts an older epoch's non-void invoice occupies (never drafted). */
  blockedByOlderEpoch: string[];
  /** Nothing paid and nothing open in this epoch: only a reissue or a cancel moves it on. */
  needsReissue: boolean;
  /** A first invoice without early access waiting for its payment (no cycle, no access). */
  firstInvoicePending: { invoiceId: string; dueOn: string; expiresOn: string } | null;
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

export function addMonthsToPeriod(period: string, deltaMonths: number): string {
  if (!isValidYearMonth(period) || !Number.isInteger(deltaMonths)) {
    throw new RangeError(`invalid period addition: ${period}, ${deltaMonths}`);
  }
  const year = Number(period.slice(0, 4));
  const monthIdx = Number(period.slice(5, 7)) - 1;
  const total = year * 12 + monthIdx + deltaMonths;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function nextPeriodOf(period: string): string {
  return addMonthsToPeriod(period, 1);
}

/** One month after `start` on its own anchor: the end of cycle 0 that starts on `start`. */
export function oneCycleFrom(start: string): Cycle {
  return { start, end: cycleStartAt(start, 1) };
}

/** The cycle of `anchor` that starts on `start` (its end follows the anchor's day, month-end clamp included). */
export function cycleStartingOn(anchor: string, start: string): Cycle {
  const c = cycleContaining(anchor, start);
  return c && c.start === start ? { start, end: c.end } : oneCycleFrom(start);
}

/**
 * Due date (B1c-2, rule 3): the issue day + 14 (transfer; card: the base day itself); a cycle issued late counts
 * from `max(issue day, cycle start)`. There is no first-invoice exception any more.
 */
export function dueOnForInvoice(params: { issueDay: string; cycleStart?: string | null; method: BrandCollectionMethod }): string {
  const { issueDay, method } = params;
  if (!isValidCalendarDay(issueDay)) throw new RangeError(`invalid issueDay: ${issueDay}`);
  const base = params.cycleStart && params.cycleStart > issueDay ? params.cycleStart : issueDay;
  return method === 'transfer' ? addCalendarDays(base, TRANSFER_DUE_DAYS) : base;
}

/** The first day an unpaid first invoice without early access is voided: `due_on + 15` (`today > due + 14`). */
export function firstInvoiceExpiryDay(dueOn: string): string {
  return addCalendarDays(dueOn, FIRST_INVOICE_EXPIRY_DAYS + 1);
}

/**
 * Nothing paid in the epoch and no early access: a first invoice is issued WITHOUT a cycle and opens nothing until
 * it is paid (rule 4).
 */
export function firstInvoiceRuleApplies(
  subscription: Pick<EngineSubscription, 'activatedBeforePayment' | 'epoch'>,
  invoices: readonly EngineInvoice[],
): boolean {
  return !subscription.activatedBeforePayment && !invoicesForEpoch(subscription, invoices).some(isPaidCover);
}

function stampKstDay(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return null;
  return kstDayOf(new Date(ms));
}

/** Fallback `due_on` for issued invoices without an explicit `due_on` (legacy 14-day rule from the KST issue day). */
export function effectiveInvoiceDueOn(invoice: Pick<EngineInvoice, 'dueOn' | 'issuedAt'>): string | null {
  if (invoice.dueOn && isValidCalendarDay(invoice.dueOn)) return invoice.dueOn;
  const issuedDay = stampKstDay(invoice.issuedAt);
  return issuedDay ? addCalendarDays(issuedDay, BRAND_INVOICE_OVERDUE_DAYS) : null;
}

/** Overdue check using `due_on` when present, else the legacy 14-day check. */
export function isInvoiceOverdueWithDueOn(
  invoice: { status: string; issuedAt: string | null; dueOn: string | null },
  todayKst: string,
  now: Date,
): boolean {
  if (invoice.status !== 'issued') return false;
  if (invoice.dueOn && isValidCalendarDay(invoice.dueOn)) return todayKst > invoice.dueOn;
  return isInvoiceOverdue({ status: invoice.status, issuedAt: invoice.issuedAt }, now);
}

/** A1: only invoices of the subscription's current epoch. */
export function invoicesForEpoch(
  subscription: Pick<EngineSubscription, 'epoch'>,
  invoices: readonly EngineInvoice[],
): EngineInvoice[] {
  return invoices.filter((inv) => inv.subscriptionEpoch !== null && inv.subscriptionEpoch === subscription.epoch);
}

function sortByCreation(list: readonly EngineInvoice[]): EngineInvoice[] {
  return [...list].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
}

function isPaidCover(inv: EngineInvoice): boolean {
  return inv.status === 'paid' && (inv.kind === 'subscription' || inv.kind === 'prepay');
}

const hasCycle = (inv: EngineInvoice): inv is EngineInvoice & { cycleStart: string; cycleEnd: string } =>
  Boolean(inv.cycleStart && inv.cycleEnd);

const overlaps = (a: Cycle, b: Cycle) => a.start < b.end && b.start < a.end;

/**
 * Cycle starts whose most recent subscription invoice of the epoch an admin voided AFTER it was issued. The job
 * never bills such a cycle by itself; voiding a DRAFT blocks nothing.
 */
export function findAdminVoidedCycles(epochInvoices: readonly EngineInvoice[]): string[] {
  const byCycle = new Map<string, EngineInvoice[]>();
  for (const inv of epochInvoices) {
    if (inv.kind !== 'subscription' || !hasCycle(inv)) continue;
    byCycle.set(inv.cycleStart, [...(byCycle.get(inv.cycleStart) ?? []), inv]);
  }
  const out: string[] = [];
  for (const [start, list] of byCycle) {
    const last = sortByCreation(list).at(-1);
    if (last && last.status === 'void' && last.voidedBy === 'admin' && last.issuedAt) out.push(start);
  }
  return out.sort();
}

function latestOfCycle(epochInvoices: readonly EngineInvoice[], start: string): EngineInvoice | null {
  return sortByCreation(epochInvoices.filter((i) => i.kind === 'subscription' && i.cycleStart === start)).at(-1) ?? null;
}

/**
 * The cycles that occupy dates in this epoch: issued and paid cycle invoices, and admin-voided-after-issue cycles
 * (they keep their dates: waived or waiting for a reissue). Drafts do not: a draft is the next cycle waiting to be
 * billed.
 */
function occupiedCycles(epochInvoices: readonly EngineInvoice[]): Cycle[] {
  const starts = new Set<string>();
  const out: Cycle[] = [];
  const blocked = new Set(findAdminVoidedCycles(epochInvoices));
  for (const inv of epochInvoices) {
    if (inv.kind !== 'subscription' || !hasCycle(inv) || starts.has(inv.cycleStart) || inv.status === 'draft') continue;
    if (inv.status === 'void' && !blocked.has(inv.cycleStart)) continue;
    if (inv.status === 'void' && latestOfCycle(epochInvoices, inv.cycleStart) !== inv) continue;
    starts.add(inv.cycleStart);
    out.push({ start: inv.cycleStart, end: inv.cycleEnd });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * The current run: the latest run start (a cycle that no other occupied cycle ends on) that has already begun on
 * `todayKst` — a run that starts later (for example a future cycle adopted from flag-off time) is not the current
 * one — followed by the contiguous chain from it. Its start is the anchor.
 */
export function currentRun(
  epochInvoices: readonly EngineInvoice[],
  todayKst = '9999-12-31',
): { anchor: string; lastEnd: string; cycles: Cycle[] } | null {
  const cycles = occupiedCycles(epochInvoices);
  if (cycles.length === 0) return null;
  const ends = new Set(cycles.map((c) => c.end));
  // B1c-3 (plan upgrade): a cycle shorter than its anchor's cycle was cut by an upgrade, which started a new cycle (a
  // new anchor) on the cut day. The run ends there and the cycle starting on the cut day starts the next run. Without a
  // cut cycle the runs, and therefore everything below, are exactly as before. One pass: every cycle is visited once.
  const byStart = new Map(cycles.map((c) => [c.start, c] as const));
  const runs: { first: Cycle; chain: Cycle[] }[] = [];
  const queue = cycles.filter((c) => !ends.has(c.start));
  for (let i = 0; i < queue.length; i += 1) {
    const first = queue[i]!;
    const chain = [first];
    for (;;) {
      const last = chain.at(-1)!;
      const next = byStart.get(last.end);
      if (!next) break;
      if (cutByUpgrade(first.start, chain.length - 1, last)) {
        queue.push(next);
        break;
      }
      chain.push(next);
    }
    runs.push({ first, chain });
  }
  runs.sort((a, b) => a.first.start.localeCompare(b.first.start));
  const started = runs.filter((r) => r.first.start <= todayKst);
  const picked = (started.length > 0 ? started : runs.slice(0, 1)).at(-1);
  if (!picked) {
    // No run start at all (cannot happen with non-overlapping cycles): the last cycle, as before.
    const last = cycles.at(-1)!;
    return { anchor: last.start, lastEnd: last.end, cycles: [last] };
  }
  return { anchor: picked.first.start, lastEnd: picked.chain.at(-1)!.end, cycles: picked.chain };
}

/** B1c-3: cycle `index` of the run anchored on `anchor` ends before that anchor's cycle would (an upgrade cut it). */
function cutByUpgrade(anchor: string, index: number, cycle: Cycle): boolean {
  // Fast path (no date math): a cycle ending on the anchor's day one month after its start is never shorter than the
  // anchor's cycle (every natural end in that window falls on or before that day). Month-end and cut cycles go below.
  const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7));
  if (cycle.end.slice(8, 10) === anchor.slice(8, 10) && monthIndex(cycle.end) === monthIndex(cycle.start) + 1) return false;
  if (cycleStartAt(anchor, index) === cycle.start) return cycle.end < cycleStartAt(anchor, index + 1);
  const natural = cycleContaining(anchor, cycle.start);
  return natural !== null && cycle.end < natural.end;
}

interface Ledger {
  hasPaid: boolean;
  hasIssuedUnpaid: boolean;
  oldestUnpaid: EngineInvoice | null;
  blocked: Set<string>;
  waived: Set<string>;
  coverageEnd: string | null;
}

function ledgerOf(epochInvoices: readonly EngineInvoice[], todayKst: string, olderEpochCycles: readonly Cycle[] = []): Ledger {
  const paid = epochInvoices.filter(isPaidCover);
  const paidCycles = paid.filter(hasCycle);
  const earliestPaid = paidCycles.length > 0 ? paidCycles.map((i) => i.cycleStart).sort()[0]! : null;
  const blocked = new Set(findAdminVoidedCycles(epochInvoices));
  const waived = new Set([...blocked].filter((start) => earliestPaid !== null && earliestPaid < start));
  const unpaid: EngineInvoice[] = epochInvoices.filter(
    (inv) => inv.status === 'issued' && (inv.kind === 'subscription' || inv.kind === 'adjustment'),
  );
  const hasIssuedUnpaid = unpaid.length > 0;
  for (const c of olderEpochCycles) {
    if (c.start <= todayKst && !paidCycles.some((p) => overlaps(c, { start: p.cycleStart, end: p.cycleEnd }))) {
      unpaid.push({
        id: `older-epoch-${c.start}`,
        period: periodOfDay(c.start),
        kind: 'subscription',
        coversMonths: 1,
        status: 'issued',
        planId: 'b2b_29',
        dueOn: addCalendarDays(c.start, TRANSFER_DUE_DAYS),
        issuedAt: null,
        subscriptionEpoch: null,
        cycleStart: c.start,
        cycleEnd: c.end,
      });
    }
  }
  const dueOf = (inv: EngineInvoice) => effectiveInvoiceDueOn(inv) ?? inv.cycleStart ?? '9999-12-31';
  const oldestUnpaid =
    unpaid.length === 0
      ? null
      : [...unpaid].sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || (a.cycleStart ?? '').localeCompare(b.cycleStart ?? '') || a.id.localeCompare(b.id))[0]!;
  let coverageEnd: string | null = null;
  const extend = (end: string) => {
    if (coverageEnd === null || end > coverageEnd) coverageEnd = end;
  };
  for (const inv of paidCycles) extend(inv.cycleEnd);
  for (const start of waived) {
    const inv = latestOfCycle(epochInvoices, start);
    if (inv && hasCycle(inv)) extend(inv.cycleEnd);
  }
  // Fix round 1, B1: a paid subscription invoice that could not be placed into a cycle (its paid day out of bounds) covers
  // no days and opens nothing; the subscription waits as it was.
  const covering = paid.filter((inv) => inv.kind !== 'subscription' || hasCycle(inv));
  return { hasPaid: covering.length > 0, hasIssuedUnpaid, oldestUnpaid, blocked, waived, coverageEnd };
}

function unpaidDueOf(inv: EngineInvoice): string {
  return effectiveInvoiceDueOn(inv) ?? inv.cycleStart ?? '9999-12-31';
}

function assignmentWindow(startedOn: string, endsOn: string): { startedOn: string; endsOn: string } {
  return { startedOn: startedOn < endsOn ? startedOn : addCalendarDays(endsOn, -1), endsOn };
}

interface Standing {
  ledger: Ledger;
  endsOn: string | null;
  status: BrandSubscriptionStatus;
}

/** Access opens after a payment, or early when an admin allowed it and an ISSUED invoice is outstanding. */
function hasAccessBasis(sub: Pick<EngineSubscription, 'activatedBeforePayment'>, ledger: Ledger): boolean {
  return ledger.hasPaid || (sub.activatedBeforePayment && ledger.hasIssuedUnpaid);
}

function standingOf(
  sub: Pick<EngineSubscription, 'startedOn' | 'cancelAtPeriodEnd' | 'activatedBeforePayment'>,
  epochInvoices: readonly EngineInvoice[],
  todayKst: string,
  graceDays: number,
  anchor: string | null,
  olderEpochCycles: readonly Cycle[] = [],
): Standing {
  const ledger = ledgerOf(epochInvoices, todayKst, olderEpochCycles);
  if (!hasAccessBasis(sub, ledger)) {
    return { ledger, endsOn: null, status: sub.cancelAtPeriodEnd ? 'ended' : 'pending' };
  }
  if (!ledger.hasPaid && sub.cancelAtPeriodEnd) return { ledger, endsOn: null, status: 'ended' };
  const unpaidDue = ledger.oldestUnpaid ? unpaidDueOf(ledger.oldestUnpaid) : null;
  const endsOn = unpaidDue ?? ledger.coverageEnd;
  const startedOn = anchor ?? sub.startedOn;
  const active = endsOn !== null && planActiveWithGrace(assignmentWindow(startedOn, endsOn), todayKst, graceDays).active;
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

/** A paid first invoice without a cycle gets `[paid day, one month later)` (rule 4); the facts use it at once. */
function withFirstPaymentCycle(epochInvoices: readonly EngineInvoice[], todayKst: string): EngineInvoice[] {
  return epochInvoices.map((inv) => {
    if (inv.kind !== 'subscription' || inv.status !== 'paid' || hasCycle(inv)) return inv;
    const start = stampKstDay(inv.paidAt) ?? todayKst;
    return { ...inv, ...{ cycleStart: start, cycleEnd: cycleStartAt(start, 1) } };
  });
}

/** Rebuild the epoch invoices as they stood at the end of `targetDay` (KST) from their timestamps. */
export function invoicesAsOfDay(epochInvoices: readonly EngineInvoice[], targetDay: string): EngineInvoice[] {
  const out: EngineInvoice[] = [];
  for (const inv of epochInvoices) {
    const createdDay = stampKstDay(inv.createdAt);
    if (createdDay && createdDay > targetDay) continue;
    const issuedDay = stampKstDay(inv.issuedAt);
    const wasIssued = issuedDay !== null && issuedDay <= targetDay;
    const asDraft: EngineInvoice = { ...inv, status: 'draft', issuedAt: null, dueOn: null, paidAt: null, voidedAt: null, voidedBy: null };
    const asIssued: EngineInvoice = { ...inv, status: 'issued', paidAt: null, voidedAt: null, voidedBy: null };
    // A first invoice's cycle exists only from its payment on: as of an earlier day it had none.
    const beforePayment = (x: EngineInvoice): EngineInvoice =>
      inv.cycleStart && stampKstDay(inv.paidAt) === inv.cycleStart && issuedDay !== inv.cycleStart
        ? { ...x, cycleStart: null, cycleEnd: null }
        : x;
    if (inv.status === 'paid') {
      const paidDay = stampKstDay(inv.paidAt);
      if (paidDay === null || paidDay <= targetDay) out.push(inv);
      else out.push(beforePayment(wasIssued ? asIssued : asDraft));
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

function hypotheticalIssue(
  sub: Pick<EngineSubscription, 'collectionMethod' | 'epoch'>,
  base: EngineInvoice | null,
  cycle: Cycle,
  planId: BrandPlanId,
  day: string,
): EngineInvoice {
  return {
    id: base?.id ?? `engine-issue-${cycle.start}`,
    period: periodOfDay(cycle.start),
    kind: 'subscription',
    coversMonths: 1,
    status: 'issued',
    planId,
    dueOn: dueOnForInvoice({ issueDay: day, cycleStart: cycle.start, method: sub.collectionMethod }),
    issuedAt: `${day}T00:00:00+09:00`,
    subscriptionEpoch: sub.epoch,
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    manualAmounts: false,
    createdAt: base?.createdAt ?? `${day}T00:00:00+09:00`,
    createdVia: 'system',
  };
}

/**
 * Billable on `day` (rule 6): not cancel-flagged, started, and `active` or `past_due` once the cycle that starts on
 * `boundary` is (hypothetically) issued that day — `pending`, `suspended` and `ended` are not billable.
 */
function billableOnDayFromFacts(
  sub: Pick<EngineSubscription, 'startedOn' | 'cancelAtPeriodEnd' | 'activatedBeforePayment' | 'collectionMethod' | 'epoch' | 'planId'>,
  epochInvoices: readonly EngineInvoice[],
  day: string,
  graceDays: number,
  cycle: Cycle | null,
  olderEpochCycles: readonly Cycle[] = [],
): boolean {
  if (sub.cancelAtPeriodEnd || day < sub.startedOn) return false;
  const facts = withFirstPaymentCycle(epochInvoices, day);
  let effective: readonly EngineInvoice[] = facts;
  if (cycle) {
    const existing = facts.find((i) => i.kind === 'subscription' && i.cycleStart === cycle.start && i.status !== 'void');
    if (!existing || existing.status === 'draft') {
      effective = [...facts.filter((i) => i !== existing), hypotheticalIssue(sub, existing ?? null, cycle, sub.planId, day)];
    }
  }
  const anchor = currentRun(effective, day)?.anchor ?? null;
  const status = standingOf({ ...sub, cancelAtPeriodEnd: false }, effective, day, graceDays, anchor, olderEpochCycles).status;
  return status === 'active' || status === 'past_due';
}

/**
 * Was the subscription billable on `targetDay` for the cycle starting on `boundary`, from the invoices as they
 * stood that day (never from the stored status)?
 */
export function wasBillableOnDay(params: {
  targetDay: string;
  graceDays: number;
  subscription: Pick<EngineSubscription, 'planId' | 'startedOn' | 'cancelAtPeriodEnd' | 'activatedBeforePayment' | 'epoch'> &
    Partial<Pick<EngineSubscription, 'collectionMethod'>>;
  invoices: readonly EngineInvoice[];
  cycle?: Cycle | null;
}): boolean {
  if (!isPaidPlanId(params.subscription.planId)) return false;
  const asOf = invoicesAsOfDay(invoicesForEpoch(params.subscription, params.invoices), params.targetDay);
  return billableOnDayFromFacts(
    { ...params.subscription, collectionMethod: params.subscription.collectionMethod ?? 'transfer' },
    asOf,
    params.targetDay,
    safeGraceDays(params.graceDays),
    params.cycle ?? null,
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

function pendingPlanEffectiveFrom(sub: Pick<EngineSubscription, 'pendingPlanEffectivePeriod' | 'startedOn'>): string {
  return sub.pendingPlanEffectivePeriod ?? nextPeriodOf(periodOfDay(sub.startedOn));
}

/** The plan in force for the cycle starting on `start` (a due downgrade from its cycle on). */
function planForCycle(sub: EngineSubscription, start: string): PaidBrandPlanId {
  const pending = sub.pendingPlanId;
  if (pending !== null && isPaidPlanId(pending) && pending !== sub.planId && periodOfDay(start) >= pendingPlanEffectiveFrom(sub)) {
    return pending;
  }
  return sub.planId as PaidBrandPlanId;
}

/**
 * A pending downgrade is due as soon as a cycle from its effective one on has started and that cycle's issued or
 * paid invoice carries the new plan, whoever issued it. Returns the plan to switch to, or null.
 */
export function pendingPlanCarriedByInvoice(
  sub: Pick<EngineSubscription, 'planId' | 'pendingPlanId' | 'pendingPlanEffectivePeriod' | 'startedOn' | 'epoch'>,
  invoices: readonly EngineInvoice[],
  todayKst: string,
): PaidBrandPlanId | null {
  return pendingPlanCarrier(sub, invoices, todayKst)?.planId ?? null;
}

/** The started cycle whose issued or paid invoice carries the scheduled plan, if any. */
function pendingPlanCarrier(
  sub: Pick<EngineSubscription, 'planId' | 'pendingPlanId' | 'pendingPlanEffectivePeriod' | 'startedOn' | 'epoch'>,
  invoices: readonly EngineInvoice[],
  todayKst: string,
): { planId: PaidBrandPlanId; cycleStart: string } | null {
  const pending = sub.pendingPlanId;
  if (pending === null || !isPaidPlanId(pending) || pending === sub.planId) return null;
  const from = pendingPlanEffectiveFrom(sub);
  const carrier = invoicesForEpoch(sub, invoices).find(
    (inv) =>
      inv.kind === 'subscription' &&
      (inv.status === 'issued' || inv.status === 'paid') &&
      hasCycle(inv) &&
      periodOfDay(inv.cycleStart) >= from &&
      inv.cycleStart <= todayKst &&
      inv.planId === pending,
  );
  return carrier && hasCycle(carrier) ? { planId: pending, cycleStart: carrier.cycleStart } : null;
}

function endReason(standing: Standing): string {
  if (!standing.ledger.hasPaid) return 'canceled_unpaid';
  return standing.ledger.oldestUnpaid ? 'canceled_unpaid_past_grace' : 'canceled_period_ended';
}

function skipped(
  todayKst: string,
  status: BrandSubscriptionStatus,
  accessEnd: string | null,
  skippedReason?: 'sandboxed' | 'project_only',
): SubscriptionEvaluation {
  return {
    cycle: { todayKst, anchor: null, currentCycle: null, nextCycle: null, nextDraftDay: null },
    status,
    accessEnd,
    hasPlanAccess: false,
    oldestUnpaid: null,
    latestPaidEndDay: null,
    adminVoidedCycles: [],
    waivedCycles: [],
    blockedByOlderEpoch: [],
    needsReissue: false,
    firstInvoicePending: null,
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
  /** Cycles an older epoch's non-void invoice occupies (never drafted; counted). */
  olderEpochCycles?: readonly Cycle[];
  /** Cycle starts whose draft/issue failed in this run (not retried; facts still applied). */
  suppressBillingFor?: readonly string[];
  /** Invoice ids whose system void or cycle write failed in this run. */
  suppressVoidOf?: readonly string[];
}): SubscriptionEvaluation {
  const { todayKst, subscription: sub, assignment, sandboxed = false } = params;
  const graceDays = safeGraceDays(params.graceDays);
  if (sub.status === 'ended') return skipped(todayKst, 'ended', null);
  if (sandboxed) return skipped(todayKst, sub.status, assignment?.endsOn ?? null, 'sandboxed');
  if (!isPaidPlanId(sub.planId)) return skipped(todayKst, sub.status, null, 'project_only');

  const olderEpoch = params.olderEpochCycles ?? [];
  const suppressBilling = new Set(params.suppressBillingFor ?? []);
  const suppressVoid = new Set(params.suppressVoidOf ?? []);
  const actions: SubscriptionAction[] = [];
  let working: EngineInvoice[] = invoicesForEpoch(sub, params.invoices);
  let planId: PaidBrandPlanId = sub.planId;

  // 0a. Rule 4: a paid first invoice without a cycle starts cycle 0 on its paid day.
  for (const inv of working) {
    if (inv.kind !== 'subscription' || inv.status !== 'paid' || hasCycle(inv) || suppressVoid.has(inv.id)) continue;
    const start = stampKstDay(inv.paidAt) ?? todayKst;
    const c = oneCycleFrom(start);
    actions.push({ type: 'setInvoiceCycle', invoiceId: inv.id, cycleStart: c.start, cycleEnd: c.end });
    // Fix round 1, B7: the cycle only; `period` stays the month the invoice was issued for.
    working = working.map((x) => (x === inv ? { ...x, cycleStart: c.start, cycleEnd: c.end } : x));
  }

  // 0b. System voids: an expired first invoice (no early access, nothing paid, `today > due + 14`); a draft without
  //     a cycle; a draft whose cycle ended without being the cycle billed now.
  const nothingPaid = !working.some(isPaidCover);
  const runBefore = currentRun(working, todayKst);
  const nextBefore = runBefore ? cycleStartingOn(runBefore.anchor, runBefore.lastEnd) : null;
  const billableBefore = nextBefore ? billableOnDayFromFacts(sub, working, todayKst, graceDays, nextBefore, olderEpoch) : false;
  for (const inv of [...working]) {
    if (inv.kind !== 'subscription' || suppressVoid.has(inv.id)) continue;
    let reason: 'first_invoice_expired' | 'stale_system_draft' | null = null;
    if (inv.status === 'issued' && !hasCycle(inv) && nothingPaid && !sub.activatedBeforePayment) {
      const due = effectiveInvoiceDueOn(inv);
      if (due && todayKst >= firstInvoiceExpiryDay(due)) reason = 'first_invoice_expired';
    } else if (
      inv.status === 'draft' &&
      (!hasCycle(inv) || (inv.cycleEnd <= todayKst && (inv.cycleStart !== nextBefore?.start || !billableBefore || sub.cancelAtPeriodEnd)))
    ) {
      reason = 'stale_system_draft';
    }
    if (reason === null) continue;
    actions.push({ type: 'void', invoiceId: inv.id, period: inv.period, cycleStart: inv.cycleStart ?? null, reason });
    working = working.map((x) => (x === inv ? { ...x, status: 'void', voidedBy: 'system', voidedAt: `${todayKst}T00:00:00+09:00` } : x));
  }

  // 0c. A downgrade follows the invoice that carries it, whoever issued it.
  let pendingApplied = false;
  const carrier = pendingPlanCarrier(sub, working, todayKst);
  if (carrier !== null && !suppressBilling.has(carrier.cycleStart)) {
    actions.push({ type: 'applyPendingPlan', fromPlanId: sub.planId, toPlanId: carrier.planId, cycleStart: carrier.cycleStart });
    planId = carrier.planId;
    pendingApplied = true;
  }
  const subNow = (): EngineSubscription => (pendingApplied ? { ...sub, planId, pendingPlanId: null, pendingPlanEffectivePeriod: null } : sub);

  // 1. The next cycle: draft from D-7, issue on the boundary while billable; a resume restarts the cycle. A second round
  //    runs only after an issue in the first (fix round 1: a late issue or a restart can leave the FOLLOWING cycle's D-7
  //    window already open — drafted in the same evaluation, so one run leaves nothing for the next evaluation).
  const blockedByOlder: string[] = [];
  for (let round = 0; round < 2; round += 1) {
    const run = currentRun(working, todayKst);
    if (!run || sub.cancelAtPeriodEnd) break;
    const actionsBefore = actions.length;
    const next = cycleStartingOn(run.anchor, run.lastEnd);
    const heldByOlder = olderEpoch.some((c) => overlaps(c, next));
    if (heldByOlder && !blockedByOlder.includes(next.start)) blockedByOlder.push(next.start);
    const blocked = findAdminVoidedCycles(working).includes(next.start) || suppressBilling.has(next.start) || heldByOlder;
    const nextDraftDay = addCalendarDays(next.start, -SUBSCRIPTION_DRAFT_LEAD_DAYS);
    if (!blocked && todayKst >= nextDraftDay) {
      const s = subNow();
      if (todayKst < next.start) {
        // D-7: the next cycle's draft (at the plan in force for that cycle).
        if (billableOnDayFromFacts(s, working, todayKst, graceDays, null, olderEpoch)) {
          const existing = working.find((i) => i.kind === 'subscription' && i.cycleStart === next.start && i.status !== 'void');
          if (!existing) {
            const draftPlan = planForCycle(s, next.start);
            actions.push({ type: 'draft', cycleStart: next.start, cycleEnd: next.end, period: periodOfDay(next.start), planId: draftPlan });
            working = [...working, draftOf(sub, next, draftPlan, todayKst)];
          }
        }
      } else if (billableOnDayFromFacts(s, working, todayKst, graceDays, next, olderEpoch)) {
        // On/after the boundary: contiguous when billable on the boundary itself, else a resume on the first
        // billable day since then (the paid day).
        const asOfBoundary = invoicesAsOfDay(working, next.start);
        const contiguous = billableOnDayFromFacts(s, asOfBoundary, next.start, graceDays, next, olderEpoch);
        let target: Cycle = next;
        // Fix round 1, B3: a cycle that already ended (no job run for a whole cycle) is never billed; the subscription
        // restarts on today, like a resume. The skipped time is not billed.
        if (!contiguous || next.end <= todayKst) {
          let restartDay = todayKst;
          if (!contiguous) {
            for (let d = addCalendarDays(next.start, 1); d < todayKst; d = addCalendarDays(d, 1)) {
              if (billableOnDayFromFacts(s, invoicesAsOfDay(working, d), d, graceDays, oneCycleFrom(d), olderEpoch)) {
                restartDay = d;
                break;
              }
            }
          }
          target = oneCycleFrom(restartDay);
          // A resume whose restart cycle has itself already ended restarts on today as well.
          if (target.end <= todayKst) target = oneCycleFrom(todayKst);
          // The old anchor's drafts that the new cycle replaces are voided by the system.
          for (const inv of [...working]) {
            if (inv.kind === 'subscription' && inv.status === 'draft' && hasCycle(inv) && inv.cycleStart >= next.start && !suppressVoid.has(inv.id)) {
              actions.push({ type: 'void', invoiceId: inv.id, period: inv.period, cycleStart: inv.cycleStart, reason: 'stale_system_draft' });
              working = working.map((x) => (x === inv ? { ...x, status: 'void', voidedBy: 'system', voidedAt: `${todayKst}T00:00:00+09:00` } : x));
            }
          }
        }
        if (!suppressBilling.has(target.start)) {
          const cyclePlan = planForCycle(s, target.start);
          if (cyclePlan !== planId && !pendingApplied) {
            actions.push({ type: 'applyPendingPlan', fromPlanId: planId, toPlanId: cyclePlan, cycleStart: target.start });
            planId = cyclePlan;
            pendingApplied = true;
          }
          const existing = working.find((i) => i.kind === 'subscription' && i.cycleStart === target.start && i.status === 'draft');
          if (!existing) {
            actions.push({ type: 'draft', cycleStart: target.start, cycleEnd: target.end, period: periodOfDay(target.start), planId });
          }
          const dueOn = dueOnForInvoice({ issueDay: todayKst, cycleStart: target.start, method: sub.collectionMethod });
          actions.push({ type: 'issue', cycleStart: target.start, period: periodOfDay(target.start), dueOn });
          working = [...working.filter((i) => i !== existing), hypotheticalIssue(sub, existing ?? null, target, planId, todayKst)];
        }
      }
    }
    if (!actions.slice(actionsBefore).some((a) => a.type === 'issue')) break;
  }

  // 2. Status and the plan assignment, from the invoices after the actions above.
  const runAfter = currentRun(working, todayKst);
  const anchor = runAfter?.anchor ?? null;
  const standing = standingOf(sub, working, todayKst, graceDays, anchor, olderEpoch);
  const target =
    standing.status === 'ended' || standing.endsOn === null
      ? null
      : { planId, billingMode: 'invoice' as const, ...assignmentWindow(anchor ?? sub.startedOn, standing.endsOn) };
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
  if (standing.status === 'ended') actions.push({ type: 'end', reason: endReason(standing) });
  else if (standing.status !== sub.status) actions.push({ type: 'setStatus', from: sub.status, to: standing.status });

  const currentCycle = anchor ? cycleContaining(anchor, todayKst) : null;
  const nextCycle = runAfter ? cycleStartingOn(runAfter.anchor, runAfter.lastEnd) : null;
  const pendingFirst = !sub.activatedBeforePayment && nothingPaid
    ? working.find((i) => i.kind === 'subscription' && i.status === 'issued' && !hasCycle(i)) ?? null
    : null;
  const pendingDue = pendingFirst ? effectiveInvoiceDueOn(pendingFirst) : null;
  return {
    cycle: {
      todayKst,
      anchor,
      currentCycle: currentCycle ? { start: currentCycle.start, end: currentCycle.end } : null,
      nextCycle,
      nextDraftDay: nextCycle ? addCalendarDays(nextCycle.start, -SUBSCRIPTION_DRAFT_LEAD_DAYS) : null,
    },
    status: standing.status,
    accessEnd: target?.endsOn ?? null,
    hasPlanAccess: target !== null && planActiveWithGrace(target, todayKst, graceDays).active,
    oldestUnpaid: standing.ledger.oldestUnpaid,
    latestPaidEndDay: standing.ledger.coverageEnd,
    adminVoidedCycles: [...standing.ledger.blocked].sort(),
    waivedCycles: [...standing.ledger.waived].sort(),
    blockedByOlderEpoch: blockedByOlder,
    needsReissue: standing.status !== 'ended' && !standing.ledger.hasPaid && standing.ledger.oldestUnpaid === null,
    firstInvoicePending:
      pendingFirst && pendingDue ? { invoiceId: pendingFirst.id, dueOn: pendingDue, expiresOn: firstInvoiceExpiryDay(pendingDue) } : null,
    actions,
  };
}

function draftOf(sub: Pick<EngineSubscription, 'epoch'>, cycle: Cycle, planId: BrandPlanId, day: string): EngineInvoice {
  return {
    id: `engine-draft-${cycle.start}`,
    period: periodOfDay(cycle.start),
    kind: 'subscription',
    coversMonths: 1,
    status: 'draft',
    planId,
    dueOn: null,
    issuedAt: null,
    subscriptionEpoch: sub.epoch,
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    manualAmounts: false,
    createdAt: `${day}T00:00:00+09:00`,
    createdVia: 'system',
  };
}

/** Waived cycle starts of the current epoch. */
export function findWaivedCycles(subscription: Pick<EngineSubscription, 'epoch'>, invoices: readonly EngineInvoice[]): string[] {
  return [...ledgerOf(invoicesForEpoch(subscription, invoices), '0001-01-01').waived].sort();
}
