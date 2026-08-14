import type { Locale } from '@/lib/i18n/config';
import type { LegalDoc } from './documents';

/**
 * The legal surface's paths, spelled once (same reason `lib/prompts/links.ts` exists): the footer,
 * the pages themselves, the sitemap and the sweep all have to agree, and a payment reviewer follows
 * whichever one they find first.
 */
export const LEGAL_REST = '/legal';

export function legalRest(doc: LegalDoc): string {
  return `${LEGAL_REST}/${doc}`;
}

export function legalHref(locale: Locale | string, doc: LegalDoc): string {
  return `/${locale}${legalRest(doc)}`;
}
