import type { Metadata } from 'next';
import type { ShapedPrompt } from '@/lib/prompts/shape';
import { promptRest } from '@/lib/prompts/links';
import type { Locale } from '@/lib/i18n/config';
import { localeAlternates } from './playbook-metadata';

/**
 * PLAN §13.2 — "published prompt details join the sitemap with locale alternates; gallery indexed;
 * submit/admin noindex". This is `lib/seo/playbook-metadata.ts`'s sibling, and it reuses that
 * file's `localeAlternates` so the two surfaces can never drift on hreflang.
 *
 * The one rule that differs, and it follows from §13 rather than from SEO: **every published prompt
 * is indexable**, including a Pro-gated one. There is no showcase/non-showcase split here — the
 * card, the poster and the result clip are public marketing surface for every published item, and
 * only the TEXT is gated. A crawler gets exactly what an anonymous reader gets, which is the
 * honest version of an indexable page behind a partial paywall.
 *
 * `og:image` still comes from a public-bucket URL only: a crawler fetches OG images with no
 * session, and the prompt-media route answers from the public bucket for published items only —
 * both are safe, and a route path is used when no CDN is configured (§11) rather than nothing.
 */

export interface PromptMetaInput {
  slug: string;
  locale: Locale;
  title: string;
  titleKo: string | null;
  /** The one-line positioning that doubles as every prompt page's description. */
  description: string;
  poster: ShapedPrompt['poster'];
  video: ShapedPrompt['video'];
  siteName: string;
}

export function promptMetadata(input: PromptMetaInput): Metadata {
  const title = input.locale === 'ko' && input.titleKo ? input.titleKo : input.title;
  const rest = promptRest(input.slug);
  const image = input.poster?.src ?? null;

  return {
    title,
    description: input.description,
    alternates: {
      canonical: `/${input.locale}${rest}`,
      languages: localeAlternates(rest),
    },
    openGraph: {
      type: 'article',
      locale: input.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${input.locale}${rest}`,
      title,
      description: input.description,
      ...(image ? { images: [{ url: image }] } : {}),
      ...(input.video ? { videos: [{ url: input.video.src, type: input.video.mime }] } : {}),
    },
  };
}

/** The gallery itself: indexable, self-canonical, reciprocal alternates. */
export function promptsGalleryMetadata(input: {
  locale: Locale;
  title: string;
  description: string;
  /**
   * The OG title, which must NAME the site because it is read outside it (a shared link, a card in
   * a chat client). The `<title>` must NOT: the locale layout already appends `· {siteName}` as a
   * template, so spelling the brand into `title` too produced "Prompts — YAGI PROMPTS · YAGI
   * PROMPTS" in the browser tab. `/pricing` had it right; this is the same split. (M7)
   */
  ogTitle?: string;
}): Metadata {
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: `/${input.locale}/prompts`,
      languages: localeAlternates('/prompts'),
    },
    openGraph: {
      type: 'website',
      locale: input.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${input.locale}/prompts`,
      title: input.ogTitle ?? input.title,
      description: input.description,
    },
  };
}

/** Pending, rejected, archived or unknown — a page that must not be indexed. */
export function unresolvedPromptMetadata(siteName: string): Metadata {
  return { title: siteName, robots: { index: false, follow: false } };
}
