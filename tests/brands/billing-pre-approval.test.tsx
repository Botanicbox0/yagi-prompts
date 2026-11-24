import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingPageClient } from '@/components/brand-billing/billing-page-client';
import { BillingRequestForm } from '@/components/brand-billing/billing-request-form';
import { billingPlanCatalogue } from '@/lib/brands/billing-page-data';
import type { CustomerBrandBillingPayload } from '@/lib/brands/billing-ui';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * Before approval (no plan and no allowance at all) the billing page offers only the existing "이용 신청"
 * path: no extra-credit request next to an all-zero usage card, and no extra-credit tab in the request
 * dialog it opens. A workspace with any cap (plan, override, trial or other grants) is unchanged.
 */
const ORG = 'd4444444-4444-4444-8444-444444444444';
const copy = getDictionary('ko').brandBilling.customer;
const catalogue = billingPlanCatalogue();

const PLAN: NonNullable<CustomerBrandBillingPayload['plan']> = {
  id: 'b2b_29',
  name: 'Plan 29',
  monthlyListKrw: 290_000,
  billingMode: 'invoice',
  startedOn: '2026-11-01',
  endsOn: null,
  active: true,
  inGrace: false,
  seats: null,
};

function billing(over: { plan?: CustomerBrandBillingPayload['plan']; capCredits?: number; extraCredits?: number; source?: 'override' | 'plan' | 'default' } = {}): CustomerBrandBillingPayload {
  const extra = over.extraCredits ?? 0;
  const cap = over.capCredits ?? 0;
  return {
    organizationId: ORG,
    plan: over.plan ?? null,
    allowance: {
      capKrw: cap * 10,
      baseCapKrw: (cap - extra) * 10,
      extraKrw: extra * 10,
      usedKrw: 0,
      capCredits: cap,
      baseCapCredits: cap - extra,
      extraCredits: extra,
      usedCredits: 0,
      remainingCredits: cap,
      source: over.source ?? 'default',
      resetsOn: '2026-12-01',
      resetsAt: '2026-11-30T15:00:00.000Z',
    },
    activeDiscount: null,
    invoices: [],
    billingProfile: null,
  };
}

const page = (initialBilling: CustomerBrandBillingPayload) => (
  <BillingPageClient
    organizationId={ORG}
    organizationName="Fixture brand"
    initialBilling={initialBilling}
    planCatalogue={catalogue}
    todayKst="2026-11-24"
    copy={copy}
    locale="ko"
  />
);

const mounted: MountedDom[] = [];
afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

describe('billing page before approval', () => {
  it('offers only the plan request when there is no plan and no allowance', () => {
    const html = renderToStaticMarkup(page(billing()));
    expect(html).not.toContain('data-billing-allowance-request');
    expect(html).not.toContain(copy.usageSection.requestCreditsCta);
    expect(html).toContain('data-billing-plan-request');
    expect(html).toContain(copy.planSection.requestCta);
  });

  it('is unchanged for a workspace with any cap: plan, override or grants only', () => {
    const cases: Array<[string, CustomerBrandBillingPayload]> = [
      ['plan', billing({ plan: PLAN, capCredits: 29_000, source: 'plan' })],
      ['override, no plan', billing({ capCredits: 5_000, source: 'override' })],
      ['grants only, no plan', billing({ capCredits: 3_000, extraCredits: 3_000 })],
    ];
    for (const [name, state] of cases) {
      const html = renderToStaticMarkup(page(state));
      expect(html, name).toContain('data-billing-allowance-request');
      expect(html, name).toContain(copy.usageSection.requestCreditsCta);
    }
  });

  it('opens the request dialog without the extra-credit tab before approval, and with it afterwards', async () => {
    const before = await mountDom(page(billing()));
    mounted.push(before);
    await before.click('[data-billing-plan-request]');
    // Booleans, not elements: the test runner cannot print the harness's fake elements.
    expect(Boolean(before.query('[data-billing-request-dialog]'))).toBe(true);
    expect(before.query('[data-billing-intent="plan_request"]')?.getAttribute('aria-checked')).toBe('true');
    expect(Boolean(before.query('[data-billing-intent="plan_question"]'))).toBe(true);
    expect(Boolean(before.query('[data-billing-intent="allowance_request"]'))).toBe(false);
    await mounted.pop()!.unmount();

    const after = await mountDom(page(billing({ capCredits: 3_000, extraCredits: 3_000 })));
    mounted.push(after);
    await after.click('[data-billing-allowance-request]');
    expect(after.query('[data-billing-intent="allowance_request"]')?.getAttribute('aria-checked')).toBe('true');
    expect(Boolean(after.query('[data-billing-intent="plan_request"]'))).toBe(true);
  });

  it('lets the request form leave out intents it is told to hide, keeping the order of the rest', () => {
    const intents = (html: string) => [...html.matchAll(/data-billing-intent="([a-z_]+)"/g)].map((m) => m[1]);
    const shared = { organizationId: ORG, copy: copy.requestForm, tierNames: copy.planSection.tierNames, planCatalogue: catalogue };
    expect(intents(renderToStaticMarkup(<BillingRequestForm {...shared} />))).toEqual(['plan_request', 'allowance_request', 'plan_question']);
    expect(intents(renderToStaticMarkup(<BillingRequestForm {...shared} hiddenIntents={['allowance_request']} />))).toEqual([
      'plan_request',
      'plan_question',
    ]);
  });
});
