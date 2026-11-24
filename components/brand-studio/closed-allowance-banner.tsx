'use client';

import { useEffect, useState } from 'react';
import { BillingRequestDialog } from '@/components/brand-billing/billing-request-form';
import type { BillingPlanCatalogueItem } from '@/lib/brands/billing-ui';
import type { BrandBillingCopy } from '@/messages/brand-billing';
import type { StudioCopy } from './copy';

type RequestedCopyKey = 'closedRequestedTitle' | 'closedRequestedBody' | 'closedRequestedAction';

/** The dock copy this banner reads; the requested-state strings may be missing (older dictionaries). */
export type ClosedAllowanceDockCopy = Omit<StudioCopy['dock'], RequestedCopyKey> &
  Partial<Pick<StudioCopy['dock'], RequestedCopyKey>>;

/**
 * The closed studio's explanation and its request button. Once the organization has sent a studio access
 * request (read once on mount from `/api/brand-workspace/access-request`, or a request just sent from this
 * banner's dialog) it says so and the button becomes a quieter follow-up into the same dialog. Until the
 * answer arrives, or when it cannot be read, it is the plain closed banner.
 */
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
  dockCopy: ClosedAllowanceDockCopy;
  billingCopy?: BrandBillingCopy['customer'];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  locale?: 'ko' | 'en';
  surface?: string;
}) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const canOpenDialog = Boolean(billingCopy);

  useEffect(() => {
    // Another organization's answer never carries over.
    setRequested(false);
    if (!canOpenDialog || !organizationId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `/api/brand-workspace/access-request?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { ok?: unknown; requested?: unknown } | null;
        if (!controller.signal.aborted && body?.ok === true && body.requested === true) setRequested(true);
      } catch {
        // Unknown: keep the plain closed banner.
      }
    })();
    return () => controller.abort();
  }, [canOpenDialog, organizationId]);

  const title = requested ? (dockCopy.closedRequestedTitle ?? dockCopy.closedTitle) : dockCopy.closedTitle;
  const body = requested ? (dockCopy.closedRequestedBody ?? dockCopy.closedBody) : dockCopy.closedBody;
  const action = requested ? (dockCopy.closedRequestedAction ?? dockCopy.closedAction) : dockCopy.closedAction;

  return (
    <section
      className="bs-closed"
      data-studio-allowance-closed
      data-studio-closed-requested={requested ? true : undefined}
    >
      <h2>{title}</h2>
      <p>{body}</p>
      <button
        type="button"
        className="bs-btn"
        data-variant={requested ? 'soft' : 'solid'}
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
        {action}
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
          onSuccess={({ intent }) => {
            if (intent === 'plan_request' || intent === 'allowance_request') setRequested(true);
          }}
        />
      ) : null}
    </section>
  );
}
