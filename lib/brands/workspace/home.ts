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

export type HomeDoorKey = 'image' | 'video';
export type HomeToolKey = 'sound' | 'compose' | 'workflows' | 'assets';
/** `commission`: 새 프로젝트 의뢰 (rooms open); `campaign`: 캠페인 의뢰 (rooms closed); `projects`: 프로젝트, for a role that cannot request. */
export type HomeTeamKey = 'commission' | 'campaign' | 'projects';

export interface HomeLayout {
  /** The two big doors: 이미지 스튜디오, 영상 스튜디오. */
  doors: Array<{ key: HomeDoorKey; path: string }>;
  /** The compact tools: 사운드 스튜디오 (when open), 편집 스튜디오, 워크플로우, 에셋 (when the asset hub is open). */
  tools: Array<{ key: HomeToolKey; path: string }>;
  /** The YAGI team tile: a service, not a tool. */
  team: { key: HomeTeamKey; path: string };
}

export interface HomeLayoutInput {
  choice: HomeOrg;
  flagOn: boolean;
  /** Owners and editors of this brand (never the TWINGS team view): the request tile. */
  canRequest: boolean;
  /** Project rooms are open for this brand: the request is a project brief to the YAGI team. */
  rooms: boolean;
  /** The sound studio is open for this brand (lib/brand-studio/visibility.ts `soundStudioVisible`). */
  sound?: boolean;
}

/**
 * What this brand sees, with the same checks the rail and each page use: the four studio screens share one
 * gate (`studioRouteContext`), the asset hub its own (`assetHubVisible`), and a request is for a role that
 * may send one. A role that cannot request (a viewer, the TWINGS team view) gets 프로젝트 instead, the
 * list the rail opens. Null when the brand has no home.
 */
export function homeLayout(input: HomeLayoutInput): HomeLayout | null {
  const { choice, flagOn } = input;
  if (!brandHomeVisible(choice, flagOn)) return null;
  const tools: HomeLayout['tools'] = [
    ...(input.sound ? [{ key: 'sound' as const, path: '/brand/studio/sound' }] : []),
    { key: 'compose', path: '/brand/studio/compose' },
    { key: 'workflows', path: '/brand/studio/workflows' },
  ];
  if (assetHubVisible(choice, flagOn)) tools.push({ key: 'assets', path: '/brand/library' });
  const team: HomeLayout['team'] = input.canRequest
    ? { key: input.rooms ? 'commission' : 'campaign', path: '/brand/projects/new' }
    : { key: 'projects', path: '/brand' };
  return {
    doors: [
      { key: 'image', path: '/brand/studio' },
      { key: 'video', path: '/brand/studio/video' },
    ],
    tools,
    team,
  };
}

export type HomeStarterKey = 'product' | 'look' | 'film';
/**
 * "이렇게 시작해 보세요" for a brand that has made nothing yet: a house frame and a sentence that describes
 * exactly that frame (messages/brand-home.ts), opened in the studio through the prefill hand-off.
 */
export const HOME_STARTERS: ReadonlyArray<{ key: HomeStarterKey; medium: HomeDoorKey; picture: string }> = [
  { key: 'product', medium: 'image', picture: '/reel/landing/c-garment-wide.webp' },
  { key: 'look', medium: 'image', picture: '/reel/landing/look-knit.webp' },
  { key: 'film', medium: 'video', picture: '/reel/landing/v7/rx-beauty-world.jpg' },
];

