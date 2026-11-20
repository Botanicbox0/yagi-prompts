/**
 * The rail's two modes (founder 2026-11-20): 직접 만들기 (the self-serve studios) and 야기 팀과 (projects
 * with the YAGI team). A brand that hires the team rarely opens the studios, and a brand that makes things
 * itself rarely needs the project side, so the rail shows one side at a time behind a two-way switch.
 *
 * Rules, all here and free of React so they are tested directly:
 *  - Modes exist only while project rooms are open (without rooms the rail is the ungrouped one, unchanged).
 *  - 야기 팀과 is always there with rooms; 직접 만들기 only when the studio (or its showroom) is.
 *    One side only: no switch, the rail is that side.
 *  - The current mode: the page's own side when the page belongs to one (a deep link, a notice, a home
 *    card flips the rail to match), else the side this browser last used for this brand, else the brand's
 *    default: 야기 팀과 for a brand that can only work with the team (`self_studio` denied, which a
 *    `project_only` plan also sets, lib/brands/entitlements.ts), 직접 만들기 for everyone else.
 *  - 에셋 sits on both sides: project briefs pick from it, and the project-only plan keeps the asset hub.
 *
 * Where the choice lives: a cookie (`twings_brand_mode`), per brand. No per-member preference store
 * exists in the database, and the server needs the value for the first paint (the rail and the home's
 * card order render on the server), which localStorage cannot give. Unreadable or blocked: the default.
 *
 * Client-safe: no env, no db. Presentation only: every page and API authorizes on its own.
 */
import { RAIL_GROUP, type RailGroups, type RailItemId } from './rail-model';

export type RailMode = 'make' | 'team';
export const RAIL_MODES: readonly RailMode[] = ['make', 'team'];

/** `<organizationId>:<mode>` pairs joined by `|`, most recent first. Mirrors nothing else. */
export const RAIL_MODE_COOKIE = 'twings_brand_mode';
/** Brands remembered per browser; older entries fall off. */
export const RAIL_MODE_MAX = 12;

export interface RailModeInput {
  /** The studio is open for this brand (rail-model `RailVisibility.studio`). */
  studio: boolean;
  /** The studio's showroom stands in for it (project-only brand). */
  studioShowroom?: boolean;
  /** Project rooms are open (the team side exists). */
  rooms: boolean;
}

/** The sides this brand has, in switch order. Empty without rooms: no modes at all. */
export function railModes(input: RailModeInput): RailMode[] {
  if (!input.rooms) return [];
  return input.studio || input.studioShowroom ? ['make', 'team'] : ['team'];
}

/** First visit: a brand that can only work with the team opens on 야기 팀과. */
export function defaultRailMode(input: RailModeInput): RailMode {
  return input.studio ? 'make' : 'team';
}

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * The side a page belongs to, or null for a page both sides share (home, assets, team, settings, usage,
 * an invitation). `/brand` is the project list.
 */
