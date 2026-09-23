import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { loadBrandUsage } from "@/lib/brands/usage/service";
import { usagePaymentsOpen } from "@/lib/brands/usage/runtime";
import { getTossGateway, tossConfigFromEnv } from "@/lib/billing/toss-gateway";
import { formatKrw } from "@/lib/i18n/format";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { UsageCheckout } from "@/components/brand-workspace/usage-checkout";

/**
 * Pay an accepted secondary-usage quote (docs/SECONDARY-USAGE.md). Every term is fixed before this
 * page: the amount shown and charged is the accepted quote's total, re-checked on the server.
 */
export const dynamic = "force-dynamic";
export default async function UsagePay({ params, searchParams }: { params: Promise<{ id: string; caseId: string }>; searchParams: Promise<{ failed?: string }> }) {
  const [{ id, caseId }, { sql, viewer, verifiedEmail, b, locale }, search] = await Promise.all([params, brandContext(), searchParams]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const view = await loadBrandUsage({ sql, verifiedEmail, paymentsOpen: usagePaymentsOpen() }, viewer, id);
  const item = view?.cases.find((c) => c.id === caseId);
  if (!view || !item) notFound();
  const u = b.secondaryUsage, p = u.payment;
  let gateway = null;
  try { gateway = getTossGateway(); } catch { gateway = null; }
  const canPay = item.actions.pay && item.quote !== null && gateway !== null;
  let clientKey: string | null = null;
  if (canPay && gateway!.kind !== "fake") { try { clientKey = tossConfigFromEnv()?.clientKey ?? null; } catch { clientKey = null; } }
  return (
    <div className="bw-usage-pay" data-usage-pay-page={item.state}>
      <a href={`/brand/projects/${id}#usage`}>← {p.back}</a>
      <h1>{p.title}</h1>
      <p className="bw-muted">{p.summary}</p>
      {item.quote && (
        <div className="bw-panel bw-row">
          <div>
            <strong>{u.quote.title} · {item.quote.revision}</strong>
            <p className="bw-muted">{u.quote.validUntil}: {formatBrandTimestamp(item.quote.validUntil, locale)}</p>
            {item.quote.contract && <a href={item.quote.contract.url} target="_blank" rel="noopener noreferrer">{u.quote.contract}: {item.quote.contract.title} v{item.quote.contract.version} ↗</a>}
          </div>
          <div className="bw-usage-total"><small>{p.amount}</small><strong>{formatKrw(item.quote.totalKrw, locale)}</strong><small>{item.quote.taxBasis === "included" ? u.quote.taxIncluded : u.quote.taxExcluded}</small></div>
        </div>
      )}
      {search.failed === "1" && <p role="alert" className="bw-error">{p.failed}</p>}
      {canPay ? (
        <UsageCheckout caseId={item.id} projectId={id} amount={item.quote!.totalKrw} kind={gateway!.kind} clientKey={clientKey}
          customerKey={viewer.userId!} locale={locale} copy={p} />
      ) : (
        <p className="bw-note" role="status">{item.state === "awaiting_payment" || item.state === "quoted" ? p.unavailable : u.stateHints[item.state]}</p>
      )}
    </div>
  );
}
