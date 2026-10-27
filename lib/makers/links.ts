import type { Locale } from '@/lib/i18n/config';

/**
 * docs/PLATFORM-2.0.md §7.5 — a maker's public page, `/{locale}/makers/{handle}`. Pure, like
 * `lib/prompts/links.ts`, so the card credit, the template page, the sitemap and the tests agree.
 * Handles are already `[a-z0-9_]` (0060), so no encoding is needed — and none is applied, so a
 * malformed value cannot smuggle a path segment in.
 */
export const MAKER_REST = '/makers';

export function makerRest(handle: string): string {
  return `${MAKER_REST}/${handle}`;
}

export function makerHref(locale: Locale, handle: string): string {
  return `/${locale}${makerRest(handle)}`;
}
