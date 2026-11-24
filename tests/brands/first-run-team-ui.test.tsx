import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { BrandMembers, BrandOrganization, BrandRole, BrandWorkspace } from '@/lib/brands/workspace/types';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';

/**
 * The brand side's first run, found on the real screen on 2026-11-24: the team page (copy the new link,
 * cancel a pending invitation, the expiry sentence once), the bar of an account with no brand yet, the
 * order of the no-workspace home, and the invitation landing's refusal colour. Real pages and components,
 * data layer stubbed. Fixture names only.
 */
const state = vi.hoisted(() => ({
  workspace: { organizations: [], projects: [] } as BrandWorkspace,
  extra: [] as BrandWorkspaceChoice[],
  members: null as BrandMembers | null,
  pending: 0,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand',
  useSearchParams: () => new URLSearchParams(''),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      return { viewer: { userId: '00000000-0000-4000-8000-000000000001', isAdmin: false }, sql: { query: async () => ({ rows: [] }) }, locale: 'ko', dict, b: dict.brandWorkspace, brandHost: false };
    },
  };
});
vi.mock('@/lib/brands/workspace/service', () => ({
  countPendingSharedCampaigns: async () => state.pending,
  loadBrandWorkspaceScope: async () => scopeOf(state.workspace),
  loadBrandWorkspace: async (_deps: unknown, _viewer: unknown, options: { organizationId?: string } = {}) => ({
    organizations: state.workspace.organizations.filter((o) => !options.organizationId || o.id === options.organizationId),
    projects: state.workspace.projects.filter((p) => !options.organizationId || p.organizationId === options.organizationId),
  }),
  loadBrandMembers: async () => state.members,
}));

import BrandHome from '@/app/(brand)/brand/page';
import MembersPage from '@/app/(brand)/brand/members/page';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { InviteLink, copyInviteLink } from '@/components/brand-workspace/invite-link';
import { getDictionary } from '@/lib/i18n/dictionaries';

const b = getDictionary('ko').brandWorkspace;
const org = (role: BrandRole, id = `org-${role}`): BrandOrganization => ({ id, name: `Brand ${role}`, role });
function scopeOf(w: BrandWorkspace): BrandWorkspaceScope {
  const choices: BrandWorkspaceScope['choices'] = w.organizations.map((o) => ({ ...o, logoUrl: null }));
  return { choices: [...choices, ...state.extra], projectOrganizations: {} };
}
const html = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);
const search = () => ({ searchParams: Promise.resolve({}) });
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const TEAM: BrandMembers = {
  organization: { id: 'org-owner', name: 'Brand owner' },
  members: [{ id: 'm1', userId: 'u2', email: 'editor@example.test', role: 'editor', status: 'active', isSelf: false }],
  invitations: [
    { id: 'i-pending', email: 'pending@example.test', role: 'editor', expiresAt: '2099-01-01T00:00:00.000Z', issuedByStudio: false, status: 'pending', project: null },
    { id: 'i-studio', email: null, role: 'owner', expiresAt: '2099-01-01T00:00:00.000Z', issuedByStudio: true, status: 'pending', project: null },
    { id: 'i-campaign', email: 'guest@example.test', role: 'viewer', expiresAt: '2099-01-01T00:00:00.000Z', issuedByStudio: false, status: 'pending', project: { shared: true, title: 'Fixture campaign' } },
    { id: 'i-accepted', email: 'accepted@example.test', role: 'viewer', expiresAt: '2099-01-01T00:00:00.000Z', issuedByStudio: false, status: 'accepted', project: null },
    { id: 'i-revoked', email: 'revoked@example.test', role: 'viewer', expiresAt: '2099-01-01T00:00:00.000Z', issuedByStudio: false, status: 'revoked', project: null },
    { id: 'i-expired', email: 'expired@example.test', role: 'viewer', expiresAt: '2020-01-01T00:00:00.000Z', issuedByStudio: false, status: 'expired', project: null },
  ],
};

beforeEach(() => {
  state.workspace = { organizations: [], projects: [] };
  state.extra = [];
  state.members = null;
  state.pending = 0;
});

describe('team page', () => {
  it('offers the owner a quiet cancel on pending workspace invitations only', async () => {
    state.workspace = { organizations: [org('owner')], projects: [] };
    state.members = TEAM;
    const page = await html(MembersPage(search()));
    expect(count(page, 'data-invitation-cancel=')).toBe(1);
    expect(page).toContain('data-invitation-cancel="i-pending"');
    // The control reuses the confirm copy that is true for an invitation, and is a neutral button.
    const control = page.slice(page.indexOf('data-invitation-cancel="i-pending"'));
    const form = control.slice(0, control.indexOf('</form>'));
    expect(form).toContain(`>${b.confirm.revokeInviteAction}</button>`);
    expect(form).toContain('class="bw-button"');
    expect(form).not.toContain('bw-primary');
    expect(form).not.toContain('bw-danger');
    expect(form).not.toContain(b.revoke);
  });

  it.each(['editor', 'viewer'] as const)('gives an %s no cancel control', async (role) => {
    state.workspace = { organizations: [org(role)], projects: [] };
    state.members = TEAM;
    const page = await html(MembersPage(search()));
    expect(page).not.toContain('data-invitation-cancel');
    expect(page).toContain(b.access.ownerOnlyTeam);
  });

  it('gives the TWINGS team view no cancel control', async () => {
    state.extra = [{ id: 'org-owner', name: 'Brand owner', role: 'studio', logoUrl: null }];
    state.members = TEAM;
    const page = await html(MembersPage(search()));
    expect(page).toContain(b.invitationStates.pending);
    expect(page).not.toContain('data-invitation-cancel');
  });

  it('says once that the link expires after 7 days', async () => {
    state.workspace = { organizations: [org('owner')], projects: [] };
    state.members = TEAM;
    const page = await html(MembersPage(search()));
    expect(count(page, b.inviteExpiry)).toBe(1);
    // Next to the composer, where the link is made.
    const composer = page.slice(page.indexOf('data-sota-invite-composer'));
    expect(composer.indexOf(b.inviteExpiry)).toBeGreaterThan(-1);
    expect(composer.indexOf(b.inviteExpiry)).toBeLessThan(composer.indexOf('</form>'));
  });

  it('shows the new link with a copy button beside it, and no second expiry sentence', () => {
    const url = 'https://brand.example.test/brand/invite#token=fixture';
    const note = renderToStaticMarkup(<InviteLink url={url} b={b} />);
    expect(note).toContain(b.inviteReady);
    expect(note).toContain(`value="${url}"`);
    expect(note).toMatch(new RegExp(`<button type="button"[^>]*class="bw-button"[^>]*data-invite-copy[^>]*>${b.copy}</button>`));
    expect(note).not.toContain(b.inviteExpiry);
    // The field keeps its visible name.
    expect(note).toContain(b.inviteToken);
  });
});

