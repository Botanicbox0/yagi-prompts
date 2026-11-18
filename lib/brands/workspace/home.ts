/**
 * The workspace home (`/brand/home`, docs/BRAND-STUDIO-V3.md §12): who has it, where sign-in lands,
 * which action cards a brand sees and which recent results it shows.
 *
 * Client-safe: no env, no db. The server reads `brandStudioV2Open()` and passes it in as `flagOn`.
 * Presentation and routing only: every page and API still authorizes on its own, so a card that is
 * shown never grants anything and a card that is hidden is never what keeps someone out.
 */
import { featureDenied, isSandboxedClientOrganization } from '../features';
import { assetHubVisible, studioV2Visible } from '@/lib/brand-studio/visibility';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { resolveWorkspaceSelection, scopedHref, sectionVisibility, selectedChoice, type BrandWorkspaceChoice } from './selection';

/** The home itself. */
export const BRAND_HOME_PATH = '/brand/home';
/**
 * The default landing of the brand host (sign-in without `next`, the bare host, a refused `next`).
 * A resolver, not a page: it sends a brand with the studio to the home and everyone else to `/brand`,
 * exactly where they landed before the home existed (app/(brand)/brand/start/route.ts).
 */
export const BRAND_LANDING_PATH = '/brand/start';

type HomeOrg = Pick<BrandWorkspaceChoice, 'role'> & Partial<Pick<BrandWorkspaceChoice, 'id' | 'name' | 'denied'>>;

/**
 * True when this brand gets the home: studio v2 is open for it (flag on, not sandboxed, generative media
 * and the self-serve studio both open) and the role reads the studio (not a campaign-only guest). The
 * TWINGS team view (`studio`) passes, read-only like every other page it browses.
 */
export function brandHomeVisible(choice: HomeOrg | null | undefined, flagOn: boolean): boolean {
  if (!choice || !flagOn) return false;
  if (isSandboxedClientOrganization(choice) || featureDenied(choice.denied, 'generative_media')) return false;
  if (!studioV2Visible(choice, flagOn)) return false;
  return sectionVisibility(choice).studio;
}

/**
 * Where the default landing sends this account: the home of the brand the workspace opens on (the first
 * choice, the same default the sidebar selects) when that brand has it, otherwise `/brand` as before.
 */
export function brandLandingPath(choices: readonly BrandWorkspaceChoice[], flagOn: boolean): string {
  const choice = selectedChoice(resolveWorkspaceSelection(choices, {}));
  return brandHomeVisible(choice, flagOn) ? BRAND_HOME_PATH : '/brand';
}

export type HomeActionKey = 'image' | 'video' | 'compose' | 'workflows' | 'assets' | 'commission' | 'campaign';
export type HomeGroupId = 'make' | 'team';

export interface HomeAction {
  key: HomeActionKey;
  group: HomeGroupId;
  /** Unscoped; the page attaches the brand. */
  path: string;
}

/** The order cards appear in, and the rail address each one opens. */
const ACTION_PATHS: ReadonlyArray<readonly [HomeActionKey, HomeGroupId, string]> = [
  ['image', 'make', '/brand/studio'],
  ['video', 'make', '/brand/studio/video'],
  ['compose', 'make', '/brand/studio/compose'],
  ['workflows', 'make', '/brand/studio/workflows'],
  ['assets', 'make', '/brand/library'],
  ['commission', 'team', '/brand/projects/new'],
  ['campaign', 'team', '/brand/projects/new'],
];

export interface HomeActionInput {
  choice: HomeOrg;
  flagOn: boolean;
  /** Owners and editors of this brand (never the TWINGS team view): the request card. */
  canRequest: boolean;
  /** Project rooms are open for this brand: the request is a project brief to the YAGI team. */
  rooms: boolean;
}

/**
 * The cards this brand sees, with the same checks the rail and each page use: the four studio screens
 * share one gate (`studioRouteContext`), the asset hub its own (`assetHubVisible`), and a request is for
 * a role that may send one. With rooms the request is `commission` (새 프로젝트 의뢰), without them the
 * campaign request the "+" menu offers (`campaign`).
 */
export function homeActions(input: HomeActionInput): HomeAction[] {
  const { choice, flagOn } = input;
  if (!brandHomeVisible(choice, flagOn)) return [];
  const shown: Record<HomeActionKey, boolean> = {
    image: true,
    video: true,
    compose: true,
    workflows: true,
    assets: assetHubVisible(choice, flagOn),
    commission: input.canRequest && input.rooms,
    campaign: input.canRequest && !input.rooms,
  };
  return ACTION_PATHS.filter(([key]) => shown[key]).map(([key, group, path]) => ({ key, group, path }));
}

export interface HomeResult {
  outputId: string;
  kind: 'image' | 'video';
  /** The picture the tile shows: the poster of a clip, the image itself otherwise; null for a clip without a poster. */
  src: string | null;
  /** A clip without a poster: the tile shows its first frame (never autoplays). */
  clip: string | null;
  width: number | null;
  height: number | null;
  /** Seconds in tenths, for a clip. */
  seconds: number | null;
  /** The studio screen that lists it, opening it in the viewer (`?view=o:<id>`). */
  href: string;
}

/** Image and partial-edit results live on the image screen; every other run on the video screen. */
const screenOf = (kind: StudioJobView['kind']): string => (kind === 'image' || kind === 'region_edit' ? '/brand/studio' : '/brand/studio/video');

/**
 * The newest finished results of this brand, newest first, at most `limit`. A clip without a poster shows
 * its first frame; every internal "빈 곳 채우기" strip is left out.
 */
export function homeResults(jobs: readonly StudioJobView[], organizationId: string, limit = 6): HomeResult[] {
  const out: HomeResult[] = [];
  for (const job of jobs) {
    if (job.status !== 'succeeded' || job.purpose === 'fill') continue;
    for (const output of job.outputs) {
      if (out.length >= limit) return out;
      const src = output.kind === 'image' ? output.thumbUrl ?? output.url : output.thumbUrl;
      const clip = output.kind === 'video' && !src ? output.url : null;
      if (!src && !clip) continue;
      const base = scopedHref(screenOf(job.kind), { id: organizationId });
      out.push({
        outputId: output.id,
        kind: output.kind,
        src,
        clip,
        width: output.width,
        height: output.height,
        seconds: output.kind === 'video' ? output.seconds : null,
        href: `${base}&view=${encodeURIComponent(`o:${output.id}`)}`,
      });
    }
  }
  return out;
}
