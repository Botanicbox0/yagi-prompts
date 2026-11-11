import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * docs/BRAND-ROOMS.md §2 — the rail in two groups, rendered from the real navigation.
 *
 * HARDLINE: a sandboxed organization (by id or by name) and one whose policy denies generative media
 * keep the `sidebar` markup byte for byte with rooms on, with no 메시지 item, no group and no room copy.
 * With rooms off (or without the room words) the rail is exactly the ungrouped rail.
 */
const state = vi.hoisted(() => ({ path: '/brand' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(),
}));

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';

const ko = getDictionary('ko');
const shell = ko.studioShell;
const nav = ko.roomsShell.nav;
const b = ko.brandWorkspace;
const OWNER = 'a0000000-0000-4000-8000-00000000000a';
const labels = {
  home: b.home,
  members: b.members,
  settings: b.managed.settings,
  library: b.managed.library,
  studio: b.productionStudio.title,
  identity: b.identityLayer.nav,
  creators: b.creatorPool.nav,
};
const scopeOf = (choice: BrandWorkspaceChoice): BrandWorkspaceScope => ({ choices: [choice], projectOrganizations: {} });
type Opts = { studioV2?: boolean; withShell?: boolean; rooms?: boolean; withRooms?: boolean };
const render = (choice: BrandWorkspaceChoice | null, o: Opts = {}) =>
  renderToStaticMarkup(
    <WorkspaceNavigation
      {...labels}
      scope={choice ? scopeOf(choice) : null}
      studioV2={o.studioV2}
      shell={o.withShell === false ? undefined : shell}
      locale="ko"
      rooms={o.rooms}
      roomsCopy={o.withRooms === false ? undefined : nav}
    />,
  );

/** Markers and words only the grouped rail renders. */
const ROOMS_ONLY = [
  'data-rail-section',
  'data-rail-item="messages"',
  'href="/brand/rooms',
  'bw-rail-group',
  nav.groupMake,
  nav.groupTeam,
  nav.messages,
];

const owner: BrandWorkspaceChoice = { id: OWNER, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] };
const sandboxedChoices: Array<[string, BrandWorkspaceChoice]> = [
  ...[...SANDBOXED_CLIENT_ORG_IDS].map((id): [string, BrandWorkspaceChoice] => [`sandboxed id ${id}`, { id, name: 'Client brand', role: 'owner', logoUrl: null }]),
  ['named "Morphic Korea"', { id: 'e0000000-0000-4000-8000-00000000000e', name: 'Morphic Korea', role: 'owner', logoUrl: null }],
  ['named "모픽"', { id: 'e0000000-0000-4000-8000-0000000000e2', name: '모픽', role: 'editor', logoUrl: null }],
  ['generative_media denied by policy', { id: 'd0000000-0000-4000-8000-00000000000d', name: 'Policy brand', role: 'owner', logoUrl: null, denied: ['generative_media'] }],
];

beforeEach(() => {
  state.path = '/brand';
});

describe.each(sandboxedChoices)('hardline with rooms on: %s', (_label, choice) => {
  it("keeps the 'sidebar' markup byte for byte, with no rooms item, group or copy", () => {
    for (const path of ['/brand', '/brand/rooms', '/brand/library', '/brand/projects/new']) {
      state.path = path;
      const off = render(choice, { studioV2: false, withShell: false, rooms: false, withRooms: false });
      const on = render(choice, { studioV2: true, rooms: true });
      expect(on, path).toBe(off);
      expect(on).toContain('data-brand-layout-mode="sidebar"');
      for (const marker of ROOMS_ONLY) expect(on, `${path} ${marker}`).not.toContain(marker);
    }
  });
});

