import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn(async () => ({ user: null, response: NextResponse.next() })),
  withCookies: (r: NextResponse) => r,
}));
import { middleware } from '@/middleware';
import { productionStructuredData, productionSitemap, productionUrl } from '@/lib/yagi/seo';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { renderToStaticMarkup } from 'react-dom/server';
import YagiPage from '@/app/(production)/yagi/[locale]/page';
const req = (host: string, path: string, method = 'GET') => new NextRequest(`https://${host}${path}`, { method, headers: { host } });

describe('YAGI public production surface', () => {
  it('shows the reusable format and both examples before the portfolio', async () => {
    for (const locale of ['en', 'ko'] as const) {
      const html = renderToStaticMarkup(await YagiPage({ params: Promise.resolve({ locale }) }));
      expect(html.indexOf('data-yagi-format-section')).toBeGreaterThan(html.indexOf('data-service-definition'));
      expect(html.indexOf('data-yagi-format-section')).toBeLessThan(html.indexOf('data-yagi-work-section'));
      expect(html).toContain('/reel/studio-demo/designed-format.mp4');
      expect(html).toContain('/reel/studio-demo/different-person.mp4');
      expect(html).toContain('/yagi/yagi-wordmark.png');
      expect((await middleware(req('yagiworkshop.xyz', '/yagi/yagi-wordmark.png'))).status).toBe(200);
    }
  });
  it('serves both locales independently of the TWINGS app', async () => {
    for (const host of ['yagiworkshop.xyz']) {
      const r = await middleware(req(host, '/ko'));
      expect(r.headers.get('x-middleware-rewrite')).toBe('https://yagiworkshop.xyz/yagi/ko');
    }
    expect((await middleware(req('www.yagiworkshop.xyz', '/ko'))).headers.get('location')).toBe('https://yagiworkshop.xyz/ko');
    expect((await middleware(req('yagiworkshop.xyz', '/'))).headers.get('location')).toBe('https://yagiworkshop.xyz/en');
  });
  it('does not expose application handlers, private workspaces or arbitrary assets', async () => {
    for (const path of ['/admin', '/account', '/auth/callback?code=x', '/api/brands/inquiries', '/.storage/private.mp4', '/ko/video', '/yagi/en']) {
      expect((await middleware(req('yagiworkshop.xyz', path))).status).toBe(404);
    }
    expect((await middleware(req('yagiworkshop.xyz', '/ko', 'POST'))).status).toBe(404);
    expect((await middleware(req('www.yagiworkshop.xyz', '/auth/callback?code=x'))).status).toBe(404);
    expect((await middleware(req('yagiworkshop.xyz.evil.test', '/ko'))).status).toBe(404);
  });
  it('publishes YAGI search documents and keeps canonical URLs independent of APP_URL', async () => {
    expect(productionUrl('ko')).toBe('https://yagiworkshop.xyz/ko');
    expect(productionSitemap()).toContain('https://yagiworkshop.xyz/en');
    const r = await middleware(req('yagiworkshop.xyz', '/sitemap.xml'));
    expect(await r.text()).toContain('https://yagiworkshop.xyz/ko');
    for (const locale of ['en', 'ko'] as const) {
      const graph = JSON.stringify(productionStructuredData(locale, getDictionary(locale)));
      expect(graph).toContain('FAQPage');
      expect(graph).toContain('YAGI');
      expect(graph).not.toContain('https://twings.app/#organization');
    }
  });
});
