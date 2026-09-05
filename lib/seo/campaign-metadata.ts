import type { Metadata } from 'next';
import type { Locale } from '@/lib/i18n/config';
import { localize } from '@/lib/i18n/format';
import type { CampaignCard } from '@/lib/campaigns/catalog';
import { campaignRest } from '@/lib/campaigns/links';
import { localeAlternates } from './playbook-metadata';
import { SITE_OG_IMAGE, SITE_TWITTER_CARD } from './og';

/** A campaign detail: indexable, self-canonical, the style's poster as its card when it has one. */
export function campaignMetadata(input: {
  campaign: Pick<CampaignCard, 'slug' | 'title' | 'summary'>;
  posterSrc: string | null;
  locale: Locale;
  siteName: string;
}): Metadata {
  const { campaign, locale } = input;
  const rest = campaignRest(campaign.slug);
  const title = localize(campaign.title, locale);
  const description = localize(campaign.summary, locale);
  return {
    title,
    description,
    alternates: { canonical: `/${locale}${rest}`, languages: localeAlternates(rest) },
    openGraph: {
      type: 'article',
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${locale}${rest}`,
      title,
      description,
      siteName: input.siteName,
      images: [input.posterSrc ? { url: input.posterSrc } : SITE_OG_IMAGE],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

export function campaignsListingMetadata(input: { locale: Locale; title: string; description: string; siteName: string }): Metadata {
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: `/${input.locale}/campaigns`, languages: localeAlternates('/campaigns') },
    openGraph: {
      type: 'website',
      locale: input.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${input.locale}/campaigns`,
      title: `${input.title} — ${input.siteName}`,
      description: input.description,
      siteName: input.siteName,
      images: [SITE_OG_IMAGE],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

/** Draft, archived or unknown — never indexed. */
export function unresolvedCampaignMetadata(siteName: string): Metadata {
  return { title: siteName, robots: { index: false, follow: false } };
}