describe('the grouped rail', () => {
  it('splits into 직접 만들기 and 야기 팀과 with 프로젝트 · 알림함', () => {
    const html = render(owner, { studioV2: true, rooms: true });
    expect(html).toContain('data-brand-layout-mode="rail"');
    const sections = [...html.matchAll(/data-rail-section="(\w+)"/g)].map((m) => m[1]);
    expect(sections).toEqual(['make', 'team']);
    const make = html.slice(html.indexOf('data-rail-section="make"'), html.indexOf('data-rail-section="team"'));
    const team = html.slice(html.indexOf('data-rail-section="team"'));
    const ids = (part: string) => [...part.matchAll(/data-rail-item="(\w+)"/g)].map((m) => m[1]);
    expect(ids(make)).toEqual(['image', 'video', 'assets']);
    expect(ids(team)).toEqual(['campaigns', 'messages']);
    expect(make).toContain(nav.groupMake);
    expect(team).toContain(nav.groupTeam);
    // 의뢰 is the renamed 캠페인 item, only in this mode; 메시지 is the inbox.
    expect(team).toContain(`href="/brand?organizationId=${OWNER}"`);
    expect(team).toContain(`>${nav.commissions}<`);
    expect(team).not.toContain(`>${shell.rail.campaigns}<`);
    expect(team).toContain(`href="/brand/rooms?organizationId=${OWNER}"`);
    expect(team).toContain(`>${nav.messages}<`);
    // Collapsed tooltips name the group.
    expect(html).toContain(`data-rail-tip="${nav.groupTeam} · ${nav.messages}"`);
    expect(html).toContain(`data-rail-tip="${nav.groupMake} · ${shell.rail.image}"`);
    // Each group is a labelled group for assistive technology.
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+-make"/);
  });

  it('puts 이미지 · 영상 · 의뢰 · 메시지 on the phone bar', () => {
    const html = render(owner, { studioV2: true, rooms: true });
    expect([...html.matchAll(/data-rail-tab="(\w+)"/g)].map((m) => m[1])).toEqual(['image', 'video', 'campaigns', 'messages', 'more']);
  });

  it('marks 의뢰 current inside a project room and 메시지 on the inbox', () => {
    const current = (html: string) => [...html.matchAll(/data-rail-item="(\w+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    state.path = '/brand/rooms';
    expect(current(render(owner, { studioV2: true, rooms: true }))).toEqual(['messages']);
    state.path = '/brand/rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11';
    expect(current(render(owner, { studioV2: true, rooms: true }))).toEqual(['campaigns']);
  });

  it('gives a campaign-only guest 에셋, 프로젝트 and 알림함, still nothing of the studio', () => {
    const html = render({ ...owner, role: 'guest' }, { studioV2: true, rooms: true });
    expect([...html.matchAll(/data-rail-item="(\w+)"/g)].map((m) => m[1])).toEqual(['assets', 'campaigns', 'messages']);
    expect(html).not.toContain('/brand/studio');
    expect(html).not.toContain('data-rail-create');
  });

  it('gives a project-only owner (self_studio denied) 에셋 · 프로젝트 · 알림함 and the + brief button without studio links', () => {
    const html = render({ ...owner, denied: ['self_studio'] }, { studioV2: true, rooms: true });
    expect([...html.matchAll(/data-rail-item="(\w+)"/g)].map((m) => m[1])).toEqual(['assets', 'campaigns', 'messages']);
    expect(html).not.toContain('/brand/studio');
    expect(html).toContain('data-rail-create');
  });

  it('is not grouped for the TWINGS team view', () => {
    const html = render({ ...owner, role: 'studio' }, { studioV2: true, rooms: true });
    expect(html).toContain('data-brand-layout-mode="rail"');
    for (const marker of ROOMS_ONLY) expect(html, marker).not.toContain(marker);
  });
});

describe('rooms closed', () => {
  it('renders exactly the ungrouped rail whether the flag is off or the words are missing', () => {
    for (const path of ['/brand', '/brand/studio', '/brand/studio/review', '/brand/library']) {
      state.path = path;
      const today = render(owner, { studioV2: true, rooms: undefined, withRooms: false });
      expect(render(owner, { studioV2: true, rooms: false }), path).toBe(today);
      expect(render(owner, { studioV2: true, rooms: true, withRooms: false }), path).toBe(today);
      for (const marker of ROOMS_ONLY) expect(today, `${path} ${marker}`).not.toContain(marker);
      expect(today).toContain(`>${shell.rail.campaigns}<`);
    }
  });

  it('leaves the topbar alone with rooms on', () => {
    const topbar = render(owner, { studioV2: false, rooms: true });
    expect(topbar).toContain('data-brand-layout-mode="topbar"');
    expect(topbar).toBe(render(owner, { studioV2: false, rooms: false, withRooms: false }));
  });
});

describe('the layout', () => {
  it('opens rooms only with the flag and the studio-copy rule, and hands the room words only then', () => {
    const layout = readFileSync('app/(brand)/layout.tsx', 'utf8');
    expect(layout).toContain('const rooms=brandRoomsOpen()&&studioCopy;');
    expect(layout).toContain('roomsCopy={rooms?d.roomsShell.nav:undefined}');
  });
});

describe('copy', () => {
  it('has every room shell string in both languages', () => {
    const en = getDictionary('en').roomsShell;
    const leaves = (value: unknown, prefix = ''): Array<[string, string]> =>
      typeof value === 'string'
        ? [[prefix, value]]
        : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
    const koLeaves = new Map(leaves(ko.roomsShell));
    for (const [key, value] of leaves(en)) {
      expect(value.trim(), `en ${key}`).not.toBe('');
      expect((koLeaves.get(key) ?? '').trim(), `ko ${key}`).not.toBe('');
    }
    expect(ko.roomsShell.room.team).toBe('야기 팀');
    expect(ko.roomsShell.nav.groupTeam).toBe('야기 팀과');
  });
});
