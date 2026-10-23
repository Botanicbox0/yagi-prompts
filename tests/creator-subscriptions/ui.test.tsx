import { describe, expect, it, vi } from 'vitest';
import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { SubscriptionPlanComparison } from '@/components/twings/subscription-plan-comparison';
import { parseSubscriptionAvailability } from '@/components/twings/subscription-availability';
import { SubscriptionStatus, subscriptionActionMessage } from '@/components/billing/subscription-status';
import { SubscriptionAuthorization, SubscriptionCheckout } from '@/components/billing/subscription-checkout';
import { readSubscriptionReturn } from '@/components/billing/subscription-return';
import { buildSubscriptionRenderForm, parsePremiumEditBudget, PremiumEditBudgetNotice, SubscriptionPaymentChoice } from '@/components/twings/studio';

const plans = [
  { id: 'creator' as const, price: '24,900원', filmCounts: { 10: 6, 15: 4, 30: 2 } },
  { id: 'premium' as const, price: '49,000원', filmCounts: { 10: 12, 15: 8, 30: 4 } },
];
const ready = { status: 'open' as const, version: 'v1', plans: { creator: { status: 'open' as const }, premium: { status: 'preparing' as const } }, editing: 'preparing' as const };

describe('monthly plans follow server readiness', () => {
  it('opens only the verified plan and leaves unfinished Premium browsing examples', () => {
    const html = renderToStaticMarkup(<SubscriptionPlanComparison plans={plans} copy={getDictionary('ko').pricing} browseHref="/ko/video" initialAvailability={ready} />);
    expect(html).toContain('href="/billing/subscription?plan=creator"');
    expect(html).not.toContain('href="/billing/subscription?plan=premium"');
    expect(html).toContain('data-subscription-plan-status="preparing"');
    expect(html).not.toMatch(/monthlyUnits|604|1200|크레딧|충전/);
  });
  it('fails closed for incomplete or untrusted responses', () => {
    expect(parseSubscriptionAvailability({ status: 'open' }).status).toBe('preparing');
    expect(parseSubscriptionAvailability({ ...ready, plans: { ...ready.plans, creator: { status: 'invalid' } } }).status).toBe('preparing');
    expect(parseSubscriptionAvailability(ready)).toEqual(ready);
  });
  it('preserves the configured edit limit and closes Premium for an explicitly missing or invalid limit', () => {
    const premiumReady = { ...ready, plans: { creator: { status: 'open' as const }, premium: { status: 'open' as const } }, editing: 'open' as const };
    expect(parseSubscriptionAvailability({ ...premiumReady, premiumEditRequestsPerPeriod: 37 })).toEqual({ ...premiumReady, premiumEditRequestsPerPeriod: 37 });
    for (const limit of [null, 0, 1.5, 1001, '37']) {
      const availability = parseSubscriptionAvailability({ ...premiumReady, premiumEditRequestsPerPeriod: limit });
      expect(availability.plans.creator.status).toBe('open');
      expect(availability.plans.premium.status).toBe('preparing');
      expect(availability.editing).toBe('preparing');
      expect(availability.premiumEditRequestsPerPeriod).toBeNull();
    }
  });
  it('shows the real configured Premium request limit and counting rule only when it is open', () => {
    const copy = getDictionary('ko').pricing;
    const premiumReady = { ...ready, plans: { creator: { status: 'open' as const }, premium: { status: 'open' as const } }, editing: 'open' as const, premiumEditRequestsPerPeriod: 1000 };
    const html = renderToStaticMarkup(<SubscriptionPlanComparison plans={plans} copy={copy} browseHref="/ko/video" initialAvailability={premiumReady} />);
    expect(html).toContain('href="/billing/subscription?plan=premium"');
    expect(html).toContain('월 최대 1,000회');
    expect(html).toContain(copy.subscriptionEditCountNotice);
    const preparing = renderToStaticMarkup(<SubscriptionPlanComparison plans={plans} copy={copy} browseHref="/ko/video" initialAvailability={{ ...ready, premiumEditRequestsPerPeriod: 1000 }} />);
    expect(preparing).not.toContain('data-premium-edit-request-limit');
    const legacy = renderToStaticMarkup(<SubscriptionPlanComparison plans={plans} copy={copy} browseHref="/ko/video" initialAvailability={ready} />);
    expect(legacy).not.toContain('data-premium-edit-request-limit');
  });
});

