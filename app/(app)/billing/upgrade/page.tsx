import { getViewer } from '@/lib/auth/viewer';
import { loadSubscription } from '@/lib/billing/reconcile';
import { CHECKOUT_ACTION, sanitizeSlug } from '@/lib/billing/links';
import { isBillingConfigured } from '@/lib/billing/stripe-gateway';
import { getSqlRunner } from '@/lib/db/connect';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { TextSwap } from '@/components/ui/text-swap';
import { BillingUnavailable } from '@/components/billing/upgrade-cta';

/**
 * `/billing/upgrade` — the upgrade entry point for surfaces that cannot know the viewer's tier.
 *
 * The pricing page and the landing are STATIC by contract (§3.1, and tests/routes/cache-contract
 * forbids a session read anywhere in the marketing tree), so their CTA cannot branch on tier. They
 * link here through `/auth/signin`, which short-circuits for an already-signed-in reader — so this
 * page is always reached with a session, and it is where the three answers live:
 *
 *   · already entitled     → say so; the portal is on `/account`
 *   · no Stripe configured → the designed §11 state, not a dead button
 *   · otherwise            → one button that POSTs to the guarded checkout route
 *
 * The detail page does NOT come through here: it knows the tier, so its locked-block CTA posts to
 * checkout directly and stays one click (Journey A).
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function BillingUpgradePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawLocale = first(params.locale);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const slug = sanitizeSlug(first(params.slug));

  const viewer = await getViewer();
  let entitled = viewer.tier === 'pro';
  if (viewer.userId !== null && !entitled) {
    const sql = await getSqlRunner();
    if (sql !== null) {
      const subscription = await loadSubscription(sql, viewer.userId);
      entitled = subscription?.entitled === true;
    }
  }

  const billingReady = isBillingConfigured();

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <main id="main" className="band py-24 lg:py-32">
        <p className="text-accent font-label text-eyebrow uppercase">{dict.billing.upgradeEyebrow}</p>

        {entitled ? (
          <>
            <h1 className="mt-6 max-w-detail font-display text-title font-black uppercase">
              {dict.billing.alreadyProTitle}
            </h1>
            <p className="mt-6 max-w-detail text-body opacity-70">{dict.billing.alreadyProBody}</p>
            <p className="mt-10">
              <a href="/account" className="text-accent font-label text-label uppercase">
                <TextSwap>{dict.billing.backToAccount} →</TextSwap>
              </a>
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-6 max-w-detail font-display text-title font-black uppercase">
              {dict.billing.upgradeTitle}
            </h1>
            <p className="mt-6 max-w-detail text-body opacity-70">{dict.billing.upgradeBody}</p>

            {billingReady ? (
              <div className="mt-12">
                <form method="post" action={CHECKOUT_ACTION}>
                  <input type="hidden" name="locale" value={locale} />
                  {slug !== null && <input type="hidden" name="slug" value={slug} />}
                  <button
                    type="submit"
                    className="inline-block border border-current px-7 py-3.5 font-label text-label uppercase"
                  >
                    <TextSwap>{dict.billing.upgradeCta} →</TextSwap>
                  </button>
                </form>
                <p className="mt-5 font-mono text-code opacity-60">{dict.billing.upgradeNote}</p>
              </div>
            ) : (
              <BillingUnavailable
                className="mt-12 max-w-detail"
                title={dict.billing.unavailableTitle}
                body={dict.billing.unavailableBody}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
