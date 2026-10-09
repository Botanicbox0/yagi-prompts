import { getRequestLocale } from '@/lib/i18n/server';
import { isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { SubscriptionReturn } from '@/components/billing/subscription-return';

export const dynamic = 'force-dynamic';
export default async function SubscriptionReturnPage({ searchParams }: { searchParams: Promise<{ locale?: string }> }) {
  const requested = (await searchParams).locale;
  const locale = isLocale(requested) ? requested : await getRequestLocale();
  return <main id="main" className="mx-auto min-h-screen max-w-2xl px-5 py-24 sm:px-8"><SubscriptionReturn locale={locale} copy={getDictionary(locale).creatorSubscription} /></main>;
}