describe('Premium edit request budget', () => {
  it('shows actual remaining requests and explains that started failed interpretations also count', () => {
    const copy = getDictionary('ko').creatorSubscription;
    const budget = { limit: 1000, attempted: 993, remaining: 7 };
    expect(parsePremiumEditBudget(budget)).toEqual(budget);
    const html = renderToStaticMarkup(<PremiumEditBudgetNotice budget={budget} locale="ko" copy={copy} />);
    expect(html).toContain('7회 남음');
    expect(html).toContain('총 1,000회');
    expect(html).toContain(copy.premiumEditCountNotice);
    expect(html).not.toContain(copy.premiumEditLimitReached);
  });
  it('never invents a request budget and keeps the original-template explanation available', () => {
    const copy = getDictionary('en').creatorSubscription;
    for (const value of [undefined, null, { limit: 20, attempted: 3, remaining: 18 }, { limit: 0, attempted: 0, remaining: 0 }]) expect(parsePremiumEditBudget(value)).toBeNull();
    const unknown = renderToStaticMarkup(<PremiumEditBudgetNotice budget={null} locale="en" copy={copy} />);
    expect(unknown).toContain(copy.premiumEditBudgetUnavailable);
    expect(unknown).not.toContain('data-premium-edit-remaining');
    const exhausted = renderToStaticMarkup(<PremiumEditBudgetNotice budget={{ limit: 20, attempted: 20, remaining: 0 }} locale="en" copy={copy} />);
    expect(exhausted).toContain(copy.premiumEditLimitReached);
    const latestError = renderToStaticMarkup(<PremiumEditBudgetNotice budget={{ limit: 20, attempted: 19, remaining: 1 }} limitReached locale="en" copy={copy} />);
    expect(latestError).toContain(copy.premiumEditLimitReached);
    expect(latestError).not.toContain('data-premium-edit-remaining');
  });
});

describe('private subscription summary', () => {
  it('shows actual ledger percent and a scheduled cancellation, without calculator counts', () => {
    const copy = getDictionary('ko').creatorSubscription;
    const html = renderToStaticMarkup(<SubscriptionStatus initial={{ id: 'sub', planId: 'creator', environment: 'live', status: 'active', cancelAtPeriodEnd: true, periodStart: '2026-10-09T00:00:00Z', periodEnd: '2026-11-09T00:00:00Z', nextBillingAt: null, remainingPercent: 37, usedPercent: 63, hasAccess: true }} locale="ko" copy={copy} />);
    expect(html).toContain('37%');
    expect(html).toContain(copy.cancellationScheduled);
    expect(html).not.toContain('<button data-subscription-cancel');
    expect(html).not.toMatch(/604|1200|월 최대 4편/);
  });
  it('distinguishes pending refunds from pending charges', () => {
    const copy = getDictionary('ko').creatorSubscription;
    expect(subscriptionActionMessage('refund_pending', copy)).toBe(copy.refundPending);
    expect(subscriptionActionMessage('payment_pending', copy)).toBe(copy.paymentPending);
  });
});

describe('reviewed subscription enrollment', () => {
  it('discloses real admin QA charges and the accepted Premium limit before unchecked consent', () => {
    const copy = getDictionary('ko').creatorSubscription;
    const html = renderToStaticMarkup(<SubscriptionCheckout planId="premium" locale="ko" copy={copy} price="49,000원" consentVersion="reviewed-v1" available liveQa premiumEditLimit={37} />);
    expect(html).toContain(copy.liveQaMode);
    expect(html).not.toContain(copy.testMode);
    expect(html).toContain('월 최대 37회');
    expect(html).toContain(copy.premiumEditCountNotice);
    expect(html.indexOf('월 최대 37회')).toBeLessThan(html.indexOf('data-subscription-consent'));
    expect(html).toMatch(/data-subscription-consent="true"[^>]*type="checkbox"[^>]*\/>/);
    expect(html).not.toMatch(/data-subscription-consent="true"[^>]*checked/);
    expect(html).toMatch(/data-subscription-enroll="true"[^>]*disabled/);
  });
  it('keeps the real-charge warning and stored request limit visible before card registration', () => {
    const copy = getDictionary('en').creatorSubscription;
    const html = renderToStaticMarkup(<SubscriptionAuthorization subscriptionId="sub" customerKey="customer" clientKey="public-key-placeholder" locale="en" copy={copy} price="₩49,000" planName="Premium" liveQa premiumEditLimit={37} />);
    const prose = html.replaceAll('&#x27;', "'");
    expect(prose).toContain(copy.liveQaMode);
    expect(prose).not.toContain(copy.testMode);
    expect(prose).toContain('Up to 37 custom edit requests per month');
    expect(prose).toContain(copy.premiumEditCountNotice);
    expect(prose.indexOf('Up to 37 custom edit requests per month')).toBeLessThan(prose.indexOf('data-subscription-register'));
  });
});

