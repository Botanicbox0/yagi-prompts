import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Audit P2-13 / P2-18: an expired, never-paid Toss order used to say "confirmation is delayed —
 * do not pay again" with a status button that could only answer "pending"; and the order page
 * showed `₩9,900` while the Korean checkout button said `9,900원`. No network: all mocked.
 */
const order = vi.hoisted(() => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'u',
  environment: 'test',
  amount_krw: 9900,
  status: 'pending',
  payment_key: null as string | null,
  template_slug: 'tpl',
  order_name: 'TWINGS · 템플릿',
  aspect: '9:16',
  resolution: null as string | null,
  locale: 'ko' as 'ko' | 'en',
  render_ref: 'r',
  input_key: 'k',
  input_mime: 'image/jpeg',
  render_id: null as string | null,
  fulfilled_at: null,
  lease_until: null,
  expires_at: '',
  failure_code: null as string | null,
  input_deleted_at: null as string | null,
  retried_by: null as string | null,
}));
const gate = vi.hoisted(() => ({ mode: 'off' as 'on' | 'review' | 'off' }));
vi.mock('@/lib/flags', async (original) => ({
  ...(await original<typeof import('@/lib/flags')>()),
  get RENDER_PIPELINE_MODE() {
    return gate.mode;
  },
}));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: 'u', email: null, isAdmin: false, tier: 'free', locale: 'ko' }) }));
vi.mock('@/lib/billing/toss-runtime', () => ({ getTossContext: async () => ({ sql: {}, gateway: { kind: 'test' }, store: {}, createRender: vi.fn() }) }));
vi.mock('@/lib/billing/toss-service', async (original) => ({
  ...(await original<typeof import('@/lib/billing/toss-service')>()),
  loadOwnTossOrder: async () => order,
}));
vi.mock('@/lib/billing/toss-gateway', async (original) => ({
  ...(await original<typeof import('@/lib/billing/toss-gateway')>()),
  tossConfigFromEnv: () => null,
}));
vi.mock('next/script', () => ({ default: () => null }));

import TossOrderPage from '@/app/(app)/billing/toss/[id]/page';
import { TossCheckout } from '@/app/(app)/billing/toss/checkout';
import { getDictionary } from '@/lib/i18n/dictionaries';

const render = async () =>
  renderToStaticMarkup(await TossOrderPage({ params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve({}) }));
// React escapes quotes in text; compare against the same escaping.
const escaped = (text: string) => renderToStaticMarkup(<>{text}</>);

describe('Toss order page', () => {
  beforeEach(() => {
    gate.mode = 'off';
    order.status = 'pending';
    order.payment_key = null;
    order.locale = 'ko';
    order.resolution = null;
    order.render_id = null;
    order.failure_code = null;
    order.input_deleted_at = null;
    order.retried_by = null;
    order.expires_at = new Date(Date.now() - 60 * 60_000).toISOString();
  });

  it('an expired, never-paid order says so and offers a fresh start on the template', async () => {
    const html = await render();
    const c = getDictionary('ko').billing.toss;
    expect(html).toContain('data-payment-status="expired"');
    expect(html).toContain(c.expired);
    expect(html).not.toContain(c.pending);
    expect(html).toContain('href="/ko/t/tpl#make"');
    expect(html).not.toContain(c.check);
  });

  it('an expired order that has a payment key is still "confirmation pending", not expired', async () => {
    order.payment_key = 'pk_test';
    const html = await render();
    expect(html).toContain('data-payment-status="pending"');
    expect(html).not.toContain('data-toss-restart');
  });

  it('a live pending order is not called expired', async () => {
    order.expires_at = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(await render()).not.toContain('data-payment-status="expired"');
  });

  it('shows the amount in the same format as the checkout button', async () => {
    const page = await render();
    expect(page).toContain('9,900원');
    expect(page).not.toContain('₩9,900');
    const button = renderToStaticMarkup(
      <TossCheckout id={order.id} amount={9900} name="x" customerKey="u" clientKey={null} kind="fake" locale="ko" copy={getDictionary('ko').billing.toss} />,
    );
    expect(button).toContain('9,900원');
    order.locale = 'en';
    expect(await render()).toContain('₩9,900');
  });

  it('names the bought resolution before payment, in both languages, and nothing for a pre-0039 order', async () => {
    expect(await render()).not.toContain('data-order-resolution');
    order.resolution = '1080p';
    expect(await render()).toContain(`${getDictionary('ko').billing.toss.resolution} 1080p`);
    order.locale = 'en';
    expect(await render()).toContain(`${getDictionary('en').billing.toss.resolution} 1080p`);
  });
});

