import { normalizeReturnPath } from '@/lib/auth/return-path';
import type { AdminOutcome } from './context';
import type { AdminOperationName } from './operations';

/**
 * The studio's campaign preparation on brand.twings.app (docs/BRAND-STAFF-ACCESS.md "운영자 캠페인 준비").
 *
 * The brand host refuses `/admin/do`, so a DB admin looking at a customer's brand had no way to open,
 * start or finish a campaign there. This list is the whole brand-host door: the SAME registered
 * operations, run by the same `dispatchAdmin` after the same `requireAdmin()`. Any other name is a
 * 404 at the door, so the brand host never becomes a second copy of the admin surface.
 */
export const BRAND_HOST_STUDIO_OPERATIONS = [
  'brandWorkspace.organization',
  'brandWorkspace.createProject',
  'brandWorkspace.status',
  // The campaign cover: the image arrives through the attachment path (type and size checked on
  // reserve, real bytes on complete); this only points the campaign at one of its finished images.
  'brandWorkspace.cover',
  // Candidate file import and removal stay on admin.twings.app: the import worker has its own
  // secret-only route, and removal is destructive. Sharing is the one shortlist move this host needs.
  'brandWorkspace.shortlistShare',
] as const satisfies readonly AdminOperationName[];
export type BrandHostStudioOperation = (typeof BRAND_HOST_STUDIO_OPERATIONS)[number];

export const BRAND_STUDIO_ACTION_PATH = '/api/brand-workspace/studio';
/**
 * Every JSON call to the door carries this header with the value "1". A cross-site `<form>` cannot
 * send a custom header, and a cross-site `fetch` with one needs a CORS preflight this route never
 * answers. JS-free forms (which cannot set it) are held to the exact Origin + Sec-Fetch-Site check.
 */
export const STUDIO_REQUEST_HEADER = 'x-twings-studio';

export function isBrandHostStudioOperation(name: string): name is BrandHostStudioOperation {
  return (BRAND_HOST_STUDIO_OPERATIONS as readonly string[]).includes(name);
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ADMIN_PROJECT = new RegExp(`^/admin/brand-workspace/(${UUID})(#[a-z-]+)?$`, 'i');
const BRAND_PAGE = new RegExp(`^/brand/projects/(?:new|${UUID})$`, 'i');

/**
 * The brand-host page for an operation's admin destination. A campaign → its brand campaign page; a
 * new brand → the new-campaign page with that brand selected. Anything else → the campaign home.
 */
export function brandHostDestination(to: string | undefined, newOrganizationId?: string | null): string {
  if (newOrganizationId && new RegExp(`^${UUID}$`, 'i').test(newOrganizationId))
    return `/brand/projects/new?organizationId=${newOrganizationId}`;
  const project = to?.match(ADMIN_PROJECT);
  return project ? `/brand/projects/${project[1]!.toLowerCase()}${project[2] ?? ''}` : '/brand';
}

/**
 * Where a JS-free form on the brand host returns to, with the outcome in the query (the page shows it,
 * as `/admin` pages do). Only a brand campaign page or the new-campaign page; never an open redirect.
 */
export function brandHostOutcomeUrl(back: string, outcome: AdminOutcome): string {
  const path = normalizeReturnPath(back);
  const target = new URL(path && BRAND_PAGE.test(new URL(path, 'https://path.invalid').pathname) ? path : '/brand', 'https://path.invalid');
  for (const key of ['ok', 'err', 'detail']) target.searchParams.delete(key);
  target.searchParams.set(outcome.ok ? 'ok' : 'err', outcome.code);
  if (!outcome.ok && outcome.detail) target.searchParams.set('detail', outcome.detail.slice(0, 200));
  return `${target.pathname}${target.search}${target.hash}`;
}
