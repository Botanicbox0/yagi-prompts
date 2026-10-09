import type { SubscriptionPlanId } from './types';

/** Approved contract values. Cost-model changes must never change an existing charge. */
export const SUBSCRIPTION_PLAN_VERSION = 'creator-2026-10-09-v1';
export const SUBSCRIPTION_PLANS = {
  creator: { amountKrw: 24900, monthlyUnits: 604, name: 'TWINGS Creator' },
  premium: { amountKrw: 49000, monthlyUnits: 1200, name: 'TWINGS Premium' },
} as const;
export function isSubscriptionPlan(value: unknown): value is SubscriptionPlanId {
  return value === 'creator' || value === 'premium';
}
/** Korean calendar months, always derived from the ORIGINAL anchor (including time of day). */
export function billingBoundary(anchor: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 0 || !Number.isFinite(anchor.getTime())) throw new Error('Invalid billing anchor');
  const korean = new Date(anchor.getTime() + 9 * 3600_000);
  const month = korean.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(korean.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(korean.getUTCFullYear(), month, Math.min(korean.getUTCDate(), lastDay),
    korean.getUTCHours(), korean.getUTCMinutes(), korean.getUTCSeconds(), korean.getUTCMilliseconds()) - 9 * 3600_000);
}
export function currentBillingIndex(anchor: Date, now: Date): number {
  const a = new Date(anchor.getTime() + 9 * 3600_000);
  const n = new Date(now.getTime() + 9 * 3600_000);
  let index = Math.max(0, (n.getUTCFullYear() - a.getUTCFullYear()) * 12 + n.getUTCMonth() - a.getUTCMonth());
  if (billingBoundary(anchor, index) > now) index = Math.max(0, index - 1);
  return index;
}
