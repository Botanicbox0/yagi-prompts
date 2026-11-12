/**
 * The workspace rail's rules (docs/BRAND-STUDIO-V3.md §3, slice A), kept free of React so they are
 * tested directly: which items exist, their default order, which one is current, how a saved order
 * applies, the stored expanded state, and when a finished job deserves a toast.
 *
 * Client-safe: no env, no db.
 */
import type { StudioJobKind } from '@/lib/brand-studio/contracts';

export type RailItemId =
  | 'image'
  | 'video'
  | 'compose'
  | 'workflows'
  | 'review'
  | 'campaigns'
  | 'creators'
  | 'assets'
  | 'brandKit'
  | 'messages';

/**
 * Project rooms (docs/BRAND-ROOMS.md §2): with rooms open the rail splits in two. What the brand makes
 * itself, and what it does with the YAGI team. Without rooms there are no groups and no `messages`.
 */
export type RailGroupId = 'make' | 'team';
export const RAIL_GROUP: Readonly<Record<RailItemId, RailGroupId>> = {
  image: 'make',
  video: 'make',
  compose: 'make',
  workflows: 'make',
  assets: 'make',
  brandKit: 'make',
  campaigns: 'team',
  messages: 'team',
  review: 'team',
  creators: 'team',
};

/** localStorage: `{ expanded: boolean }`. */
export const RAIL_STORAGE_KEY = 'twings_brand_rail_v1';
/** Mirror of the expanded state the layout reads, so the first paint already has the right width. */
export const RAIL_COOKIE = 'twings_brand_rail';
/** Shared with the topbar's drag order (components/brand-workspace/navigation.tsx). */
export const NAV_ORDER_STORAGE_KEY = 'twings_brand_nav_order_v1';
/** sessionStorage: job ids seen running and ids already announced, so a page change loses no toast. */
export const RAIL_JOBS_SESSION_KEY = 'twings_brand_rail_jobs_v1';

export const RAIL_HREF: Readonly<Record<RailItemId, string>> = {
  image: '/brand/studio',
  video: '/brand/studio/video',
  compose: '/brand/studio/compose',
  workflows: '/brand/studio/workflows',
  review: '/brand/studio/review',
  campaigns: '/brand',
  creators: '/brand/creators',
  assets: '/brand/library',
  brandKit: '/brand/identity',
  messages: '/brand/rooms',
};

/** 18px stroke icons on a 20-unit grid. */
export const RAIL_ICON: Readonly<Record<RailItemId | 'team' | 'settings' | 'create' | 'more' | 'toggle' | 'commission', string>> = {
  messages: 'M3.5 4.5h10v7.5H8l-3 2.5v-2.5H3.5z M13.5 7.5h3v7H15v2l-2.6-2H9.5v-2.5',
  commission: 'M4 4.5h9.5l2.5 2.5v8.5H4z M7 9h6M7 12h4 M13.5 4.5V7H16',
  compose: 'M3.5 5.5h5v9h-5z M11.5 5.5h5v9h-5z M8.5 10h3',
  workflows: 'M3.5 5.5h4.5v4.5H3.5z M12 5.5h4.5v4.5H12z M12 12h4.5v4.5H12z M8 7.75h4 M5.75 10v4.25h6.25',
  image: 'M3.5 4.5h13v11h-13z M3.5 13l3.8-3.6 3 2.8 2.2-2 4 3.6 M12.6 7.4h.1',
  video: 'M3 5.5h10v9H3z M13 8.6l4-2.4v7.6l-4-2.4',
  review: 'M4 4.5h12v8.5H9l-3.5 3v-3H4z M7 8h6M7 10.5h4',
  campaigns: 'M3.5 3.5h13v13h-13z M3.5 8h13M8 8v8.5',
  creators: 'M7 8a3 3 0 1 0 0-.01M2.5 16.5v-.5a4.5 4.5 0 0 1 9 0v.5M13.5 6a2.5 2.5 0 1 1 0 5M14.5 13a4 4 0 0 1 3 3.5',
  assets: 'M3 6h14v10.5H3z M6 3.5h8 M6 13l3-3.5 3 2.6 2-1.8 3 3.2',
  brandKit: 'M4 3.5h12v13H4z M7 7h6M7 10h6M7 13h3.5',
  team: 'M2.5 16.5v-1.5a5.5 5.5 0 0 1 11 0v1.5M5 6.5a3 3 0 1 0 6 0 3 3 0 1 0-6 0M16 11v5M13.5 13.5h5',
  settings: 'M4 5.5h12M4 10h12M4 14.5h12M7.5 3.5v4M12.5 8v4M8.5 12.5v4',
  create: 'M10 4.5v11M4.5 10h11',
  more: 'M4.5 10h.1M10 10h.1M15.5 10h.1',
  toggle: 'M3.5 4h13v12h-13z M8 4v12 M11.5 8l2 2-2 2',
};

