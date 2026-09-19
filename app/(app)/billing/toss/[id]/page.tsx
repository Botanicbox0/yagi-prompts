import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getTossContext } from '@/lib/billing/toss-runtime';
import { loadOwnTossOrder } from '@/lib/billing/toss-service';
import { tossConfigFromEnv } from '@/lib/billing/toss-gateway';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { RENDER_PIPELINE_PUBLIC } from '@/lib/flags';
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
  const canPay =
    RENDER_PIPELINE_PUBLIC &&
    o.status === 'pending' &&
    new Date(o.expires_at) > new Date();
  const failed = (await searchParams).failed === '1';
  const config = canPay ? tossConfigFromEnv() : null;
  return (
    <section data-section data-theme="light" className="section min-h-screen">
      <main id="main" className="mx-auto max-w-2xl px-5 py-20 sm:px-8 lg:py-28">
        <p className="font-label text-sm tracking-widest text-accent">TWINGS</p>
        <h1 className="mt-4 font-display text-4xl font-black">{c.title}</h1>
        <p className="mt-4 text-body opacity-70">{c.summary}</p>
        <div className="mt-8 flex items-start justify-between gap-4 border-y border-hairline py-5">
          <p className="font-semibold">{o.order_name}</p>
          <div className="shrink-0 text-right">
            <p className="text-xs opacity-60">{c.amount}</p>
            <p className="mt-1 text-2xl font-semibold">
              ₩{o.amount_krw.toLocaleString(o.locale)}
            </p>
          </div>
        </div>
        {failed && (
          <p role="alert" className="mt-5 text-sm">
            {c.failed}
          </p>
        )}
        {canPay ? (
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
