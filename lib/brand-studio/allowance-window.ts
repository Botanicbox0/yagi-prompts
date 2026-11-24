/**
 * Which words an allowance's screens use (R1). A plan organization's credits run on its billing cycle (B1c: one month
 * from the plan start day, lib/brands/billing/cycle.ts); an organization with an allowance override or without a plan
 * stays on the KST calendar month. Calendar-month screens keep their existing words exactly; cycle screens use the
 * "이번 이용 기간" keys (the `…Cycle` siblings in messages/*) with the cycle's real dates. A screen that does not know the
 * window (no allowance at hand) keeps the existing words — it never guesses.
 *
 * Pure and client-safe: screens receive the window inside `StudioAllowanceView` (`allowanceView`, ./usage.ts) and
 * format its days with the date format they already use.
 */
import { kstDayStartUtc } from '@/lib/brands/billing/cycle';
import { addCalendarDays, isValidCalendarDay, kstDayOf } from '@/lib/brands/billing/math';

export type AllowanceWindowKind = 'cycle' | 'month';

/** The allowance window as screens receive it: KST calendar days, `end` exclusive. */
export interface AllowanceWindowView {
  kind: AllowanceWindowKind;
  /** First KST day of the window, `YYYY-MM-DD` (a cycle's start day, or the month's 1st). */
  start: string;
  /** First KST day after the window, `YYYY-MM-DD`: the day the credits refill (the next cycle's start, or the next 1st). */
  end: string;
}

type KnownWindow = Pick<AllowanceWindowView, 'kind'> | null | undefined;

/**
 * The window of a loaded allowance: its cycle when it has one (plan organizations), else the calendar month its
 * `resetsAt` closes (overrides, the env default, organizations without a plan — `resetsAt` is then the next 1st).
 */
export function allowanceWindowView(allowance: { resetsAt: string; cycle?: { start: string; end: string } | null }): AllowanceWindowView {
  if (allowance.cycle) return { kind: 'cycle', start: allowance.cycle.start, end: allowance.cycle.end };
  const resets = new Date(allowance.resetsAt);
  const end = Number.isNaN(resets.getTime()) ? '' : kstDayOf(resets);
  if (!isValidCalendarDay(end)) return { kind: 'month', start: '', end: '' };
  return { kind: 'month', start: `${addCalendarDays(end, -1).slice(0, 7)}-01`, end };
}

/** True only for a window known to be a billing cycle; an unknown window reads as the calendar month. */
export function isCycleWindow(window: KnownWindow): boolean {
  return window?.kind === 'cycle';
}

/** The cycle wording for a billing-cycle window; otherwise the existing (calendar-month) wording, unchanged. */
export function windowText<T>(window: KnownWindow, month: T, cycle: T): T {
  return isCycleWindow(window) ? cycle : month;
}

/** The instant a window day begins in Seoul, for a screen's own date formatter (KST midnight). */
export function windowDayInstant(day: string): Date {
  return kstDayStartUtc(day);
}
