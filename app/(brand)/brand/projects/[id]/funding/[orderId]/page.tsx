import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { loadFundingCheckout } from "@/lib/campaigns/funding/service";
import { fundingClientKey, fundingDeps } from "@/lib/campaigns/funding/runtime";
import { open } from "@/lib/campaigns/funding/core";
import { fundingCopy } from "@/messages/campaign-funding";
import { FundingCheckout } from "@/components/campaigns/funding-actions";
import { formatKrw } from "@/lib/i18n/format";
export const dynamic = "force-dynamic";
export default async function FundingOrder({
  params,
}: {
  params: Promise<{ id: string; orderId: string }>;
}) {
  const [{ id, orderId }, { sql, viewer, locale }] = await Promise.all([
    params,
    brandContext(),
  ]);
  const t = fundingCopy(locale);
  if (!sql) return <p>{t.unavailable}</p>;
  const item = await loadFundingCheckout(sql, viewer, id, orderId);
  if (!item) notFound();
  const deps = fundingDeps(sql);
  return (
    <section className="mx-auto max-w-3xl px-5 py-10" data-campaign-funding>
      <a
        className="text-sm text-accent underline"
        href={`/brand/projects/${id}/funding`}
      >
        {t.back}
      </a>
      <h1 className="mt-6 text-3xl font-semibold">{t.title}</h1>
      <p className="mt-5 text-2xl font-semibold tabular-nums">
        {formatKrw(item.order.amountKrw, locale)}
      </p>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm">
        {item.quote.taxBasis}
      </p>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
        {item.quote.termsSummary}
      </p>
      <p className="mt-3 text-sm">
        {t.termsRef}: {item.quote.termsRef}
      </p>
      {deps &&
      open(deps) &&
      deps.gateway.kind === item.order.environment &&
      item.order.status === "pending" &&
      new Date(item.order.expiresAt) > new Date() ? (
        <FundingCheckout
          locale={locale}
          projectId={id}
          order={item.order}
          kind={deps.gateway.kind}
          clientKey={fundingClientKey()}
          customerKey={viewer.userId!}
        />
      ) : (
        <p role="status" className="mt-6">
          {item.order.status === "pending"
            ? t.closed
            : t.states[item.order.status as keyof typeof t.states]}
        </p>
      )}
    </section>
  );
}
