import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { BrandProjectDetail, BrandProjectSummary, BrandWorkspace } from '@/lib/brands/workspace/types';
import { sectionVisibility, switchHref, type BrandWorkspaceChoice, type BrandWorkspaceScope } from '@/lib/brands/workspace/selection';

/**
 * The existing logo switcher and brand pages in the TWINGS team view (`role: 'studio'`), rendered from
 * the real components with the data layer stubbed. Authorization itself is covered for real in
 * staff-workspace.test.ts; this proves the label, switch URLs, menu structure and read-only chrome.
 */
const A = 'a0000000-0000-4000-8000-00000000000a', B = 'b0000000-0000-4000-8000-00000000000b', C = 'c0000000-0000-4000-8000-00000000000c';
const P_B = 'b1000000-0000-4000-8000-000000000001', P_HIDDEN = 'b1000000-0000-4000-8000-000000000002';
const choices: BrandWorkspaceChoice[] = [
  { id: A, name: 'Alpha fixture', role: 'owner', logoUrl: null },
  { id: B, name: 'Beta fixture', role: 'studio', logoUrl: `/api/brand-workspace/organizations/${B}/logo?v=2` },
  { id: C, name: 'Empty fixture', role: 'studio', logoUrl: null },
];
const scope: BrandWorkspaceScope = { choices, projectOrganizations: { [P_B]: B, [P_HIDDEN]: B } };

const state = vi.hoisted(() => ({
  path: '/brand', query: '', scope: null as unknown as BrandWorkspaceScope, isAdmin: false,
  projects: [] as BrandProjectSummary[], brandHost: false,
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
  return { brandContext: async () => { const dict = getDictionary('ko'); return { viewer: { userId: '00000000-0000-4000-8000-000000000001', isAdmin: state.isAdmin }, sql: {}, verifiedEmail: undefined, brandHost: state.brandHost, locale: 'ko', dict, b: dict.brandWorkspace }; } };
});
vi.mock('@/lib/brands/workspace/service', () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandWorkspaceScope: async () => state.scope,
  loadBrandWorkspace: async (_d: unknown, _v: unknown, options: { organizationId?: string } = {}): Promise<BrandWorkspace> => ({
    organizations: [], projects: state.projects.filter((p) => p.organizationId === options.organizationId),
  }),
  loadBrandMembers: async (_d: unknown, _v: unknown, id: string) => ({ organization: { id, name: 'Beta fixture' },
    members: [{ id: 'm1', userId: 'u1', email: 'member@example.test', role: 'editor', status: 'active', isSelf: false }], invitations: [] }),
  loadBrandSettings: async (_d: unknown, _v: unknown, id: string) => ({ id, name: 'Beta fixture', website: '', description: '', contactEmail: '', revision: 0, role: 'studio', logoUrl: null, logoRevision: 0 }),
}));

import { WorkspaceIdentity } from '@/components/brand-workspace/identity';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { WorkspaceSupport } from '@/components/brand-workspace/context-links';
import { ProjectDetail } from '@/components/brand-workspace/project-detail';
import BrandHome from '@/app/(brand)/brand/page';
import MembersPage from '@/app/(brand)/brand/members/page';
import BrandSettings from '@/app/(brand)/brand/settings/page';
import NewBrandProject from '@/app/(brand)/brand/projects/new/page';
import { getDictionary } from '@/lib/i18n/dictionaries';

const b = getDictionary('ko').brandWorkspace;
const en = getDictionary('en').brandWorkspace;
const html = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);
const search = (organizationId?: string) => ({ searchParams: Promise.resolve(organizationId ? { organizationId } : {}) });
const identity = (copy = b) => renderToStaticMarkup(<WorkspaceIdentity scope={state.scope} copy={copy.identity} roles={copy.roles} />);
const summary = (id: string, title: string, clientVisible: boolean): BrandProjectSummary => ({
  id, organizationId: B, organizationName: 'Beta fixture', title, objective: 'Fixture', audience: '', budgetKrw: null, budgetTaxBasis: 'unspecified', clientVisible,
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: null, endsOn: null, productionMode: 'creator', status: 'active', revision: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01',
});