export function pathRailMode(path: string): RailMode | null {
  const clean = path.split(/[?#]/)[0] ?? path;
  if (under(clean, '/brand/studio') || under(clean, '/brand/identity')) return 'make';
  if (clean === '/brand' || clean === '/brand/' || under(clean, '/brand/projects') || under(clean, '/brand/rooms') || under(clean, '/brand/creators')) {
    return 'team';
  }
  return null;
}

export interface ResolveRailModeInput extends RailModeInput {
  path: string;
  /** What this browser last used for this brand (from the cookie), if anything. */
  remembered?: RailMode | null;
}

/** The mode the rail shows; null when the brand has no modes (rooms closed). */
export function resolveRailMode(input: ResolveRailModeInput): RailMode | null {
  const modes = railModes(input);
  if (modes.length === 0) return null;
  if (modes.length === 1) return modes[0]!;
  const fromPath = pathRailMode(input.path);
  if (fromPath && modes.includes(fromPath)) return fromPath;
  if (input.remembered && modes.includes(input.remembered)) return input.remembered;
  return defaultRailMode(input);
}

const ORG_ID = /^[0-9a-f-]{8,64}$/i;
const isMode = (value: unknown): value is RailMode => value === 'make' || value === 'team';

/** The cookie's pairs, most recent first. Anything malformed is skipped; an unreadable cookie is empty. */
export function parseRailModeCookie(raw: string | null | undefined): Record<string, RailMode> {
  const out: Record<string, RailMode> = {};
  if (!raw) return out;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // keep the raw text
  }
  for (const pair of text.split('|').slice(0, RAIL_MODE_MAX)) {
    const [id, mode] = pair.split(':');
    if (!id || !ORG_ID.test(id) || !isMode(mode)) continue;
    const key = id.toLowerCase();
    if (!(key in out)) out[key] = mode;
  }
  return out;
}

/** The cookie value after remembering `mode` for `organizationId` (moved to the front, capped). */
export function rememberRailMode(memory: Readonly<Record<string, RailMode>>, organizationId: string, mode: RailMode): string {
  const key = organizationId.toLowerCase();
  const rest = Object.entries(memory).filter(([id]) => id !== key);
  return [[key, mode] as const, ...rest]
    .filter(([id, value]) => ORG_ID.test(id) && isMode(value))
    .slice(0, RAIL_MODE_MAX)
    .map(([id, value]) => `${id}:${value}`)
    .join('|');
}

/** The remembered mode for one brand, or null. */
export function rememberedRailMode(memory: Readonly<Record<string, RailMode>>, organizationId: string | null | undefined): RailMode | null {
  if (!organizationId) return null;
  return memory[organizationId.toLowerCase()] ?? null;
}

/**
 * The items one mode shows. 직접 만들기: its own group (에셋 included). 야기 팀과: its group, then 에셋 when
 * the brand has it. Saved order applies inside each group (rail-model `groupItems`).
 */
export function railModeItems(groups: RailGroups, mode: RailMode): RailItemId[] {
  if (mode === 'make') return [...groups.make];
  return groups.make.includes('assets') ? [...groups.team, 'assets'] : [...groups.team];
}

/** Items a mode shows that are not its own group's (에셋 on 야기 팀과): listed, but never reordered there. */
export function railModeGuest(id: RailItemId, mode: RailMode): boolean {
  return RAIL_GROUP[id] !== mode;
}

/**
 * Where switching lands. On a page both sides share (home, assets, settings) the page stays and only the
 * rail changes; on a page of the other side, the new side's first item (its saved order) opens, so nobody
 * sits on a page their rail does not list.
 */
export function railModeSwitchTarget(path: string, next: RailMode, items: readonly RailItemId[], hrefOf: (id: RailItemId) => string): string | null {
  const side = pathRailMode(path);
  if (side === null || side === next) return null;
  const first = items.find((id) => !railModeGuest(id, next)) ?? items[0];
  return first ? hrefOf(first) : null;
}

/**
 * A page whose server-rendered content depends on the mode marks its root with this attribute (the home
 * today: the making home or the team home, components/brand-workspace/home/). A switch on such a page
 * refreshes the server-rendered tree after the cookie is written, so the content follows at once without
 * a reload; a shared page without it (team, settings, assets) only changes the rail.
 */
export const RAIL_MODE_FOLLOWS_ATTRIBUTE = 'data-follows-rail-mode';

export type RailModeSwitchEffect = { kind: 'navigate'; href: string } | { kind: 'refresh' } | { kind: 'none' };

/** What pressing the switch does to the page (the rail itself always changes). */
export function railModeSwitchEffect(input: {
  path: string;
  next: RailMode;
  items: readonly RailItemId[];
  hrefOf: (id: RailItemId) => string;
  pageFollowsMode: boolean;
}): RailModeSwitchEffect {
  const href = railModeSwitchTarget(input.path, input.next, input.items, input.hrefOf);
  if (href) return { kind: 'navigate', href };
  return input.pageFollowsMode ? { kind: 'refresh' } : { kind: 'none' };
}
