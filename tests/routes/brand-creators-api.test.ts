import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), issue: vi.fn(), notify: vi.fn(), after: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async (original) => ({ ...(await original<object>()), after: mocks.after }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/notify/service', () => ({ getMailer: () => null }));
vi.mock('@/lib/campaigns/collaboration/service', async (original) => ({ ...(await original<object>()), issueInvitation: mocks.issue }));
vi.mock('@/lib/campaigns/notify', async (original) => ({ ...(await original<object>()), notifyCampaignInvitation: mocks.notify }));
import { POST } from '@/app/api/brand-creators/route';

/**
 * docs/PLATFORM-2.0.md §17.3 — the pool's one action over HTTP: closed while the flag is off,
 * same-origin, signed-in brand members only (the TWINGS team acts through /admin/do), a small strict
 * body, private answers. The invitation link never goes back to the brand; the invited person gets
 * it by mail, after the response, only when the invitation is new.
 */
const PRIVATE = 'private, no-store';
const CAMPAIGN = '11111111-1111-4111-8111-111111111111', ACCOUNT = '22222222-2222-4222-8222-222222222222', REQUEST = '33333333-3333-4333-8333-333333333333';
const body = { campaignId: CAMPAIGN, socialAccountId: ACCOUNT, requestId: REQUEST };
const post = (payload: unknown, origin = 'http://localhost:3016') =>
  new Request('http://localhost:3016/api/brand-creators', { method: 'POST', headers: { host: 'localhost:3016', origin, 'content-type': 'application/json' }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

describe('/api/brand-creators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TWINGS_INFLUENCERS', 'on');
    mocks.viewer.mockResolvedValue({ userId: 'u1', isAdmin: false });
    mocks.sql.mockResolvedValue({});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is closed while TWINGS_INFLUENCERS is off, before any session', async () => {
    vi.stubEnv('TWINGS_INFLUENCERS', 'off');
    const r = await POST(post(body) as never);
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe(PRIVATE);
    expect(mocks.viewer).not.toHaveBeenCalled();
  });

  it('refuses cross-origin, anonymous and TWINGS-team writes', async () => {
    expect((await POST(post(body, 'https://evil.example') as never)).status).toBe(403);
    mocks.viewer.mockResolvedValue({ userId: null, isAdmin: false });
    expect((await POST(post(body) as never)).status).toBe(401);
    mocks.viewer.mockResolvedValue({ userId: 'admin', isAdmin: true });
    expect((await POST(post(body) as never)).status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('takes a small strict body only', async () => {
    for (const bad of ['{', '[]', JSON.stringify({ ...body, email: 'a@b.c' }), JSON.stringify({ ...body, socialAccountId: 5 }), JSON.stringify({ campaignId: CAMPAIGN, requestId: REQUEST }), 'x'.repeat(5000)])
      expect((await POST(post(bad) as never)).status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('invites, answers without the link, and mails the invited person after the response', async () => {
    mocks.issue.mockResolvedValue({ ok: true, id: 'inv1', token: 't'.repeat(43), slug: 'fall', invitee: 'creator1' });
    const r = await POST(post(body) as never);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe(PRIVATE);
    const json = await r.json();
    expect(json).toEqual({ ok: true, id: 'inv1' });
    expect(mocks.issue.mock.calls[0]![2]).toEqual(body);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify.mock.calls[0]![1]).toEqual({ campaignId: CAMPAIGN, userId: 'creator1', invitationId: 'inv1', token: 't'.repeat(43) });
  });

  it('keeps refusals private, with their status, and mails nobody', async () => {
    for (const [code, status] of [['conflict', 409], ['invitation_retry', 409], ['invite_limit', 409], ['not_found', 404], ['forbidden', 403], ['not_open', 409], ['unavailable', 503], ['rate_limited', 429]] as const) {
      mocks.issue.mockResolvedValueOnce({ ok: false, code });
      const r = await POST(post(body) as never);
      expect(r.status, code).toBe(status);
      expect(await r.json()).toEqual({ ok: false, code });
    }
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
