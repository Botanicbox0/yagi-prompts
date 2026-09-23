import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { BrandMembers, BrandOrganization, BrandProjectSummary, BrandRole, BrandWorkspace } from '@/lib/brands/workspace/types';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';

/**
 * Role-shaped workspace states (fresh, viewer, editor, owner, campaign-only invitee), rendered from
 * the real pages with the data layer stubbed. Server authorization is not under test here; these
 * pages must simply never offer a path the account cannot finish.
 */
const state = vi.hoisted(() => ({
  workspace: { organizations: [], projects: [] } as BrandWorkspace,
  members: null as BrandMembers | null,
  settings: null as Record<string, unknown> | null,
  locale: 'ko' as 'ko' | 'en',
  path: '/brand',
  query: '',
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
  return {
    brandContext: async () => {
      const dict = getDictionary(state.locale);
      return { viewer: { userId: '00000000-0000-4000-8000-000000000001' }, sql: { query: async () => ({ rows: [] }) }, locale: state.locale, dict, b: dict.brandWorkspace };
    },
  };
});
vi.mock('@/lib/brands/production/service', () => ({ loadProductionWorkspace: async () => ({ role: 'owner', contracts: [], jobs: [] }) }));
vi.mock('@/lib/identity/service', () => ({ assetLibraryMode: () => 'off', needsLiveness: () => false, identityStatusFor: async () => 'active' }));
vi.mock('@/lib/brands/workspace/service', () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandWorkspaceScope: async () => scopeOf(state.workspace),
  loadBrandWorkspace: async (_deps: unknown, _viewer: unknown, options: { organizationId?: string } = {}) => ({
    organizations: state.workspace.organizations.filter((o) => !options.organizationId || o.id === options.organizationId),
    projects: state.workspace.projects.filter((p) => !options.organizationId || p.organizationId === options.organizationId),
  }),
  loadBrandMembers: async () => state.members,
  loadBrandSettings: async () => state.settings,
}));

import BrandHome from '@/app/(brand)/brand/page';
import NewBrandProject from '@/app/(brand)/brand/projects/new/page';
import MembersPage from '@/app/(brand)/brand/members/page';
import BrandSettings from '@/app/(brand)/brand/settings/page';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { SupportDrawer } from '@/components/brand-workspace/support';
import BrandStudio from '@/app/(brand)/brand/studio/page';
import { StudioInquiry } from '@/components/brand-workspace/studio-inquiry';
import { DecisionFields } from '@/components/brand-workspace/decision-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';

const b = getDictionary('ko').brandWorkspace;
const org = (role: BrandRole, id = `org-${role}`): BrandOrganization => ({ id, name: `Brand ${role}`, role });
const project: BrandProjectSummary = {
  id: 'p1', organizationId: 'org-shared', organizationName: 'Shared brand', title: 'Autumn launch', objective: 'Launch', audience: '',
  budgetKrw: null, budgetTaxBasis: 'unspecified', criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: null, endsOn: null, productionMode: 'creator', status: 'active', revision: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01',
};
const CASES: Record<string, BrandWorkspace> = {
  fresh: { organizations: [], projects: [] },
  viewer: { organizations: [org('viewer')], projects: [] },
  editor: { organizations: [org('editor')], projects: [] },
  owner: { organizations: [org('owner')], projects: [] },
  projectScoped: { organizations: [], projects: [project] },
};
/** The same shape the real scope loader returns: memberships, then brands reached only via shared campaigns. */
function scopeOf(w: BrandWorkspace): BrandWorkspaceScope {
  const choices: BrandWorkspaceScope['choices'] = w.organizations.map((o) => ({ ...o, logoUrl: null }));
  for (const p of w.projects) if (!choices.some((c) => c.id === p.organizationId)) choices.push({ id: p.organizationId, name: p.organizationName, role: 'guest', logoUrl: null });
  return { choices, projectOrganizations: Object.fromEntries(w.projects.map((p) => [p.id, p.organizationId])) };
}
const html = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);
const search = (organizationId?: string) => ({ searchParams: Promise.resolve(organizationId ? { organizationId } : {}) });
const CREATE_LINK = 'href="/brand/projects/new';

beforeEach(() => { state.members = null; state.settings = null; state.locale = 'ko'; state.path = '/brand'; state.query = ''; });

