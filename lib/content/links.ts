import { PLAYBOOK_DETAIL_ROUTE_READY } from '@/lib/flags';
import type { CatalogCard } from './catalog';

/**
 * Where a catalog card points.
 *
 * PLAN §3.1: "Cards for non-showcase playbooks link into the login wall (intended funnel)" —
 * showcase playbooks are the public SEO surface and go straight to their detail page.
 *
 * `/[locale]/p/[slug]` is M2's route. Until it exists, `PLAYBOOK_DETAIL_ROUTE_READY` keeps every
 * card on the login wall so the landing never links into a 404; flipping that one flag in M2
 * restores the §3.1 split. `/library` is middleware-gated, so an anonymous visitor is bounced to
 * the sign-in CTA — which is exactly the funnel §3.1 describes.
 */
export function playbookHref(locale: string, card: Pick<CatalogCard, 'slug' | 'isShowcase'>): string {
  if (PLAYBOOK_DETAIL_ROUTE_READY && card.isShowcase) return `/${locale}/p/${card.slug}`;
  return '/library';
}

/** True when the card links to public content rather than into the login wall. */
export function isPublicCardLink(card: Pick<CatalogCard, 'isShowcase'>): boolean {
  return PLAYBOOK_DETAIL_ROUTE_READY && card.isShowcase;
}
