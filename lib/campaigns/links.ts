import type { Locale } from '@/lib/i18n/config';

/**
 * Every campaign URL, spelled once (docs/CAMPAIGNS.md §6) — the same discipline as
 * `lib/contests/links.ts`, so the nav, the footer, the cards and the redirects cannot disagree.
 */

export const CAMPAIGNS_REST = '/campaigns';
export const ADMIN_CAMPAIGNS_PATH = '/admin/campaigns';
export const ADMIN_CAMPAIGN_NEW_PATH = `${ADMIN_CAMPAIGNS_PATH}/new`;
/** The brand inbox — its own board, so enquiries and campaigns never share a list (2026-09-11). */
export const ADMIN_INQUIRIES_PATH = '/admin/inquiries';
/** The creator's own view of every campaign they applied to — in the (app) group, session-gated. */
export const MY_CAMPAIGNS_PATH = '/campaigns/mine';

export function campaignsHref(locale: Locale | string): string {
  return `/${locale}${CAMPAIGNS_REST}`;
}

/** The brand half of the campaigns page (2026-09-11): the pitch and the enquiry form, one anchor. */
export const BRANDS_ANCHOR = 'brands';

/** Public campaign-service landing; the authenticated workspace remains on its own host. */
export function brandsHref(locale: Locale | string): string {
  return `/${locale}/brands`;
}

export function brandEnquiryHref(locale: Locale | string): string {
  return `${brandsHref(locale)}#${BRANDS_ANCHOR}`;
}

/** An explicit locale keeps the brand sign-in screen in the language of the landing page. */
export function brandWorkspaceHref(locale: Locale): string {
  return `https://brand.twings.app/auth/choose?next=%2Fbrand&locale=${locale}`;
}

/** `POST` — the enquiry form's endpoint (app/api/brands/inquiries). */
export const BRAND_INQUIRY_ENDPOINT = '/api/brands/inquiries';

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
export function campaignMakePath(slug: string): string {
  return `${CAMPAIGNS_REST}/${encodeURIComponent(slug)}/make`;
}

export function adminCampaignPath(id: string): string {
  return `${ADMIN_CAMPAIGNS_PATH}/${encodeURIComponent(id)}`;
}
