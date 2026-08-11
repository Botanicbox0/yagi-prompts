import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { linkStripeCustomer, reconcileSubscription } from '@/lib/billing/reconcile';
import { originPath, sanitizeSlug } from '@/lib/billing/links';
import { getBillingContext } from '@/lib/billing/service';
import { track } from '@/lib/events/server';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * `/billing/success` — PLAN §3.4.
 *
 *   "Stripe Checkout (hosted), origin slug + locale in metadata → `/billing/success` reconciles →
 *    redirect to origin unlocked; bounded 'confirming payment…' state."
 *
 * This route is the reason the product does not depend on webhook delivery at all. It retrieves the
 * session, records the customer id, and runs the SAME `reconcileSubscription` every webhook runs.
 * A webhook that arrives first is harmless (both re-fetch, both are fenced); a webhook that never
 * arrives is also harmless, which is the acceptance criterion in §8 M3 ("lock→pay→unlock without
 * webhook delivery").
 *
 * The "confirming" state is BOUNDED: Stripe occasionally reports the session complete a beat before
 * the subscription is queryable, so the page retries twice with a meta refresh and then stops and
 * says so. An unbounded spinner would be a lie about what we know.
 */
export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 3;
const RETRY_SECONDS = 2;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function Frame({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <main id="main" className="band py-24 lg:py-32">
        <h1 className="max-w-detail font-display text-title font-black uppercase">{title}</h1>
        <p className="mt-6 max-w-detail text-body opacity-70">{body}</p>
        {children}
      </main>
    </div>
  );
}

export default async function BillingSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawLocale = first(params.locale);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const slug = sanitizeSlug(first(params.slug));
  const returnTo = originPath({ slug, locale });
  const sessionId = first(params.session_id);
  const attempt = Math.max(1, Number(first(params.try) ?? '1') || 1);

  const viewer = await getViewer();
  if (viewer.userId === null) {
    // No session to attach a subscription to. Sending them to the origin is honest: if the payment
    // landed, the webhook reconciles it and the next signed-in render is unlocked.
    redirect(returnTo);
  }

  const context = await getBillingContext();
  if (context !== null && sessionId !== null) {
    const session = await context.gateway.retrieveCheckoutSession(sessionId);
    // The session must belong to THIS user. Otherwise a shared/guessed session id would reconcile
    // someone else's subscription onto the reader's profile.
    const owner = session?.clientReferenceId ?? session?.metadata?.userId ?? null;
    if (session !== null && owner === viewer.userId && session.customerId !== null) {
      await linkStripeCustomer(context.sql, viewer.userId, session.customerId);
    }
  }

  const outcome =
    context === null
      ? null
      : await reconcileSubscription(context, viewer.userId);

  const entitled = outcome !== null && outcome.entitled;

  if (entitled) {
    await track({
      type: 'unlock_success',
      userId: viewer.userId,
      meta: { surface: 'success', locale, ...(slug === null ? {} : { slug }) },
    });
    // §3.4: "redirect to origin unlocked".
    redirect(returnTo);
  }

  // --- not entitled yet ---------------------------------------------------
  const canRetry = attempt < MAX_ATTEMPTS && sessionId !== null && context !== null;
  if (canRetry) {
    const next = new URLSearchParams({ locale, try: String(attempt + 1) });
    next.set('session_id', sessionId);
    if (slug !== null) next.set('slug', slug);
    return (
      <>
        {/* Bounded, server-driven retry — no client JavaScript, and it stops on its own. */}
        <meta httpEquiv="refresh" content={`${RETRY_SECONDS};url=/billing/success?${next.toString()}`} />
        <Frame title={dict.billing.confirmingTitle} body={dict.billing.confirmingBody}>
          <p className="mt-10 font-mono text-code opacity-60">
            {attempt} / {MAX_ATTEMPTS}
          </p>
        </Frame>
      </>
    );
  }

  return (
    <Frame title={dict.billing.confirmingSlowTitle} body={dict.billing.confirmingSlowBody}>
      <div className="mt-10 flex flex-wrap gap-8">
        <a href="/account" className="text-accent font-label text-label uppercase">
          <TextSwap>{dict.billing.backToAccount} →</TextSwap>
        </a>
        <a href={returnTo} className="font-label text-label uppercase opacity-70">
          <TextSwap>
            {slug === null ? dict.billing.backToLibrary : dict.billing.backToPlaybook} →
          </TextSwap>
        </a>
      </div>
    </Frame>
  );
}
