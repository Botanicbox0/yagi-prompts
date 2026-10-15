import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatKrw, localize } from "@/lib/i18n/format";
import { loadFundingAdmin } from "@/lib/campaigns/funding/service";
import { fundingDeps } from "@/lib/campaigns/funding/runtime";
import { open, environmentMatches } from "@/lib/campaigns/funding/core";
import { fundingCopy } from "@/messages/campaign-funding";
import {
  AdminShell,
  Panel,
  Field,
  OpForm,
  ConfirmCheck,
  OutcomeBanner,
  INPUT,
  BUTTON,
  BUTTON_PRIMARY,
} from "@/components/admin/chrome";
export const dynamic = "force-dynamic";
export default async function FundingAdmin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, sql, locale, query] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    searchParams,
  ]);
  const dict = getDictionary(locale),
    t = fundingCopy(locale);
  const view = sql ? await loadFundingAdmin(sql, viewer) : null;
  if (sql && !view) notFound();
  const deps = sql ? fundingDeps(sql) : null;
  const enabled = deps !== null && open(deps);
  const recovery = deps !== null && environmentMatches(deps);
  return (
    <AdminShell dict={dict.admin} locale={locale} active="funding">
      <div data-campaign-funding>
        <h1 className="text-3xl font-semibold">{t.adminTitle}</h1>
        <p className="mt-4 max-w-prose text-sm leading-relaxed">{t.intro}</p>
        <OutcomeBanner
          dict={dict.admin}
          ok={typeof query.ok === "string" ? query.ok : undefined}
          err={typeof query.err === "string" ? query.err : undefined}
          detail={typeof query.detail === "string" ? query.detail : undefined}
        />
        {!view?.ready ? (
          <p role="status" className="mt-6">
            {t.unavailable}
          </p>
        ) : (
          <>
            {!enabled && (
              <p
                role="status"
                className="mt-6 border border-hairline p-4 text-sm"
              >
                {t.closed}
              </p>
            )}
            <Panel title={t.reward.history}>
              <p className="mb-5 max-w-prose text-sm leading-relaxed">
                {t.reward.hint}
              </p>
              {!view.proposals.length && (
                <p className="text-sm">{t.reward.empty}</p>
              )}
              <ul className="divide-y divide-hairline">
                {view.proposals.map((p) => (
                  <li key={p.id} className="py-5">
                    <p className="text-sm font-semibold">
                      {formatKrw(p.amount_krw, locale)} · {t.reward[p.state]}
                    </p>
                    <a
                      className="mt-2 inline-block text-sm text-accent underline"
                      href={`/admin/campaigns/${p.campaign_id}`}
                    >
                      {t.campaign}
                    </a>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {p.conditions}
                    </p>
                    {p.state === "proposed" ? (
                      <OpForm
                        op="campaignFunding.reviewReward"
                        back="/admin/funding"
                        className="mt-4 grid gap-3"
                      >
                        <input name="proposalId" value={p.id} type="hidden" />
                        <Field label={t.status}>
                          <select name="state" className={INPUT}>
                            <option value="reviewed">
                              {t.reward.reviewed}
                            </option>
                            <option value="declined">
                              {t.reward.declined}
                            </option>
                          </select>
                        </Field>
                        <Field label={t.reward.note}>
                          <textarea
                            name="note"
                            required
                            minLength={1}
                            maxLength={1000}
                            className={INPUT}
                          />
                        </Field>
                        <div>
                          <button className={BUTTON}>{t.reward.review}</button>
                        </div>
                      </OpForm>
                    ) : (
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                        {p.review_note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={t.createQuote}>
              <p className="mb-5 max-w-prose text-sm leading-relaxed">
                {t.quoteHint}
              </p>
              {!view.campaigns.length ? (
                <p>{t.noCampaign}</p>
              ) : (
                <OpForm
                  op="campaignFunding.quote"
                  back="/admin/funding"
                  className="grid gap-5"
                >
                  <input type="hidden" name="requestId" value={randomUUID()} />
                  <Field label={t.campaign}>
                    <select name="campaignId" required className={INPUT}>
                      {view.campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {localize(
                            c.title as { en: string; ko: string },
                            locale,
                          )}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label={t.total}>
                      <input
                        name="totalKrw"
                        type="number"
                        required
                        min={1}
                        max={2147483647}
                        step={1}
                        className={INPUT}
                      />
                    </Field>
                    <Field label={t.valid} hint={t.validHint}>
                      <input
                        name="validUntil"
                        type="datetime-local"
                        required
                        className={INPUT}
                      />
                    </Field>
                  </div>
                  <Field label={t.tax}>
                    <textarea
                      name="taxBasis"
                      required
                      maxLength={1000}
                      rows={2}
                      className={INPUT}
                    />
                  </Field>
                  <Field label={t.terms}>
                    <textarea
                      name="termsSummary"
                      required
                      maxLength={4000}
                      rows={5}
                      className={INPUT}
                    />
                  </Field>
                  <Field label={t.termsRef}>
                    <input
                      name="termsRef"
                      required
                      maxLength={200}
                      className={INPUT}
                    />
                  </Field>
                  <div>
                    <button className={BUTTON_PRIMARY}>{t.createQuote}</button>
                  </div>
                </OpForm>
              )}
            </Panel>
            <OpForm
              op="campaignFunding.reconcile"
              back="/admin/funding"
              className="mt-8"
            >
              <button className={BUTTON}>{t.reconcile}</button>
            </OpForm>
            {view.items.map((item) => (
              <Panel key={item.id} title={item.projectTitle}>
                <div id={`case-${item.id}`}>
                  <p className="text-sm">
                    {t.status}: {t.states[item.status as keyof typeof t.states]}
                  </p>
                  <a
                    className="mt-3 inline-block text-sm text-accent underline"
                    href={`/admin/campaigns/${item.campaignId}`}
                  >
                    {dict.admin.navCampaigns}
                  </a>
                  {item.quote && (
                    <div className="mt-5 grid gap-2 text-sm">
                      <p>
                        {t.quote} #{item.quote.revision} ·{" "}
                        {formatKrw(item.quote.totalKrw, locale)} ·{" "}
                        {formatBrandTimestamp(item.quote.validUntil, locale)}
                      </p>
                      <p className="whitespace-pre-wrap break-words">
                        {item.quote.taxBasis}
                      </p>
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {item.quote.termsSummary}
                      </p>
                      <p>
                        {t.termsRef}: {item.quote.termsRef}
                      </p>
                    </div>
                  )}
                  {item.status === "accepted" &&
                    item.quote &&
                    new Date(item.quote.validUntil) <= new Date() && (
                      <OpForm
                        op="campaignFunding.voidExpired"
                        back="/admin/funding"
                        className="mt-6 grid gap-3"
                      >
                        <input name="caseId" type="hidden" value={item.id} />
                        <Field label={t.voidReason}>
                          <textarea
                            name="reason"
                            required
                            minLength={1}
                            maxLength={1000}
                            className={INPUT}
                          />
                        </Field>
                        <ConfirmCheck label={t.confirmVoid} />
                        <div>
                          <button className={BUTTON}>{t.voidQuote}</button>
                        </div>
                      </OpForm>
                    )}
                  <ul className="mt-6 divide-y divide-hairline">
                    {item.payments.map((p) => (
                      <li key={p.id} className="py-5 text-sm">
                        <p>
                          {t.states[p.status as keyof typeof t.states]} ·{" "}
                          {formatKrw(p.amountKrw, locale)} ·{" "}
                          {p.environment === "live"
                            ? t.live
                            : p.environment === "test"
                              ? t.test
                              : t.fake}
                        </p>
                        {recovery && ["paid", "review"].includes(p.status) && (
                          <OpForm
                            op="campaignFunding.refund"
                            back="/admin/funding"
                            className="mt-4 grid gap-3"
                          >
                            <input
                              name="paymentId"
                              value={p.id}
                              type="hidden"
                            />
                            <p className="max-w-prose leading-relaxed">
                              {t.refundHint}
                            </p>
                            <Field label={t.reason}>
                              <textarea
                                name="reason"
                                required
                                minLength={1}
                                maxLength={1000}
                                className={INPUT}
                              />
                            </Field>
                            <ConfirmCheck label={t.confirmRefund} />
                            <div>
                              <button className={BUTTON}>{t.refund}</button>
                            </div>
                          </OpForm>
                        )}
                        {recovery &&
                          ["confirming", "awaiting_deposit", "review"].includes(
                            p.status,
                          ) && (
                            <OpForm
                              op="campaignFunding.releaseUnpaid"
                              back="/admin/funding"
                              className="mt-5 grid gap-3"
                            >
                              <input
                                name="paymentId"
                                type="hidden"
                                value={p.id}
                              />
                              <p className="max-w-prose text-sm leading-relaxed">
                                {t.releaseHint}
                              </p>
                              <Field label={t.voidReason}>
                                <textarea
                                  name="reason"
                                  required
                                  minLength={1}
                                  maxLength={1000}
                                  className={INPUT}
                                />
                              </Field>
                              <ConfirmCheck label={t.confirmRelease} />
                              <div>
                                <button className={BUTTON}>
                                  {t.releaseOrder}
                                </button>
                              </div>
                            </OpForm>
                          )}
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
            ))}
          </>
        )}
      </div>
    </AdminShell>
  );
}