describe('brand home by role', () => {
  it('keeps the workspace-creation path for a fresh account', async () => {
    state.workspace = CASES.fresh!;
    const page = await html(BrandHome(search()));
    expect(page).toContain(b.createOrganization);
    expect(page).toContain(b.needOrganization);
  });

  it('never sends a viewer-only account into the request loop', async () => {
    state.workspace = CASES.viewer!;
    const page = await html(BrandHome(search()));
    expect(page).not.toContain(CREATE_LINK);
    expect(page).not.toContain(b.createOrganization);
    expect(page).toContain(b.access.viewerEmpty);
    expect(page).toContain('data-brand-empty="read-only"');
    // Their workspace is still listed; read-only context is not hidden.
    expect(page).toContain('Brand viewer');
  });

  it.each(['editor', 'owner'] as const)('offers the first brief to an %s', async (role) => {
    state.workspace = CASES[role]!;
    const page = await html(BrandHome(search()));
    expect(page).toContain(CREATE_LINK);
    expect(page).toContain('data-brand-empty="request"');
  });

  it('shows campaign-only invitees their campaigns, without an empty workspace section or creation', async () => {
    state.workspace = CASES.projectScoped!;
    const page = await html(BrandHome(search()));
    expect(page).toContain('Autumn launch');
    expect(page).not.toContain(CREATE_LINK);
    expect(page).not.toContain(b.organizations);
    expect(page).not.toContain('href="/brand/studio');
  });
});

describe('new brief page by role', () => {
  it('lets an account without a workspace create one in place and return here', async () => {
    for (const key of ['fresh', 'projectScoped'] as const) {
      state.workspace = CASES[key]!;
      const page = await html(NewBrandProject(search()));
      expect(page).toContain('data-brand-new-project-setup');
      expect(page).toContain('name="name"');
      // No bounce back to /brand, which offers no creation form once campaigns exist.
      expect(page).not.toContain(`href="/brand" class="bw-button">${b.createOrganization}`);
    }
  });

  it('tells a viewer who can request, and offers no creation form', async () => {
    state.workspace = CASES.viewer!;
    const page = await html(NewBrandProject(search()));
    expect(page).toContain(b.access.viewerCannotRequest);
    expect(page).not.toContain('name="organizationId"');
    expect(page).not.toContain('name="name"');
  });

  it('keeps the brief form for editors and owners', async () => {
    for (const key of ['editor', 'owner'] as const) {
      state.workspace = CASES[key]!;
      const page = await html(NewBrandProject(search()));
      expect(page).toContain('name="organizationId"');
      expect(page).toContain('name="referenceUrl"');
    }
  });
});

describe('workspace navigation', () => {
  const labels = { home: 'Home', members: 'Team', settings: 'Settings', library: 'Library', studio: 'Studio' };
  const links = (key: keyof typeof CASES) =>
    renderToStaticMarkup(<WorkspaceNavigation {...labels} scope={scopeOf(CASES[key]!)} />);

  it('shows team management only to owners', () => {
    expect(links('owner')).toContain('href="/brand/members');
    for (const key of ['editor', 'viewer', 'projectScoped', 'fresh'] as const) expect(links(key)).not.toContain('href="/brand/members');
  });

  it('keeps read-only destinations for members and hides workspace-only ones from campaign-only invitees', () => {
    expect(links('viewer')).toContain('href="/brand/settings');
    expect(links('viewer')).toContain('href="/brand/studio');
    expect(links('projectScoped')).not.toContain('href="/brand/settings');
    expect(links('projectScoped')).not.toContain('href="/brand/studio');
    expect(links('projectScoped')).toContain('href="/brand/library');
    expect(links('fresh')).toContain('href="/brand/studio');
  });

  it('shows everything while access is unknown (signed-out invitation landing)', () => {
    const page = renderToStaticMarkup(<WorkspaceNavigation {...labels} />);
    for (const href of ['/brand', '/brand/studio', '/brand/library', '/brand/settings', '/brand/members']) expect(page).toContain(`href="${href}"`);
  });
});