export interface HomeResult {
  outputId: string;
  kind: 'image' | 'video';
  /** The picture the tile shows: the poster of a clip, the image itself otherwise; null for a clip without a poster. */
  src: string | null;
  /** A clip without a poster: the tile shows a still frame of it (never autoplays). */
  clip: string | null;
  /** A clip's file, with or without a poster: what the tile plays, muted, while the pointer is on it. */
  play: string | null;
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
 * a still frame of itself; every internal "빈 곳 채우기" strip is left out.
 */
export function homeResults(jobs: readonly StudioJobView[], organizationId: string, limit = HOME_WALL_LIMIT): HomeResult[] {
  const out: HomeResult[] = [];
  for (const job of jobs) {
    if (job.status !== 'succeeded' || job.purpose === 'fill') continue;
    for (const output of job.outputs) {
      if (out.length >= limit) return out;
      // The home's doors and results show pictures and films; sound lives in the sound studio.
      if (output.kind === 'audio') continue;
      const src = output.kind === 'image' ? output.thumbUrl ?? output.url : output.thumbUrl;
      const clip = output.kind === 'video' && !src ? output.url : null;
      if (!src && !clip) continue;
      const base = scopedHref(screenOf(job.kind), { id: organizationId });
      out.push({
        outputId: output.id,
        kind: output.kind,
        src,
        clip,
        play: output.kind === 'video' ? output.url : null,
        width: output.width,
        height: output.height,
        seconds: output.kind === 'video' ? output.seconds : null,
        href: `${base}&view=${encodeURIComponent(`o:${output.id}`)}`,
      });
    }
  }
  return out;
}

/** How many results the home's wall shows (the page reads the newest 24 runs; the wall never asks for more). */
export const HOME_WALL_LIMIT = 12;

/** A tile's width over its height, from the result's own size. Kept between a tall phone frame and a wide strip. */
export function homeTileRatio(result: Pick<HomeResult, 'kind' | 'width' | 'height'>): number {
  const ratio = result.width && result.height ? result.width / result.height : result.kind === 'video' ? 16 / 9 : 4 / 5;
  return Math.min(2.4, Math.max(0.5625, Math.round(ratio * 1000) / 1000));
}

export interface HomeWallRow<T> {
  items: ReadonlyArray<{ item: T; ratio: number }>;
  /** What is left of the row's width, in the same unit as the ratios: 0 for a full row, more for a short last row. */
  rest: number;
}

/**
 * The wall as rows of one height each: every tile keeps its own proportions, and a row is closed when its
 * tiles' ratios add up to about `target` (a row's height is its width over that sum, so rows come out
 * close to one another). A short last row keeps the height of a full one and leaves its end open: its
 * tiles are never blown up to fill the line. Pure: the same results always give the same wall.
 */
export function homeWallRows<T>(items: readonly T[], ratioOf: (item: T) => number, target = 4.6): HomeWallRow<T>[] {
  const rows: HomeWallRow<T>[] = [];
  let row: Array<{ item: T; ratio: number }> = [];
  let sum = 0;
  for (const item of items) {
    const ratio = ratioOf(item);
    // Closing before this tile leaves the row nearer the target than taking it would.
    if (row.length > 0 && Math.abs(sum - target) <= Math.abs(sum + ratio - target)) {
      rows.push({ items: row, rest: 0 });
      row = [];
      sum = 0;
    }
    row.push({ item, ratio });
    sum += ratio;
  }
  if (row.length > 0) rows.push({ items: row, rest: Math.max(0, Math.round((target - sum) * 1000) / 1000) });
  return rows;
}

/* ------------------------------------------------------------------ the home on 야기 팀과 */

/** At most this many projects on the team home; the full list is one link away. */
export const TEAM_HOME_PROJECTS = 6;

export interface TeamHomeProjectRank {
  id: string;
  status: string;
  updatedAt: string;
}

/**
 * Which projects the team home lists, and in what order (founder 2026-11-20: a brand that works with the
 * team sees its projects, not the making side). Cancelled ones are left out. Projects with something
 * waiting on the person (a draft or storyboard to decide, unread team messages) come first, then work in
 * progress, then new requests, then finished work; newest first within each.
 */
export function teamHomeProjects<T extends TeamHomeProjectRank>(
  projects: readonly T[],
  waiting: Readonly<Record<string, number>>,
  limit = TEAM_HOME_PROJECTS,
): T[] {
  const rank: Record<string, number> = { active: 0, requested: 1, completed: 2 };
  const time = (value: string) => {
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : 0;
  };
  return projects
    .filter((p) => p.status !== 'cancelled')
    .map((p, index) => ({ p, index, waits: (waiting[p.id] ?? 0) > 0 ? 0 : 1, status: rank[p.status] ?? 3 }))
    .sort((a, b) => a.waits - b.waits || a.status - b.status || time(b.p.updatedAt) - time(a.p.updatedAt) || a.index - b.index)
    .slice(0, limit)
    .map(({ p }) => p);
}
