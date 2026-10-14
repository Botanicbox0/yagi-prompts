import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ auth: vi.fn(), setSession: vi.fn(), profile: vi.fn(), revoke: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword: state.auth, signOut: state.revoke } }) }));
vi.mock('@/lib/supabase/auth-client', () => ({ isAuthConfigured: () => true, supabaseUrl: () => 'https://fixture.supabase.co', supabaseAnonKey: () => 'test-only', createAuthServerClient: async () => ({ auth: { setSession: state.setSession, signOut: vi.fn() } }) }));
vi.mock('@/lib/supabase/data-client', () => ({ createDataClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: state.profile }) }) }) }) }));
import { POST } from '@/app/auth/review/login/route';
function request(host = 'twings.app', origin = `https://${host}`, body = 'email=pg-review%40twings.app&password=test-password&locale=ko', type = 'application/x-www-form-urlencoded') {
  return new NextRequest(`https://${host}/auth/review/login`, { method: 'POST', headers: { host, origin, 'content-type': type }, body });
}
describe('review login HTTP boundary', () => {
  it('rejects cross-origin requests, workspace hosts, oversized bodies and wrong content type before authentication', async () => {
    state.auth.mockClear();
    expect((await POST(request('twings.app', 'https://evil.invalid'))).status).toBe(403);
    expect((await POST(request('admin.twings.app'))).status).toBe(404);
    expect((await POST(request('brand.twings.app'))).status).toBe(404);
    expect((await POST(request('twings.app', 'https://twings.app', 'x'.repeat(4097)))).status).toBe(413);
    expect((await POST(request('twings.app', 'https://twings.app', '{}', 'application/json'))).status).toBe(415);
    expect(state.auth).not.toHaveBeenCalled();
  });
  it('sets the verified ordinary session and redirects without secrets in the URL', async () => {
    state.auth.mockResolvedValue({ data: { user: { id: 'review-id', app_metadata: { purpose: 'toss_review' } }, session: { access_token: 'test-access', refresh_token: 'test-refresh' } }, error: null });
    state.profile.mockResolvedValue({ data: { is_admin: false }, error: null });
    state.setSession.mockResolvedValue({ error: null });
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://twings.app/account');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(state.setSession).toHaveBeenCalledWith({ access_token: 'test-access', refresh_token: 'test-refresh' });
  });
  it('never commits a profile with admin access and returns only a generic error', async () => {
    state.setSession.mockClear();
    state.auth.mockResolvedValue({ data: { user: { id: 'review-id', app_metadata: { purpose: 'toss_review' } }, session: { access_token: 'test-access', refresh_token: 'test-refresh' } }, error: null });
    state.profile.mockResolvedValue({ data: { is_admin: true }, error: null });
    const response = await POST(request());
    expect(response.headers.get('location')).toBe('https://twings.app/auth/review?locale=ko&error=invalid');
    expect(state.setSession).not.toHaveBeenCalled();
    expect(state.revoke).toHaveBeenCalledWith({ scope: 'local' });
  });
});
