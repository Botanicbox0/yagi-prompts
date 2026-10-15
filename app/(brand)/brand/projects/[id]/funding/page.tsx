import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { loadFundingProject } from "@/lib/campaigns/funding/service";
import { fundingDeps } from "@/lib/campaigns/funding/runtime";
import { open } from "@/lib/campaigns/funding/core";
import { fundingCopy } from "@/messages/campaign-funding";
import {
  FundingAction,
  FundingStatus,
  RewardProposalForm,
} from "@/components/campaigns/funding-actions";
import { formatKrw } from "@/lib/i18n/format";
export const dynamic = "force-dynamic";
export default async function FundingProject({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failed?: string }>;
}) {
  const [{ id }, { sql, viewer, locale }, search] = await Promise.all([
    params,
    brandContext(),
    searchParams,
  ]);
  const t = fundingCopy(locale);
  if (!sql) return <p role="status">{t.unavailable}</p>;
  const view = await loadFundingProject({ sql }, viewer, id);
  if (!view) notFound();
  const deps = fundingDeps(sql),
    enabled = deps !== null && open(deps);
  return (
    <section className="mx-auto max-w-4xl px-5 py-10" data-campaign-funding>
      <a
        href={`/brand/projects/${id}`}
        className="text-sm text-accent underline"
      >
        {t.back}
      </a>
      <h1 className="mt-6 text-3xl font-semibold">{t.title}</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed">{t.intro}</p>
      {!view.ready ? (
        <p className="mt-8" role="status">
          {t.unavailable}
        </p>
      ) : (
        <>
          <section
            className="mt-8 border-y border-hairline py-6"
            data-campaign-reward-proposals
          >
            <h2 className="text-xl font-semibold">{t.reward.title}</h2>
            <p className="mt-3 max-w-prose text-sm leading-relaxed">
              {t.reward.hint}
            </p>
            <p className="mt-2 text-sm opacity-70">{t.reward.writer}</p>
            {view.canPropose && view.campaigns.length > 0 && (
              <RewardProposalForm
                locale={locale}
                projectId={id}
                campaigns={view.campaigns}
              />
            )}
            {!view.campaigns.length && (
              <p className="mt-4 text-sm">{t.noCampaign}</p>
            )}
            {!view.proposals.length && (
              <p className="mt-5 text-sm">{t.reward.empty}</p>
            )}
            <ul className="mt-6 divide-y divide-hairline">
              {view.proposals.map((p) => (
                <li key={p.id} className="py-4 text-sm">
                  <p className="font-semibold">
                    {formatKrw(p.amount_krw, locale)} · {t.reward[p.state]}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">
                    {p.conditions}
                  </p>
                  {p.review_note && (
                    <p className="mt-3 whitespace-pre-wrap break-words">
                      {t.reward.note}: {p.review_note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {!enabled && (
            <p
              className="mt-6 border border-hairline p-4 text-sm"
              role="status"
            >
              {t.closed}
            </p>
          )}
          {search.failed && (
            <p className="mt-6" role="alert">
              {t.failed}
            </p>
          )}
          {!view.items.length && (
            <p className="mt-8 text-sm leading-relaxed">{t.empty}</p>
          )}
          <p className="mt-4 text-sm opacity-70">{t.buyer}</p>
          {view.items.map((item) => {
            const q = item.quote,
              expired = q && new Date(q.validUntil) <= new Date();
            return (
              <section
                key={item.id}
                className="mt-10 border-t border-hairline pt-6"
              >
                <h2 className="text-xl font-semibold">
                  {t.quote} · {q?.revision}
                </h2>
                <p className="mt-2 text-sm">
                  {t.status}: {t.states[item.status as keyof typeof t.states]}
                </p>
                {q && (
                  <dl className="mt-5 grid gap-4 text-sm">
                    <div>
                      <dt className="font-semibold">{t.total}</dt>
                      <dd className="mt-1 text-2xl font-semibold tabular-nums">
                        {formatKrw(q.totalKrw, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">{t.tax}</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">
                        {q.taxBasis}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">{t.terms}</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words leading-relaxed">
                        {q.termsSummary}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">{t.termsRef}</dt>
                      <dd className="mt-1 break-words">{q.termsRef}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">{t.valid}</dt>
                      <dd className="mt-1">
                        {formatBrandTimestamp(q.validUntil, locale)}
                      </dd>
                    </div>
                  </dl>
                )}
                {expired && <p className="mt-5 text-sm">{t.expired}</p>}
                {enabled &&
                  view.canBuy &&
                  q &&
                  !expired &&
                  item.status === "quoted" &&
                  q.status === "proposed" && (
                    <FundingAction
                      locale={locale}
                      operation="quote.accept"
                      input={{ quoteId: q.id, revision: q.revision }}
                      label={t.accept}
                      consent
                    />
                  )}
                {enabled &&
                  view.canBuy &&
                  item.status === "accepted" &&
                  q &&
                  !expired &&
                  !item.payments.some((p) =>
                    [
                      "confirming",
                      "awaiting_deposit",
                      "paid",
                      "review",
                      "refund_pending",
                      "refunded",
                    ].includes(p.status),
                  ) && (
                    <FundingAction
                      locale={locale}
                      operation="order.create"
                      input={{ caseId: item.id }}
                      label={t.pay}
                    />
                  )}
                <h3 className="mt-8 font-semibold">{t.receipt}</h3>
                {!item.payments.length && (
                  <p className="mt-3 text-sm">{t.noReceipt}</p>
                )}
                <ul className="mt-4 divide-y divide-hairline">
                  {item.payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-4 py-4 text-sm"
                    >
                      <div>
                        <p>
                          {t.states[p.status as keyof typeof t.states]} ·{" "}
                          {formatKrw(p.amountKrw, locale)}
                        </p>
                        <p className="mt-1 opacity-70">
                          {p.environment === "live"
                            ? t.live
                            : p.environment === "fake"
                              ? t.fake
                              : t.test}
                        </p>
                      </div>
                      {view.canBuy && p.status === "pending" && enabled && (
                        <a
                          className="bw-button"
                          href={`/brand/projects/${id}/funding/${p.id}`}
                        >
                          {t.pay}
                        </a>
                      )}
                      {view.canBuy &&
                        [
                          "confirming",
                          "awaiting_deposit",
                          "refund_pending",
                        ].includes(p.status) && (
                          <FundingStatus
                            locale={locale}
                            projectId={id}
                            orderId={p.id}
                            status={p.status}
                          />
                        )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <a className="bw-button mt-6" href={`/brand/projects/${id}/funding`}>
            {t.refresh}
          </a>
        </>
      )}
    </section>
  );
}
