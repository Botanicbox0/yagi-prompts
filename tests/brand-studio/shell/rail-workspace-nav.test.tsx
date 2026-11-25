import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * docs/BRAND-STUDIO-V3.md §3.1 — the tidied rail: the brand block and its menu on top, no utility rows or
 * order row at the foot, the credits line as a link to 플랜 및 청구 for a role that may open it.
 *
 * HARDLINE (kept from navigation-modes.test.tsx): a sandboxed organization and one whose policy denies
 * generative media stay in `sidebar` and never get the rail's brand block, whatever the layout hands over.
 * Invented brands only.
 */
const state = vi.hoisted(() => ({ path: '/brand/studio', query: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
}));

type Allowance = { capKrw: number; usedKrw: number; resetsAt: string };
const activity = vi.hoisted(() => ({ summary: null as null | { allowance: Allowance; open: never[]; settled: never[] } }));
vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    // The server never reads the summary; the meter's markup needs one, so the hook hands this file's.
    useStudioActivity: () => ({ summary: activity.summary, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
  };
});

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { RailNavigation, type RailNavigationProps } from '@/components/brand-workspace/rail-nav';
import { CreditsMeter, meterFigures, meterSummary } from '@/components/brand-workspace/rail-activity';
import type { RailWorkspace } from '@/components/brand-workspace/rail-workspace-menu';

const ko = getDictionary('ko');
const shell = ko.studioShell;
const b = ko.brandWorkspace;
const roomsNav = ko.roomsShell.nav;
const ALPHA = 'a0000000-0000-4000-8000-0000000000a1';
const BRAVO = 'b0000000-0000-4000-8000-0000000000b2';
const ALLOWANCE: Allowance = { capKrw: 300_000, usedKrw: 100_000, resetsAt: '2026-12-01T00:00:00+09:00' };

const scoped = (path: string) => `${path}?organizationId=${ALPHA}`;
const workspace: RailWorkspace = {
  currentId: ALPHA,
  emptyLabel: b.identity.none,
  brands: [
    { id: ALPHA, name: 'Alpha fixture', logoUrl: null, role: b.roles.owner, href: scoped('/brand/studio'), staff: false },
    { id: BRAVO, name: 'Bravo fixture', logoUrl: null, role: b.roles.editor, href: `/brand/studio?organizationId=${BRAVO}`, staff: false },
  ],
  locale: 'ko',
  copy: { current: b.identity.current, switch: b.identity.switch, staffGroup: b.identity.staffGroup, language: ko.nav.localeToggle, signOut: b.signOut },
};

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

/** The opening tag of the first element carrying `marker`. */
const tagWith = (html: string, marker: string) => {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
};
const unescape = (value: string) => value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag: string | null, name: string) => {
  const match = tag ? new RegExp(`\\s${name}="([^"]*)"`).exec(tag) : null;
  return match ? unescape(match[1]!) : null;
};

beforeEach(() => {
  state.path = '/brand/studio';
  state.query = '';
  activity.summary = null;
});

