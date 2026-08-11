import { setLocaleAction } from '@/app/actions/locale';
import { LOCALES, localizedPath, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * `EN | KO` (§3.1 nav). A server action so the cookie AND the profile mirror are written on the
 * server in one round trip, then the browser lands on the equivalent URL.
 */
export function LocaleToggle({
  current,
  /** Path WITHOUT the locale prefix, e.g. `/pricing`. App routes pass their own path. */
  rest = '/',
  prefixed = true,
}: {
  current: Locale;
  rest?: string;
  prefixed?: boolean;
}) {
  const dict = getDictionary(current);

  return (
    <nav aria-label={dict.nav.localeToggle} className="flex items-center gap-1 font-label text-eyebrow uppercase">
      {LOCALES.map((locale, index) => {
        const target = prefixed ? localizedPath(locale, rest) : rest;
        const isCurrent = locale === current;
        return (
          <span key={locale} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden className="opacity-40">|</span>}
            <form action={setLocaleAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="next" value={target} />
              <button
                type="submit"
                aria-current={isCurrent ? 'true' : undefined}
                className={isCurrent ? 'text-accent' : 'opacity-60 hover:opacity-100'}
              >
                {locale === 'en' ? dict.nav.localeEn : dict.nav.localeKo}
              </button>
            </form>
          </span>
        );
      })}
    </nav>
  );
}
