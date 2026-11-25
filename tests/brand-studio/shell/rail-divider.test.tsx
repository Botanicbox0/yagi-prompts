import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioShellEn, studioShellKo } from '@/messages/studio-shell';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * docs/BRAND-STUDIO-V3.md §3.1 (founder 2026-11-25): the wide rail lost its "+" button and menu, and its rows
 * split in two bands. The working screens sit above a thin divider; 워크플로우 sits under it, one step
 * quieter. A row never crosses the divider: the arrows and drops stay inside a row's own group and band.
 * The saved order (`twings_brand_nav_order_v1`) stays one flat list of hrefs. Invented brands only.
 */
const state = vi.hoisted(() => ({ path: '/brand/studio' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    // No polling in a test: nothing running, nothing unread.
    useStudioActivity: () => ({ summary: null, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
    useRoomUnread: () => 0,
  };
});

import {
  NAV_ORDER_STORAGE_KEY,
  RAIL_HREF,
  RAIL_ICON,
  dropInGroup,
  dropInTier,
  groupItems,
  moveInGroup,
  moveInTier,
  orderItems,
  railItems,
  railShownOrder,
  railTier,
  railTiers,
  type RailItemId,
} from '@/components/brand-workspace/rail-model';
import { railModeItems, railModeSwitchTarget } from '@/components/brand-workspace/rail-mode';
import { RailNavigation, type RailNavigationProps } from '@/components/brand-workspace/rail-nav';

const ko = getDictionary('ko');
const shell = ko.studioShell;
const roomsNav = ko.roomsShell.nav;
const ALPHA = 'a0000000-0000-4000-8000-0000000000a1';
const scoped = (path: string) => `${path}?organizationId=${ALPHA}`;

const ALL_IDS = Object.keys(RAIL_HREF) as RailItemId[];
const sorted = (list: readonly string[]) => [...list].sort();

/* ------------------------------------------------------------------ the model */

describe('railTier and railTiers', () => {
  it('puts 워크플로우, and only 워크플로우, under the divider', () => {
    for (const id of ALL_IDS) expect(railTier(id), id).toBe(id === 'workflows' ? 'lower' : 'main');
  });

  it('splits a list in two and keeps the list\'s own order on each side', () => {
    const all = railItems({ studio: true, creators: true, identity: true, sound: true });
    expect(all).toEqual(['image', 'video', 'sound', 'compose', 'workflows', 'campaigns', 'creators', 'assets']);
    expect(railTiers(all)).toEqual({ main: ['image', 'video', 'sound', 'compose', 'campaigns', 'creators', 'assets'], lower: ['workflows'] });
    expect(railTiers(['assets', 'workflows', 'image'])).toEqual({ main: ['assets', 'image'], lower: ['workflows'] });
    // No 워크플로우 row (studio closed, no showroom): nothing under the divider.
    expect(railTiers(railItems({ studio: false, creators: false, identity: false }))).toEqual({ main: ['campaigns', 'assets'], lower: [] });
    expect(railTiers([])).toEqual({ main: [], lower: [] });
  });
});

describe('moveInTier and dropInTier (the rail without rooms)', () => {
  const list = railItems({ studio: true, creators: true, identity: true });

  it('starts from the default flat order, 워크플로우 in its old place', () => {
    expect(list).toEqual(['image', 'video', 'compose', 'workflows', 'campaigns', 'creators', 'assets']);
  });

  it('moves a main row among the main rows; 워크플로우 keeps its slot in the flat list', () => {
    // 편집 스튜디오 down: it trades places with 캠페인 (the next main row), not with 워크플로우.
    expect(moveInTier(list, 'compose', 1)).toEqual(['image', 'video', 'campaigns', 'workflows', 'compose', 'creators', 'assets']);
    // 캠페인 up: it trades places with 편집 스튜디오.
    expect(moveInTier(list, 'campaigns', -1)).toEqual(['image', 'video', 'campaigns', 'workflows', 'compose', 'creators', 'assets']);
    const slot = list.indexOf('workflows');
    for (const id of railTiers(list).main) {
      for (const direction of [-1, 1] as const) {
        const next = moveInTier(list, id, direction);
        expect(next.indexOf('workflows'), `${id} ${direction}`).toBe(slot);
        expect(sorted(next), `${id} ${direction}`).toEqual(sorted(list));
        expect(railTiers(next).lower).toEqual(['workflows']);
      }
    }
  });

  it('stops a main row at the ends of the main band: the last one does not move down past the divider', () => {
    expect(moveInTier(list, 'assets', 1)).toEqual(list);
    expect(moveInTier(list, 'image', -1)).toEqual(list);
    // The rooms rail's 직접 만들기 group ends its main band right before 워크플로우 in the flat list.
    const make = groupItems(railItems({ studio: true, creators: true, identity: true, rooms: true }), []).make;
    expect(make).toEqual(['image', 'video', 'compose', 'workflows', 'assets']);
    expect(moveInTier(make, 'compose', 1)).toEqual(['image', 'video', 'assets', 'workflows', 'compose']);
    expect(moveInTier(make, 'assets', 1)).toEqual(make);
  });

  it('never moves 워크플로우, alone in its band', () => {
    expect(moveInTier(list, 'workflows', -1)).toEqual(list);
    expect(moveInTier(list, 'workflows', 1)).toEqual(list);
  });

  it('drops within a band and refuses a drop across the divider', () => {
    expect(dropInTier(list, 'assets', 'workflows')).toBeNull();
    expect(dropInTier(list, 'workflows', 'image')).toBeNull();
    expect(dropInTier(list, 'workflows', 'assets')).toBeNull();
    expect(dropInTier(list, 'assets', 'image')).toEqual(['assets', 'image', 'video', 'workflows', 'compose', 'campaigns', 'creators']);
    expect(dropInTier(list, 'assets', 'image')!.indexOf('workflows')).toBe(list.indexOf('workflows'));
  });
});

describe('moveInGroup and dropInGroup (the rail with rooms)', () => {
  const items = railItems({ studio: true, creators: true, identity: true, rooms: true, sound: true });
  const groups = groupItems(items, []);

  it('starts from 이미지 · 영상 · 사운드 · 편집 · 워크플로우 · 에셋 | 프로젝트 · 알림함', () => {
    expect(groups).toEqual({ make: ['image', 'video', 'sound', 'compose', 'workflows', 'assets'], team: ['campaigns', 'messages'] });
  });

  it('moves 에셋 up past 편집 스튜디오, never past 워크플로우', () => {
    const next = moveInGroup(groups, 'assets', -1);
    expect(next).toEqual(['image', 'video', 'sound', 'assets', 'workflows', 'compose', 'campaigns', 'messages']);
    // As the rail draws it: 에셋 now sits above 편집 스튜디오, and 워크플로우 stays alone under the divider.
    const drawn = groupItems(items, next.map((id) => RAIL_HREF[id]));
    expect(railTiers(drawn.make)).toEqual({ main: ['image', 'video', 'sound', 'assets', 'compose'], lower: ['workflows'] });
    expect(moveInGroup(groups, 'compose', 1)).toEqual(['image', 'video', 'sound', 'assets', 'workflows', 'compose', 'campaigns', 'messages']);
    // The end of the main band stays put; 워크플로우 never moves.
    expect(moveInGroup(groups, 'assets', 1)).toEqual([...groups.make, ...groups.team]);
    for (const direction of [-1, 1] as const) expect(moveInGroup(groups, 'workflows', direction)).toEqual([...groups.make, ...groups.team]);
    // The team group is unchanged by the bands.
    expect(moveInGroup(groups, 'messages', -1)).toEqual([...groups.make, 'messages', 'campaigns']);
  });

  it('refuses a drop across the divider as it refuses one across the groups', () => {
    expect(dropInGroup(groups, 'assets', 'workflows')).toBeNull();
    expect(dropInGroup(groups, 'workflows', 'compose')).toBeNull();
    expect(dropInGroup(groups, 'messages', 'image')).toBeNull();
    expect(dropInGroup(groups, 'workflows', 'messages')).toBeNull();
    expect(dropInGroup(groups, 'assets', 'image')).toEqual(['assets', 'image', 'video', 'sound', 'workflows', 'compose', 'campaigns', 'messages']);
  });

  it('reads an old saved order with 워크플로우 in the middle as main rows above, 워크플로우 under the divider', () => {
    const roomsItems = railItems({ studio: true, creators: true, identity: true, rooms: true });
    // An order saved before the divider: 이미지 · 워크플로우 · 영상.
    const old = [RAIL_HREF.image, RAIL_HREF.workflows, RAIL_HREF.video];
    const make = groupItems(roomsItems, old).make;
    expect(make.slice(0, 2)).toEqual(['image', 'workflows']);
    const tiers = railTiers(make);
    expect(tiers.lower).toEqual(['workflows']);
    expect(tiers.main).not.toContain('workflows');
    expect(tiers.main.filter((id) => id === 'image' || id === 'video')).toEqual(['image', 'video']);
    expect(sorted(tiers.main)).toEqual(sorted(['image', 'video', 'compose', 'assets']));
    // A full old order: the main rows keep exactly that order.
    const full = [RAIL_HREF.image, RAIL_HREF.workflows, RAIL_HREF.video, RAIL_HREF.compose, RAIL_HREF.assets];
    expect(railTiers(groupItems(roomsItems, full).make)).toEqual({ main: ['image', 'video', 'compose', 'assets'], lower: ['workflows'] });
    // The same old order on the rail without rooms.
    const flat = orderItems(railItems({ studio: true, creators: false, identity: true }), old);
    expect(flat.slice(0, 2)).toEqual(['image', 'workflows']);
    expect(railTiers(flat).lower).toEqual(['workflows']);
    expect(railTiers(flat).main).not.toContain('workflows');
    expect(railTiers(flat).main.filter((id) => id === 'image' || id === 'video')).toEqual(['image', 'video']);
  });

  it('writes back a whole permutation after a move: nothing lost, 워크플로우 still there', () => {
    const roomsItems = railItems({ studio: true, creators: true, identity: true, rooms: true, sound: true });
    const oldGroups = groupItems(roomsItems, [RAIL_HREF.image, RAIL_HREF.workflows, RAIL_HREF.video]);
    for (const id of roomsItems) {
      for (const direction of [-1, 1] as const) {
        const next = moveInGroup(oldGroups, id, direction);
        expect(sorted(next), `${id} ${direction}`).toEqual(sorted(roomsItems));
        expect(next).toContain('workflows');
        // Read back from the saved hrefs, the bands are the same: 워크플로우 alone under the divider.
        const back = groupItems(roomsItems, next.map((item) => RAIL_HREF[item]));
        expect(railTiers(back.make).lower, `${id} ${direction}`).toEqual(['workflows']);
      }
    }
    const flatItems = railItems({ studio: true, creators: true, identity: true });
    const flat = orderItems(flatItems, [RAIL_HREF.image, RAIL_HREF.workflows, RAIL_HREF.video]);
    for (const id of flatItems) {
      for (const direction of [-1, 1] as const) {
        const next = moveInTier(flat, id, direction);
        expect(sorted(next), `${id} ${direction}`).toEqual(sorted(flatItems));
        expect(next.indexOf('workflows')).toBe(flat.indexOf('workflows'));
      }
    }
  });

  it('has no "+" icon any more', () => {
    expect(Object.keys(RAIL_ICON)).not.toContain('create');
  });
});

/* ------------------------------------------------------------------ the markup */

const railProps = (over: Partial<RailNavigationProps> = {}): RailNavigationProps => ({
  organizationId: ALPHA,
  studio: true,
  creators: false,
  identity: false,
  team: true,
  billing: true,
  settings: true,
  canCreate: true,
  copy: shell,
  locale: 'ko',
  initialExpanded: true,
  scope: scoped,
  ...over,
});
const rail = (over: Partial<RailNavigationProps> = {}) => renderToStaticMarkup(<RailNavigation {...railProps(over)} />);
const withRooms = { rooms: true, roomsCopy: roomsNav } as const;

/** The row ids of one `<ul data-rail-group>` in markup order, or null when the list is not there. */
const listIds = (html: string, group: string) => {
  const list = new RegExp(`<ul class="bw-rail-list" data-rail-group="${group}">([\\s\\S]*?)</ul>`).exec(html);
  return list ? [...list[1]!.matchAll(/data-rail-item="(\w+)"/g)].map((m) => m[1]) : null;
};
const count = (html: string, marker: string) => html.split(marker).length - 1;
/** The opening tag of the first element carrying `marker`. */
const tagWith = (html: string, marker: string) => {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
};
const navOf = (html: string) => html.slice(html.indexOf('<nav'), html.indexOf('</nav>') + '</nav>'.length);

beforeEach(() => {
  state.path = '/brand/studio';
});

describe('the divider in the markup', () => {
  it('draws 직접 만들기 as the working screens, one divider, then 워크플로우', () => {
    for (const sound of [false, true]) {
      const html = rail({ ...withRooms, sound });
      expect(html).toContain('data-rail-mode="make"');
      expect(listIds(html, 'primary'), `sound ${sound}`).toEqual(sound ? ['image', 'video', 'sound', 'compose', 'assets'] : ['image', 'video', 'compose', 'assets']);
      expect(count(html, 'data-rail-divider'), `sound ${sound}`).toBe(1);
      expect(listIds(html, 'lower')).toEqual(['workflows']);
      // In the markup: the main list, the divider, then the lower list.
      const primary = html.indexOf('data-rail-group="primary"');
      const divider = html.indexOf('data-rail-divider');
      const lower = html.indexOf('data-rail-group="lower"');
      expect(primary).toBeGreaterThan(-1);
      expect(divider).toBeGreaterThan(html.indexOf('</ul>', primary));
      expect(lower).toBeGreaterThan(divider);
      // 워크플로우 is still a primary row of the rail (the saved order and the phone bar know it as one).
      expect(tagWith(html, 'data-rail-item="workflows"')).toContain('data-nav-group="primary"');
    }
  });

  it('makes the divider a plain rule: an <hr>, no tab stop, no role, not a link or a button', () => {
    const tag = tagWith(rail(withRooms), 'data-rail-divider');
    expect(tag).not.toBeNull();
    expect(tag!).toMatch(/^<hr /);
    expect(tag!).toContain('class="bw-rail-divider"');
    expect(tag!).not.toMatch(/tabindex/i);
    expect(tag!).not.toMatch(/\srole=/);
    expect(tag!).not.toMatch(/href=|<a |<button /);
  });

  it('gives 야기 팀과 no divider, no lower band and no 새 프로젝트 의뢰 row; 알림함 stays a main row', () => {
    state.path = '/brand';
    const html = rail(withRooms);
    expect(html).toContain('data-rail-mode="team"');
    expect(listIds(html, 'primary')).toEqual(['campaigns', 'messages', 'assets']);
    expect(html).not.toContain('data-rail-divider');
    expect(html).not.toContain('data-rail-group="lower"');
    expect(navOf(html)).not.toContain('/brand/projects/new');
    expect(html).not.toContain('/brand/projects/new');
    expect(html).not.toContain('data-rail-create');
  });

  it('keeps the same order and the divider on the folded rail', () => {
    for (const over of [withRooms, {}]) {
      const open = rail({ ...over, initialExpanded: true });
      const folded = rail({ ...over, initialExpanded: false });
      expect(folded).toContain('data-rail-expanded="false"');
      expect(listIds(folded, 'primary')).toEqual(listIds(open, 'primary'));
      expect(listIds(folded, 'lower')).toEqual(['workflows']);
      expect(count(folded, 'data-rail-divider')).toBe(1);
    }
  });

  it('splits the rail without rooms the same way', () => {
    const html = rail();
    expect(html).not.toContain('data-rail-mode=');
    expect(listIds(html, 'primary')).toEqual(['image', 'video', 'compose', 'campaigns', 'assets']);
    expect(count(html, 'data-rail-divider')).toBe(1);
    expect(listIds(html, 'lower')).toEqual(['workflows']);
    // With 홈 above, the 홈 list is unchanged and comes first.
    const home = rail({ home: '홈' });
    expect(listIds(home, 'home')).toEqual(['home']);
    expect(home.indexOf('data-rail-group="home"')).toBeLessThan(home.indexOf('data-rail-group="primary"'));
    expect(listIds(home, 'lower')).toEqual(['workflows']);
  });

  it('draws no divider for a brand with no 워크플로우 row (studio closed, no showroom)', () => {
    for (const over of [{ studio: false }, { studio: false, ...withRooms }, { studio: false, home: '홈' }]) {
      state.path = '/brand/library';
      const html = rail(over);
      expect(html, JSON.stringify(Object.keys(over))).not.toContain('data-rail-divider');
      expect(html).not.toContain('data-rail-group="lower"');
      expect(html).not.toContain('data-rail-item="workflows"');
    }
  });
});

/* ------------------------------------------------------------------ the arrows (DOM) */

describe('순서 편집 arrows stay inside a row\'s band (DOM)', () => {
  let dom: MountedDom | null = null;
  let stored: Map<string, string>;
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('location', { protocol: 'http:' });
    stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
      clear: () => stored.clear(),
    });
  });
  afterEach(async () => {
    await dom?.unmount();
    dom = null;
    vi.unstubAllGlobals();
  });

  const rows = (group: string) => dom!.queryAll(`[data-rail-group="${group}"] [data-rail-item]`).map((a) => a.getAttribute('data-rail-item'));
  const arrow = (word: 'moveUp' | 'moveDown', label: string) =>
    dom!.queryAll('button').find((button) => button.getAttribute('aria-label') === shell.rail[word].replace('{label}', label)) ?? null;
  const disabled = (button: { hasAttribute(name: string): boolean } | null) =>
    Boolean(button && (button.hasAttribute('disabled') || (button as unknown as { disabled?: boolean }).disabled === true));

  it('gives 워크플로우 no arrows, stops the last main row, and saves one flat order with 워크플로우 in its slot', async () => {
    dom = await mountDom(<RailNavigation {...railProps()} />);
    await dom.click('[data-rail-order] button');
    expect(dom.query('[data-brand-layout-mode="rail"]')!.getAttribute('data-nav-reordering')).toBe('true');
    expect(dom.queryAll('[data-rail-group="primary"] .bw-rail-move')).toHaveLength(5);
    // Alone in its band, 워크플로우 has nowhere to go.
    expect(dom.query('[data-rail-group="lower"] .bw-rail-move')).toBeNull();
    expect(arrow('moveDown', shell.rail.workflows)).toBeNull();
    // The last main row cannot go down past the divider.
    expect(disabled(arrow('moveDown', shell.rail.assets))).toBe(true);
    expect(disabled(arrow('moveUp', shell.rail.image))).toBe(true);

    await dom.click(arrow('moveDown', shell.rail.compose)!);
    expect(rows('primary')).toEqual(['image', 'video', 'campaigns', 'compose', 'assets']);
    expect(rows('lower')).toEqual(['workflows']);
    expect(JSON.parse(stored.get(NAV_ORDER_STORAGE_KEY) ?? 'null')).toEqual([
      RAIL_HREF.image,
      RAIL_HREF.video,
      RAIL_HREF.campaigns,
      RAIL_HREF.workflows,
      RAIL_HREF.compose,
      RAIL_HREF.assets,
    ]);
  });

  it('moves 에셋 up past 편집 스튜디오 on 직접 만들기, never past 워크플로우', async () => {
    dom = await mountDom(<RailNavigation {...railProps(withRooms)} />);
    expect(dom.query('[data-brand-layout-mode="rail"]')!.getAttribute('data-rail-mode')).toBe('make');
    await dom.click('[data-rail-order] button');
    expect(dom.query('[data-rail-group="lower"] .bw-rail-move')).toBeNull();
    expect(disabled(arrow('moveDown', shell.rail.assets))).toBe(true);

    await dom.click(arrow('moveUp', shell.rail.assets)!);
    expect(rows('primary')).toEqual(['image', 'video', 'assets', 'compose']);
    expect(rows('lower')).toEqual(['workflows']);
    const saved = JSON.parse(stored.get(NAV_ORDER_STORAGE_KEY) ?? 'null') as string[];
    expect(saved).toEqual([RAIL_HREF.image, RAIL_HREF.video, RAIL_HREF.assets, RAIL_HREF.workflows, RAIL_HREF.compose, RAIL_HREF.campaigns, RAIL_HREF.messages]);
  });
});