describe('RailNavigation with the workspace block', () => {
  it('puts the brand block first in the nav, before the switch, 홈 and the list', () => {
    const html = rail({ workspace, home: '홈' });
    expect(html).toMatch(/<nav [^>]*data-brand-layout-mode="rail"[^>]*><div class="bw-rail-workspace" data-rail-workspace="a0000000-0000-4000-8000-0000000000a1">/);
    const block = html.indexOf('data-rail-workspace=');
    expect(block).toBeLessThan(html.indexOf('data-rail-item="home"'));
    expect(block).toBeLessThan(html.indexOf('data-rail-group="primary"'));
    expect(tagWith(html, 'data-rail-workspace-trigger')).toContain('aria-haspopup="menu"');
    // The menu is not in the markup until it opens.
    expect(html).not.toContain('data-rail-workspace-menu');
    expect(html).toContain('Alpha fixture');
    expect(html).toContain(b.roles.owner);
  });

  it('lists no utility rows and no order row at the foot, expanded or collapsed', () => {
    for (const initialExpanded of [true, false]) {
      const html = rail({ workspace, initialExpanded });
      expect(html, `expanded ${initialExpanded}`).not.toContain('data-rail-group="utility"');
      expect(html).not.toContain('data-nav-group="utility"');
      expect(html).not.toContain('data-rail-order');
      expect(html).not.toContain(`>${shell.rail.reorder}<`);
      for (const path of ['/brand/members', '/brand/settings']) expect(html, path).not.toContain(`data-nav-item="${path}"`);
    }
  });

  it('gives a browser without script 팀 · 플랜 및 청구 · 설정 as plain links in a noscript list at the foot', () => {
    const html = rail({ workspace });
    const noscript = /<noscript><ul class="bw-rail-list" data-rail-noscript="[^"]*">([\s\S]*?)<\/ul><\/noscript>/.exec(html);
    expect(noscript).not.toBeNull();
    const list = noscript![1]!;
    expect([...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([scoped('/brand/members'), scoped('/brand/billing'), scoped('/brand/settings')]);
    expect(list).toContain('class="bw-rail-item"');
    // Plain links: none of the rail's markers, so nothing counts them as rows.
    expect(list).not.toContain('data-nav-');
    expect(list).not.toContain('data-rail-');
    // It sits in the foot, after the list.
    expect(html.indexOf('data-rail-noscript')).toBeGreaterThan(html.indexOf('class="bw-rail-foot"'));
    // Only what the role may open, and nothing at all for a role with none of the three.
    const settingsOnly = /data-rail-noscript[\s\S]*?<\/noscript>/.exec(rail({ workspace, team: false, billing: false }))![0];
    expect([...settingsOnly.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([scoped('/brand/settings')]);
    expect(rail({ workspace, team: false, billing: false, settings: false })).not.toContain('data-rail-noscript');
    // Without the menu the rows are there already: no noscript copy of them.
    expect(rail()).not.toContain('data-rail-noscript');
  });

  it('titles the fold button with its name only on the expanded rail with the block', () => {
    const toggle = (html: string) => tagWith(html, 'data-rail-toggle');
    expect(attr(toggle(rail({ workspace, initialExpanded: true })), 'title')).toBe(shell.rail.collapse);
    expect(attr(toggle(rail({ workspace, initialExpanded: false })), 'title')).toBeNull();
    expect(attr(toggle(rail({ initialExpanded: true })), 'title')).toBeNull();
    expect(attr(toggle(rail({ initialExpanded: false })), 'title')).toBeNull();
  });

  it('draws no "+" at all (2026-11-25): no button, mark, old disc or menu, with or without create rights', () => {
    for (const canCreate of [true, false]) {
      for (const initialExpanded of [true, false]) {
        const html = rail({ workspace, canCreate, initialExpanded });
        const at = `canCreate ${canCreate} expanded ${initialExpanded}`;
        expect(html, at).not.toContain('data-rail-create');
        for (const name of ['bw-rail-create-button', 'bw-rail-create-mark', 'bw-rail-create-disc', 'bw-rail-create-menu']) expect(html, `${at} ${name}`).not.toContain(name);
      }
    }
  });

  it('makes the credits line a link to the scoped 플랜 및 청구 for a role with billing', () => {
    activity.summary = { allowance: ALLOWANCE, open: [], settled: [] };
    const html = rail({ workspace, billing: true });
    const meter = tagWith(html, 'data-rail-credits');
    expect(meter).toMatch(/^<a /);
    expect(meter).toContain('data-rail-credits-link');
    expect(attr(meter, 'href')).toBe(scoped('/brand/billing'));
    const summary = meterSummary(meterFigures(ALLOWANCE, 'ko')!, shell);
    expect(attr(meter, 'aria-label')).toBe(`${shell.rail.billing}: ${summary}`);
    expect(meter).not.toContain('role="group"');
  });

  it('keeps the credits line plain text (a labelled group) for a role without billing', () => {
    activity.summary = { allowance: ALLOWANCE, open: [], settled: [] };
    for (const billing of [false, undefined]) {
      const html = rail({ workspace, billing });
      const meter = tagWith(html, 'data-rail-credits');
      expect(meter, String(billing)).toMatch(/^<div /);
      expect(meter).toContain('role="group"');
      expect(attr(meter, 'aria-label')).toBe(shell.credits.label);
      expect(meter).not.toContain('href=');
      expect(html).not.toContain('data-rail-credits-link');
      expect(html).not.toContain('/brand/billing');
    }
  });

  it('shows no credits line on 야기 팀과 (team mode)', () => {
    activity.summary = { allowance: ALLOWANCE, open: [], settled: [] };
    state.path = '/brand';
    const team = rail({ workspace, rooms: true, roomsCopy: roomsNav });
    expect(team).toContain('data-rail-mode="team"');
    expect(team).not.toContain('data-rail-credits');
    state.path = '/brand/studio';
    const make = rail({ workspace, rooms: true, roomsCopy: roomsNav });
    expect(make).toContain('data-rail-mode="make"');
    expect(make).toContain('data-rail-credits-link');
  });

  it('has no credits line at all without a summary (the server render)', () => {
    expect(rail({ workspace })).not.toContain('data-rail-credits');
  });
});

describe('RailNavigation without the workspace block (exactly as before)', () => {
  it('keeps 팀 · 플랜 및 청구 · 설정 as utility rows at the foot', () => {
    const html = rail();
    expect(html).not.toContain('data-rail-workspace');
    expect(html).toContain('data-rail-group="utility"');
    const utility = [...html.matchAll(/data-nav-item="([^"]+)" data-nav-group="utility"/g)].map((m) => m[1]);
    expect(utility).toEqual(['/brand/members', '/brand/billing', '/brand/settings']);
    for (const word of [shell.rail.team, shell.rail.billing, shell.rail.settings]) expect(html).toContain(`>${word}<`);
  });

  it('lists only the utilities the role may open', () => {
    const html = rail({ team: false, billing: false, settings: true });
    expect([...html.matchAll(/data-nav-item="([^"]+)" data-nav-group="utility"/g)].map((m) => m[1])).toEqual(['/brand/settings']);
    expect(rail({ team: false, billing: false, settings: false })).not.toContain('data-rail-group="utility"');
  });

  it('keeps the 순서 편집 row on an expanded rail, and none on a collapsed one', () => {
    const html = rail();
    expect(html).toContain('data-rail-order');
    expect(html).toMatch(/data-rail-order[^>]*><button type="button" aria-pressed="false">순서 편집<\/button><\/div>/);
    expect(rail({ initialExpanded: false })).not.toContain('data-rail-order');
  });

  it('still makes the credits line a billing link for a role with billing', () => {
    activity.summary = { allowance: ALLOWANCE, open: [], settled: [] };
    expect(attr(tagWith(rail(), 'data-rail-credits'), 'href')).toBe(scoped('/brand/billing'));
  });
});

describe('CreditsMeter', () => {
  it('is a link named "<page>: <summary>" with href, and the old labelled group without', () => {
    const summary = meterSummary(meterFigures(ALLOWANCE, 'ko')!, shell);
    const link = renderToStaticMarkup(<CreditsMeter allowance={ALLOWANCE} copy={shell} locale="ko" expanded href="/brand/billing?organizationId=x" hrefLabel="플랜 및 청구" />);
    expect(link).toMatch(/^<a class="bw-rail-credits" data-rail-credits=/);
    expect(attr(tagWith(link, 'data-rail-credits'), 'aria-label')).toBe(`플랜 및 청구: ${summary}`);
    expect(attr(tagWith(link, 'data-rail-credits'), 'href')).toBe('/brand/billing?organizationId=x');
    const plain = renderToStaticMarkup(<CreditsMeter allowance={ALLOWANCE} copy={shell} locale="ko" expanded={false} />);
    expect(plain).toMatch(/^<div class="bw-rail-credits" data-rail-credits=/);
    expect(plain).toContain('tabindex="0"');
    expect(plain).toContain('role="group"');
    expect(plain).not.toContain('data-rail-credits-link');
  });

  it('makes the bar a silent picture inside the link, and keeps it a meter in the plain group', () => {
    const bar = (html: string) => tagWith(html, 'class="bw-rail-credits-bar"');
    const linked = bar(renderToStaticMarkup(<CreditsMeter allowance={ALLOWANCE} copy={shell} locale="ko" expanded href="/brand/billing" hrefLabel="플랜 및 청구" />));
    expect(attr(linked, 'aria-hidden')).toBe('true');
    expect(linked).not.toContain('role=');
    expect(linked).not.toMatch(/aria-(valuemin|valuemax|valuenow|valuetext|label)=/);
    const figures = meterFigures(ALLOWANCE, 'ko')!;
    const plain = bar(renderToStaticMarkup(<CreditsMeter allowance={ALLOWANCE} copy={shell} locale="ko" expanded />));
    expect(attr(plain, 'role')).toBe('meter');
    expect(attr(plain, 'aria-valuemin')).toBe('0');
    expect(attr(plain, 'aria-valuemax')).toBe(String(figures.total));
    expect(attr(plain, 'aria-valuenow')).toBe(String(figures.left));
    expect(attr(plain, 'aria-valuetext')).toBe(meterSummary(figures, shell));
    expect(attr(plain, 'aria-label')).toBe(shell.credits.label);
    expect(plain).not.toContain('aria-hidden');
  });

  it('names the link by the summary alone when no page name is given', () => {
    const summary = meterSummary(meterFigures(ALLOWANCE, 'ko')!, shell);
    const link = renderToStaticMarkup(<CreditsMeter allowance={ALLOWANCE} copy={shell} locale="ko" expanded href="/brand/billing" />);
    expect(attr(tagWith(link, 'data-rail-credits'), 'aria-label')).toBe(summary);
  });
});

describe('순서 편집 from the menu (DOM)', () => {
  let dom: MountedDom | null = null;
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('innerWidth', 1440);
  });
  afterEach(async () => {
    await dom?.unmount();
    dom = null;
    vi.unstubAllGlobals();
  });

  it('opens a collapsed rail first, then hands focus to 완료; 완료 ends it and the row goes away', async () => {
    try {
      (globalThis as { localStorage?: Storage }).localStorage?.clear();
    } catch {
      // no storage yet: the harness makes one
    }
    dom = await mountDom(<RailNavigation {...railProps({ workspace, initialExpanded: false })} />);
    const nav = () => dom!.query('[data-brand-layout-mode="rail"]')!;
    expect(nav().getAttribute('data-rail-expanded')).toBe('false');
    expect(dom.query('[data-rail-order]')).toBeNull();

    await dom.click('[data-rail-workspace-trigger]');
    await dom.click('[data-rail-workspace-reorder]');
    expect(dom.query('[data-rail-workspace-menu]')).toBeNull();
    expect(nav().getAttribute('data-rail-expanded')).toBe('true');
    expect(nav().getAttribute('data-nav-reordering')).toBe('true');
    const done = dom.query('[data-rail-order] button')!;
    expect(done.textContent).toBe(shell.rail.reorderDone);
    // With the menu this row is 완료 alone, not a toggle: no pressed state to announce.
    expect(done.hasAttribute('aria-pressed')).toBe(false);
    expect(dom.document.activeElement).toBe(done);
    expect(dom.queryAll('.bw-rail-move').length).toBeGreaterThan(0);

    // While reordering, the menu does not offer to start again.
    await dom.click('[data-rail-workspace-trigger]');
    expect(dom.query('[data-rail-workspace-menu]')).not.toBeNull();
    expect(dom.query('[data-rail-workspace-reorder]')).toBeNull();
    await dom.keyDown('Escape');

    await dom.click('[data-rail-order] button');
    expect(dom.query('[data-rail-order]')).toBeNull();
    expect(nav().hasAttribute('data-nav-reordering')).toBe(false);
    expect(dom.query('.bw-rail-move')).toBeNull();
    // The row went away with the editing: focus is back on the block that started it, not lost.
    expect(dom.document.activeElement).toBe(dom.query('[data-rail-workspace-trigger]'));
  });

  it('keeps the old pressed toggle for 순서 편집 without the block', async () => {
    dom = await mountDom(<RailNavigation {...railProps({ initialExpanded: true })} />);
    const button = () => dom!.query('[data-rail-order] button')!;
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().textContent).toBe(shell.rail.reorder);
    await dom.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().textContent).toBe(shell.rail.reorderDone);
    await dom.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(dom.query('[data-rail-workspace-trigger]')).toBeNull();
  });

  it('puts the three workspace links in the menu, scoped, with the current page marked', async () => {
    state.path = '/brand/members';
    dom = await mountDom(<RailNavigation {...railProps({ workspace })} />);
    await dom.click('[data-rail-workspace-trigger]');
    const links = dom.queryAll('[data-rail-workspace-link]');
    expect(links.map((a) => a.getAttribute('data-rail-workspace-link'))).toEqual(['team', 'billing', 'settings']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([scoped('/brand/members'), scoped('/brand/billing'), scoped('/brand/settings')]);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null, null]);
    expect(links.map((a) => a.textContent)).toEqual([shell.rail.team, shell.rail.billing, shell.rail.settings]);
  });

  it('gives a viewer-like role (no team, billing or settings) a menu with no workspace group', async () => {
    dom = await mountDom(<RailNavigation {...railProps({ workspace, team: false, billing: false, settings: false, canCreate: false })} />);
    await dom.click('[data-rail-workspace-trigger]');
    expect(dom.query('[data-rail-workspace-group="workspace"]')).toBeNull();
    expect(dom.query('[data-rail-workspace-group="language"]')).not.toBeNull();
    expect(dom.query('[data-rail-workspace-signout]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ WorkspaceNavigation */

const labels = {
  home: b.home,
  members: b.members,
  settings: b.managed.settings,
  billing: ko.brandBilling.customer.pageTitle,
  library: b.managed.library,
  studio: b.productionStudio.title,
  identity: b.identityLayer.nav,
  creators: b.creatorPool.nav,
};
const workspaceMenu = { identity: b.identity, roles: b.roles, language: ko.nav.localeToggle, signOut: b.signOut };
const scopeOf = (...choices: BrandWorkspaceChoice[]): BrandWorkspaceScope => ({ choices, projectOrganizations: {} });
const navigation = (scope: BrandWorkspaceScope | null, o: { studioV2?: boolean; menu?: boolean; pendingShare?: boolean } = {}) =>
  renderToStaticMarkup(
    <WorkspaceNavigation
      {...labels}
      scope={scope}
      studioV2={o.studioV2 ?? true}
      shell={shell}
      locale="ko"
      pendingShare={o.pendingShare}
      workspaceMenu={o.menu === false ? undefined : workspaceMenu}
    />,
  );

const sandboxedChoices: Array<[string, BrandWorkspaceChoice]> = [
  ...[...SANDBOXED_CLIENT_ORG_IDS].map((id): [string, BrandWorkspaceChoice] => [`sandboxed id ${id}`, { id, name: 'Client brand', role: 'owner', logoUrl: null }]),
  ['named "Morphic Korea"', { id: 'e0000000-0000-4000-8000-00000000000e', name: 'Morphic Korea', role: 'owner', logoUrl: null }],
  ['named "모픽"', { id: 'e0000000-0000-4000-8000-0000000000e2', name: '모픽', role: 'editor', logoUrl: null }],
  ['generative_media denied by policy', { id: 'd0000000-0000-4000-8000-00000000000d', name: 'Policy brand', role: 'owner', logoUrl: null, denied: ['generative_media'] }],
];

describe.each(sandboxedChoices)('WorkspaceNavigation hardline with the workspace menu: %s', (_label, choice) => {
  it("stays 'sidebar', byte for byte, and never gets the brand block", () => {
    for (const path of ['/brand', '/brand/studio', '/brand/members', '/brand/settings']) {
      state.path = path;
      const withMenu = navigation(scopeOf(choice));
      expect(withMenu, path).toContain('data-brand-layout-mode="sidebar"');
      expect(withMenu).not.toContain('data-rail-workspace');
      expect(withMenu).not.toContain('aria-haspopup="menu"');
      expect(withMenu).toBe(navigation(scopeOf(choice), { menu: false }));
      expect(withMenu).toBe(navigation(scopeOf(choice), { studioV2: false, menu: false }));
    }
  });
});

describe('WorkspaceNavigation with the workspace menu', () => {
  const owner: BrandWorkspaceChoice = { id: ALPHA, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] };

  it('gives a rail brand the block with its name and its role in words, and no utility rows', () => {
    const html = navigation(scopeOf(owner));
    expect(html).toContain('data-brand-layout-mode="rail"');
    expect(html).toContain(`data-rail-workspace="${ALPHA}"`);
    const trigger = html.slice(html.indexOf('data-rail-workspace-trigger'), html.indexOf('</button>', html.indexOf('data-rail-workspace-trigger')));
    expect(trigger).toContain(`<span class="bw-rail-sr">${b.identity.current}: </span><strong>Alpha fixture</strong>`);
    expect(trigger).toContain(`<small>${b.roles.owner}</small>`);
    expect(html).not.toContain('data-rail-group="utility"');
    expect(html).not.toContain('data-rail-order');
  });

  it('says the role in words for an editor, a viewer, a campaign guest and the TWINGS team', () => {
    const word = (choice: BrandWorkspaceChoice) => {
      const html = navigation(scopeOf(choice));
      return /data-rail-workspace-trigger[\s\S]*?<small>([^<]*)<\/small>/.exec(html)?.[1];
    };
    expect(word({ ...owner, role: 'editor' })).toBe(b.roles.editor);
    expect(word({ ...owner, role: 'viewer' })).toBe(b.roles.viewer);
    expect(word({ ...owner, role: 'guest' })).toBe(b.identity.guest);
    expect(word({ ...owner, role: 'studio' })).toBe(b.identity.studio);
  });

  it('keeps the rows as before when the layout gives no menu words', () => {
    const html = navigation(scopeOf(owner), { menu: false });
    expect(html).toContain('data-brand-layout-mode="rail"');
    expect(html).not.toContain('data-rail-workspace');
    expect(html).toContain('data-rail-group="utility"');
  });

  it('never reaches the topbar (studio v2 off)', () => {
    const html = navigation(scopeOf(owner), { studioV2: false });
    expect(html).toContain('data-brand-layout-mode="topbar"');
    expect(html).not.toContain('data-rail-workspace');
    expect(html).toBe(navigation(scopeOf(owner), { studioV2: false, menu: false }));
  });

  it('gives the no-brand account and the signed-out visitor the empty bar, not the block', () => {
    for (const scope of [scopeOf(), null]) {
      const html = navigation(scope);
      expect(html).toBe('<span aria-hidden="true" data-brand-layout-mode="topbar" data-brand-nav-empty=""></span>');
    }
  });

  it('says "no brand yet" on the block of an account waiting for a shared campaign', () => {
    const html = navigation(scopeOf(), { pendingShare: true });
    expect(html).toContain('data-brand-layout-mode="rail"');
    expect(html).toContain('data-rail-workspace="none"');
    expect(html).toContain(`<strong>${b.identity.none}</strong>`);
  });
});

describe('WorkspaceNavigation menu per role (DOM)', () => {
  let dom: MountedDom | null = null;
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('innerWidth', 1440);
  });
  afterEach(async () => {
    await dom?.unmount();
    dom = null;
    vi.unstubAllGlobals();
  });

  const owner: BrandWorkspaceChoice = { id: ALPHA, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] };
  const rowsWithoutMenu = (choice: BrandWorkspaceChoice) =>
    [...navigation(scopeOf(choice), { menu: false }).matchAll(/data-nav-item="([^"]+)" data-nav-group="utility"/g)].map((m) => m[1]);

  it.each(['owner', 'editor', 'viewer', 'guest', 'studio'] as const)('offers a %s exactly the utilities the rows used to show', async (role) => {
    const choice = { ...owner, role };
    dom = await mountDom(
      <WorkspaceNavigation {...labels} scope={scopeOf(choice)} studioV2 shell={shell} locale="ko" workspaceMenu={workspaceMenu} />,
    );
    await dom.click('[data-rail-workspace-trigger]');
    const inMenu = dom.queryAll('[data-rail-workspace-link]').map((a) => a.getAttribute('data-nav-item'));
    expect(inMenu).toEqual(rowsWithoutMenu(choice));
    for (const a of dom.queryAll('[data-rail-workspace-link]')) expect(a.getAttribute('href')).toContain(`organizationId=${ALPHA}`);
    if (role === 'owner') expect(inMenu).toEqual(['/brand/members', '/brand/billing', '/brand/settings']);
    // Language and sign-out are there for every role.
    expect(dom.queryAll('[data-language-option]')).toHaveLength(2);
    expect(dom.query('[data-rail-workspace-signout]')).not.toBeNull();
  });

  it('lists every brand of the scope with its role in words and a switch link that keeps the section', async () => {
    state.path = '/brand/library';
    const other: BrandWorkspaceChoice = { id: BRAVO, name: 'Bravo fixture', role: 'guest', logoUrl: null };
    dom = await mountDom(
      <WorkspaceNavigation {...labels} scope={scopeOf(owner, other)} studioV2 shell={shell} locale="ko" workspaceMenu={workspaceMenu} />,
    );
    await dom.click('[data-rail-workspace-trigger]');
    const choices = dom.queryAll('[data-brand-choice]');
    expect(choices.map((c) => c.getAttribute('data-brand-choice'))).toEqual([ALPHA, BRAVO]);
    expect(choices.map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(choices[0]!.textContent).toContain(b.roles.owner);
    expect(choices[1]!.textContent).toContain(b.identity.guest);
    expect(choices[0]!.getAttribute('href')).toBe(`/brand/library?organizationId=${ALPHA}`);
    expect(choices[1]!.getAttribute('href')).toContain(`organizationId=${BRAVO}`);
  });
});

describe('the layout', () => {
  it('hands the menu words to the navigation only while studio v2 is on (studio v2 already needs studio copy)', () => {
    const layout = readFileSync('app/(brand)/layout.tsx', 'utf8');
    expect(layout).toContain('const studioV2=brandStudioV2Open()&&studioCopy;');
    expect(layout).toContain('workspaceMenu={studioV2?{identity:b.identity,roles:b.roles,language:d.nav.localeToggle,signOut:b.signOut}:undefined}');
    // The layout keeps its own brand block, language control and sign-out row: phones and no-script use them.
    expect(layout).toContain('<WorkspaceLanguage ');
    expect(layout).toContain('action="/auth/signout" method="post" className="bw-signout"');
  });
});
