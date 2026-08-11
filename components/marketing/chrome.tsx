import { SiteNav } from '@/components/nav/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { LocaleToggle } from '@/components/locale-toggle';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import type { SectionTheme } from '@/lib/motion/geometry';

/**
 * The dictionary → chrome-props seam.
 *
 * `SiteNav` is a client component (IntersectionObserver, overlay menu), so it is handed the
 * handful of strings it needs rather than importing `getDictionary` — that would ship BOTH
 * dictionaries to the browser on every page. The locale toggle is passed through as a
 * server-rendered node for the same reason.
 */
export function MarketingNav({
  locale,
  dict,
  rest = '/',
  initialTheme = 'light',
}: {
  locale: Locale;
  dict: Dictionary;
  /** Path without the locale prefix, so the toggle lands on the equivalent page. */
  rest?: string;
  initialTheme?: SectionTheme;
}) {
  return (
    <SiteNav
      locale={locale}
      initialTheme={initialTheme}
      labels={{
        brand: dict.meta.siteName,
        library: dict.nav.library,
        pricing: dict.nav.pricing,
        signIn: dict.auth.signIn,
        menu: dict.nav.menu,
        close: dict.nav.close,
        primary: dict.nav.primary,
        skipToContent: dict.nav.skipToContent,
      }}
      localeToggle={<LocaleToggle current={locale} rest={rest} />}
    />
  );
}

export function MarketingFooter({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <SiteFooter
      locale={locale}
      labels={{
        hireCta: dict.footer.hireCta,
        hireLede: dict.footer.hireLede,
        advertise: dict.footer.advertise,
        rights: dict.footer.rights,
        builtIn: dict.footer.builtIn,
        navHeading: dict.footer.navHeading,
        contactHeading: dict.footer.contactHeading,
        library: dict.nav.library,
        pricing: dict.nav.pricing,
        brand: dict.meta.siteName,
        adContact: dict.ad.contact,
      }}
    />
  );
}

export function adLabels(dict: Dictionary) {
  return {
    label: dict.ad.label,
    placeholder: dict.ad.placeholder,
    pitch: dict.ad.pitch,
    contact: dict.ad.contact,
  };
}
