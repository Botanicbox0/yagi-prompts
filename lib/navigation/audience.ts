import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { brandEnquiryHref, brandsHref, brandWorkspaceHref, campaignsHref } from '@/lib/campaigns/links';
import { templatesHref } from '@/lib/prompts/links';

export type Audience = 'creator' | 'brand';
export function audienceForPath(rest: string): Audience {
  const path = rest.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') ?? '';
  return path === '/brands' || path.startsWith('/brands/') ? 'brand' : 'creator';
}

/** Audience is a navigation destination, never a persisted account role or an authorization input. */
export function audienceNavigation(locale: Locale, dict: Dictionary, rest: string) {
  const audience = audienceForPath(rest);
  const t = dict.audience;
  const next = rest === '/' || rest === '' ? templatesHref(locale, 'video') : `/${locale}${rest}`;
  return {
    audience,
    modes: [
      { id: 'creator' as const, href: `/${locale}`, label: t.personal },
      { id: 'brand' as const, href: brandsHref(locale), label: t.brand },
    ],
    links: audience === 'brand' ? [
      { href: `${brandsHref(locale)}#campaign-types`, label: t.services },
      { href: `${brandsHref(locale)}#work`, label: t.work },
      { href: `${brandsHref(locale)}#process`, label: t.process },
    ] : [
      { href: templatesHref(locale, 'video'), label: dict.nav.video },
      { href: templatesHref(locale, 'image'), label: dict.nav.image },
      { href: `/${locale}/direct`, label: dict.nav.direct },
      { href: campaignsHref(locale), label: dict.nav.campaigns },
      { href: `/${locale}/pricing`, label: dict.nav.pricing },
    ],
    signInHref: audience === 'brand' ? brandWorkspaceHref(locale) : `/auth/signin?next=${encodeURIComponent(next)}&locale=${locale}`,
    signInLabel: audience === 'brand' ? t.workspace : dict.auth.signIn,
    primary: audience === 'brand'
      ? { href: brandEnquiryHref(locale), label: t.contact }
      : { href: templatesHref(locale, 'video'), label: t.start },
  };
}
