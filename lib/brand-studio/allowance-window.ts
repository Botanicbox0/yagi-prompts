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

/* ------------------------------------------------------------------ refill (R4) */

export type AllowanceRefillKind = 'cycle' | 'month' | 'none';

/**
 * R4: whether the credits refill at the window's end. They do whenever the allowance has a base cap above 0 (a plan
 * cycle, an allowance override, an env default above 0); then the view carries no `refill` at all and every screen keeps
 * the words it has (`cycle` / `month` name those cases for readers). `none`: the base cap is 0 and the cap comes only
 * from grants, so nothing refills on a date. `trialThrough`: the organization's credits are its trial (an unrevoked
 * trial grant counts now) — the last KST day (`YYYY-MM-DD`) the trial can be used, from the admin side's rule
 * (lib/brands/billing/workspace-approval.ts `usableThrough`). Loaded by lib/brand-studio/allowance-refill.ts.
 */
export interface AllowanceRefillView {
  kind: AllowanceRefillKind;
  trialThrough?: string;
}

type KnownRefill = Pick<AllowanceRefillView, 'kind' | 'trialThrough'> | null | undefined;

/**
 * How a screen words the refill: today's words (`refills`, also for a view without the fact), the trial words with the
 * trial's last day (`trial`), or no refill sentence at all (`hidden`, extra credits without a trial).
 */
export type RefillWording = { kind: 'refills' } | { kind: 'trial'; through: string } | { kind: 'hidden' };

export function refillWording(refill: KnownRefill): RefillWording {
  if (refill?.kind !== 'none') return { kind: 'refills' };
  const through = refill.trialThrough;
  return through && isValidCalendarDay(through) ? { kind: 'trial', through } : { kind: 'hidden' };
}

/**
 * An existing sentence without its last sentence, for the `hidden` case: every customer string that carries the refill
 * day carries it as its last sentence ("…남았어요. {date}에 다시 채워져요." → "…남았어요."), so no new sentence is
 * written. Applied to the template before its placeholders are filled; tests/brands/billing-trial-copy.test.tsx pins
 * every result. Empty when the text is one sentence.
 */
export function withoutLastSentence(text: string): string {
  const cut = text.lastIndexOf('. ');
  return cut < 0 ? '' : text.slice(0, cut + 1);
}
