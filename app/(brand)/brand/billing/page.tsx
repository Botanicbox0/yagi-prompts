import { notFound } from 'next/navigation';
import { BillingPageClient } from '@/components/brand-billing/billing-page-client';
import s from '@/components/brand-billing/brand-billing.module.css';
import { BrandUnavailable } from '@/components/brand-workspace/brand-unavailable';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope } from '@/components/brand-workspace/scope';
import { adminOrganizationHref, StaffNotice } from '@/components/brand-workspace/staff-notice';
import { studioEnv } from '@/lib/brand-studio/env';
import { billingPlanCatalogue, loadBrandBillingPageState } from '@/lib/brands/billing-page-data';
import { isSandboxedClientOrganization } from '@/lib/brands/features';

export const dynamic = 'force-dynamic';

export default async function BrandBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b, dict, locale }] =
    await Promise.all([searchParams, brandContext()]);
  const c = dict.brandBilling.customer;
  const pageLocale = locale === 'en' ? 'en' : 'ko';

  if (!sql) {
    return (
      <main className={s.page} data-billing-state="unavailable">
        <section className={s.emptyPanel}>
          <h1 className={s.title}>{c.access.unavailableTitle}</h1>
          <p className={s.lead}>{c.access.unavailableBody}</p>
        </section>
      </main>
    );
  }

  const rawOrgParam = Array.isArray(organizationId) ? organizationId[0] : organizationId;
  if (rawOrgParam && isSandboxedClientOrganization({ id: rawOrgParam, name: '' })) {
    notFound();
  }

  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (choice && isSandboxedClientOrganization(choice)) {
    notFound();
  }
  if (selection.state === 'unavailable' || !choice) {
    return <BrandUnavailable b={b} />;
  }

  const state = await loadBrandBillingPageState(
    { sql, env: studioEnv(), locale: pageLocale },
    viewer,
    choice,
  );

  if (state.kind === 'not_found') {
    notFound();
  }
  if (state.kind === 'sign_in') {
    return <BrandUnavailable b={b} />;
  }
  if (state.kind === 'unavailable') {
    return (
      <main className={s.page} data-billing-state="unavailable">
        <section className={s.emptyPanel}>
          <h1 className={s.title}>{c.access.unavailableTitle}</h1>
          <p className={s.lead}>{c.access.unavailableBody}</p>
        </section>
      </main>
    );
  }
  if (state.kind === 'forbidden') {
    return (
      <main className={s.page} data-billing-state="forbidden">
        <section className={s.emptyPanel}>
          <h1 className={s.title}>{c.access.forbiddenTitle}</h1>
          <p className={s.lead}>{c.access.forbiddenBody}</p>
        </section>
      </main>
    );
  }

  return (
    <BillingPageClient
      organizationId={choice.id}
      organizationName={choice.name}
      initialBilling={state.billing}
      planCatalogue={billingPlanCatalogue()}
      todayKst={state.todayKst}
      graceDays={state.graceDays}
      copy={c}
      locale={pageLocale}
      readOnly={state.staffReadOnly}
      notice={
        state.staffReadOnly ? (
          <StaffNotice
            b={b}
            manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null}
          />
        ) : null
      }
    />
  );
}
