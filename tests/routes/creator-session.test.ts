import { beforeEach, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ user: null as { id: string; user_metadata?: Record<string, unknown> } | null, query: vi.fn() }));
vi.mock('@/lib/supabase/auth-client', () => ({ getSessionUser: async () => context.user }));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({ query: context.query }) }));
import { GET } from '@/app/api/account/session/route';

const request = (host = 'twings.app') => new Request(`https://${host}/api/account/session`);

describe('creator navigation session projection', () => {
  beforeEach(() => { context.user = null; context.query.mockReset(); });
  it('returns an anonymous answer without reading the database', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedIn: false });
    expect(context.query).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
  it('returns only the display name of the server-verified account', async () => {
    context.user = { id: 'verified-user', user_metadata: { full_name: 'Google name' } };
    context.query.mockResolvedValue({ rows: [{ display_name: '활동 이름', sns_url: 'https://instagram.com/private-profile' }] });
    const response = await GET(request());
    expect(await response.json()).toEqual({ signedIn: true, displayName: '활동 이름' });
    expect(context.query.mock.calls[0]?.[1]).toEqual(['verified-user']);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('keeps valid sign-in visible even if the profile store is unavailable', async () => {
    context.user = { id: 'verified-user', user_metadata: { full_name: 'Google name' } };
    context.query.mockRejectedValue(new Error('unavailable'));
    expect(await (await GET(request())).json()).toEqual({ signedIn: true, displayName: 'Google name' });
  });
  it('does not expose consumer identity on the brand, admin or unknown host', async () => {
    for (const host of ['brand.twings.app', 'admin.twings.app', 'untrusted.example']) {
      const response = await GET(request(host));
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });
});
