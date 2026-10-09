import { getRequestLocale } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { SUBSCRIPTION_TERMS_DRAFT, SUBSCRIPTION_TERMS_VERSION } from '@/lib/creator-subscriptions/legal';
import { subscriptionTermsApproved } from '@/lib/creator-subscriptions/evidence';
import { getSqlRunner } from '@/lib/db/connect';
import { Markdown } from '@/components/playbook/markdown';
import { SUBSCRIPTION_PRIVACY_DRAFT } from '@/lib/creator-subscriptions/legal-projection';

export const dynamic = 'force-dynamic';
export default async function SubscriptionTermsPage() {
  const locale = await getRequestLocale(); const copy = getDictionary(locale).creatorSubscription;
  const termsApproved = await subscriptionTermsApproved(await getSqlRunner());
  return <main id="main" data-subscription-terms={SUBSCRIPTION_TERMS_VERSION} data-subscription-terms-status={termsApproved ? 'approved' : 'draft'} className="mx-auto min-h-screen max-w-3xl px-5 py-24 sm:px-8">
    <h1 className="text-3xl font-semibold tracking-tight">{copy.termsTitle}</h1>
    {!termsApproved && <p role="status" className="mt-5 text-sm leading-relaxed text-accent">{copy.termsDraft}</p>}
    <article className="mt-8"><Markdown source={SUBSCRIPTION_TERMS_DRAFT[locale]} /></article>
    <article className="mt-8"><Markdown source={SUBSCRIPTION_PRIVACY_DRAFT[locale]} /></article>
  </main>;
}
