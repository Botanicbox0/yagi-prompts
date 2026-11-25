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
/** The rail's workspace menu words, handed over by the layout with studio v2 (docs/BRAND-STUDIO-V3.md §3.1). */
const workspaceMenu = { identity: b.identity, roles: b.roles, language: ko.nav.localeToggle, signOut: b.signOut };
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
      workspaceMenu={o.studioV2 ? workspaceMenu : undefined}
    />,
  );

/** The rail with what this browser remembered per brand (the layout's reading of the mode cookie). */
const renderWithMemory = (choice: BrandWorkspaceChoice, memory: Record<string, 'make' | 'team'>) =>
  renderToStaticMarkup(
    <WorkspaceNavigation
      {...labels}
      scope={scopeOf(choice)}
      studioV2
      shell={shell}
      locale="ko"
      rooms
      roomsCopy={nav}
      railModes={memory}
      workspaceMenu={workspaceMenu}
    />,
  );

/** Markers and words only the rail with rooms renders. */
const ROOMS_ONLY = [
  'data-rail-section',
  'data-rail-mode',
  'role="radiogroup"',
  nav.mode,
  'data-rail-item="messages"',
  'href="/brand/rooms',
  'bw-rail-group',
  nav.groupMake,
  nav.groupTeam,
  nav.messages,
  shell.rail.messages,
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

describe('the two-mode rail (founder 2026-11-20, components/brand-workspace/rail-mode.ts)', () => {
  const ids = (html: string) => [...html.matchAll(/data-rail-item="(\w+)"/g)].map((m) => m[1]).filter((id) => id !== 'home');
  const modeOf = (html: string) => /data-rail-mode="(\w+)"/.exec(html)?.[1] ?? null;
  const team = { studioV2: true, rooms: true };

  it('opens a brand that makes things itself on 직접 만들기, with only the making items and no headings', () => {
    state.path = '/brand/library';
    const html = render(owner, team);
    expect(html).toContain('data-brand-layout-mode="rail"');
    expect(modeOf(html)).toBe('make');
    // 워크플로우 sits under the divider (rail-model `railTiers`), after the working screens.
    expect(ids(html)).toEqual(['image', 'video', 'compose', 'assets', 'workflows']);
    expect(html).toContain('data-rail-divider');
    expect(html).toContain('data-rail-group="lower"');
    expect(html).toContain(`>${shell.rail.compose}<`);
    expect(html).not.toContain('data-rail-section');
    expect(html).not.toContain('bw-rail-group');
    // No "+" button or menu since 2026-11-25: the rows are the way in. 새 프로젝트 의뢰 is not on this side either.
    expect(html).not.toContain('data-rail-create');
    expect(html).not.toContain('bw-rail-create-button');
    expect(html).not.toContain(nav.commission);
    // Tooltips name the item only.
    expect(html).toContain(`data-rail-tip="${shell.rail.image}"`);
  });

  it('is a labelled two-option radio group under the brand switcher, the current side checked and focusable', () => {
    state.path = '/brand/library';
    const html = render(owner, team);
    const at = html.indexOf('data-rail-mode-switch="rail"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('data-rail-item='));
    // §3.1: the rail's own brand block is the row above the switch.
    const block = html.indexOf(`data-rail-workspace="${OWNER}"`);
    expect(block).toBeGreaterThan(-1);
    expect(block).toBeLessThan(at);
    expect(html).toMatch(new RegExp(`role="radiogroup" aria-label="${nav.mode}"`));
    expect(html).toMatch(/role="radio" aria-checked="true" tabindex="0"[^>]*data-rail-mode-option="make"/);
    expect(html).toMatch(/role="radio" aria-checked="false" tabindex="-1"[^>]*data-rail-mode-option="team"/);
    expect(html).toContain(`>${nav.groupMake}<`);
    expect(html).toContain(`>${nav.groupTeam}<`);
  });

  it('shows 야기 팀과 with 프로젝트 · 알림함 · 에셋 and no 새 프로젝트 의뢰 row, divider or lower band', () => {
    state.path = '/brand';
    const html = render(owner, team);
    expect(modeOf(html)).toBe('team');
    expect(ids(html)).toEqual(['campaigns', 'messages', 'assets']);
    expect(html).toContain(`href="/brand?organizationId=${OWNER}"`);
    expect(html).toContain(`href="/brand/rooms?organizationId=${OWNER}"`);
    // The rail's 새 프로젝트 의뢰 row went with the "+" button (2026-11-25): a new project starts from 프로젝트.
    expect(html).not.toContain('data-rail-create');
    expect(html).not.toContain('bw-rail-create-button');
    expect(html).not.toContain('/brand/projects/new');
    expect(html).not.toContain(`>${nav.commission}<`);
    expect(html).not.toContain('data-rail-divider');
    expect(html).not.toContain('data-rail-group="lower"');
    expect(html).not.toContain('/brand/studio');
    expect(html).not.toContain('data-rail-credits');
  });

  it('flips to the side of the page it opens on, over the remembered side', () => {
    state.path = '/brand/rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11';
    expect(modeOf(renderWithMemory(owner, { [OWNER]: 'make' }))).toBe('team');
    state.path = '/brand/studio/video';
    expect(modeOf(renderWithMemory(owner, { [OWNER]: 'team' }))).toBe('make');
  });

  it('opens a shared page on the side this browser last used for this brand', () => {
    state.path = '/brand/library';
    expect(modeOf(renderWithMemory(owner, { [OWNER]: 'team' }))).toBe('team');
    expect(modeOf(renderWithMemory(owner, { [OWNER]: 'make' }))).toBe('make');
    // Another brand's memory is not this brand's.
    expect(modeOf(renderWithMemory(owner, { 'b0000000-0000-4000-8000-00000000000b': 'team' }))).toBe('make');
  });

  it('puts 이미지 · 영상 on the phone bar in 직접 만들기 and 프로젝트 · 알림함 in 야기 팀과', () => {
    state.path = '/brand/studio';
    expect([...render(owner, team).matchAll(/data-rail-tab="(\w+)"/g)].map((m) => m[1])).toEqual(['image', 'video', 'compose', 'workflows', 'more']);
    state.path = '/brand';
    expect([...render(owner, team).matchAll(/data-rail-tab="(\w+)"/g)].map((m) => m[1])).toEqual(['campaigns', 'messages', 'assets', 'more']);
  });

  it('marks 의뢰 current inside a project room and 메시지 on the inbox', () => {
    const current = (html: string) => [...html.matchAll(/data-rail-item="(\w+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    state.path = '/brand/rooms';
    expect(current(render(owner, team))).toEqual(['messages']);
    state.path = '/brand/rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11';
    expect(current(render(owner, team))).toEqual(['campaigns']);
  });

  it('gives a campaign-only guest (team side only) 프로젝트, 알림함 and 에셋 with no switch and nothing of the studio', () => {
    state.path = '/brand/library';
    const html = render({ ...owner, role: 'guest' }, team);
    expect(modeOf(html)).toBe('team');
    expect(ids(html)).toEqual(['campaigns', 'messages', 'assets']);
    expect(html).not.toContain('data-rail-mode-switch');
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain('/brand/studio');
    expect(html).not.toContain('data-rail-create');
  });

  it('opens a project-only owner (self_studio denied) on 야기 팀과 and keeps the studio showroom one switch away', () => {
    state.path = '/brand/library';
    const html = render({ ...owner, denied: ['self_studio'] }, team);
    expect(modeOf(html)).toBe('team');
    expect(ids(html)).toEqual(['campaigns', 'messages', 'assets']);
    expect(html).toContain('data-rail-mode-switch="rail"');
    expect(html).not.toContain('data-rail-create');
    expect(html).not.toContain('/brand/projects/new');
    expect(html).not.toContain('data-rail-credits');
    state.path = '/brand/studio';
    const make = render({ ...owner, denied: ['self_studio'] }, team);
    expect(modeOf(make)).toBe('make');
    // The showroom draws the same two bands: 워크플로우 under the divider.
    expect(ids(make)).toEqual(['image', 'video', 'compose', 'assets', 'workflows']);
    expect(make).toContain('data-rail-divider');
    // The showroom has nothing to make: no "+", no credits.
    expect(make).not.toContain('data-rail-create');
    expect(make).not.toContain('data-rail-credits');
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
