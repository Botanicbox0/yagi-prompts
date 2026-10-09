import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Audit P1-3: the session-gated `(app)` group had no 404 or error boundary, so a mistyped share
 * link fell to Next's unstyled English default and a render failure fell to a mixed-language,
 * joking `global-error`.
 */
const locale = vi.hoisted(() => ({ value: 'ko' as 'ko' | 'en' }));
vi.mock('@/lib/i18n/server', () => ({
  getRequestLocale: async () => locale.value,
  getLocaleFromHeaders: async () => locale.value,
}));
vi.mock('@/app/actions/locale', () => ({ setLocaleAction: async () => undefined }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => null }));

import AppNotFound from '@/app/(app)/not-found';
import AppError from '@/app/(app)/error';
import GlobalError from '@/app/global-error';
import { AppErrorCopyProvider } from '@/components/app/error-copy';
import { getDictionary } from '@/lib/i18n/dictionaries';

describe('(app) not-found', () => {
  for (const current of ['ko', 'en'] as const) {
    it(`speaks ${current} and links home to /${current}/video`, async () => {
      locale.value = current;
      const html = renderToStaticMarkup(await AppNotFound());
      const dict = getDictionary(current);
      expect(html).toContain(`data-app-not-found="${current}"`);
      expect(html).toContain(dict.notFound.body);
      expect(html).toContain(`href="/${current}/video"`);
      // One language only — the (app) tree knows the reader's locale.
      const other = getDictionary(current === 'ko' ? 'en' : 'ko');
      expect(html).not.toContain(other.notFound.body);
    });
  }
});

describe('(app) error boundary', () => {
  for (const current of ['ko', 'en'] as const) {
    it(`renders the ${current} dictionary copy handed down by the layout`, () => {
      const { appError } = getDictionary(current);
      const html = renderToStaticMarkup(
        <AppErrorCopyProvider copy={{ locale: current, ...appError, homeHref: `/${current}/video` }}>
          <AppError error={new Error('boom')} reset={() => {}} />
        </AppErrorCopyProvider>,
      );
      expect(html).toContain('role="alert"');
      expect(html).toContain(appError.title);
      expect(html).toContain(appError.retry);
      expect(html).toContain(`href="/${current}/video"`);
      expect(html).not.toContain('boom');
    });
  }

  it('the error bundle does not import the dictionaries', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['app/(app)/error.tsx', 'components/app/error-copy.tsx', 'components/app/static-error-copy.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"][^'"]*(?:dictionaries|messages\/)/);
    }
  });
});

describe('global-error', () => {
  it('is calm, bilingual and free of the old jokes', () => {
    const html = renderToStaticMarkup(<GlobalError error={Object.assign(new Error('x'), { digest: 'd1' })} reset={() => {}} />);
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('페이지를 불러오지 못했습니다.');
    expect(html).toContain('lang="en"');
    expect(html).toContain('This page did not load.');
    expect(html).not.toContain('Something broke on the way here.');
    expect(html).not.toContain('done politely');
  });
});
