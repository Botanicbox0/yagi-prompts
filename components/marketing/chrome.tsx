import { SiteNav, type NavLink } from '@/components/nav/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { LocaleToggle } from '@/components/locale-toggle';
import { PLAYBOOKS_IN_NAV } from '@/lib/flags';
import { templatesHref } from '@/lib/prompts/links';
import { brandEnquiryHref, campaignsHref } from '@/lib/campaigns/links';
import { LEGAL_DOCS, legalDocument } from '@/lib/legal/documents';
import { legalHref } from '@/lib/legal/links';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import type { SectionTheme } from '@/lib/motion/geometry';

/**
 * §14.2 — "Nav: Prompts · Contests · Pricing". One list, built once, used by the bar and the
 * footer, so the two can never disagree about what the site currently offers.
 *
 * Contests sits second because that is the order the site reads in: the prompts are what we make,
 * the contests are what we ask you to make, and the price is the last question. (§13.2's two-item
 * version is superseded, not amended — the library stays denavigated behind `PLAYBOOKS_IN_NAV`.)
 */
export function siteLinks(locale: Locale, dict: Dictionary): NavLink[] {
  // docs/TEMPLATES-IA.md (2026-09-05): the two things you can make, the way to get paid for
  // making them, and the price. Studio, prompts and contests left the nav with the prompt site.
  const links: NavLink[] = [
    { href: templatesHref(locale, 'video'), label: dict.nav.video },
    { href: templatesHref(locale, 'image'), label: dict.nav.image },
    { href: campaignsHref(locale), label: dict.nav.campaigns },
  ];
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
      signInNext={templatesHref(locale, 'video')}
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
      /* 전자상거래법 §21 and every payment provider's merchant review: the legal documents must be
         reachable from anywhere on the site, so they live in the footer rather than on a page a
         reviewer has to be told about. */
      legalLinks={LEGAL_DOCS.map((doc) => ({
        href: legalHref(locale, doc),
        label: legalDocument(doc, locale).title,
        doc,
      }))}
      labels={{
        hireCta: dict.footer.hireCta,
        hireLede: dict.footer.hireLede,
        advertise: dict.footer.advertise,
        rights: dict.footer.rights,
        builtIn: dict.footer.builtIn,
        navHeading: dict.footer.navHeading,
        contactHeading: dict.footer.contactHeading,
        brand: dict.meta.siteName,
        adHref: brandEnquiryHref(locale),
      }}
    />
  );
}

/** The house ad (2026-09-11): the brand-campaign pitch, pointing at the enquiry form. */
export function adLabels(dict: Dictionary, locale: Locale) {
  return {
    label: dict.ad.label,
    headline: dict.ad.headline,
    pitch: dict.ad.pitch,
    cta: dict.ad.cta,
    href: brandEnquiryHref(locale),
  };
}
