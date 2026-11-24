/**
 * R4: whether an organization's credits refill, beside the window (./allowance-window.ts) on the view screens receive.
 *
 * Credits refill when the allowance has a base cap above 0 — a plan cap (its billing cycle), an allowance override or an
 * env default above 0 (the calendar month). Then nothing here runs a statement and the view is exactly `allowanceView`
 * (no `refill` key), so those organizations keep every word, API field and SQL statement they have today.
 *
 * When the base cap is 0 and the cap is above 0, the cap comes only from grants: nothing refills on a date. One
 * statement (lib/brands/billing/workspace-approval.ts `loadTrialUsability`) then tells a trial-only organization — an
 * unrevoked trial grant counts now — the last day its trial can be used, with the admin panel's own date rule. With
 * `BRAND_WORKSPACE_APPROVAL` off or migration 0184 not applied there are no trial grants: the view stays as today's.
 *
 * `loadAllowance` itself is untouched (its recorded-SQL parity fixtures stay as they are).
 */
import { loadTrialUsability } from '@/lib/brands/billing/workspace-approval';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AllowanceRefillView } from './allowance-window';
import type { StudioAllowanceView } from './contracts';
import { allowanceView, loadAllowance, type StudioAllowance } from './usage';

type Env = Record<string, string | undefined>;

/** The refill fact, or null for today's behaviour (credits refill, or the flag / schema is not there). */
export async function loadAllowanceRefill(
  sql: SqlRunner,
  organizationId: string,
  allowance: Pick<StudioAllowance, 'baseCapKrw' | 'capKrw'>,
  options: { now?: Date; env?: Env } = {},
): Promise<AllowanceRefillView | null> {
  // A base cap refills on its window's end; a closed allowance (cap 0) shows no credits and no refill line at all.
  if (allowance.baseCapKrw > 0 || !(allowance.capKrw > 0)) return null;
  const trial = await loadTrialUsability(sql, organizationId, options);
  if (!trial) return null;
  return trial.activeNow && trial.usableThrough ? { kind: 'none', trialThrough: trial.usableThrough } : { kind: 'none' };
}

/** `loadAllowance` then `allowanceViewWithRefill`, for the services that answer a screen with the allowance. */
export async function loadAllowanceViewWithRefill(
  sql: SqlRunner,
  organizationId: string,
  env: { defaultMonthlyKrw: number; planGraceDays?: number },
  now: Date = new Date(),
): Promise<StudioAllowanceView> {
  return allowanceViewWithRefill(sql, organizationId, await loadAllowance(sql, organizationId, env, now), { now });
}

/** `allowanceView` with the refill fact when there is one (see above); otherwise exactly `allowanceView`. */
export async function allowanceViewWithRefill(
  sql: SqlRunner,
  organizationId: string,
  allowance: StudioAllowance,
  options: { now?: Date; env?: Env } = {},
): Promise<StudioAllowanceView> {
  const view = allowanceView(allowance);
  const refill = await loadAllowanceRefill(sql, organizationId, allowance, options);
  return refill ? { ...view, refill } : view;
}
