import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * docs/BRAND-STUDIO-V3.md §3 and §9-1 — the three layout modes, rendered from the real navigation.
 *
 * HARDLINE: a sandboxed organization (by id or by name) and any organization whose policy denies
 * generative media keep the `sidebar` markup byte for byte, whatever the studio flag says, and none of
 * the rail's elements. Do not weaken this file to make something pass.
 */
const state = vi.hoisted(() => ({ path: '/brand', query: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
}));

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';

const shell = getDictionary('ko').studioShell;
const b = getDictionary('ko').brandWorkspace;
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
const rooms = getDictionary('ko').roomsShell.nav;
/** The rail's workspace menu words, as app/(brand)/layout.tsx hands them over while studio v2 is on (§3.1). */
const workspaceMenu = { identity: b.identity, roles: b.roles, language: getDictionary('ko').nav.localeToggle, signOut: b.signOut };
const render = (choice: BrandWorkspaceChoice | null, rail: { studioV2?: boolean; withShell?: boolean; rooms?: boolean; menu?: boolean } = {}) =>
  renderToStaticMarkup(
    <WorkspaceNavigation
      {...labels}
      scope={choice ? scopeOf(choice) : null}
      studioV2={rail.studioV2}
      shell={rail.withShell === false ? undefined : shell}
      locale="ko"
      // Project rooms (docs/BRAND-ROOMS.md §2): the room words travel only with the flag.
      rooms={rail.rooms}
      roomsCopy={rail.rooms ? rooms : undefined}
      // Like the layout: the menu words travel with studio v2 unless a test asks for the rail without them.
      workspaceMenu={rail.studioV2 && rail.menu !== false ? workspaceMenu : undefined}
    />,
  );

/** Markers only the rail renders. */
const RAIL_ONLY = [
  'data-brand-layout-mode="rail"',
  // The rail's brand block and its menu (docs/BRAND-STUDIO-V3.md §3.1).
  'data-rail-workspace',
  'data-rail-create',
  'data-rail-credits',
  'data-rail-toggle',
  'data-rail-tabs',
  'data-rail-item',
  'data-nav-item="/brand/studio/video"',
  'data-nav-item="/brand/studio/review"',
  'href="/brand/studio/video',
  'href="/brand/studio/review',
  // The divider and the band under it (워크플로우), 2026-11-25.
  'data-rail-divider',
  'bw-rail-divider',
  'data-rail-group="lower"',
  // Project rooms: the groups, 메시지 and its address.
  'data-rail-section',
  'data-rail-item="messages"',
  'href="/brand/rooms',
  rooms.groupMake,
  rooms.groupTeam,
  rooms.messages,
];

const sandboxedChoices: Array<[string, BrandWorkspaceChoice]> = [
  ...[...SANDBOXED_CLIENT_ORG_IDS].map((id): [string, BrandWorkspaceChoice] => [`sandboxed id ${id}`, { id, name: 'Client brand', role: 'owner', logoUrl: null }]),
  ['named "Morphic Korea"', { id: 'e0000000-0000-4000-8000-00000000000e', name: 'Morphic Korea', role: 'owner', logoUrl: null }],
  ['named "모픽"', { id: 'e0000000-0000-4000-8000-0000000000e2', name: '모픽', role: 'editor', logoUrl: null }],
  ['generative_media denied by policy', { id: 'd0000000-0000-4000-8000-00000000000d', name: 'Policy brand', role: 'owner', logoUrl: null, denied: ['generative_media'] }],
  ['generative_media + sound denied', { id: 'd0000000-0000-4000-8000-0000000000d2', name: 'Policy brand two', role: 'viewer', logoUrl: null, denied: ['generative_media', 'sound'] }],
];

beforeEach(() => {
  state.path = '/brand';
  state.query = '';
});

describe.each(sandboxedChoices)('hardline: %s', (_label, choice) => {
  it("stays in 'sidebar' with the flag on and renders nothing of the rail", () => {
    for (const path of ['/brand', '/brand/studio', '/brand/studio/video', '/brand/members', '/brand/rooms']) {
      state.path = path;
      for (const html of [render(choice, { studioV2: true }), render(choice, { studioV2: true, rooms: true })]) {
        expect(html, path).toContain('data-brand-layout-mode="sidebar"');
        for (const marker of RAIL_ONLY) expect(html, `${path} ${marker}`).not.toContain(marker);
        expect(html).not.toContain('/brand/studio');
      }
    }
  });

  it('renders exactly the same markup whether studio v2 and rooms are on or off', () => {
    for (const path of ['/brand', '/brand/library', '/brand/settings', '/brand/rooms']) {
      state.path = path;
      const off = render(choice, { studioV2: false, withShell: false });
      expect(render(choice, { studioV2: true }), path).toBe(off);
      expect(render(choice, { studioV2: false }), path).toBe(off);
      expect(render(choice, { studioV2: true, rooms: true }), path).toBe(off);
    }
  });
});

