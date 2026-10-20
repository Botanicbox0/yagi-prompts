import type { Dictionary } from '@/lib/i18n/dictionaries';
import { storefrontOpen } from '@/lib/auth/purchase-gate';

export const FAQ_CATEGORIES = ['usage', 'payment', 'rights', 'campaign', 'brand'] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];
export type FaqPlacement = 'landing' | 'template' | 'campaign' | 'brand' | 'pricing';
type FaqNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22;

/** One registry for every visible FAQ and its JSON-LD. Copy remains in the locale dictionaries. */
export const FAQ_CATALOG: ReadonlyArray<{
  id: string;
  category: FaqCategory;
  number: FaqNumber;
  placements: readonly FaqPlacement[];
}> = [
  { id: 'browsing', category: 'usage', number: 1, placements: ['landing', 'template'] },
  { id: 'pricing', category: 'payment', number: 2, placements: ['landing', 'template'] },
  { id: 'photos', category: 'rights', number: 3, placements: ['landing', 'template', 'campaign'] },
  { id: 'generation-time', category: 'usage', number: 4, placements: ['landing', 'template'] },
  { id: 'result-issues', category: 'payment', number: 8, placements: ['landing', 'template'] },
  { id: 'creator-campaigns', category: 'campaign', number: 5, placements: ['landing', 'campaign'] },
  { id: 'brand-campaigns', category: 'brand', number: 7, placements: [] },
  { id: 'studio-projects', category: 'brand', number: 6, placements: [] },
  { id: 'campaign-delivery', category: 'brand', number: 9, placements: ['brand'] },
  { id: 'campaign-difference', category: 'brand', number: 10, placements: ['brand'] },
  { id: 'production-only', category: 'brand', number: 11, placements: ['brand'] },
  { id: 'campaign-estimate', category: 'brand', number: 12, placements: ['brand'] },
  { id: 'campaign-results', category: 'brand', number: 13, placements: ['brand'] },
  { id: 'creator-usage-rights', category: 'brand', number: 14, placements: ['brand'] },
  { id: 'ai-campaign-safety', category: 'brand', number: 15, placements: ['brand'] },
  { id: 'korea-japan-campaigns', category: 'brand', number: 16, placements: ['brand'] },
  { id: 'subscription-availability', category: 'payment', number: 17, placements: ['pricing'] },
  { id: 'subscription-video-count', category: 'usage', number: 18, placements: ['pricing'] },
  { id: 'premium-customization', category: 'usage', number: 19, placements: ['pricing'] },
  { id: 'subscription-rollover', category: 'payment', number: 20, placements: ['pricing'] },
  { id: 'subscription-extra-video', category: 'payment', number: 21, placements: ['pricing'] },
  { id: 'template-likeness-result', category: 'rights', number: 22, placements: ['pricing'] },
];

export interface FaqItem {
  id: string;
  category: FaqCategory;
  q: string;
  a: string;
}

/**
 * `publicGeneration` follows the STOREFRONT, not public sale: under `RENDER_PIPELINE_PUBLIC=review`
 * the template page carries a price and a buy CTA, so an FAQ still answering "결제는 준비 중입니다"
 * right beneath it contradicts the page a PG reviewer is reading. The two must say the same thing.
 */
export function faqItems(dict: Dictionary, placement?: FaqPlacement, publicGeneration = storefrontOpen()): FaqItem[] {
  return FAQ_CATALOG.filter((entry) => !placement || entry.placements.includes(placement)).map((entry) => ({
    id: entry.id,
    category: entry.category,
    q: dict.faq[`q${entry.number}`],
    a: !publicGeneration && [1, 2].includes(entry.number)
      ? `${dict.seo.generationClosed} ${dict.faq[`a${entry.number}`]}`
      : dict.faq[`a${entry.number}`],
  }));
}
