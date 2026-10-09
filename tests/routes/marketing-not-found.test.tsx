import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';

vi.mock('next/navigation', async (importOriginal) => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  usePathname: () => null,
}));
vi.mock('@/app/actions/locale', () => ({ setLocaleAction: async () => undefined }));
import MarketingNotFound from '@/app/(marketing)/[locale]/not-found';

describe('unmatched public routes', () => {
  it('enters the framework 404 boundary instead of returning a successful page', async () => {
    const { default: MissingPage } = await import('@/app/(marketing)/[locale]/[...missing]/page');
    expect(() => MissingPage()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('renders both supported languages and native return links without client effects', () => {
    const html = renderToStaticMarkup(<MarketingNotFound />);
    for (const locale of ['ko', 'en'] as const) {
      expect(html).toContain(`data-not-found="${locale}"`);
      expect(html).toContain(getDictionary(locale).notFound.body);
      expect(html).toContain(`href="/${locale}/video"`);
      expect(html).toContain(`href="/${locale}/campaigns"`);
    }
  });
});
