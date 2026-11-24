import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';

/**
 * The brand layout around the invitation landing (`/brand/invite`, the one brand page the middleware
 * serves without a session) and around an account with no brand yet. Signed out, the landing's own
 * sign-in is the one action: no tabs, no invite shortcut, no sign-out. Signed in, the bar is as before,
 * except that an account with no brand at all gets no tabs. Real layout and pages; session, database
 * handle, locale and fonts are injected. Fixture names only.
 */
const ctx = vi.hoisted(() => ({
  viewer: { userId: null as string | null, isAdmin: false, tier: 'free', email: null as string | null, locale: 'ko' },
  scope: { choices: [], projectOrganizations: {} } as BrandWorkspaceScope,
  pending: 0,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/invite',
  useSearchParams: () => new URLSearchParams(''),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/app/fonts', () => ({ fontVariables: '' }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'ko' }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ctx.viewer }));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => undefined }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({ query: async () => ({ rows: [] }) }) }));
vi.mock('@/lib/brands/workspace/service', () => ({
  loadBrandWorkspaceScope: async () => ctx.scope,
  countPendingSharedCampaigns: async () => ctx.pending,
}));

import BrandLayout from '@/app/(brand)/layout';
import InvitationPage from '@/app/(brand)/brand/invite/page';
import { getDictionary } from '@/lib/i18n/dictionaries';

const b = getDictionary('ko').brandWorkspace;
const SIGN_OUT = 'action="/auth/signout"';
async function render() {
  return renderToStaticMarkup(await BrandLayout({ children: await InvitationPage() }));
}

beforeEach(() => {
  ctx.viewer = { userId: null, isAdmin: false, tier: 'free', email: null, locale: 'ko' };
  ctx.scope = { choices: [], projectOrganizations: {} };
  ctx.pending = 0;
});

describe('the invitation landing, signed out', () => {
  it('shows no navigation and no sign-out', async () => {
    const page = await render();
    expect(page).toContain('data-brand-invitation');
    expect(page).not.toContain('data-nav-item');
    expect(page).not.toContain('data-nav-invite-cta');
    expect(page).not.toContain(SIGN_OUT);
    expect(page).not.toContain(b.signOut);
    // The bar keeps its frame, the lockup and the language switch.
    expect(page).toContain('data-brand-layout-mode="topbar"');
    expect(page).toContain('class="bw-lockup"');
  });
});

describe('signed in', () => {
  const signedIn = () => { ctx.viewer = { userId: '00000000-0000-4000-8000-000000000001', isAdmin: false, tier: 'free', email: 'member@example.test', locale: 'ko' }; };

  it('keeps the tabs and sign-out of a brand member', async () => {
    signedIn();
    ctx.scope = { choices: [{ id: 'a0000000-0000-4000-8000-00000000000a', name: 'Fixture brand', role: 'owner', logoUrl: null }], projectOrganizations: {} };
    const page = await render();
    expect(page).toContain('data-nav-item="/brand"');
    expect(page).toContain('data-nav-item="/brand/members');
    expect(page).toContain(SIGN_OUT);
  });

  it('gives an account with no brand the lockup, the "no brand yet" line, language and sign-out, but no tabs', async () => {
    signedIn();
    const page = await render();
    expect(page).not.toContain('data-nav-item');
    expect(page).toContain(b.identity.none);
    expect(page).toContain(SIGN_OUT);
    expect(page).toContain('class="bw-lockup"');
    expect(page).toContain('data-brand-layout-mode="topbar"');
  });

  it('keeps the tabs while an accepted campaign waits to be shared', async () => {
    signedIn();
    ctx.pending = 1;
    const page = await render();
    expect(page).toContain('data-nav-item="/brand"');
    expect(page).toContain(SIGN_OUT);
  });
});
