import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { BrandProjectSummary, BrandWorkspace } from '@/lib/brands/workspace/types';
import {
  resolveWorkspaceSelection, scopedHref, sectionVisibility, switchHref,
  type BrandWorkspaceChoice, type BrandWorkspaceScope,
} from '@/lib/brands/workspace/selection';

/**
 * The sidebar brand selector and the pages it scopes, rendered from the real components with the
 * data layer stubbed. Server authorization is covered in workspace-identity.test.ts; this proves the
 * URL -> brand rule, role-specific chrome and that pages ask the service for the selected brand only.
 */
const A = 'a0000000-0000-4000-8000-00000000000a', B = 'b0000000-0000-4000-8000-00000000000b', G = 'c0000000-0000-4000-8000-00000000000c';
const P_A = 'a1000000-0000-4000-8000-000000000001', P_B = 'b1000000-0000-4000-8000-000000000001', P_G = 'c1000000-0000-4000-8000-000000000001';
const FORGED = 'f0000000-0000-4000-8000-00000000000f';
const choices: BrandWorkspaceChoice[] = [
  { id: A, name: 'Alpha fixture', role: 'owner', logoUrl: `/api/brand-workspace/organizations/${A}/logo?v=3` },
  { id: B, name: 'Beta fixture', role: 'viewer', logoUrl: null },
  { id: G, name: 'Gamma fixture', role: 'guest', logoUrl: null },
];
const scope: BrandWorkspaceScope = { choices, projectOrganizations: { [P_A]: A, [P_B]: B, [P_G]: G } };

const state = vi.hoisted(() => ({
  path: '/brand', query: '', scope: null as unknown as BrandWorkspaceScope,
  workspaceCalls: [] as Array<{ organizationId?: string; includeAllContent?: boolean }>,
  projects: [] as BrandProjectSummary[],
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return { brandContext: async () => { const dict = getDictionary('ko'); return { viewer: { userId: '00000000-0000-4000-8000-000000000001' }, sql: {}, locale: 'ko', dict, b: dict.brandWorkspace }; } };
});
vi.mock('@/lib/brands/workspace/service', () => ({
  loadBrandWorkspaceScope: async () => state.scope,
  loadBrandWorkspace: async (_d: unknown, _v: unknown, options: { organizationId?: string; includeAllContent?: boolean } = {}): Promise<BrandWorkspace> => {
    state.workspaceCalls.push(options);
    const choice = state.scope.choices.find((c) => c.id === options.organizationId);
    return {
      organizations: choice && choice.role !== 'guest' ? [{ id: choice.id, name: choice.name, role: choice.role }] : [],
      projects: state.projects.filter((p) => p.organizationId === options.organizationId),
    };
  },
  loadBrandMembers: async () => ({ organization: { id: A, name: 'Alpha fixture' }, members: [], invitations: [] }),
  loadBrandSettings: async (_d: unknown, _v: unknown, id: string) => ({ id, name: 'Settings fixture', website: '', description: '', contactEmail: '', revision: 0, role: state.scope.choices.find((c) => c.id === id)?.role, logoUrl: null, logoRevision: 0 }),
}));

import { WorkspaceIdentity } from '@/components/brand-workspace/identity';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { BrandAvatar } from '@/components/brand-workspace/brand-avatar';
import BrandHome from '@/app/(brand)/brand/page';
import ContentLibrary from '@/app/(brand)/brand/library/page';
import MembersPage from '@/app/(brand)/brand/members/page';
import BrandSettings from '@/app/(brand)/brand/settings/page';
import NewBrandProject from '@/app/(brand)/brand/projects/new/page';
import { getDictionary } from '@/lib/i18n/dictionaries';

const b = getDictionary('ko').brandWorkspace;
const en = getDictionary('en').brandWorkspace;
const html = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);
const search = (organizationId?: string | string[]) => ({ searchParams: Promise.resolve(organizationId ? { organizationId } : {}) });
const summary = (id: string, organizationId: string, title: string): BrandProjectSummary => ({
  id, organizationId, organizationName: 'x', title, objective: 'Fixture', audience: '', budgetKrw: null, budgetTaxBasis: 'unspecified',
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: null, endsOn: null, productionMode: 'creator', status: 'active', revision: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01',
});
const identity = () => renderToStaticMarkup(<WorkspaceIdentity scope={state.scope} copy={b.identity} roles={b.roles} />);
const nav = () => renderToStaticMarkup(<WorkspaceNavigation home="Home" members="Team" settings="Settings" library="Library" studio="Studio" scope={state.scope} />);