/** docs/PLATFORM-2.0.md §2.2-1, -2, -4: a failed order says why, and never reopens an old checkout. */
describe('Toss order page after a failure', () => {
  beforeEach(() => {
    gate.mode = 'on';
    order.status = 'failed';
    order.payment_key = 'pk_test';
    order.locale = 'ko';
    order.render_id = null;
    order.failure_code = null;
    order.input_deleted_at = null;
    order.retried_by = null;
    order.expires_at = new Date(Date.now() + 20 * 60_000).toISOString();
  });

  it('a declined approval says nothing was charged and offers 다시 결제하기 — not the old checkout', async () => {
    order.failure_code = 'declined';
    const html = await render();
    const c = getDictionary('ko').billing.toss;
    expect(html).toContain(escaped(c.reasons.declined));
    expect(html).toContain('data-toss-retry');
    expect(html).toContain(c.retry);
    expect(html).toContain('data-payment-reason="declined"');
    expect(html).not.toContain('data-toss-checkout');
    expect(html).not.toContain(escaped(c.pending));
  });

  it('a changed price says the order has to be made again and points at the template, without a retry', async () => {
    order.failure_code = 'price_changed';
    const html = await render();
    const c = getDictionary('ko').billing.toss;
    expect(c.reasons.price_changed).toContain('가격이 바뀌어 주문을 다시 만들어야 해요');
    expect(html).toContain(escaped(c.reasons.price_changed));
    expect(html).toContain('href="/ko/t/tpl#make"');
    expect(html).not.toContain('data-toss-retry');
    expect(html).not.toContain('data-toss-checkout');
  });

  it('a closed sale says so', async () => {
    order.failure_code = 'not_open';
    const html = await render();
    expect(html).toContain(escaped(getDictionary('ko').billing.toss.reasons.not_open));
    expect(html).not.toContain('data-toss-retry');
  });

  it('offers no retry while the purchase gate is closed or once the photo is gone', async () => {
    order.failure_code = 'declined';
    gate.mode = 'off';
    expect(await render()).not.toContain('data-toss-retry');
    gate.mode = 'on';
    order.input_deleted_at = new Date().toISOString();
    const html = await render();
    expect(html).not.toContain('data-toss-retry');
    expect(html).toContain('href="/ko/t/tpl#make"');
  });

  it('an order that expired at the provider reads as expired, in English too', async () => {
    order.failure_code = 'expired';
    order.locale = 'en';
    const html = await render();
    expect(html).toContain('data-payment-status="expired"');
    expect(html).toContain(escaped(getDictionary('en').billing.toss.expired));
  });

  it('says an operator has a refund or a render that automation gave up on — never "refunded" or "pending"', async () => {
    const c = getDictionary('ko').billing.toss;
    order.status = 'refund_pending';
    order.failure_code = 'refund_manual';
    let html = await render();
    expect(html).toContain(escaped(c.refundManual));
    expect(html).not.toContain(escaped(c.refunded));
    order.failure_code = 'partial_balance';
    html = await render();
    expect(html).toContain(escaped(c.partialBalance));
    expect(html).not.toContain(escaped(c.refundPending));
    order.status = 'paid';
    order.failure_code = 'fulfil_manual';
    html = await render();
    expect(html).toContain(escaped(c.fulfilManual));
    expect(html).not.toContain(escaped(c.pending));
    order.failure_code = null;
    html = await render();
    expect(html).toContain(escaped(c.paidPreparing));
  });
});
