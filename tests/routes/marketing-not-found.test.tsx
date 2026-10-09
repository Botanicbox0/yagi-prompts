import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';

vi.mock('next/navigation', async (importOriginal) => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  usePathname: () => null,
}));
vi.mock('@/app/actions/locale', () => ({ setLocaleAction: async () => undefined }));
vi.mock('@/app/fonts', () => ({ fontVariables: 'test-font-variables' }));
import GlobalNotFound, { metadata } from '@/app/global-not-found';
import MarketingNotFound from '@/app/(marketing)/[locale]/not-found';

describe('unmatched public routes', () => {
  it('renders a self-contained static document with both languages and native return links', () => {
    const html = renderToStaticMarkup(<GlobalNotFound />);
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('test-font-variables');
    expect(html).toContain('/fonts/pretendard/pretendard-dynamic-subset.css');
    expect(html).toContain('id="site-structured-data"');
    for (const locale of ['ko', 'en'] as const) {
      expect(html).toContain(`lang="${locale}" data-not-found="${locale}"`);
      expect(html).toContain(getDictionary(locale).notFound.body);
      expect(html).toContain(`href="/${locale}/video"`);
      expect(html).toContain(`href="/${locale}/campaigns"`);
    }
  });

  it('uses 404 metadata without indexing or canonicalizing an unknown URL to a valid page', () => {
    expect(metadata.title).toContain(getDictionary('en').notFound.title);
    expect(metadata.description).toBe(getDictionary('en').notFound.body);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });

  it('keeps the existing matched-route recovery panels bilingual', () => {
    const html = renderToStaticMarkup(<MarketingNotFound />);
    for (const locale of ['ko', 'en'] as const) {
      expect(html).toContain(`data-not-found="${locale}"`);
      expect(html).toContain(`href="/${locale}/video"`);
      expect(html).toContain(`href="/${locale}/campaigns"`);
    }
  });
});
