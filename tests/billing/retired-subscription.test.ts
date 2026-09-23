import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Audit P1-4 (대표: subscriptions on hold; billing is one payment per template). The $9/month
 * Stripe subscription entry is retired: its three pages land on the localized pricing page, the
 * checkout route refuses with 410, and no dictionary string sells the monthly plan on those pages.
 * The Stripe modules, the webhook and the portal stay (dormant) — pinned at the end.
 */
const locale = vi.hoisted(() => ({ value: 'ko' as 'ko' | 'en' }));
vi.mock('@/lib/i18n/server', () => ({
  getRequestLocale: async () => locale.value,
  getLocaleFromHeaders: async () => locale.value,
}));

import nextConfig from '@/next.config';
import { POST as checkout } from '@/app/api/billing/checkout/route';
import UpgradePage from '@/app/(app)/billing/upgrade/page';
import SuccessPage from '@/app/(app)/billing/success/page';
import CancelledPage from '@/app/(app)/billing/cancelled/page';
import { getDictionary } from '@/lib/i18n/dictionaries';

async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? '');
    // NEXT_REDIRECT;<type>;<url>;<status>;
    const [, , url, status] = digest.split(';');
    expect(status).toBe('308');
    return url!;
  }
  throw new Error('expected a redirect');
}

describe('retired subscription pages', () => {
  const pages = { upgrade: UpgradePage, success: SuccessPage, cancelled: CancelledPage };

  for (const [name, Page] of Object.entries(pages)) {
    it(`/billing/${name} lands on the pricing page in the carried locale`, async () => {
      locale.value = 'en';
      const target = await redirectTarget(() => Page({ searchParams: Promise.resolve({ locale: 'ko', slug: 'x' }) }));
      expect(target).toBe('/ko/pricing');
    });

    it(`/billing/${name} falls back to the request locale`, async () => {
      locale.value = 'en';
      expect(await redirectTarget(() => Page({ searchParams: Promise.resolve({ locale: 'fr' }) }))).toBe('/en/pricing');
    });
  }

  it('next.config 308s all three before the session gate, locale first from the query, then the cookie', async () => {
    const redirects = await nextConfig.redirects!();
    const retired = redirects.filter((r) => r.source === '/billing/:page(upgrade|success|cancelled)');
    // three variants × two host matchers
    expect(retired).toHaveLength(6);
    for (const route of retired) expect('permanent' in route && route.permanent).toBe(true);
    const byKind = (type: string) => retired.find((r) => r.has?.some((h) => h.type === type));
    expect(byKind('query')?.destination).toBe('/:locale/pricing');
    expect(byKind('query')?.has).toContainEqual({ type: 'query', key: 'locale', value: '(?<locale>en|ko)' });
    expect(byKind('cookie')?.has).toContainEqual({ type: 'cookie', key: 'playbook.locale', value: '(?<locale>en|ko)' });
    const plain = retired.filter((r) => r.has?.every((h) => h.type === 'host' || h.type === 'header'));
    expect(plain.map((r) => r.destination)).toEqual(['/pricing', '/pricing']);
    // Query and cookie variants come before the plain one, so they win.
    expect(retired.findIndex((r) => r.destination === '/pricing')).toBeGreaterThan(
      retired.findIndex((r) => r.has?.some((h) => h.type === 'cookie')),
    );
  });

  it('the locale cookie name in next.config matches the app constant', async () => {
    const { LOCALE_COOKIE } = await import('@/lib/i18n/config');
    expect(LOCALE_COOKIE).toBe('playbook.locale');
  });

  it('no dictionary keeps the retired upgrade-page copy', () => {
    for (const current of ['ko', 'en'] as const) {
      const billing = getDictionary(current).billing as Record<string, unknown>;
      for (const key of ['upgradeTitle', 'upgradeBody', 'upgradeCta', 'alreadyProTitle', 'cancelledTitle']) {
        expect(billing[key], `${current}.billing.${key}`).toBeUndefined();
      }
    }
  });
});

describe('POST /api/billing/checkout', () => {
  it('refuses every caller with 410 subscription_retired, never cached', async () => {
    const response = await checkout();
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: 'subscription_retired' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps the dormant Stripe modules, webhook and portal in place', () => {
    for (const file of [
      'lib/billing/stripe-gateway.ts',
      'lib/billing/stripe-live.ts',
      'lib/billing/checkout.ts',
      'app/api/stripe/webhook/route.ts',
      'app/api/billing/portal/route.ts',
    ]) {
      expect(readFileSync(file, 'utf8').length, file).toBeGreaterThan(0);
    }
  });
});