describe('the rail', () => {
  const owner: BrandWorkspaceChoice = { id: OWNER, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] };

  it('is the mode for every other signed-in brand while studio v2 is on, omitting studio review and brand kit', () => {
    const html = render(owner, { studioV2: true });
    expect(html).toContain('data-brand-layout-mode="rail"');
    expect(html).toContain('data-rail-expanded="false"');
    for (const href of ['/brand/studio', '/brand/studio/video', '/brand', '/brand/creators', '/brand/library']) {
      expect(html, href).toContain(`href="${href}?organizationId=${OWNER}"`);
    }
    expect(html).not.toContain('/brand/studio/review');
    expect(html).not.toContain('/brand/identity');
    for (const word of [shell.rail.image, shell.rail.video, shell.rail.campaigns, shell.rail.assets]) {
      expect(html).toContain(word);
    }
    // §3.1: 팀 · 설정 moved from the foot into the brand block's menu, which is not in the markup until it opens.
    expect(html).toContain(`data-rail-workspace="${OWNER}"`);
    expect(html).not.toContain('data-rail-group="utility"');
    expect(html).not.toContain('data-rail-order');
    // No "+" button since 2026-11-25; 워크플로우 sits under a divider instead.
    expect(html).not.toContain('data-rail-create');
    expect(html).toContain('data-rail-divider');
    expect(html).toContain('data-rail-toggle');
    expect(html).toContain('data-rail-tabs');
    expect(html).toContain(`aria-label="${shell.rail.label}"`);
  });

  it('keeps 팀 and 설정 as rows at the foot when the layout gives no menu words', () => {
    const html = render(owner, { studioV2: true, menu: false });
    expect(html).toContain('data-brand-layout-mode="rail"');
    expect(html).not.toContain('data-rail-workspace');
    expect(html).toContain('data-rail-group="utility"');
    for (const href of ['/brand/members', '/brand/settings']) {
      expect(html, href).toContain(`href="${href}?organizationId=${OWNER}"`);
    }
    for (const word of [shell.rail.team, shell.rail.settings]) expect(html).toContain(word);
  });

  it("keeps 'topbar' when the flag is off or the copy is missing, and for signed-out visitors", () => {
    expect(render(owner, { studioV2: false })).toContain('data-brand-layout-mode="topbar"');
    expect(render(owner, { studioV2: true, withShell: false })).toContain('data-brand-layout-mode="topbar"');
    const signedOut = render(null, { studioV2: true });
    expect(signedOut).toContain('data-brand-layout-mode="topbar"');
    for (const marker of RAIL_ONLY) expect(signedOut).not.toContain(marker);
  });

  it('marks the image studio current only on its own screen', () => {
    const current = (html: string) => [...html.matchAll(/data-rail-item="(\w+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    state.path = '/brand/studio';
    expect(current(render(owner, { studioV2: true }))).toEqual(['image']);
    state.path = '/brand/studio/video';
    expect(current(render(owner, { studioV2: true }))).toEqual(['video']);
    state.path = '/brand/studio/review';
    expect(current(render(owner, { studioV2: true }))).toEqual([]);
    state.path = '/brand/projects/new';
    expect(current(render(owner, { studioV2: true }))).toEqual(['campaigns']);
  });

  it('gives no role a "+" button or menu, and a campaign-only guest never the studio items', () => {
    // With and without the menu words: the rows (no menu) show exactly what the role may open, and the
    // menu takes the same list (tests/brand-studio/shell/rail-workspace-nav.test.tsx opens it per role).
    // The wide rail has had no "+" since 2026-11-25 for any role, with rooms or without: its rows are the way in.
    const noCreate = (html: string, who: string) => {
      expect(html, who).toContain('data-brand-layout-mode="rail"');
      expect(html, who).not.toContain('data-rail-create');
      expect(html, who).not.toContain('bw-rail-create-button');
      expect(html, who).not.toContain('bw-rail-create-mark');
      // The old button's word, as a row label or a tooltip.
      expect(html, who).not.toContain('>만들기<');
      expect(html, who).not.toContain('data-rail-tip="만들기"');
    };
    for (const menu of [true, false]) {
      for (const role of ['owner', 'editor', 'viewer', 'guest', 'studio'] as const) {
        for (const withRooms of [false, true]) noCreate(render({ ...owner, role }, { studioV2: true, menu, rooms: withRooms }), `${role} menu ${menu} rooms ${withRooms}`);
      }
      const viewer = render({ ...owner, role: 'viewer' }, { studioV2: true, menu });
      expect(viewer).toContain('data-rail-item="image"');
      expect(viewer).not.toContain('/brand/members');
      expect(render({ ...owner, role: 'editor' }, { studioV2: true, menu })).toContain('data-rail-item="image"');
      const guest = render({ ...owner, role: 'guest' }, { studioV2: true, menu });
      expect(guest).not.toContain('/brand/studio');
      expect(guest).not.toContain('/brand/settings');
    }
  });

  it('renders expanded on the server when the layout says so', () => {
    const html = renderToStaticMarkup(
      <WorkspaceNavigation {...labels} scope={scopeOf(owner)} studioV2 shell={shell} locale="ko" railExpanded />,
    );
    expect(html).toContain('data-rail-expanded="true"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('has every rail string in both languages', () => {
    const en = getDictionary('en').studioShell;
    for (const group of Object.keys(shell) as Array<keyof typeof shell>) {
      for (const key of Object.keys(shell[group]) as Array<keyof (typeof shell)[typeof group]>) {
        expect(String(shell[group][key]).trim(), `ko ${group}.${String(key)}`).not.toBe('');
        expect(String(en[group][key]).trim(), `en ${group}.${String(key)}`).not.toBe('');
      }
    }
  });
});
