import type { Metadata } from 'next';
import type { Locale } from '@/lib/i18n/config';
import { localeAlternates } from '@/lib/seo/playbook-metadata';
import { SITE_TWITTER_CARD, siteOgImage } from '@/lib/seo/og';
import { seoUrl, type StructuredData } from '@/lib/seo/structured-data';
import { makerHref } from '@/lib/makers/links';
import { makerBlogListRest, makerBlogPostRest } from './links';
import type { PublicPost } from './public';

/** Metadata and JSON-LD builders for AI creative blog pages (AGENTS.md §7). */

function absoluteMediaUrl(origin: string, src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    const url = new URL(src, `${origin.replace(/\/+$/, '')}/`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function postListMetadata(input: {
  handle: string;
  locale: Locale;
  title: string;
  description: string;
  siteName: string;
  poster: string | null;
}): Metadata {
  const rest = makerBlogListRest(input.handle);
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: `/${input.locale}${rest}`, languages: localeAlternates(rest) },
    openGraph: {
      type: 'website',
      locale: input.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${input.locale}${rest}`,
      title: input.title,
      description: input.description,
      siteName: input.siteName,
      images: [input.poster ? { url: input.poster } : siteOgImage(input.locale)],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

export function postDetailMetadata(input: {
  handle: string;
  slug: string;
  locale: Locale;
  title: string;
  description: string;
  siteName: string;
  poster: string | null;
  publishedAt: string | null;
  updatedAt: string;
}): Metadata {
  const rest = makerBlogPostRest(input.handle, input.slug);
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: `/${input.locale}${rest}`, languages: localeAlternates(rest) },
    openGraph: {
      type: 'article',
      locale: input.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${input.locale}${rest}`,
      title: input.title,
      description: input.description,
      siteName: input.siteName,
      ...(input.publishedAt ? { publishedTime: input.publishedAt } : {}),
      modifiedTime: input.updatedAt,
      images: [input.poster ? { url: input.poster } : siteOgImage(input.locale)],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

export function postStructuredData(input: {
  origin: string;
  locale: Locale;
  post: PublicPost;
  fallbackDescription: string;
  fallbackImage: string | null;
}): StructuredData {
  const { origin, locale, post } = input;
  const url = seoUrl(origin, `/${locale}${makerBlogPostRest(post.author.handle, post.slug)}`);
  const authorUrl = seoUrl(origin, makerHref(locale, post.author.handle));
  const image = absoluteMediaUrl(origin, post.cover?.src ?? input.fallbackImage);
  const avatar = absoluteMediaUrl(origin, post.author.avatar);
  const rootUrl = seoUrl(origin, '/');

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    mainEntityOfPage: url,
    url,
    headline: post.title,
    description: post.summary ?? input.fallbackDescription,
    inLanguage: locale,
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    dateModified: post.updatedAt,
    ...(image ? { image: [image] } : {}),
    author: {
      '@type': 'Person',
      name: post.author.displayName ?? `@${post.author.handle}`,
      alternateName: `@${post.author.handle}`,
      url: authorUrl,
      ...(avatar ? { image: avatar } : {}),
    },
    publisher: { '@id': `${rootUrl}#organization` },
  };
}