function findPaymentSwitch(node: ReactNode): { onClick: () => void } | null {
  if (!isValidElement<{ children?: ReactNode; 'data-subscription-payment-switch'?: boolean; onClick?: () => void }>(node)) return null;
  if (node.props['data-subscription-payment-switch'] && node.props.onClick) return { onClick: node.props.onClick };
  for (const child of Children.toArray(node.props.children)) {
    const button = findPaymentSwitch(child);
    if (button) return button;
  }
  return null;
}

describe('exhausted monthly usage', () => {
  it('offers the actual separate price and needs an explicit choice without sending a payment request', () => {
    const onSelect = vi.fn();
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    try {
      const copy = getDictionary('ko').creatorSubscription;
      const element = SubscriptionPaymentChoice({ available: true, selected: false, price: '6,200원', copy, onSelect });
      const html = renderToStaticMarkup(element);
      expect(html).toContain('6,200원');
      expect(html).toContain(copy.singlePaymentCta);
      expect(html).toContain('aria-pressed="false"');
      expect(html).toContain('type="button"');
      expect(onSelect).not.toHaveBeenCalled();
      findPaymentSwitch(element)!.onClick();
      expect(onSelect).toHaveBeenCalledExactlyOnceWith('single');
      expect(network).not.toHaveBeenCalled();
      const selected = renderToStaticMarkup(<SubscriptionPaymentChoice available selected price="6,200원" copy={copy} onSelect={onSelect} />);
      expect(selected).toContain(copy.backToMonthly);
      expect(selected).toContain('data-subscription-payment-choice="single"');
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not offer an unavailable separate payment mode', () => {
    expect(renderToStaticMarkup(<SubscriptionPaymentChoice available={false} selected={false} price="6,200원" copy={getDictionary('ko').creatorSubscription} onSelect={() => {}} />)).toBe('');
  });
});

describe('subscription return credentials', () => {
  it('removes credentials before returning them for the one server confirmation', () => {
    let cleanUrl = '';
    const value = readSubscriptionReturn('https://twings.app/billing/subscription/return?authKey=secret&customerKey=customer&state=sub&locale=ko', href => { cleanUrl = href; });
    expect(cleanUrl).toBe('/billing/subscription/return?locale=ko');
    expect(value).toEqual({ subscriptionId: 'sub', authKey: 'secret', customerKey: 'customer' });
  });
  it('also scrubs an incomplete authorization URL', () => {
    let cleanUrl = '';
    expect(readSubscriptionReturn('https://twings.app/billing/subscription/return?authKey=secret', href => { cleanUrl = href; })).toBeNull();
    expect(cleanUrl).toBe('/billing/subscription/return');
  });
});

describe('monthly render request boundary', () => {
  it('sends consent and a stable submission id, without overriding the template format', () => {
    const form = buildSubscriptionRenderForm({ requestId: 'stable-request', template: 'film', locale: 'ko', selfieId: 'selfie', editText: '셔츠를 파란색으로 바꿔주세요.', references: [], referencesConsent: false });
    expect(form.get('requestId')).toBe('stable-request');
    expect(form.get('ownFaceConsent')).toBe('1');
    expect(form.get('selfieId')).toBe('selfie');
    expect(form.get('editText')).toBe('셔츠를 파란색으로 바꿔주세요.');
    for (const key of ['aspect', 'resolution', 'prompt', 'rawPrompt', 'referenceConsent']) expect(form.has(key)).toBe(false);
  });
});