export interface RailVisibility {
  /** Studio v2 is open for this brand (flag on, not sandboxed, generation allowed, a role that sees the studio). */
  studio: boolean;
  /** Non-subscribed project-only brand: shows Studio tabs leading to the Showroom, with `프로젝트` placed first. */
  studioShowroom?: boolean;
  /** The creator pool is open and this role may use it. */
  creators: boolean;
  identity: boolean;
  /** Project rooms are open for this brand (docs/BRAND-ROOMS.md §2): the two groups and 메시지. */
  rooms?: boolean;
}

/**
 * Default order (§3): 이미지 스튜디오 · 영상 스튜디오 · 편집 스튜디오 · 워크플로우 · 캠페인 · 크리에이터 · 에셋.
 * With rooms (묶음 E, docs/BRAND-PROJECTS-E.md): 이미지 스튜디오 · 영상 스튜디오 · 편집 스튜디오 · 워크플로우 · 에셋 | 프로젝트 · 리뷰 · 대화 · 피드백.
 * For project-only orgs (`studioShowroom` without `studio`), `프로젝트 · 리뷰 · 대화 · 피드백` lead ahead of `에셋 · 스튜디오`.
 */
export function railItems(visible: RailVisibility): RailItemId[] {
  const showStudio = Boolean(visible.studio || visible.studioShowroom);
  if (visible.rooms) {
    if (visible.studioShowroom && !visible.studio) {
      return ['campaigns', 'messages', 'assets', 'image', 'video', 'compose', 'workflows'];
    }
    const grouped: Array<[RailItemId, boolean]> = [
      ['image', showStudio],
      ['video', showStudio],
      ['compose', showStudio],
      ['workflows', showStudio],
      ['assets', true],
      ['campaigns', true],
      ['messages', true],
    ];
    return grouped.filter(([, shown]) => shown).map(([id]) => id);
  }
  const all: Array<[RailItemId, boolean]> = [
    ['image', showStudio],
    ['video', showStudio],
    ['compose', showStudio],
    ['workflows', showStudio],
    ['campaigns', true],
    ['creators', visible.creators],
    ['assets', true],
  ];
  return all.filter(([, shown]) => shown).map(([id]) => id);
}

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * Whether `href` is the current section. `/brand/studio` (images) is not current on
 * `/brand/studio/video`, `/brand/studio/compose`, `/brand/studio/workflows`, or `/brand/studio/review`; campaigns own `/brand` and every campaign page.
 */
export function railActive(href: string, path: string): boolean {
  // A project's room (`/brand/rooms/<id>`) is part of that commission: 의뢰 is current there, and
  // 메시지 only on the inbox itself.
  if (href === '/brand') return path === '/brand' || under(path, '/brand/projects') || /^\/brand\/rooms\/[^/]+/.test(path);
  if (href === '/brand/rooms') return path === '/brand/rooms' || path === '/brand/rooms/';
  if (href === '/brand/studio') {
    return (
      under(path, '/brand/studio') &&
      !under(path, '/brand/studio/video') &&
      !under(path, '/brand/studio/review') &&
      !under(path, '/brand/studio/compose') &&
      !under(path, '/brand/studio/workflows')
    );
  }
  if (href === '/brand/studio/video') {
    return under(path, '/brand/studio/video');
  }
  if (href === '/brand/studio/workflows') {
    return under(path, '/brand/studio/workflows');
  }
  return under(path, href);
}

/**
 * Items in the saved order. An item the saved order does not know (a screen added after the person
 * arranged their menu) sits right after the nearest item before it in the default order, so 영상 and
 * 리뷰 appear next to 이미지 instead of at the end of an old arrangement.
 */
