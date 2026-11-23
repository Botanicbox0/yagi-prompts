'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { formatCredits } from '@/lib/brand-studio/credits';
import { BRAND_PLAN_GRACE_DAYS_DEFAULT, kstDayOf } from '@/lib/brands/billing/math';
import {
  BILLING_PROFILE_FIELDS,
  billingProfileCompleteness,
  emptyBillingProfileValues,
  formatKrwAmount,
  formatKstDateLabel,
  resolvePlanLifecycle,
  validateBillingProfileFieldError,
  type BillingPlanCatalogueItem,
  type BillingRequestIntent,
  type CustomerBillingProfileValues,
  type CustomerBrandBillingPayload,
} from '@/lib/brands/billing-ui';
import type { BrandBillingCopy } from '@/messages/brand-billing';
import { BillingRequestDialog, type DesiredPlanChoice } from './billing-request-form';
import s from './brand-billing.module.css';

export interface BillingPageClientProps {
  organizationId: string;
  organizationName: string;
  initialBilling: CustomerBrandBillingPayload;
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  todayKst?: string;
  graceDays?: number;
  copy: BrandBillingCopy['customer'];
  locale: 'ko' | 'en';
  readOnly?: boolean;
  notice?: ReactNode;
}

export function BillingPageClient({
  organizationId,
  organizationName,
  initialBilling,
  planCatalogue = [],
  todayKst,
  graceDays = BRAND_PLAN_GRACE_DAYS_DEFAULT,
  copy,
  locale,
  readOnly = false,
  notice = null,
}: BillingPageClientProps) {
  const [billing, setBilling] = useState<CustomerBrandBillingPayload>(initialBilling);
  const [selectedCataloguePlan, setSelectedCataloguePlan] =
    useState<Exclude<DesiredPlanChoice, 'undecided'>>('b2b_29');

  // Request dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogIntent, setDialogIntent] = useState<BillingRequestIntent>('plan_request');
  const [dialogPlan, setDialogPlan] = useState<DesiredPlanChoice>('undecided');

  // Discount redeem state
  const [discountCode, setDiscountCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemFeedback, setRedeemFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  // Billing profile state
  const [profileValues, setProfileValues] = useState<CustomerBillingProfileValues>(() =>
    emptyBillingProfileValues(initialBilling.billingProfile),
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  const profileErrors = useMemo(
    () => validateBillingProfileFieldError(profileValues),
    [profileValues],
  );
  const completeness = useMemo(
    () => billingProfileCompleteness(billing.billingProfile),
    [billing.billingProfile],
  );

  async function refreshBilling(): Promise<void> {
    if (readOnly) return;
    try {
      const res = await fetch(
        `/api/brand-billing?organizationId=${encodeURIComponent(organizationId)}`,
        { cache: 'no-store' },
      );
      const json = (await res.json().catch(() => null)) as
        | ({ ok: true } & CustomerBrandBillingPayload)
        | null;
      if (res.ok && json?.ok) {
        setBilling(json);
      }
    } catch {
      // Ignore silent refresh failures
    }
  }

  function openRequestDialog(intent: BillingRequestIntent, desired: DesiredPlanChoice = 'undecided') {
    if (readOnly) return;
    setDialogIntent(intent);
    setDialogPlan(desired);
    setDialogOpen(true);
  }

  async function handleRedeemSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || redeeming) return;
    const trimmed = discountCode.trim();
    if (!trimmed) {
      setRedeemFeedback({ kind: 'error', text: copy.discountSection.errors.invalid });
      return;
    }
    setRedeeming(true);
    setRedeemFeedback(null);
    try {
      const res = await fetch('/api/brand-billing/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, code: trimmed }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        replaced?: boolean;
        activeDiscount?: CustomerBrandBillingPayload['activeDiscount'];
        code?: string;
      };
      if (res.ok && json.ok) {
        if (json.activeDiscount) {
          setBilling((prev) => ({
            ...prev,
            activeDiscount: json.activeDiscount ?? prev.activeDiscount,
          }));
        }
        const msg = json.replaced
          ? copy.discountSection.redeemReplacedPlain.replace(
              '{percent}',
              String(json.activeDiscount?.percent ?? ''),
            )
          : copy.discountSection.redeemSuccessPlain;
        setRedeemFeedback({ kind: 'success', text: msg });
        setDiscountCode('');
        await refreshBilling();
        return;
      }

      const code = json.code ?? '';
      if (code === 'code_unavailable') {
        setRedeemFeedback({
          kind: 'error',
          text: copy.discountSection.errors.code_unavailable,
        });
      } else if (code === 'rate_limited' || res.status === 429) {
        setRedeemFeedback({ kind: 'error', text: copy.discountSection.errors.rate_limited });
      } else if (code === 'forbidden' || res.status === 403) {
        setRedeemFeedback({ kind: 'error', text: copy.discountSection.errors.forbidden });
      } else if (code === 'invalid') {
        setRedeemFeedback({
          kind: 'error',
          text: copy.discountSection.errors.invalid,
        });
      } else {
        setRedeemFeedback({ kind: 'error', text: copy.discountSection.errors.unavailable });
      }
    } catch {
      setRedeemFeedback({ kind: 'error', text: copy.discountSection.errors.unavailable });
    } finally {
      setRedeeming(false);
    }
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || profileSaving) return;
    if (profileErrors.businessRegNoInvalid) {
      setProfileFeedback({ kind: 'error', text: copy.profileInvalidRegNo });
      return;
    }
    if (profileErrors.taxInvoiceEmailInvalid) {
      setProfileFeedback({ kind: 'error', text: copy.profileSection.invalidEmail });
      return;
    }
    setProfileSaving(true);
    setProfileFeedback(null);
    try {
      const res = await fetch('/api/brand-billing/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, ...profileValues }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        profile?: CustomerBrandBillingPayload['billingProfile'];
        code?: string;
      };
      if (res.ok && json.ok) {
        if (json.profile) {
          setProfileValues(emptyBillingProfileValues(json.profile));
          setBilling((prev) => ({ ...prev, billingProfile: json.profile ?? null }));
        }
        setProfileFeedback({ kind: 'success', text: copy.profileSaved });
        return;
      }
      setProfileFeedback({ kind: 'error', text: copy.profileSection.saveError });
    } catch {
      setProfileFeedback({ kind: 'error', text: copy.profileSection.saveError });
    } finally {
      setProfileSaving(false);
    }
  }

  const plan = billing.plan;
  const allowance = billing.allowance;
  const usedPct =
    allowance.capCredits > 0
      ? Math.min(100, Math.round((allowance.usedCredits / allowance.capCredits) * 100))
      : 0;

  const resolvedToday = todayKst ?? kstDayOf();
  let planBadgeLabel: string | null = null;
  let planBadgeClass = s.badgeMuted;
  if (plan) {
    const lifecycle = resolvePlanLifecycle(plan, resolvedToday, graceDays);
    if (lifecycle.state === 'upcoming') {
      planBadgeLabel = copy.planSection.startsOnBadge.replace('{date}', plan.startedOn);
      planBadgeClass = s.badgeMuted;
    } else if (lifecycle.state === 'in_grace') {
      planBadgeLabel = copy.planSection.endedGraceBadge
        .replace('{endedDate}', plan.endsOn ?? '')
        .replace('{graceUntil}', lifecycle.graceUntil ?? '');
      planBadgeClass = s.badgeWarn;
    } else if (lifecycle.state === 'ending_on') {
      planBadgeLabel = copy.planSection.endingOnBadge.replace('{date}', plan.endsOn ?? '');
      planBadgeClass = s.badgeWarn;
    } else if (lifecycle.state === 'active') {
      planBadgeLabel = copy.planSection.activeBadge;
      planBadgeClass = s.badgeReady;
    } else {
      planBadgeLabel = copy.planSection.endedBadge;
      planBadgeClass = s.badgeWarn;
    }
  }

  const discountSummaryLine = billing.activeDiscount
    ? (() => {
        const base = copy.discountSummary.replace(
          '{percent}',
          String(billing.activeDiscount.percent),
        );
        if (billing.activeDiscount.openEnded) {
          return copy.discountSection.summaryOpenEnded.replace('{base}', base);
        }
        return copy.discountSection.summaryRemaining
          .replace('{base}', base)
          .replace('{count}', String(billing.activeDiscount.invoicesRemaining ?? 0));
      })()
    : null;

  return (
    <main className={s.page} data-brand-billing-page>
      <header className={s.header}>
        <div className={s.titleGroup}>
          <h1 className={s.title}>{copy.pageTitle}</h1>
          <p className={s.lead}>{copy.pageLead}</p>
        </div>
        <span className={s.orgPill}>{organizationName}</span>
      </header>

      {notice}

      {/* Section 1: Plan */}
      <section className={s.heroPanel} data-billing-section="plan" aria-label={copy.planHeading}>
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>{copy.planHeading}</h2>
          {planBadgeLabel ? <span className={planBadgeClass}>{planBadgeLabel}</span> : null}
        </div>

        {plan ? (
          <>
            <div className={s.well}>
              <div className={s.metricRow}>
                <span className={s.metricPrimary}>{plan.name}</span>
                <span className={s.metricSecondary}>
                  {copy.planSection.monthlyFee
                    .replace('{amount}', formatKrwAmount(plan.monthlyListKrw, locale))
                    .replace('{vat}', copy.planSection.vatSeparate)}
                </span>
              </div>
              <dl className={s.kvList}>
                <div className={s.kvRow}>
                  <dt>{copy.planSection.periodLabel}</dt>
                  <dd>
                    {plan.endsOn
                      ? copy.planSection.rangedPeriod
                          .replace('{start}', plan.startedOn)
                          .replace('{end}', plan.endsOn)
                      : copy.planSection.openPeriod.replace('{start}', plan.startedOn)}
                  </dd>
                </div>
              </dl>
            </div>
            {!readOnly ? (
              <div className={s.actionsRow}>
                <button
                  type="button"
                  className={s.ctaSecondary}
                  data-billing-plan-question
                  onClick={() => openRequestDialog('plan_question', 'undecided')}
                >
                  {copy.planSection.questionCta}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className={s.panelSub}>{copy.planSection.noPlanBody}</p>
            <div className={s.field}>
              <span className={s.fieldLabel}>{copy.planSection.catalogueTitle}</span>
              <div className={s.catalogueGrid} data-billing-plan-catalogue>
                {planCatalogue.map((tier) => {
                  const selected = selectedCataloguePlan === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      disabled={readOnly}
                      data-catalogue-tier={tier.id}
                      className={selected ? `${s.planTier} ${s.planTierSelected}` : s.planTier}
                      onClick={() => setSelectedCataloguePlan(tier.id)}
                    >
                      <span className={s.planTierName}>{copy.planSection.tierNames[tier.id]}</span>
                      <span className={s.planTierFee}>
                        {formatKrwAmount(tier.monthlyKrw, locale)}
                      </span>
                      <span className={s.planTierMeta}>{copy.planSection.vatSeparate}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {!readOnly ? (
              <div className={s.actionsRow}>
                <button
                  type="button"
                  className={s.ctaPrimary}
                  data-variant="solid"
                  data-billing-plan-request
                  onClick={() => openRequestDialog('plan_request', selectedCataloguePlan)}
                >
                  {copy.planSection.requestCta}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <div className={s.gridTwo}>
        {/* Section 2: Usage this month (credits only - NEVER KRW) */}
        <section
          className={s.panel}
          data-billing-section="usage"
          aria-label={copy.allowanceHeading}
        >
          <div className={s.panelHead}>
            <h2 className={s.panelTitle}>{copy.allowanceHeading}</h2>
            <span className={s.badgeMuted}>
              {copy.allowanceSources[allowance.source]}
            </span>
          </div>

          <div className={s.well}>
            <div className={s.metricRow}>
              <span className={s.metricPrimary}>
                {formatCredits(allowance.remainingCredits, locale)}
              </span>
              <span className={s.metricSecondary}>
                {copy.usageSection.ratio
                  .replace('{used}', formatCredits(allowance.usedCredits, locale))
                  .replace('{cap}', formatCredits(allowance.capCredits, locale))}
              </span>
            </div>
            <div className={s.meterTrack} aria-hidden="true">
              <div className={s.meterFill} style={{ width: `${usedPct}%` }} />
            </div>
            <dl className={s.kvList}>
              <div className={s.kvRow}>
                <dt>{copy.allowanceBaseLabel}</dt>
                <dd>{formatCredits(allowance.baseCapCredits, locale)}</dd>
              </div>
              <div className={s.kvRow}>
                <dt>{copy.allowanceExtraLabel}</dt>
                <dd>{formatCredits(allowance.extraCredits, locale)}</dd>
              </div>
              <div className={s.kvRow}>
                <dt>{copy.allowanceRemainingLabel}</dt>
                <dd>{formatCredits(allowance.remainingCredits, locale)}</dd>
              </div>
            </dl>
          </div>

          {billing.extraGrants && billing.extraGrants.length > 0 ? (
            <div className={s.field}>
              <span className={s.fieldLabel}>{copy.usageSection.extraHeading}</span>
              <ul className={s.grantList} data-billing-extra-grants>
                {billing.extraGrants.map((grant) => (
                  <li key={grant.id} className={s.grantItem}>
                    <span>
                      {copy.usageSection.extraGrantItem
                        .replace('{credits}', formatCredits(grant.credits, locale))
                        .replace('{expiryDate}', grant.expiresOn)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className={s.panelSub}>
            {copy.usageSection.reset.replace('{resetDate}', allowance.resetsOn)}
          </p>
          <p className={s.panelSub}>{copy.usageSection.explainer}</p>

          {!readOnly ? (
            <div className={s.actionsRow}>
              <button
                type="button"
                className={s.ctaSecondary}
                data-billing-allowance-request
                onClick={() => openRequestDialog('allowance_request')}
              >
                {copy.usageSection.requestCreditsCta}
              </button>
            </div>
          ) : null}
        </section>

        {/* Section 3: Discount & code redemption */}
        <section
          className={s.panel}
          data-billing-section="discount"
          aria-label={copy.discountHeading}
        >
          <div className={s.panelHead}>
            <h2 className={s.panelTitle}>{copy.discountHeading}</h2>
          </div>

          <div className={s.well}>
            {discountSummaryLine ? (
              <p className={s.studioNoticeText} data-billing-active-discount>
                {discountSummaryLine}
              </p>
            ) : (
              <p className={s.panelSub} data-billing-no-discount>
                {copy.discountNone}
              </p>
            )}
          </div>

          <form className={s.field} onSubmit={handleRedeemSubmit} data-billing-redeem-form>
            <label className={s.fieldLabel} htmlFor="billing-discount-code">
              {copy.redeemHeading}
            </label>
            <div className={s.formRowInline}>
              <input
                id="billing-discount-code"
                type="text"
                name="code"
                className={s.input}
                value={discountCode}
                placeholder={copy.redeemPlaceholder}
                disabled={readOnly || redeeming}
                onChange={(e) => setDiscountCode(e.target.value)}
              />
              <button
                type="submit"
                className={s.ctaSecondary}
                disabled={readOnly || redeeming}
                data-billing-redeem-submit
              >
                {copy.redeemSubmit}
              </button>
            </div>
            {redeemFeedback ? (
              <div
                className={redeemFeedback.kind === 'success' ? s.noticeSuccess : s.noticeWarn}
                role="status"
                data-billing-redeem-feedback={redeemFeedback.kind}
              >
                {redeemFeedback.text}
              </div>
            ) : null}
          </form>
        </section>
      </div>

      {/* Section 4: Invoices (strictly read-only, zero payment controls) */}
      <section
        className={s.panel}
        data-billing-section="invoices"
        aria-label={copy.invoicesHeading}
      >
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>{copy.invoicesHeading}</h2>
        </div>

        <p className={s.panelSub} data-billing-payment-note>
          {copy.invoiceSection.paymentNote}
        </p>

        {billing.invoices.length === 0 ? (
          <div className={s.well} data-billing-invoices-empty>
            <p className={s.panelSub}>{copy.invoicesEmpty}</p>
          </div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} data-billing-invoices-table>
              <thead>
                <tr>
                  <th>{copy.invoiceColumns.period}</th>
                  <th>{copy.invoiceColumns.plan}</th>
                  <th className={s.numCell}>{copy.invoiceColumns.list}</th>
                  <th className={s.numCell}>{copy.invoiceColumns.discount}</th>
                  <th className={s.numCell}>{copy.invoiceColumns.supply}</th>
                  <th className={s.numCell}>{copy.invoiceColumns.vat}</th>
                  <th className={s.numCell}>{copy.invoiceColumns.total}</th>
                  <th>{copy.invoiceColumns.status}</th>
                </tr>
              </thead>
              <tbody>
                {billing.invoices.map((inv) => {
                  const dateLabel =
                    inv.status === 'paid' && inv.paidAt
                      ? `${copy.invoiceSection.paidDate} ${formatKstDateLabel(inv.paidAt)}`
                      : inv.status === 'void' && inv.voidedAt
                        ? `${copy.invoiceSection.voidDate} ${formatKstDateLabel(inv.voidedAt)}`
                        : inv.issuedAt
                          ? `${copy.invoiceSection.issuedDate} ${formatKstDateLabel(inv.issuedAt)}`
                          : null;
                  const statusBadgeClass =
                    inv.status === 'paid'
                      ? s.badgeReady
                      : inv.status === 'void'
                        ? s.badgeMuted
                        : s.badge;
                  return (
                    <tr key={inv.id} data-invoice-status={inv.status}>
                      <td>{inv.period}</td>
                      <td>{inv.planName}</td>
                      <td className={s.numCell}>{formatKrwAmount(inv.listKrw, locale)}</td>
                      <td className={s.numCell}>
                        {inv.discountKrw > 0
                          ? `-${formatKrwAmount(inv.discountKrw, locale)}`
                          : '-'}
                      </td>
                      <td className={s.numCell}>{formatKrwAmount(inv.supplyKrw, locale)}</td>
                      <td className={s.numCell}>{formatKrwAmount(inv.vatKrw, locale)}</td>
                      <td className={s.numCell}>
                        <strong>{formatKrwAmount(inv.totalKrw, locale)}</strong>
                      </td>
                      <td>
                        <div className={s.statusCell}>
                          <span className={statusBadgeClass}>
                            {copy.invoiceStatuses[inv.status]}
                          </span>
                          {inv.overdue ? (
                            <span className={s.badgeWarn}>{copy.invoiceOverdue}</span>
                          ) : null}
                        </div>
                        {dateLabel ? <span className={s.dateMeta}>{dateLabel}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 5: Tax invoice & billing profile */}
      <section
        id="billing-profile"
        className={s.panel}
        data-billing-section="profile"
        aria-label={copy.profileHeading}
      >
        <div className={s.panelHead}>
          <div>
            <h2 className={s.panelTitle}>{copy.profileHeading}</h2>
            <p className={s.panelSub}>{copy.profileHint}</p>
          </div>
          {!completeness.complete ? (
            <span className={s.badgeWarn}>{copy.profileSection.incompleteHint}</span>
          ) : null}
        </div>

        <form className={s.formGrid} onSubmit={handleProfileSave} data-billing-profile-form>
          {BILLING_PROFILE_FIELDS.map((fieldKey) => {
            const isRegNo = fieldKey === 'businessRegNo';
            const isEmail = fieldKey === 'taxInvoiceEmail';
            const invalid =
              (isRegNo && profileErrors.businessRegNoInvalid) ||
              (isEmail && profileErrors.taxInvoiceEmailInvalid);
            const errorText = isRegNo
              ? copy.profileInvalidRegNo
              : isEmail
                ? copy.profileSection.invalidEmail
                : null;
            const isFull = fieldKey === 'businessAddress';
            return (
              <div
                key={fieldKey}
                className={isFull ? `${s.field} ${s.fieldFull}` : s.field}
              >
                <label className={s.fieldLabel} htmlFor={`billing-profile-${fieldKey}`}>
                  {copy.profileFields[fieldKey]}
                </label>
                <input
                  id={`billing-profile-${fieldKey}`}
                  type={isEmail ? 'email' : 'text'}
                  name={fieldKey}
                  className={invalid ? `${s.input} ${s.inputError}` : s.input}
                  aria-invalid={invalid || undefined}
                  value={profileValues[fieldKey]}
                  disabled={readOnly || profileSaving}
                  onChange={(e) =>
                    setProfileValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))
                  }
                />
                {invalid && errorText ? (
                  <p className={s.fieldErrorText} role="alert" data-profile-field-error={fieldKey}>
                    {errorText}
                  </p>
                ) : null}
              </div>
            );
          })}

          {profileFeedback ? (
            <div
              className={`${s.fieldFull} ${
                profileFeedback.kind === 'success' ? s.noticeSuccess : s.noticeWarn
              }`}
              role="status"
              data-billing-profile-feedback={profileFeedback.kind}
            >
              {profileFeedback.text}
            </div>
          ) : null}

          {!readOnly ? (
            <div className={`${s.actionsRow} ${s.fieldFull}`}>
              <button
                type="submit"
                className={plan ? s.ctaPrimary : s.ctaSecondary}
                data-variant={plan ? 'solid' : 'ghost'}
                disabled={profileSaving}
                data-billing-profile-submit
              >
                {copy.profileSave}
              </button>
            </div>
          ) : null}
        </form>
      </section>

      <BillingRequestDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        organizationId={organizationId}
        copy={copy.requestForm}
        tierNames={copy.planSection.tierNames}
        planCatalogue={planCatalogue}
        vatLabel={copy.planSection.vatSeparate}
        locale={locale}
        initialIntent={dialogIntent}
        initialDesiredPlan={dialogPlan}
        profileCompleteness={completeness}
        billingProfileHref="#billing-profile"
        surface="billing_page"
      />
    </main>
  );
}
