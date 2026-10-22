import type { Locale } from '@/lib/i18n/config';
import { signInHref } from '@/lib/billing/links';

/**
 * docs/PLATFORM-2.0.md §2.2-2, -9 — a return the server answers 401 (the session lapsed between the
 * provider window and the approval POST) goes through sign-in and comes back HERE with the provider's
 * approval parameters, the same shape the edge gate already keeps in `next` for a return with no
 * session at all. Pure, so the page and the route tests share it.
 */
export interface TossReturnParams {
  orderId: string;
  paymentKey: string;
  amount: string;
  locale: Locale;
}

export function tossReturnPath(p: TossReturnParams): string {
  const query = new URLSearchParams({
    orderId: p.orderId,
    paymentKey: p.paymentKey,
    amount: p.amount,
    locale: p.locale,
  });
  return `/billing/toss/return?${query}`;
}

export function tossSignInHref(p: TossReturnParams): string {
  return signInHref(tossReturnPath(p), p.locale);
}
