import type { BrandRole } from './types';

/**
 * Which brand the workspace is showing, decided from the URL alone.
 *
 * A brand's identity is its `brand_organizations.id` UUID; no second number exists. The selected
 * brand travels as `?organizationId=<uuid>` on every workspace link, so a copied link opens the same
 * brand, two tabs can show two brands, and no cookie or server-side "current brand" can drift.
 *
 * Presentation and scoping only. Every service call still authorizes the organization on its own;
 * a choice listed here never grants anything.
 */

/** `guest`: invited to individual campaigns of this brand only, with no workspace membership. */
export type BrandChoiceRole = BrandRole | 'guest';
export interface BrandWorkspaceChoice {
  id: string;
  name: string;
  role: BrandChoiceRole;
  /** Private, re-authorized route; null means the default avatar. */
  logoUrl: string | null;
}
export interface BrandWorkspaceScope {
  /** Memberships first (oldest brand first), then brands reached only through shared campaigns. */
  choices: BrandWorkspaceChoice[];
  /** Visible campaign id -> owning organization id, so a campaign page always shows its own brand. */
  projectOrganizations: Record<string, string>;
}
export type WorkspaceSelection =
  | { state: 'selected'; choice: BrandWorkspaceChoice; source: 'route' | 'query' | 'default' }
  /** The URL named a brand this account cannot see. Never silently replaced by another brand. */
  | { state: 'unavailable' }
  /** Signed in with no brand and no shared campaign yet. */
  | { state: 'none' };

export const ORGANIZATION_QUERY = 'organizationId';
const PROJECT_ROUTE = /^\/brand\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export function projectIdFromPath(pathname: string): string | null {
  return PROJECT_ROUTE.exec(pathname)?.[1]?.toLowerCase() ?? null;
}

/**
 * Precedence: the brand that owns the page's campaign, then the query, then the first choice.
 * A route or query naming an inaccessible brand is `unavailable`, not a fallback.
 */
export function resolveWorkspaceSelection(
  choices: readonly BrandWorkspaceChoice[],
  input: { query?: string | string[] | null; routeOrganizationId?: string | null },
): WorkspaceSelection {
  const find = (id: string) => choices.find((c) => c.id === id.toLowerCase());
  if (input.routeOrganizationId) {
    const choice = find(input.routeOrganizationId);
    return choice ? { state: 'selected', choice, source: 'route' } : { state: 'unavailable' };
  }
  // A repeated parameter is ambiguous; treat it as a request for something we cannot honor.
  if (Array.isArray(input.query)) return { state: 'unavailable' };
  if (input.query) {
    const choice = find(input.query);
    return choice ? { state: 'selected', choice, source: 'query' } : { state: 'unavailable' };
  }
  return choices[0] ? { state: 'selected', choice: choices[0], source: 'default' } : { state: 'none' };
}

export function selectedChoice(selection: WorkspaceSelection): BrandWorkspaceChoice | null {
  return selection.state === 'selected' ? selection.choice : null;
}

/** `path` with the selected brand attached; unchanged when nothing is selected. */
export function scopedHref(path: string, choice: Pick<BrandWorkspaceChoice, 'id'> | null): string {
  if (!choice) return path;
  const [base, hash = ''] = path.split('#');
  const url = new URL(base!, 'https://scope.invalid');
  url.searchParams.set(ORGANIZATION_QUERY, choice.id);
  return `${url.pathname}${url.search}${hash ? `#${hash}` : ''}`;
}

export interface SectionVisibility { studio: boolean; settings: boolean; members: boolean }
/**
 * Role of the SELECTED brand only: owning brand A never shows owner controls while viewing brand B.
 * No brand yet keeps the studio open (it doubles as the setup path) and hides brand-only sections.
 */
export function sectionVisibility(choice: Pick<BrandWorkspaceChoice, 'role'> | null): SectionVisibility {
  if (!choice) return { studio: true, settings: false, members: false };
  return { studio: choice.role !== 'guest', settings: choice.role !== 'guest', members: choice.role === 'owner' };
}

/** Where switching to `choice` lands: the same section when that brand's role can open it, else home. */
export function switchHref(pathname: string, choice: BrandWorkspaceChoice): string {
  const visible = sectionVisibility(choice);
  const section =
    pathname === '/brand/library' ? '/brand/library'
    : pathname === '/brand/studio' && visible.studio ? '/brand/studio'
    : pathname === '/brand/settings' && visible.settings ? '/brand/settings'
    : pathname === '/brand/members' && visible.members ? '/brand/members'
    : '/brand';
  return scopedHref(section, choice);
}