export function orderItems(items: readonly RailItemId[], order: readonly string[]): RailItemId[] {
  if (order.length === 0) return [...items];
  const known = (id: RailItemId) => order.indexOf(RAIL_HREF[id]);
  const rank = (id: RailItemId): number => {
    const at = known(id);
    if (at !== -1) return at;
    const index = items.indexOf(id);
    for (let i = index - 1; i >= 0; i -= 1) {
      const anchor = known(items[i]!);
      // A fraction keeps it after its anchor and before the next saved item; `index` keeps default order among newcomers.
      if (anchor !== -1) return anchor + (index - i) / (items.length + 1);
    }
    return -1 + (index + 1) / (items.length + 1);
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** The saved order after moving `id` by one place. Unchanged at either end. */
export function moveItem(items: readonly RailItemId[], id: RailItemId, direction: -1 | 1): RailItemId[] {
  const from = items.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** The saved order after dropping `source` where `target` is. */
export function dropItem(items: readonly RailItemId[], source: RailItemId, target: RailItemId): RailItemId[] {
  const from = items.indexOf(source);
  const to = items.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...items];
  const next = [...items];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}

/* ------------------------------------------------------------- groups (project rooms) */

export interface RailGroups {
  make: RailItemId[];
  team: RailItemId[];
}

/**
 * The saved order applied inside each group. An item never leaves its group, whatever an older saved
 * order says: the order only decides positions among the items of the same group.
 */
export function groupItems(items: readonly RailItemId[], order: readonly string[]): RailGroups {
  return {
    make: orderItems(
      items.filter((id) => RAIL_GROUP[id] === 'make'),
      order,
    ),
    team: orderItems(
      items.filter((id) => RAIL_GROUP[id] === 'team'),
      order,
    ),
  };
}

/** The whole saved order after moving `id` by one place within its group. Unchanged at the group's ends. */
export function moveInGroup(groups: RailGroups, id: RailItemId, direction: -1 | 1): RailItemId[] {
  const group = RAIL_GROUP[id];
  const moved = moveItem(groups[group], id, direction);
  return group === 'make' ? [...moved, ...groups.team] : [...groups.make, ...moved];
}

/** The whole saved order after dropping `source` on `target`; null when they sit in different groups. */
export function dropInGroup(groups: RailGroups, source: RailItemId, target: RailItemId): RailItemId[] | null {
  const group = RAIL_GROUP[source];
  if (group !== RAIL_GROUP[target]) return null;
  const dropped = dropItem(groups[group], source, target);
  return group === 'make' ? [...dropped, ...groups.team] : [...groups.make, ...dropped];
}

export type RailCreateKey = 'image' | 'video' | 'reverse' | 'compose' | 'campaign' | 'commission';
export interface RailCreateLink {
  key: RailCreateKey;
  href: string;
  icon: string;
}

/**
 * The "+" menu. Without rooms: 이미지 만들기 · 영상 만들기 · 참고 영상으로 만들기 · 영상 합치기 · 캠페인 의뢰. With rooms the
 * request is what the brand hands to the YAGI team, so it leaves the list and becomes the last entry,
 * 야기 팀에 의뢰하기 (`commission`), which the menu shows under a divider.
 */
export function railCreateLinks(rooms: boolean, studio = true): RailCreateLink[] {
  const make: RailCreateLink[] = studio
    ? [
        { key: 'image', href: '/brand/studio', icon: RAIL_ICON.image },
        { key: 'video', href: '/brand/studio/video', icon: RAIL_ICON.video },
        { key: 'reverse', href: '/brand/studio/video?start=reverse', icon: RAIL_ICON.review },
        { key: 'compose', href: '/brand/studio/compose', icon: RAIL_ICON.compose },
      ]
    : [];
  return rooms
    ? [...make, { key: 'commission', href: '/brand/projects/new', icon: RAIL_ICON.commission }]
    : [...make, { key: 'campaign', href: '/brand/projects/new', icon: RAIL_ICON.campaigns }];
}

/** Phone tab bar with rooms: 이미지 · 영상 · 의뢰 · 메시지 when they exist (or 프로젝트 · 알림함 · 에셋 · 이미지 for project-only orgs). */
export function groupedTabIds(items: readonly RailItemId[], projectFirst = false): RailItemId[] {
  const first: RailItemId[] = projectFirst
    ? ['campaigns', 'messages', 'assets', 'image']
    : ['image', 'video', 'campaigns', 'messages'];
  return [...first.filter((id) => items.includes(id)), ...items.filter((id) => !first.includes(id))].slice(0, 4);
}

export function parseOrder(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

/** `{ expanded: boolean }` from storage; null when absent or unreadable. */
export function parseRailState(raw: string | null): { expanded: boolean } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { expanded?: unknown }).expanded === 'boolean') {
      return { expanded: (parsed as { expanded: boolean }).expanded };
    }
  } catch {
    // fall through
  }
  return null;
}

