import type { Metadata } from 'next';
import type { Locale } from '@/lib/i18n/config';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { TemplateMedium } from '@/lib/prompts/schemas';
import { TEMPLATE_LISTING_REST, templateRest } from '@/lib/prompts/links';
import { localeAlternates } from './playbook-metadata';
import { SITE_OG_IMAGE, SITE_TWITTER_CARD } from './og';

/**
 * docs/TEMPLATES-IA.md — the template surface's metadata: the two listings and every published
 * template, all indexable, all with reciprocal en/ko alternates. `lib/seo/prompt-metadata.ts`'s
 * successor; the one rule that changed is that there is no gated half anywhere on these pages any
 * more, so a crawler gets exactly what a signed-in visitor gets.
 *
 * `og:image` is the template's poster from the public bucket (or the brand card, never imageless);
 * `og:video` is the example film when there is one — a share of a template IS a share of its film.
 */

export function templateMetadata(input: {
  card: PromptCard;
  locale: Locale;
  description: string;
  siteName: string;
}): Metadata {
  const { card, locale } = input;
  const title = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
  const rest = templateRest(card.slug);
  const image = card.poster?.src ?? null;
  return {
    title,
    description: input.description,
    alternates: { canonical: `/${locale}${rest}`, languages: localeAlternates(rest) },
    openGraph: {
      type: 'article',
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${locale}${rest}`,
      title,
      description: input.description,
      siteName: input.siteName,
      images: [image ? { url: image } : SITE_OG_IMAGE],
      ...(card.video ? { videos: [{ url: card.video.src, type: card.video.mime }] } : {}),
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

/** A listing tab: indexable, self-canonical, reciprocal alternates. */
export function templatesListingMetadata(input: {
  locale: Locale;
  medium: TemplateMedium;
  title: string;
  /** Names the site — read where the site is not; the tab title gets the brand from the layout template. */
  ogTitle?: string;
  description: string;
  siteName: string;
}): Metadata {
  const rest = TEMPLATE_LISTING_REST[input.medium];
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: `/${input.locale}${rest}`, languages: localeAlternates(rest) },
    openGraph: {
      type: 'website',
      locale: input.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${input.locale}${rest}`,
      title: input.ogTitle ?? input.title,
      description: input.description,
      siteName: input.siteName,
      images: [SITE_OG_IMAGE],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

/** Unknown, unpublished or archived — a page that must not be indexed. */
export function unresolvedTemplateMetadata(siteName: string): Metadata {
  return { title: siteName, robots: { index: false, follow: false } };
}
