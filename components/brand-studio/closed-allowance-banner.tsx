'use client';

import { useState } from 'react';
import { BillingRequestDialog } from '@/components/brand-billing/billing-request-form';
import type { BillingPlanCatalogueItem } from '@/lib/brands/billing-ui';
import type { BrandBillingCopy } from '@/messages/brand-billing';
import type { StudioCopy } from './copy';

export function ClosedAllowanceBanner({
  organizationId,
  organizationName: _organizationName,
  dockCopy,
  billingCopy,
  planCatalogue,
  locale = 'ko',
  surface = 'studio_closed_banner',
}: {
  organizationId: string;
  organizationName?: string | null;
  dockCopy: StudioCopy['dock'];
  billingCopy?: BrandBillingCopy['customer'];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  locale?: 'ko' | 'en';
  surface?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="bs-closed" data-studio-allowance-closed>
      <h2>{dockCopy.closedTitle}</h2>
      <p>{dockCopy.closedBody}</p>
      <button
        type="button"
        className="bs-btn"
        data-variant="solid"
        data-size="md"
        data-studio-closed-request
        onClick={() => {
          if (billingCopy) {
            setOpen(true);
          } else if (typeof window !== 'undefined' && organizationId) {
            window.location.assign(`/brand/billing?organizationId=${encodeURIComponent(organizationId)}`);
          }
        }}
      >
        {dockCopy.closedAction}
      </button>
      {billingCopy ? (
        <BillingRequestDialog
          open={open}
          onClose={() => setOpen(false)}
          organizationId={organizationId}
          copy={billingCopy.requestForm}
          tierNames={billingCopy.planSection.tierNames}
          planCatalogue={planCatalogue}
          vatLabel={billingCopy.planSection.vatSeparate}
          locale={locale}
          initialIntent="plan_request"
          surface={surface}
        />
      ) : null}
    </section>
  );
}