/* ------------------------------------------------------------------ copy */

describe('the "+" word is gone from the copy', () => {
  it('has no create.button in either language, and keeps the phone sheet\'s shortcut words', () => {
    for (const [name, copy] of [
      ['ko', studioShellKo],
      ['en', studioShellEn],
    ] as const) {
      expect(Object.keys(copy.create), name).not.toContain('button');
      expect(copy.create, name).toHaveProperty('fromReference');
      for (const key of ['menu', 'image', 'video', 'fromReference', 'compose', 'campaign'] as const) {
        expect(String(copy.create[key]).trim(), `${name} create.${key}`).not.toBe('');
      }
    }
  });
});

describe('the mode switch opens the rail\'s first row, not the saved order\'s first href', () => {
  it('railShownOrder puts the rows above the divider first and keeps each band\'s order', () => {
    expect(railShownOrder(['workflows', 'video', 'image', 'assets'])).toEqual(['video', 'image', 'assets', 'workflows']);
    expect(railShownOrder(['campaigns', 'messages', 'assets'])).toEqual(['campaigns', 'messages', 'assets']);
  });

  it('an old saved order with 워크플로우 first still lands on a working screen when switching to 직접 만들기', () => {
    const items = railItems({ studio: true, creators: false, identity: false, rooms: true });
    const groups = groupItems(items, [RAIL_HREF.workflows, RAIL_HREF.video, RAIL_HREF.image]);
    const make = railModeItems(groups, 'make');
    expect(make[0]).toBe('workflows');
    const hrefOf = (id: RailItemId) => RAIL_HREF[id];
    // The flat order alone would open 워크플로우; the rail's own order opens its first row.
    expect(railModeSwitchTarget('/brand', 'make', make, hrefOf)).toBe(RAIL_HREF.workflows);
    const first = railTiers(make).main[0]!;
    expect(railTier(first)).toBe('main');
    expect(railModeSwitchTarget('/brand', 'make', railShownOrder(make), hrefOf)).toBe(RAIL_HREF[first]);
  });
});