/** The cookie value the layout reads (`1` expanded, `0` collapsed). */
export function railCookieExpanded(value: string | undefined | null): boolean {
  return value === '1';
}

/* ------------------------------------------------------------- jobs */

export type RailJobGroup = 'image' | 'video';

/** Which studio screen shows a job of `kind`. */
export function jobGroup(kind: StudioJobKind | string): RailJobGroup {
  return kind === 'image' || kind === 'region_edit' ? 'image' : 'video';
}

export const GROUP_SCREEN: Readonly<Record<RailJobGroup, string>> = { image: '/brand/studio', video: '/brand/studio/video' };

/** True on the screen whose board already shows (and polls) jobs of this group. */
export function onBoardFor(group: RailJobGroup, path: string): boolean {
  return path === GROUP_SCREEN[group];
}

export function countByGroup(open: ReadonlyArray<{ kind: StudioJobKind | string }>): Record<RailJobGroup, number> {
  const counts: Record<RailJobGroup, number> = { image: 0, video: 0 };
  for (const job of open) counts[jobGroup(job.kind)] += 1;
  return counts;
}

export interface SettledJob {
  id: string;
  kind: StudioJobKind | string;
  status: 'succeeded' | 'failed' | 'canceled';
}

export interface RailToast {
  id: string;
  group: RailJobGroup;
  outcome: 'done' | 'failed';
}

/**
 * The toast for a job that just finished, or null: nothing when the person is on that job's own board
 * (they watched it finish), when it was canceled (they did it), or when it was already announced.
 */
export function toastFor(job: SettledJob, path: string, announced: ReadonlySet<string>): RailToast | null {
  if (announced.has(job.id) || job.status === 'canceled') return null;
  const group = jobGroup(job.kind);
  if (onBoardFor(group, path)) return null;
  return { id: job.id, group, outcome: job.status === 'succeeded' ? 'done' : 'failed' };
}

export interface RailJobMemory {
  /** Ids seen running, by this tab, on any workspace page. */
  open: string[];
  /** Ids already announced or seen finishing on their own board. */
  announced: string[];
}

export function parseJobMemory(raw: string | null): RailJobMemory {
  if (!raw) return { open: [], announced: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<RailJobMemory>;
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(-60) : []);
    return { open: ids(parsed.open), announced: ids(parsed.announced) };
  } catch {
    return { open: [], announced: [] };
  }
}

/**
 * Fold one summary into memory: which settled jobs to announce now, and what to remember. A settled job
 * is announced only when this tab saw it running (on this page or an earlier one); a job seen finishing
 * on its own board is remembered as announced so leaving the board does not toast it afterwards.
 */
export function foldSummary(
  memory: RailJobMemory,
  summary: { open: ReadonlyArray<{ id: string }>; settled: readonly SettledJob[] },
  path: string,
): { toasts: RailToast[]; memory: RailJobMemory } {
  const seen = new Set(memory.open);
  const announced = new Set(memory.announced);
  const toasts: RailToast[] = [];
  for (const job of summary.settled) {
    if (!seen.has(job.id) || announced.has(job.id)) continue;
    const toast = toastFor(job, path, announced);
    if (toast) toasts.push(toast);
    announced.add(job.id);
  }
  const open = [...new Set(summary.open.map((j) => j.id))].slice(0, 60);
  return { toasts, memory: { open, announced: [...announced].slice(-60) } };
}
