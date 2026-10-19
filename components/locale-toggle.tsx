import { setLocaleAction } from '@/app/actions/locale';
import { LOCALES, localizedPath, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LocaleSubmitButton } from '@/components/locale-submit-button';

/**
 * `EN | KO` (§3.1 nav). The server action saves the cookie and redirects to the equivalent URL;
 * profile mirroring follows the response. The submit control supplies immediate pending feedback.
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
    <nav aria-label={dict.nav.localeToggle} className="flex items-center font-label text-eyebrow uppercase">
      {LOCALES.map((locale, index) => {
        const target = prefixed ? localizedPath(locale, rest) : rest;
        const isCurrent = locale === current;
        return (
          <span key={locale} className="flex items-center">
            {index > 0 && <span aria-hidden className="opacity-40">|</span>}
            <form action={setLocaleAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="next" value={target} />
              <LocaleSubmitButton current={isCurrent} label={locale === 'en' ? dict.nav.localeEn : dict.nav.localeKo} />
            </form>
          </span>
        );
      })}
    </nav>
  );
}
