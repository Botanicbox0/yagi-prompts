import { SiteNav, type NavLink } from '@/components/nav/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { LocaleToggle } from '@/components/locale-toggle';
import { PLAYBOOKS_IN_NAV } from '@/lib/flags';
import { promptsHref } from '@/lib/prompts/links';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import type { SectionTheme } from '@/lib/motion/geometry';

/**
 * §13.2 — "Nav becomes: Prompts · Pricing". One list, built once, used by the bar and the footer,
 * so the two can never disagree about what the site currently offers.
 */
export function siteLinks(locale: Locale, dict: Dictionary): NavLink[] {
  const links: NavLink[] = [{ href: promptsHref(locale), label: dict.nav.prompts }];
  if (PLAYBOOKS_IN_NAV) links.push({ href: '/library', label: dict.nav.library });
  links.push({ href: `/${locale}/pricing`, label: dict.nav.pricing });
  return links;
}

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
      links={siteLinks(locale, dict)}
      signInNext={promptsHref(locale)}
      labels={{
        brand: dict.meta.siteName,
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
      links={siteLinks(locale, dict)}
      labels={{
        hireCta: dict.footer.hireCta,
        hireLede: dict.footer.hireLede,
        advertise: dict.footer.advertise,
        rights: dict.footer.rights,
        builtIn: dict.footer.builtIn,
        navHeading: dict.footer.navHeading,
        contactHeading: dict.footer.contactHeading,
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
