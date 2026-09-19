import type { FaqItem } from '@/lib/faq/catalog';
import type { Locale } from '@/lib/i18n/config';
import { BUSINESS } from '@/lib/legal/documents';
import type { PromptCard } from '@/lib/prompts/catalog';

export type StructuredData = Record<string, unknown>;
const CONTEXT = 'https://schema.org';

export function seoUrl(origin: string, path: string): string {
  return new URL(path, `${origin.replace(/\/+$/, '')}/`).href;
}

/** Only public HTTP media belongs in structured data; never data:, javascript: or credential URLs. */
function mediaUrl(origin: string, value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, `${origin}/`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function siteStructuredData(origin: string): StructuredData {
  const url = seoUrl(origin, '/');
  return {
    '@context': CONTEXT,
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${url}#organization`,
        name: 'TWINGS',
        legalName: BUSINESS.nameKo,
        alternateName: BUSINESS.name,
        url,
        logo: seoUrl(origin, '/brand/twings-mark-black.png'),
        email: BUSINESS.email,
        // Add sameAs only after an official company profile is verified; guessing social handles
        // would claim an identity that the public site does not establish.
      },
      {
        '@type': 'WebSite',
        '@id': `${url}#website`,
        name: 'TWINGS',
        url,
        inLanguage: ['ko', 'en'],
        publisher: { '@id': `${url}#organization` },
      },
    ],
  };
}

export function faqStructuredData(origin: string, path: string, locale: Locale, items: FaqItem[]): StructuredData {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    '@id': `${seoUrl(origin, path)}#faq`,
    url: seoUrl(origin, path),
    inLanguage: locale,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

interface TemplateInput {
  origin: string;
  locale: Locale;
  card: PromptCard;
  description: string;
  publicSalesEnabled: boolean;
}

export function templateStructuredData(input: TemplateInput): StructuredData | null {
  const { origin, locale, card, description, publicSalesEnabled } = input;
  const url = seoUrl(origin, `/${locale}/t/${card.slug}`);
  const name = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
  const poster = mediaUrl(origin, card.poster?.src);
  const video = mediaUrl(origin, card.video?.src);
  const graph: StructuredData[] = [];

  // An output duration is not the duration of the example clip. Missing video provenance is
  // omitted, never fabricated from runtimeSeconds or from the date this page was rendered.
  // Local public-media fallbacks live under /api, which robots disallows. A browser-playable
  // fallback is not evidence of crawler access; only the published public URL is eligible here.
  if (card.medium === 'video' && card.video?.source === 'public' && card.poster?.source === 'public' && video && poster && card.publishedAt && Number.isFinite(Date.parse(card.publishedAt))) {
    const duration = card.video?.duration_s;
    graph.push({
      '@type': 'VideoObject',
      '@id': `${url}#example`,
      name,
      description: `${name}. ${description}`,
      url,
      thumbnailUrl: [poster],
      contentUrl: video,
      uploadDate: new Date(card.publishedAt).toISOString(),
      ...(duration && Number.isFinite(duration) && duration > 0 ? { duration: `PT${duration}S` } : {}),
      inLanguage: locale,
    });
  }

  // Checkout charges stored KRW. EN currently displays USD, so it cannot truthfully publish a
  // KRW offer until visible pricing agrees. The rollout flag also controls actual availability.
  if (publicSalesEnabled && locale === 'ko' && card.priceCents > 0 && Number.isInteger(card.priceKrw) && card.priceKrw > 0) {
    graph.push({
      '@type': 'Product',
      '@id': `${url}#product`,
      name,
      description,
      url,
      ...(poster ? { image: [poster] } : {}),
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'KRW',
        price: card.priceKrw,
        availability: 'https://schema.org/OnlineOnly',
        seller: { '@id': `${seoUrl(origin, '/')}#organization` },
      },
    });
  }
  return graph.length ? { '@context': CONTEXT, '@graph': graph } : null;
}

export function campaignServiceStructuredData(input: {
  origin: string;
  path: string;
  locale: Locale;
  name: string;
  description: string;
  serviceType: string;
  offer?: boolean;
}): StructuredData {
  const url = seoUrl(input.origin, input.path);
  const organization = { '@id': `${seoUrl(input.origin, '/')}#organization` };
  return {
    '@context': CONTEXT,
    '@type': 'Service',
    '@id': `${url}#service`,
    url,
    name: input.name,
    description: input.description,
    serviceType: input.serviceType,
    provider: organization,
    // A campaign is a service opportunity, not an Event or a purchasable creator. No creator
    // fee, invented campaign price, rating, or promised reach is emitted.
    ...(input.offer ? { offers: { '@type': 'Offer', url, offeredBy: organization, itemOffered: { '@id': `${url}#service` } } } : {}),
  };
}
