import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const handlers = vi.hoisted(() => ({ requireAdmin: vi.fn(), dispatchAdmin: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: handlers.requireAdmin }));
vi.mock('@/lib/admin/dispatch', () => ({ dispatchAdmin: handlers.dispatchAdmin, outcomeUrl: () => '/admin/prompts?ok=updated' }));
vi.mock('@/lib/cache', () => ({ revalidateCampaigns: vi.fn(), revalidateCatalog: vi.fn(), revalidateContests: vi.fn(), revalidateLandingMedia: vi.fn(), revalidatePrompts: vi.fn() }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/storage', () => ({ getStorage: async () => ({}) }));
vi.mock('@/lib/notify/service', () => ({ getMailer: () => ({}) }));
import { POST } from '@/app/(admin)/admin/do/route';

describe('admin mutation returns to the validated request host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.requireAdmin.mockResolvedValue({ isAdmin: true, id: 'admin' });
    handlers.dispatchAdmin.mockResolvedValue({ ok: true, code: 'updated' });
  });
  const post = (host: string) => {
    const body = new FormData(); body.set('op', 'caches.refresh');
    return new NextRequest('http://localhost:3001/admin/do', { method: 'POST', body, headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' } });
  };
  it('retains the admin alias after a successful POST instead of returning to localhost', async () => {
    const response = await POST(post('admin.twings.app'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://admin.twings.app/admin/prompts?ok=updated');
    expect(handlers.dispatchAdmin).toHaveBeenCalledOnce();
  });
  it('preserves consumer localhost compatibility', async () => {
    const response = await POST(post('localhost:3001'));
    expect(response.headers.get('location')).toBe('http://localhost:3001/admin/prompts?ok=updated');
  });
  it('still runs requireAdmin before any dispatch and refuses unrecognized hosts', async () => {
    handlers.requireAdmin.mockRejectedValue(new Error('forbidden'));
    expect((await POST(post('admin.twings.app'))).status).toBe(404);
    expect(handlers.dispatchAdmin).not.toHaveBeenCalled();
    handlers.requireAdmin.mockResolvedValue({ isAdmin: true });
    expect((await POST(post('evil.example'))).status).toBe(404);
    expect(handlers.dispatchAdmin).not.toHaveBeenCalled();
  });

  const enhanced = (site = 'same-origin') => {
    const body = new FormData();
    body.set('_op', 'prompt.create');
    body.set('_back', '/admin/prompts/new');
    return new NextRequest('https://admin.twings.app/admin/do', { method: 'POST', body,
      headers: { host: 'admin.twings.app', 'sec-fetch-site': site, accept: 'application/vnd.twings.admin-form+json' },
    });
  };

  it('returns validation feedback without redirecting the filled template form', async () => {
    handlers.dispatchAdmin.mockResolvedValue({ ok: false, code: 'invalid', detail: 'poster: required' });
    const response = await POST(enhanced());
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: false, code: 'invalid', field: 'poster' });
  });

  it('returns a guarded completion URL after a successful enhanced submission', async () => {
    const response = await POST(enhanced());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, to: '/admin/prompts?ok=updated' });
    expect(handlers.dispatchAdmin).toHaveBeenCalledOnce();
  });

  it('keeps auth and CSRF checks ahead of the enhanced response path', async () => {
    expect((await POST(enhanced('cross-site'))).status).toBe(404);
    handlers.requireAdmin.mockRejectedValue(new Error('forbidden'));
    expect((await POST(enhanced())).status).toBe(404);
    expect(handlers.dispatchAdmin).not.toHaveBeenCalled();
  });

  it('does not return raw database messages through enhanced validation feedback', async () => {
    handlers.dispatchAdmin.mockResolvedValue({ ok: false, code: 'unknown', detail: 'internal db diagnostic' });
    expect(await (await POST(enhanced())).json()).toEqual({ ok: false, code: 'unknown' });
  });
});
