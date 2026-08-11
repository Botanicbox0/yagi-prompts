import type { Metadata } from 'next';
import type { Localized } from '@/lib/content/schemas';
import type { ShapedAssetRef } from '@/lib/content/shape';
import type { Locale } from '@/lib/i18n/config';
import { localize } from '@/lib/i18n/format';

/**
 * PLAN §3.9 / §8 M5 — the detail page's `<head>`, as a pure function.
 *
 * M2 shipped this logic inline in `app/(marketing)/[locale]/p/[slug]/page.tsx`, where it could only
 * be verified by fetching a running server. It moved here unchanged so M5's SEO acceptance can
 * assert it directly (`tests/seo/metadata.test.ts`): the page still owns the decision of WHEN to
 * call it, this owns WHAT it emits.
 *
 * Three rules, each of them a consequence of a gating rule rather than an SEO preference:
 *
 *   · **Only a showcase revision is indexable.** Everything else lives behind the login wall
 *     (§3.3/§3.9), so it emits `noindex, nofollow` and no alternates at all — a canonical URL for a
 *     page crawlers must not have is a contradiction, and hreflang alternates would advertise it.
 *   · **`og:image` comes from a PUBLIC-bucket hero only.** A crawler fetches OG images with no
 *     session; a gateway path (`/api/media/…`) would answer 401 and the card would render broken.
 *     §3.1 makes heroes public marketing surface precisely so this one URL can exist.
 *   · **Alternates are reciprocal and complete**: `en`, `ko`, and `x-default` → `en`, on every
 *     indexable page, with the canonical pointing at the locale actually being served.
 */

export interface PlaybookMetaInput {
  slug: string;
  locale: Locale;
  title: Localized;
  summary: Localized;
  is_showcase: boolean;
  hero: ShapedAssetRef | null;
  /** Fallback title for the not-found / not-ok branches. */
  siteName: string;
}

/** `/{locale}/p/{slug}` — the one place the public detail path is spelled for metadata. */
export function playbookPath(locale: Locale, slug: string): string {
  return `/${locale}/p/${slug}`;
}

/** hreflang set for any locale-prefixed public page, given the path WITHOUT its locale prefix. */
export function localeAlternates(rest: string): Record<string, string> {
  const path = (locale: Locale) => `/${locale}${rest === '/' ? '' : rest}`;
  return { en: path('en'), ko: path('ko'), 'x-default': path('en') };
}

/** The `<head>` of a playbook that resolved. Non-showcase revisions are deindexed, not decorated. */
export function playbookMetadata(input: PlaybookMetaInput): Metadata {
  const title = localize(input.title, input.locale);
  const description = localize(input.summary, input.locale);

  if (!input.is_showcase) {
    return { title, description, robots: { index: false, follow: false } };
  }

  const ogImage = input.hero?.source === 'public' ? input.hero.src : null;

  return {
    title,
    description,
    alternates: {
      canonical: playbookPath(input.locale, input.slug),
      languages: localeAlternates(`/p/${input.slug}`),
    },
    openGraph: {
      type: 'article',
      locale: input.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: playbookPath(input.locale, input.slug),
      title,
      description,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
  };
}

/** Draft, archived, unknown, or a preview attempt by a non-admin — a page that must not be indexed. */
export function unresolvedPlaybookMetadata(siteName: string): Metadata {
  return { title: siteName, robots: { index: false, follow: false } };
}
