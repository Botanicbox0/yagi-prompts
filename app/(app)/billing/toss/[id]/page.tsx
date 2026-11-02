import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getTossContext } from '@/lib/billing/toss-runtime';
import { loadOwnTossOrder, tossOrderView } from '@/lib/billing/toss-service';
import { tossConfigFromEnv } from '@/lib/billing/toss-gateway';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { purchaseOpenFor } from '@/lib/auth/purchase-gate';
import { formatKrw } from '@/lib/i18n/format';
import { templateHref } from '@/lib/prompts/links';
import { TossCheckout } from '../checkout';
import { TossStatus } from '../status';

export const dynamic = 'force-dynamic';
export default async function TossOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failed?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer.userId) notFound();
  const deps = await getTossContext();
  if (!deps) notFound();
  const o = await loadOwnTossOrder(deps.sql, viewer, (await params).id);
  if (!o) notFound();
  const c = getDictionary(o.locale).billing.toss;
  const live = new Date(o.expires_at) > new Date();
  const open = purchaseOpenFor(viewer);
  // Only a pending order opens the provider window. A refusal at approval ends the order
  // (docs/PLATFORM-2.0.md §2.2-1, -2), so an old price or a closed sale is never offered again.
  const canPay = open && o.status === 'pending' && live;
  const view = tossOrderView(o);
  // Audit P2-13: a pending order past its window with no payment key was never paid — it is
  // expired, not "confirmation delayed". Say so and offer a fresh start on the template. The
  // reconcile records the same as `failed(expired)`.
  const expired =
    (o.status === 'pending' && !live && o.payment_key === null) ||
    (o.status === 'failed' && view.reason === 'expired');
  const restartHref = `${templateHref(o.locale, o.template_slug)}#make`;
  const failed = (await searchParams).failed === '1';
  const config = canPay ? tossConfigFromEnv() : null;
  return (
    <section data-section data-theme="light" className="section min-h-screen">
      <main id="main" className="mx-auto max-w-2xl px-5 py-20 sm:px-8 lg:py-28">
        <p className="font-label text-sm tracking-widest text-accent">TWINGS</p>
        <h1 className="mt-4 font-display text-4xl font-black">{c.title}</h1>
        <p className="mt-4 text-body opacity-70">{c.summary}</p>
        <div className="mt-8 flex items-start justify-between gap-4 border-y border-hairline py-5">
          <div>
            <p className="font-semibold">{o.order_name}</p>
            {/* What the amount buys: a film's resolution, stored on the order (pre-0039 orders carry none). */}
            {o.resolution && (
              <p data-order-resolution={o.resolution} className="mt-1 text-sm opacity-60">
                {c.resolution} {o.resolution}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs opacity-60">{c.amount}</p>
            <p className="mt-1 text-2xl font-semibold">
              {formatKrw(o.amount_krw, o.locale)}
            </p>
          </div>
        </div>
        {failed && (
          <p role="alert" className="mt-5 text-sm">
            {c.failed}
          </p>
        )}
        {expired ? (
          <div data-payment-status="expired" className="mt-8">
            <p role="status" className="text-lg leading-relaxed">
              {c.expired}
            </p>
            <a
              href={restartHref}
              data-toss-restart
              className="mt-6 inline-block rounded-full bg-black px-6 py-3 text-white"
            >
              {c.restart}
            </a>
          </div>
        ) : canPay ? (
          <TossCheckout
            id={o.id}
            amount={o.amount_krw}
            name={o.order_name}
            customerKey={viewer.userId}
            clientKey={config?.clientKey ?? null}
            kind={deps.gateway.kind}
            locale={o.locale}
            copy={c}
          />
        ) : (
          <TossStatus
            id={o.id}
            initialStatus={o.status}
            renderId={o.render_id}
            reason={view.reason}
            retry={view.retry && open}
            restartHref={restartHref}
            copy={c}
          />
        )}
        <a
          href={`/${o.locale}/t/${o.template_slug}`}
          className="mt-8 inline-block text-sm underline"
        >
          {c.back}
        </a>
      </main>
    </section>
  );
}
