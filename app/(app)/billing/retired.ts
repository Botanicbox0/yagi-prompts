import { permanentRedirect } from 'next/navigation';
import { isLocale } from '@/lib/i18n/config';
import { getRequestLocale } from '@/lib/i18n/server';
import { pricingHref } from '@/lib/billing/links';

/**
 * The retired $9/month subscription entry (audit P1-4, 대표 decision: subscriptions on hold,
 * billing is one payment per template). `/billing/upgrade`, `/billing/success` and
 * `/billing/cancelled` are 308'd to the localized pricing page by `next.config.ts` before the
 * session gate runs; these pages are the same answer for whatever reaches them anyway (a host the
 * config matcher does not list, a signed-in reader on a cached link).
 */
export async function redirectRetiredSubscriptionPage(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<never> {
  const params = await searchParams;
  const raw = Array.isArray(params.locale) ? params.locale[0] : params.locale;
  permanentRedirect(pricingHref(isLocale(raw) ? raw : await getRequestLocale()));
}