beforeEach(() => {
  state.path = '/brand'; state.query = ''; state.scope = scope; state.isAdmin = false;
  state.brandHost = false;
  state.projects = [summary(P_B, 'Shared campaign', true), summary(P_HIDDEN, 'Unshared campaign', false)];
});

describe('logo switcher in the TWINGS team view', () => {
  it('labels a browsed brand as the TWINGS team, never as a customer role', () => {
    state.query = `organizationId=${B}`;
    const page = identity();
    expect(page).toContain(`data-brand-identity="${B}"`);
    expect(page).toMatch(/<strong>Beta fixture<\/strong><small>TWINGS 운영자<\/small>/);
    expect(page).not.toMatch(/<strong>Beta fixture<\/strong><small>(관리자|편집자|열람자)/);
    expect(identity(en)).toContain('<small>TWINGS team</small>');
    // The customer membership keeps its own role.
    expect(page).toMatch(new RegExp(`<strong>Alpha fixture</strong><small>${b.roles.owner}</small>`));
  });

  it('lists every brand, heads the team-view brands once, and switches by URL keeping the section', () => {
    state.path = '/brand/members'; state.query = `organizationId=${A}`;
    const page = identity();
    expect(page).toContain('<details');
    expect(page).toContain('<summary');
    expect(page.match(/data-brand-staff-group/g)).toHaveLength(1);
    expect(page.indexOf('data-brand-staff-group')).toBeLessThan(page.indexOf(`data-brand-choice="${B}"`));
    expect(page.indexOf('data-brand-staff-group')).toBeGreaterThan(page.indexOf(`data-brand-choice="${A}"`));
    expect(page).toContain(b.identity.staffGroup);
    for (const id of [A, B, C]) expect(page).toContain(`href="/brand/members?organizationId=${id}"`);
    expect(page).toContain(`data-brand-choice="${B}" data-brand-role="studio"`);
    expect(page).toContain(`src="/api/brand-workspace/organizations/${B}/logo?v=2"`);
    expect(switchHref('/brand/settings', choices[2]!)).toBe(`/brand/settings?organizationId=${C}`);
    expect(switchHref('/brand/studio', choices[1]!)).toBe(`/brand/studio?organizationId=${B}`);
    expect(switchHref(`/brand/projects/${P_B}`, choices[2]!)).toBe(`/brand?organizationId=${C}`);
  });

  it('a campaign page (shared or not) selects the brand that owns it', () => {
    state.path = `/brand/projects/${P_HIDDEN}`; state.query = `organizationId=${A}`;
    expect(identity()).toContain(`data-brand-identity="${B}"`);
  });

  it('keeps a long list reachable: every brand rendered in a scrolling, touch-sized menu', () => {
    state.scope = { choices: Array.from({ length: 40 }, (_, i) => ({ id: `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `Brand ${i}`, role: 'studio' as const, logoUrl: null })), projectOrganizations: {} };
    const page = identity();
    expect(page).toContain('data-brand-choices="40"');
    expect(page.match(/data-brand-choice="/g)).toHaveLength(40);
    const css = readFileSync('app/(brand)/workspace.css', 'utf8');
    expect(css).toMatch(/\.bw-identity-menu\{[^}]*max-height:[^;}]+;[^}]*overflow:auto/);
    expect(css).toMatch(/\.bw-identity-menu a\{[^}]*min-height:44px/);
  });

  it('shows every section for the team view and scopes each link to the browsed brand', () => {
    expect(sectionVisibility(choices[1]!)).toEqual({ studio: true, identity: true, settings: true, members: true });
    state.query = `organizationId=${C}`;
    const nav = renderToStaticMarkup(<WorkspaceNavigation home="Home" members="Team" settings="Settings" library="Library" studio="Studio" scope={state.scope} />);
    for (const path of ['/brand', '/brand/studio', '/brand/library', '/brand/settings', '/brand/members']) expect(nav).toContain(`href="${path}?organizationId=${C}"`);
  });

  it('does not open the customer support composer in the team view', () => {
    state.query = `organizationId=${B}`;
    expect(renderToStaticMarkup(<WorkspaceSupport scope={state.scope} b={b} locale="ko" />)).toBe('');
  });
});

describe('pages in the TWINGS team view are read-only', () => {
  it('leaves the restricted brand host for admin, while local and preview links stay local', async () => {
    state.isAdmin = true;
    state.brandHost = true;
    for (const page of [BrandHome, MembersPage, BrandSettings]) {
      expect(await html(page(search(B)))).toContain(`href="https://admin.twings.app/admin/brand-workspace/organizations/${B}"`);
    }
    state.brandHost = false;
    expect(await html(BrandHome(search(B)))).toContain(`href="/admin/brand-workspace/organizations/${B}"`);
  });
  it('home lists shared and unshared campaigns with a notice, and no setup or request form', async () => {
    const page = await html(BrandHome(search(B)));
    expect(page).toContain('data-brand-staff-view');
    expect(page).toContain(b.access.staffReadOnly);
    expect(page).toContain('Shared campaign');
    expect(page).toContain('Unshared campaign');
    expect(page).toContain('data-campaign-unshared');
    expect(page).not.toContain(b.createOrganization);
    expect(page).not.toContain('href="/brand/projects/new');
    // Only DB admins get the existing admin link.
    expect(page).not.toContain('data-brand-staff-manage');
    state.isAdmin = true;
    expect(await html(BrandHome(search(B)))).toContain(`href="/admin/brand-workspace/organizations/${B}"`);
  });

  it('an empty brand opens as an honest empty state, not a setup path', async () => {
    const page = await html(BrandHome(search(C)));
    expect(page).toContain('data-brand-empty="staff"');
    expect(page).not.toContain(b.createOrganization);
  });

  it('settings, team and new-request pages read without any write control', async () => {
    const settings = await html(BrandSettings(search(B)));
    expect(settings).toContain('data-brand-staff-view');
    expect(settings).toMatch(/<fieldset disabled=""/);
    expect(settings).not.toContain(b.identity.logoUpload);
    const team = await html(MembersPage(search(B)));
    expect(team).toContain('member@example.test');
    expect(team).not.toContain(b.createInvite);
    expect(team).not.toContain(b.revoke);
    const request = await html(NewBrandProject(search(B)));
    expect(request).toContain(b.access.staffReadOnly);
    expect(request).not.toContain('name="objective"');
  });

  it('a campaign in the team view offers no approval, upload or comment, and says so', () => {
    const project: BrandProjectDetail = {
      ...summary(P_HIDDEN, 'Unshared campaign', false), role: 'studio', canComment: false, referenceLinks: [], attachments: [], posts: [], reports: [], messages: [], decisions: [],
      contents: [{ id: 'c1', slotKey: 'hero', version: 1, title: 'Hero', attachmentId: 'f1', mediaUrl: '/api/brand-workspace/attachments/f1', caption: '', usageRights: 'Organic', reviewRevision: 0, decision: 'pending', createdAt: '2026-09-01' }],
      contracts: [{ id: 'k1', documentKey: 'main', title: 'Internal contract', version: 1, attachmentId: 'k1f', shared: false, revision: 0, createdAt: '2026-09-01' }],
    };
    const page = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale="ko" staffManageHref={`/admin/brand-workspace/${P_HIDDEN}`} />);
    expect(page).toContain('data-brand-staff-view');
    expect(page).toContain('data-project-unshared');
    expect(page).toContain(`href="/admin/brand-workspace/${P_HIDDEN}"`);
    expect(page).not.toContain(b.approveConfirm);
    expect(page).not.toContain(b.upload);
    expect(page).not.toContain(b.sendComment);
    expect(page).toContain(b.managed.private);
    // The same campaign for its owner keeps the approval form (unchanged customer rights).
    const owner = renderToStaticMarkup(<ProjectDetail project={{ ...project, role: 'owner', canComment: true }} b={b} locale="ko" />);
    expect(owner).toContain(b.approveConfirm);
    expect(owner).not.toContain('data-brand-staff-view');
  });

  it('has Korean and English copy for every new string', () => {
    for (const key of ['staffTitle', 'staffReadOnly', 'staffManage', 'staffEmpty', 'staffEmptyBody'] as const) {
      expect(b.access[key]).toBeTruthy(); expect(en.access[key]).toBeTruthy(); expect(b.access[key]).not.toBe(en.access[key]);
    }
    expect(b.identity.studio).toBe('TWINGS 운영자');
    expect(en.identity.studio).toBe('TWINGS team');
  });
});
