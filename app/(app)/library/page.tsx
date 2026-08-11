import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LocaleToggle } from '@/components/locale-toggle';

/**
 * Library — M0 skeleton behind the middleware auth gate. Grid, filters, search and the
 * `N pro blocks` indicator land in M2.
 */
export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);

  return (
    <main className="min-h-screen bg-white px-gutter py-24 text-black">
      <div className="mb-10 flex items-center justify-between">
        <p className="font-label text-eyebrow uppercase text-blue">{dict.nav.library}</p>
        <LocaleToggle current={locale} rest="/library" prefixed={false} />
      </div>
      <h1 className="font-display text-title uppercase">{dict.nav.library}</h1>
      <p className="mt-6 text-body">M0 placeholder — the grid arrives in M2.</p>
    </main>
  );
}