describe('direct visits to owner-only pages', () => {
  it('explains team management to non-owners without an error alert', async () => {
    for (const key of ['editor', 'viewer'] as const) {
      state.workspace = CASES[key]!;
      const page = await html(MembersPage(search()));
      expect(page).toContain(b.access.ownerOnlyTeam);
      expect(page).not.toContain('role="alert"');
    }
    state.workspace = CASES.projectScoped!;
    expect(await html(MembersPage(search()))).toContain(b.access.sharedOnly);
  });

  it('still manages the team for owners', async () => {
    state.workspace = CASES.owner!;
    state.members = { organization: { id: 'org-owner', name: 'Brand owner' }, members: [
      { id: 'm', userId: 'u2', email: 'editor@example.com', role: 'editor', status: 'active', isSelf: false },
    ], invitations: [] };
    const page = await html(MembersPage(search()));
    expect(page).toContain('editor@example.com');
    expect(page).toContain(b.revoke);
    expect(page).toContain(b.createInvite);
  });

  it('shows brand settings read-only to non-owners and says why', async () => {
    state.workspace = CASES.editor!;
    state.settings = { id: 'org-editor', name: 'Brand editor', website: '', description: '', contactEmail: '', revision: 1, role: 'editor' };
    const page = await html(BrandSettings(search()));
    expect(page).toContain('data-brand-settings-read-only');
    expect(page).toContain(b.access.ownerOnlySettings);
    expect(page).toContain('Brand editor');
  });

  it('gives campaign-only invitees a neutral settings note', async () => {
    state.workspace = CASES.projectScoped!;
    const page = await html(BrandSettings(search()));
    expect(page).toContain(b.access.sharedOnly);
    expect(page).not.toContain('role="alert"');
  });
});

describe('self-serve studio by role (direct visits, not just navigation)', () => {
  const t = b.productionStudio;
  const studio = async (key: keyof typeof CASES) => { state.workspace = CASES[key]!; return html(BrandStudio(search())); };

  it('gives campaign-only invitees an honest note: no request button, onboarding or workspace creation', async () => {
    const page = await studio('projectScoped');
    expect(page).toContain(b.access.studioSharedOnly);
    expect(page).not.toContain('data-studio-inquiry');
    expect(page).not.toContain(b.studioInquiry.action);
    expect(page).not.toContain('name="name"');
    expect(page).not.toContain(t.emptyHint);
  });

  it('tells a viewer who can request, without a request button that cannot send', async () => {
    const page = await studio('viewer');
    expect(page).toContain('data-brand-studio-read-only');
    expect(page).toContain(b.access.studioViewer);
    expect(page).not.toContain('data-studio-inquiry');
    expect(page).not.toContain(t.emptyHint);
    expect(page).not.toContain('name="name"');
  });

  it('keeps workspace creation for a brand-new account', async () => {
    const page = await studio('fresh');
    expect(page).toContain('data-studio-inquiry');
    expect(page).toContain('name="name"');
    expect(page).toContain(t.emptyHint);
  });

  it.each(['editor', 'owner'] as const)('keeps the template request for an %s', async (role) => {
    const page = await studio(role);
    expect(page).toContain('data-studio-inquiry');
    expect(page).toContain('name="brief"');
    expect(page).not.toContain('name="name"');
  });

  it('StudioInquiry itself never offers creation unless explicitly allowed', () => {
    expect(renderToStaticMarkup(<StudioInquiry organizations={[]} b={b} />)).toBe('');
    expect(renderToStaticMarkup(<StudioInquiry organizations={[org('viewer')]} b={b} allowSetup />)).toBe('');
    expect(renderToStaticMarkup(<StudioInquiry organizations={[]} b={b} allowSetup />)).toContain('name="name"');
  });
});

describe('support drawer states', () => {
  it('is named and does not claim an empty history before anything has loaded', () => {
    const page = renderToStaticMarkup(<SupportDrawer organizations={[org('owner')]} b={b} locale="ko" />);
    expect(page).toMatch(/<dialog[^>]*aria-labelledby="([^"]+)"/);
    const id = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(page)![1];
    expect(page).toContain(`id="${id}"`);
    expect(page).toContain('data-support-state="idle"');
    expect(page).not.toContain(b.managed.supportEmpty);
  });
});

describe('change request reason', () => {
  it('is optional for approval and required, with a reason hint, for a change request', () => {
    const approve = renderToStaticMarkup(<DecisionFields b={b} />);
    expect(approve).not.toMatch(/<textarea[^>]*required/);
    expect(approve).toContain(b.decisionForm.commentOptional);
    const changes = renderToStaticMarkup(<DecisionFields b={b} initial="changes_requested" />);
    expect(changes).toMatch(/<textarea[^>]*required/);
    expect(changes).toContain(b.decisionForm.changesReasonHint);
    expect(changes).toMatch(/<textarea[^>]*aria-describedby="[^"]+"/);
  });
});