beforeEach(() => {
  state.path = '/brand'; state.query = ''; state.scope = scope; state.workspaceCalls = [];
  state.projects = [summary(P_A, A, 'Alpha campaign'), summary(P_B, B, 'Beta campaign'), summary(P_G, G, 'Gamma campaign')];
});

describe('selection rule', () => {
  it('prefers the campaign route, then a valid query, then the first brand', () => {
    expect(resolveWorkspaceSelection(choices, { routeOrganizationId: B, query: A })).toMatchObject({ state: 'selected', source: 'route', choice: { id: B } });
    expect(resolveWorkspaceSelection(choices, { query: G })).toMatchObject({ state: 'selected', source: 'query', choice: { id: G } });
    expect(resolveWorkspaceSelection(choices, { query: G.toUpperCase() })).toMatchObject({ state: 'selected', choice: { id: G } });
    expect(resolveWorkspaceSelection(choices, {})).toMatchObject({ state: 'selected', source: 'default', choice: { id: A } });
  });

  it('never falls back to another brand for an inaccessible, malformed or repeated id', () => {
    for (const query of [FORGED, 'not-a-uuid', [A, B]]) expect(resolveWorkspaceSelection(choices, { query })).toEqual({ state: 'unavailable' });
    expect(resolveWorkspaceSelection(choices, { routeOrganizationId: FORGED, query: A })).toEqual({ state: 'unavailable' });
    expect(resolveWorkspaceSelection([], {})).toEqual({ state: 'none' });
  });

  it('shows sections by the selected brand role and keeps the brand when switching', () => {
    expect(sectionVisibility(choices[0]!)).toEqual({ studio: true, settings: true, members: true });
    expect(sectionVisibility(choices[1]!)).toEqual({ studio: true, settings: true, members: false });
    expect(sectionVisibility(choices[2]!)).toEqual({ studio: false, settings: false, members: false });
    expect(switchHref('/brand/members', choices[1]!)).toBe(`/brand?organizationId=${B}`);
    expect(switchHref('/brand/settings', choices[1]!)).toBe(`/brand/settings?organizationId=${B}`);
    expect(switchHref('/brand/settings', choices[2]!)).toBe(`/brand?organizationId=${G}`);
    expect(switchHref('/brand/library', choices[2]!)).toBe(`/brand/library?organizationId=${G}`);
    expect(switchHref(`/brand/projects/${P_A}`, choices[1]!)).toBe(`/brand?organizationId=${B}`);
    expect(scopedHref(`/brand/projects/${P_A}#review`, choices[0]!)).toBe(`/brand/projects/${P_A}?organizationId=${A}#review`);
  });
});

