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
  render_id: null,
  fulfilled_at: null,
  lease_until: null,
  expires_at: '',
}));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: 'u', email: null, isAdmin: false, tier: 'free', locale: 'ko' }) }));
vi.mock('@/lib/billing/toss-runtime', () => ({ getTossContext: async () => ({ sql: {}, gateway: { kind: 'test' }, store: {}, createRender: vi.fn() }) }));
vi.mock('@/lib/billing/toss-service', () => ({ loadOwnTossOrder: async () => order }));
vi.mock('@/lib/billing/toss-gateway', () => ({ tossConfigFromEnv: () => null }));
vi.mock('next/script', () => ({ default: () => null }));

import TossOrderPage from '@/app/(app)/billing/toss/[id]/page';
import { TossCheckout } from '@/app/(app)/billing/toss/checkout';
import { getDictionary } from '@/lib/i18n/dictionaries';

const render = async () =>
  renderToStaticMarkup(await TossOrderPage({ params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve({}) }));

describe('Toss order page', () => {
  beforeEach(() => {
    order.status = 'pending';
    order.payment_key = null;
    order.locale = 'ko';
    order.resolution = null;
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
