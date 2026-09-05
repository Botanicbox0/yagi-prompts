import type { Locale } from '@/lib/i18n/config';

/**
 * Every campaign URL, spelled once (docs/CAMPAIGNS.md §6) — the same discipline as
 * `lib/contests/links.ts`, so the nav, the footer, the cards and the redirects cannot disagree.
 */

export const CAMPAIGNS_REST = '/campaigns';
export const ADMIN_CAMPAIGNS_PATH = '/admin/campaigns';
export const ADMIN_CAMPAIGN_NEW_PATH = `${ADMIN_CAMPAIGNS_PATH}/new`;
/** The creator's own view of every campaign they applied to — in the (app) group, session-gated. */
export const MY_CAMPAIGNS_PATH = '/campaigns/mine';

export function campaignsHref(locale: Locale | string): string {
  return `/${locale}${CAMPAIGNS_REST}`;
}

export function campaignHref(locale: Locale | string, slug: string): string {
  return `/${locale}${CAMPAIGNS_REST}/${encodeURIComponent(slug)}`;
}

export function campaignRest(slug: string): string {
  return `${CAMPAIGNS_REST}/${encodeURIComponent(slug)}`;
}

/** The login-gated apply form (app group, no locale prefix — like the contest submit path). */
export function campaignApplyPath(slug: string): string {
  return `${CAMPAIGNS_REST}/${encodeURIComponent(slug)}/apply`;
}

export function adminCampaignPath(id: string): string {
  return `${ADMIN_CAMPAIGNS_PATH}/${encodeURIComponent(id)}`;
}