describe('sidebar identity', () => {
  it('shows the selected brand with its logo and a menu of every accessible brand', () => {
    state.query = `organizationId=${B}`;
    const page = identity();
    expect(page).toContain(`data-brand-identity="${B}"`);
    expect(page).toContain('<details');
    expect(page).toContain(b.identity.switch);
    for (const c of choices) expect(page).toContain(`data-brand-choice="${c.id}"`);
    expect(page).toMatch(new RegExp(`href="/brand\\?organizationId=${B}" aria-current="true"`));
    expect(page).toContain(`src="/api/brand-workspace/organizations/${A}/logo?v=3"`);
    expect(page).toContain(b.identity.guest);
    expect(page).not.toMatch(/\bKR\b/);
  });

  it('a campaign page shows the brand that owns it, whatever the query says', () => {
    state.path = `/brand/projects/${P_G}`; state.query = `organizationId=${A}`;
    expect(identity()).toContain(`data-brand-identity="${G}"`);
    state.path = `/brand/projects/${P_B}/reports/r1`;
    expect(identity()).toContain(`data-brand-identity="${B}"`);
  });

  it('a forged brand is reported as unavailable, not replaced by another brand', () => {
    state.query = `organizationId=${FORGED}`;
    const page = identity();
    expect(page).toContain('data-brand-identity="unavailable"');
    expect(page).toContain(b.identity.unavailable);
    expect(page).not.toContain('aria-current="true"');
  });

  it('a single brand is its identity, not a dropdown; no brand is a quiet empty state', () => {
    state.scope = { choices: [choices[1]!], projectOrganizations: {} };
    const single = identity();
    expect(single).toContain('Beta fixture');
    expect(single).not.toContain('<details');
    expect(single).not.toContain('<select');
    state.scope = { choices: [], projectOrganizations: {} };
    expect(identity()).toContain(b.identity.none);
  });

  it('never gives owner controls of brand A while viewing viewer-only brand B, and scopes every link', () => {
    state.query = `organizationId=${A}`;
    expect(nav()).toContain(`href="/brand/members?organizationId=${A}"`);
    state.query = `organizationId=${B}`;
    const viewing = nav();
    expect(viewing).not.toContain('/brand/members');
    expect(viewing).toContain(`href="/brand/settings?organizationId=${B}"`);
    expect(viewing).toContain(`href="/brand/library?organizationId=${B}"`);
    state.query = `organizationId=${G}`;
    expect(nav()).not.toContain('/brand/studio');
    expect(nav()).not.toContain('/brand/settings');
  });

  it('uses a decorative logo image and falls back to the initial', () => {
    expect(renderToStaticMarkup(<BrandAvatar name="Alpha fixture" logoUrl="/api/brand-workspace/organizations/x/logo?v=1" />)).toMatch(/<span[^>]*aria-hidden="true"[^>]*><img[^>]*alt=""/);
    const initial = renderToStaticMarkup(<BrandAvatar name="  beta" logoUrl={null} />);
    expect(initial).toContain('data-brand-avatar="initial"');
    expect(initial).toContain('>B</span>');
  });

  it('has Korean and English copy for every identity string', () => {
    for (const key of Object.keys(b.identity) as Array<keyof typeof b.identity>) {
      expect(b.identity[key]).toBeTruthy();
      expect(en.identity[key]).toBeTruthy();
    }
  });
});

describe('pages scoped to the selected brand', () => {
  it('home loads and lists only the selected brand', async () => {
    const page = await html(BrandHome(search(B)));
    expect(state.workspaceCalls).toEqual([{ organizationId: B }]);
    expect(page).toContain('Beta campaign');
    expect(page).not.toContain('Alpha campaign');
    expect(page).toContain(`href="/brand/studio?organizationId=${B}"`);
    // Viewer role in B: no request button even though this account owns A.
    expect(page).not.toContain('href="/brand/projects/new');
  });

  it('library loads the selected brand only, with all of its content', async () => {
    await html(ContentLibrary(search(G)));
    expect(state.workspaceCalls).toEqual([{ includeAllContent: true, organizationId: G }]);
  });

  it('an inaccessible brand shows an honest unavailable page and loads nothing', async () => {
    for (const render of [BrandHome, ContentLibrary, MembersPage, BrandSettings, NewBrandProject]) {
      const page = await html(render(search(FORGED)));
      expect(page).toContain('data-brand-unavailable');
      expect(page).not.toContain('Alpha');
    }
    expect(state.workspaceCalls).toEqual([]);
  });

  it('team and settings follow the selected role, and back links keep the brand', async () => {
    expect(await html(MembersPage(search(A)))).toContain(b.createInvite);
    const viewerTeam = await html(MembersPage(search(B)));
    expect(viewerTeam).toContain(b.access.ownerOnlyTeam);
    expect(viewerTeam).toContain(`href="/brand?organizationId=${B}"`);
    expect(await html(MembersPage(search(G)))).toContain(b.access.sharedOnly);
    const ownerSettings = await html(BrandSettings(search(A)));
    expect(ownerSettings).toContain('data-brand-logo-control');
    const viewerSettings = await html(BrandSettings(search(B)));
    expect(viewerSettings).toContain('data-brand-settings-read-only');
    expect(viewerSettings).not.toContain('data-brand-logo-control');
    expect(await html(BrandSettings(search(G)))).toContain(b.access.sharedOnly);
  });

  it('a new brief goes to the selected brand only, and only when its role may send one', async () => {
    const owned = await html(NewBrandProject(search(A)));
    expect(owned).toContain(`<option value="${A}"`);
    expect(owned).not.toContain(`value="${B}"`);
    expect(await html(NewBrandProject(search(B)))).toContain(b.access.viewerCannotRequest);
    expect(await html(NewBrandProject(search(G)))).toContain(b.access.sharedOnly);
  });
});
