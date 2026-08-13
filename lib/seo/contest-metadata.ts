import type { Metadata } from 'next';
import type { ShapedContest } from '@/lib/contests/access';
import { contestRest } from '@/lib/contests/links';
import type { Locale } from '@/lib/i18n/config';
import { localize } from '@/lib/i18n/format';
import { localeAlternates } from './playbook-metadata';
import { SITE_OG_IMAGE, SITE_TWITTER_CARD } from './og';

/**
 * PLAN §14.2 — "hreflang/canonical/OG from poster".
 *
 * `lib/seo/prompt-metadata.ts`'s sibling, reusing that file's `localeAlternates` so the three
 * public surfaces can never drift on hreflang.
 *
 * Every PUBLISHED contest is indexable, and there is no showcase/non-showcase split to make: a
 * contest page has no gated half at all. What is NOT indexable is everything else — a draft never
 * resolves on the public route, the admin preview lives under `/admin` (noindex), and the entry
 * form is unprefixed app surface (noindex, and disallowed in robots.txt).
 *
 * `og:image` comes from the poster's public-bucket URL only. A crawler fetches OG images with no
 * session, and the contest-media route answers from the public bucket for published rows only —
 * both are safe, and a route path is used when no CDN is configured (§11) rather than nothing.
 */

export interface ContestMetaInput {
  contest: Pick<ShapedContest, 'slug' | 'title' | 'summary' | 'poster' | 'video'>;
  locale: Locale;
  siteName: string;
}

export function contestMetadata(input: ContestMetaInput): Metadata {
  const { contest, locale } = input;
  const rest = contestRest(contest.slug);
  const title = localize(contest.title, locale);
  const description = localize(contest.summary, locale);
  const image = contest.poster?.src ?? null;

  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${rest}`,
      languages: localeAlternates(rest),
    },
    openGraph: {
      type: 'article',
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${locale}${rest}`,
      title,
      description,
      // The contest's own poster when it has one; the brand card otherwise — never imageless.
      images: [image ? { url: image } : SITE_OG_IMAGE],
      ...(contest.video ? { videos: [{ url: contest.video.src, type: contest.video.mime }] } : {}),
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

/** The listing itself: indexable, self-canonical, reciprocal alternates. */
export function contestsListingMetadata(input: {
  locale: Locale;
  title: string;
  description: string;
  /**
   * The OG title must NAME the site because it is read outside it; the `<title>` must not — the
   * locale layout already appends `· {siteName}` as a template (the M7 lesson, §13's gallery).
   */
  ogTitle?: string;
}): Metadata {
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: `/${input.locale}/contests`,
      languages: localeAlternates('/contests'),
    },
    openGraph: {
      type: 'website',
      locale: input.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${input.locale}/contests`,
      title: input.ogTitle ?? input.title,
      description: input.description,
      images: [SITE_OG_IMAGE],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

/** Draft, archived or unknown — a page that must not be indexed. */
export function unresolvedContestMetadata(siteName: string): Metadata {
  return { title: siteName, robots: { index: false, follow: false } };
}
