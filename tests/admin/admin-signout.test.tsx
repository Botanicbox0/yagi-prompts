import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import type { Viewer } from '@/lib/auth/identity';

/**
 * P1-6: admin.twings.app had no sign-out, and a signed-in non-admin was stuck on a bare 404.
 * The layout, the no-access route handler and the shell are exercised directly; only the session,
 * the host header and the fonts module are injected.
 */
const state = vi.hoisted(() => ({
  admin: false,
  viewer: null as unknown,
  surface: { admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' as string | null },
  locale: 'ko' as 'ko' | 'en',
}));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => {
    if (!state.admin) throw new Error('forbidden: admin only');
    return state.viewer;
  },
  getViewer: async () => state.viewer,
}));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => state.surface,
  publicHref: (path: string, admin: boolean) => (admin ? `https://twings.app${path}` : path),
}));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => state.locale }));
vi.mock('@/app/fonts', () => ({ fontVariables: '' }));

import AdminRootLayout from '@/app/(admin)/layout';
import { GET as noAccess } from '@/app/(admin)/admin/no-access/route';
import { AdminShell } from '@/components/admin/chrome';
import { getDictionary } from '@/lib/i18n/dictionaries';

/** The shell holds async server components (PublicLink), so render the way the server does. */
async function html(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}
const signedIn = (isAdmin: boolean): Viewer => ({ tier: isAdmin ? 'admin' : 'free', userId: 'f0000000-0000-4000-8000-000000000001', email: 'someone@example.test', isAdmin, locale: 'ko' });
const anon: Viewer = { tier: 'anon', userId: null, email: null, isAdmin: false, locale: null };
const digest = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
    return 'rendered';
  } catch (error) {
    return String((error as { digest?: string }).digest ?? error);
  }
};

beforeEach(() => {
  state.admin = false;
  state.viewer = null;
  state.surface = { admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' };
  state.locale = 'ko';
});

describe('AdminShell', () => {
  it.each(['home', 'brandWorkspace'] as const)('carries a same-origin sign-out form (%s shell)', async (active) => {
    const markup = await html(<AdminShell dict={getDictionary('ko').admin} locale="ko" active={active}><p>body</p></AdminShell>);
    const form = markup.match(/<form[^>]*data-admin-signout[^>]*>/)?.[0] ?? '';
    expect(form).toContain('action="/auth/signout"');
    expect(form).toContain('method="post"');
    expect(markup).toContain('로그아웃');
  });
});

describe('admin root layout', () => {
  it('renders for an admin', async () => {
    state.admin = true;
    state.viewer = signedIn(true);
    expect(await digest(() => AdminRootLayout({ children: <p>x</p> }))).toBe('rendered');
  });

  it('sends a signed-in non-admin on the admin host to /admin/no-access (a 307, like every render-time redirect)', async () => {
    state.viewer = signedIn(false);
    expect(await digest(() => AdminRootLayout({ children: <p>x</p> }))).toMatch(/^NEXT_REDIRECT;replace;\/admin\/no-access;307;/);
  });

  it('keeps the 404 on the consumer host and for anonymous visitors', async () => {
    state.viewer = signedIn(false);
    state.surface = { admin: false, brand: false, workspace: false, origin: 'https://twings.app' };
    expect(await digest(() => AdminRootLayout({ children: <p>x</p> }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    state.surface = { admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' };
    state.viewer = anon;
    expect(await digest(() => AdminRootLayout({ children: <p>x</p> }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});

describe('GET /admin/no-access', () => {
  it('answers a signed-in non-admin on the admin host with 403 and a sign-out form, nothing else', async () => {
    state.viewer = signedIn(false);
    const response = await noAccess();
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const html = await response.text();
    expect(html).toContain('<html lang="ko" data-admin-no-access>');
    expect(html).toContain(getDictionary('ko').admin.noAccessTitle);
    expect(html).toContain('<form method="post" action="/auth/signout">');
    // No admin navigation or data on the page.
    expect(html).not.toContain('/admin/campaigns');
    expect(html).not.toContain('/admin/brand-workspace');
  });

  it('speaks English when the request locale is English', async () => {
    state.viewer = signedIn(false);
    state.locale = 'en';
    const html = await (await noAccess()).text();
    expect(html).toContain(getDictionary('en').admin.noAccessTitle);
    expect(html).toContain('Sign out');
  });

  it('is a 404 on the consumer host and for anonymous visitors; an admin goes back to the dashboard', async () => {
    state.viewer = signedIn(false);
    state.surface = { admin: false, brand: false, workspace: false, origin: 'https://twings.app' };
    expect((await noAccess()).status).toBe(404);
    state.surface = { admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' };
    state.viewer = anon;
    expect((await noAccess()).status).toBe(404);
    state.viewer = signedIn(true);
    const response = await noAccess();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://admin.twings.app/admin');
  });
});
