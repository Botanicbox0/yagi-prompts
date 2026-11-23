/**
 * The billing cycle: one month from the plan start day (docs/BRAND-RECURRING-BILLING.md §5.8, founder decision
 * 2026-11-24). Started on the 17th → every cycle starts on the 17th. A start day the month lacks becomes that month's
 * last day, and the day comes back in the next month that has it (Jan 31 → Feb 28/29 → Mar 31 → Apr 30): the
 * documented Stripe behaviour, https://docs.stripe.com/billing/subscriptions/billing-cycle — except that the dates
 * here are KST calendar dates, not UTC timestamps.
 *
 * A cycle is `[start, end)` in KST days: `end` is the start of the next cycle. Pure and client-safe (no env, no db);
 * no local-time `Date` arithmetic.
 */
import { daysInYearMonth, diffCalendarDays, isValidCalendarDay } from './math';

const KST_OFFSET_MS = 9 * 3_600_000;

export interface BillingCycle {
  /** 0 = the cycle that starts on the anchor itself. */
  index: number;
  /** First KST day of the cycle, `YYYY-MM-DD`. */
  start: string;
  /** First KST day of the next cycle (exclusive end), `YYYY-MM-DD`. */
  end: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function parse(day: string): { y: number; m: number; d: number } {
  if (!isValidCalendarDay(day)) throw new RangeError(`invalid calendar day: ${day}`);
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

/** The start of cycle `index` of `anchor`: the anchor's month + `index`, day = min(anchor day, days in that month). */
export function cycleStartAt(anchor: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`invalid cycle index: ${index}`);
  const a = parse(anchor);
  const months = a.m - 1 + index;
  const year = a.y + Math.floor(months / 12);
  const period = `${year}-${pad((months % 12) + 1)}`;
  return `${period}-${pad(Math.min(a.d, daysInYearMonth(period)))}`;
}

/** The cycle of `anchor` that contains KST day `day` (`start ≤ day < end`); null before the anchor. */
export function cycleContaining(anchor: string, day: string): BillingCycle | null {
  const a = parse(anchor);
  const t = parse(day);
  if (day < anchor) return null;
  let index = (t.y - a.y) * 12 + (t.m - a.m);
  if (cycleStartAt(anchor, index) > day) index -= 1;
  return { index, start: cycleStartAt(anchor, index), end: cycleStartAt(anchor, index + 1) };
}

/** The next cycle start after `day`: the end of the cycle containing it, or the anchor itself before it. */
export function nextCycleStart(anchor: string, day: string): string {
  return cycleContaining(anchor, day)?.end ?? anchor;
}

/** Days in a cycle (28–31). */
export function cycleDays(cycle: Pick<BillingCycle, 'start' | 'end'>): number {
  return diffCalendarDays(cycle.end, cycle.start);
}

/** The UTC instant at which KST day `day` begins (KST midnight). */
export function kstDayStartUtc(day: string): Date {
  parse(day);
  return new Date(Date.parse(`${day}T00:00:00Z`) - KST_OFFSET_MS);
}

/** A cycle as UTC instants at KST midnight, `[start, end)`. */
export function cycleWindow(cycle: Pick<BillingCycle, 'start' | 'end'>): { start: Date; end: Date } {
  return { start: kstDayStartUtc(cycle.start), end: kstDayStartUtc(cycle.end) };
}
