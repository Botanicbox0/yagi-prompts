import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { BUSINESS } from '@/lib/legal/documents';

export const YAGI_ORIGIN = 'https://yagiworkshop.xyz';
export const YAGI_UPDATED = '2026-10-06';
export const productionUrl = (locale: Locale) => `${YAGI_ORIGIN}/${locale}`;

/** Pure public data. Never derive canonicals from incoming or forwarded headers. */
export function productionStructuredData(locale: Locale, dict: Dictionary) {
  const t = dict.yagi;
  const organization = `${YAGI_ORIGIN}/#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': organization, name: t.brand, legalName: BUSINESS.name, url: YAGI_ORIGIN,
        logo: `${YAGI_ORIGIN}/yagi/yagi-mark.png`, email: BUSINESS.email, sameAs: ['https://www.instagram.com/yagiworkshop/'] },
      { '@type': 'WebSite', '@id': `${YAGI_ORIGIN}/#website`, name: t.brand, url: YAGI_ORIGIN,
        publisher: { '@id': organization }, inLanguage: ['ko', 'en'] },
      { '@type': 'Service', '@id': `${productionUrl(locale)}#service`, name: t.title, description: t.definition,
        url: productionUrl(locale), provider: { '@id': organization } },
      { '@type': 'FAQPage', '@id': `${productionUrl(locale)}#faq`, inLanguage: locale,
        mainEntity: [1, 2, 3, 4].map(n => ({ '@type': 'Question', name: t.faq[`q${n}` as 'q1'],
          acceptedAnswer: { '@type': 'Answer', text: t.faq[`a${n}` as 'a1'] } })) },
    ],
  };
}

export function productionSitemap(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${(['en', 'ko'] as const).map(locale => `<url><loc>${productionUrl(locale)}</loc><lastmod>${YAGI_UPDATED}</lastmod><xhtml:link rel="alternate" hreflang="en" href="${productionUrl('en')}"/><xhtml:link rel="alternate" hreflang="ko" href="${productionUrl('ko')}"/><xhtml:link rel="alternate" hreflang="x-default" href="${productionUrl('en')}"/></url>`).join('')}</urlset>`;
}

export function productionLlms(full = false): string {
  const en = getDictionary('en').yagi;
  const ko = getDictionary('ko').yagi;
  return `# YAGI\n\n${en.definition}\n\n${ko.definition}\n\n## Pages\n- [English](${productionUrl('en')})\n- [Korean](${productionUrl('ko')})\n- [Creator app: TWINGS](https://twings.app)\n- [Brand inquiries](https://twings.app/en/campaigns#brands)\n\n## Scope and rights\n${en.scopeNote}\n${en.creatorNote}\n${en.faq.a3}\n\n## Verified campaign result\n9 videos; 2M+ views; 300+ derivative organic posts. A completed campaign for a global AI platform. Future results are not guaranteed.\n${full ? `\n## Questions\n${[1,2,3,4].map(n => `### ${en.faq[`q${n}` as 'q1']}\n${en.faq[`a${n}` as 'a1']}`).join('\n\n')}\n` : ''}`;
}

/** The production host has no application APIs, auth callbacks or private media transport. */
export function productionAssetAllowed(path: string): boolean {
  return path.startsWith('/_next/static/')
    || /^\/fonts\/[a-zA-Z0-9_./-]+\.(?:css|woff2?)$/.test(path)
    || ['/yagi/yagi-mark.png', '/yagi/yagi-wordmark.png', '/yagi/twings-mark.png', '/yagi/icon.png', '/yagi/apple-icon.png', '/favicon.ico'].includes(path)
    || /^\/reel\/campaigns\/(?:beauty-rose|retro-phone-01|retro-phone-02|highteen)\.(?:jpg|mp4|webm)$/.test(path)
    || /^\/reel\/studio-demo\/(?:designed-format\.(?:jpg|mp4|webm)|different-person\.(?:jpg|mp4|webm)|reference-selfie\.jpeg|designed-reference\.png)$/.test(path);
}