describe('copying the invitation link', () => {
  const field = () => ({ focus: vi.fn(), select: vi.fn() });

  it('uses the clipboard when it can', async () => {
    const f = field();
    const write = vi.fn().mockResolvedValue(undefined);
    expect(await copyInviteLink('link', f, { clipboard: { writeText: write }, exec: vi.fn() })).toBe(true);
    expect(write).toHaveBeenCalledWith('link');
    expect(f.select).not.toHaveBeenCalled();
  });

  it('selects the link for copying by hand when the clipboard is refused', async () => {
    const f = field();
    const exec = vi.fn().mockReturnValue(false);
    expect(await copyInviteLink('link', f, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, exec })).toBe(false);
    expect(f.focus).toHaveBeenCalled();
    expect(f.select).toHaveBeenCalled();
    expect(await copyInviteLink('link', field(), { clipboard: undefined, exec: vi.fn().mockReturnValue(true) })).toBe(true);
  });
});

describe('the bar of an account with no brand yet', () => {
  const labels = { home: b.home, members: b.members, settings: b.managed.settings, library: b.managed.library, studio: '' };

  it('draws no tabs, but keeps the bar layout', () => {
    const nav = renderToStaticMarkup(<WorkspaceNavigation {...labels} scope={{ choices: [], projectOrganizations: {} }} />);
    expect(nav).not.toContain('data-nav-item');
    expect(nav).not.toContain('data-nav-order-toggle');
    expect(nav).not.toContain('data-nav-invite-cta');
    expect(nav).toContain('data-brand-layout-mode="topbar"');
  });

  it('keeps today\'s tabs while a campaign the account accepted waits to be shared', () => {
    const nav = renderToStaticMarkup(<WorkspaceNavigation {...labels} scope={{ choices: [], projectOrganizations: {} }} pendingShare />);
    expect(nav).toContain('data-nav-item="/brand"');
    expect(nav).toContain('data-nav-item="/brand/library"');
  });

  it('keeps the tabs of owners and of the TWINGS team view', () => {
    const owner = renderToStaticMarkup(<WorkspaceNavigation {...labels} studio="Studio" scope={{ choices: [{ ...org('owner'), logoUrl: null }], projectOrganizations: {} }} />);
    expect(owner).toContain('data-nav-item="/brand/members"');
    expect(owner).toContain('data-nav-item="/brand/studio"');
    const staff = renderToStaticMarkup(<WorkspaceNavigation {...labels} studio="Studio" scope={{ choices: [{ id: 'org-x', name: 'Brand x', role: 'studio', logoUrl: null }], projectOrganizations: {} }} />);
    expect(staff).toContain('data-nav-item="/brand"');
  });

  it('draws no tabs for a signed-out visitor', () => {
    const nav = renderToStaticMarkup(<WorkspaceNavigation {...labels} studio="Studio" scope={null} />);
    expect(nav).not.toContain('data-nav-item');
    expect(nav).not.toContain('href=');
  });
});

describe('the home of an account with no workspace', () => {
  it('puts the workspace creation first and the service guide after it', async () => {
    const page = await html(BrandHome(search()));
    const create = page.indexOf(b.needOrganization);
    const guide = page.indexOf('data-brand-service=');
    expect(create).toBeGreaterThan(-1);
    expect(guide).toBeGreaterThan(-1);
    expect(create).toBeLessThan(guide);
    expect(page.indexOf('name="name"')).toBeLessThan(guide);
  });

  it('keeps today\'s order for an account waiting on a shared campaign', async () => {
    state.pending = 1;
    const page = await html(BrandHome(search()));
    expect(page).not.toContain(b.createOrganization);
    expect(page.indexOf('data-brand-service=')).toBeLessThan(page.indexOf('data-brand-pending-share'));
  });

  it('leaves an owner\'s home as it was', async () => {
    state.workspace = { organizations: [org('owner')], projects: [] };
    const page = await html(BrandHome(search()));
    expect(page).not.toContain(b.needOrganization);
    expect(page).toContain('data-brand-service-disclosure');
  });
});

describe('the invitation landing never draws a refusal in red', () => {
  const css = readFileSync(path.join(process.cwd(), 'app/(brand)/workspace.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('paints its error line in the neutral ink', () => {
    const rule = /\.bw-sota-invite-landing \.bw-error\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(rule, 'the landing has its own error colour').toBeTruthy();
    const color = /(?:^|;)\s*color\s*:\s*([^;]+);/.exec(rule!)?.[1]?.trim();
    expect(color).toBe('var(--ys-ink)');
  });
});
