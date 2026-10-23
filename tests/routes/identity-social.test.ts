import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), submit: vi.fn(), list: vi.fn(), consent: vi.fn(), remove: vi.fn(), own: vi.fn(), adminKey: vi.fn(), read: vi.fn(), influencer: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/billing/toss-runtime', () => ({ isSameOrigin: (request: Request) => request.headers.get('origin') === new URL(request.url).origin }));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({ name: 'local', put: async () => {}, read: mocks.read, url: async () => null }) }));
vi.mock('@/lib/influencers/service', async original => ({
  ...(await original<object>()), submitSocialAccount: mocks.submit, listSocialAccounts: mocks.list, setPoolConsent: mocks.consent, deleteSocialAccount: mocks.remove, ownSocialEvidence: mocks.own,
}));
vi.mock('@/lib/influencers/rules', async original => ({ ...(await original<object>()), isInfluencer: mocks.influencer }));
vi.mock('@/lib/influencers/admin', async original => ({ ...(await original<object>()), adminSocialEvidence: mocks.adminKey }));
import { DELETE, GET, PATCH, POST } from '@/app/api/identity/social/route';
import { GET as ownImage } from '@/app/api/identity/social/[id]/evidence/route';
import { GET as adminImage } from '@/app/api/admin/social/[id]/evidence/route';
import { POST as workerClaim } from '@/app/api/social-verify-worker/claim/route';
import { POST as workerEvidence } from '@/app/api/social-verify-worker/evidence/route';

/**
 * docs/PLATFORM-2.0.md §17.1 — the SNS surface over HTTP: closed while the flag is off, owner-only,
 * same-origin writes, bounded bodies, private answers; screenshots for their owner or an admin only;
 * the worker door shut without its secret.
 */
const ID = '57000000-0000-4000-8000-000000000001';
const PRIVATE = 'private, no-store';
const request = (method: string, body?: BodyInit, origin = 'https://twings.test', headers: Record<string, string> = {}) =>
  new Request('https://twings.test/api/identity/social', { method, headers: { origin, ...headers }, body });
const json = (method: string, body: unknown, origin?: string) => request(method, typeof body === 'string' ? body : JSON.stringify(body), origin, { 'content-type': 'application/json' });
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set('photo', new File([new Uint8Array(1200)], 'shot.png', { type: 'image/png' }));
  f.set('platform', 'instagram');
  f.set('profileUrl', '@hana');
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/identity/social', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TWINGS_INFLUENCERS', 'on');
    mocks.viewer.mockResolvedValue({ userId: 'u1', isAdmin: false });
    mocks.sql.mockResolvedValue({});
    mocks.list.mockResolvedValue([]);
    mocks.influencer.mockResolvedValue(false);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is closed while TWINGS_INFLUENCERS is off, before any session or service call', async () => {
    vi.stubEnv('TWINGS_INFLUENCERS', 'off');
    for (const response of [await GET(), await POST(request('POST', form())), await PATCH(json('PATCH', { id: ID, poolConsent: true })), await DELETE(json('DELETE', { id: ID }))]) {
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe(PRIVATE);
    }
    for (const fn of [mocks.viewer, mocks.submit, mocks.list, mocks.consent, mocks.remove]) expect(fn).not.toHaveBeenCalled();
  });

  it('refuses anonymous and cross-origin writes, privately', async () => {
    for (const response of [await POST(request('POST', form(), 'https://evil.example')), await PATCH(json('PATCH', { id: ID, poolConsent: true }, 'https://evil.example')), await DELETE(json('DELETE', { id: ID }, 'https://evil.example'))]) {
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe(PRIVATE);
    }
    mocks.viewer.mockResolvedValue({ userId: null });
    for (const response of [await GET(), await POST(request('POST', form())), await DELETE(json('DELETE', { id: ID }))]) expect(response.status).toBe(401);
    for (const fn of [mocks.submit, mocks.consent, mocks.remove]) expect(fn).not.toHaveBeenCalled();
  });

  it('bounds the upload and the JSON bodies before the service sees them', async () => {
    expect((await POST(request('POST', form(), 'https://twings.test', { 'content-length': String(9_000_000) }))).status).toBe(413);
    const empty = new FormData(); empty.set('platform', 'instagram');
    expect((await POST(request('POST', empty))).status).toBe(400);
    expect((await PATCH(json('PATCH', { id: ID, poolConsent: 'x'.repeat(2000) }))).status).toBe(413);
    for (const body of ['{"id":', '[]', JSON.stringify({ id: ID, poolConsent: 'yes' }), JSON.stringify({ id: ID, poolConsent: true, extra: 1 })]) expect((await PATCH(json('PATCH', body))).status).toBe(400);
    expect((await DELETE(json('DELETE', JSON.stringify({ id: 5 })))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('passes the form to the service and answers with the fresh list; refusals keep their status', async () => {
    mocks.submit.mockResolvedValue({ ok: true, id: ID });
    const created = await POST(request('POST', form({ claimedCount: '4,200', poolConsent: 'yes' })));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ ok: true, influencer: false, items: [], id: ID });
    expect(mocks.submit.mock.calls[0]![1]).toBe('u1');
    expect(mocks.submit.mock.calls[0]![2]).toMatchObject({ platform: 'instagram', profileUrl: '@hana', claimedCount: '4,200', poolConsent: true, mime: 'image/png' });
    for (const [code, status] of [['rate_limited', 429], ['already_verified', 409], ['bad_url', 400]] as const) {
      mocks.submit.mockResolvedValueOnce({ ok: false, code });
      expect((await POST(request('POST', form()))).status).toBe(status);
    }
    mocks.remove.mockResolvedValue({ ok: false, code: 'not_found' });
    expect((await DELETE(json('DELETE', { id: ID }))).status).toBe(404);
  });

  it('shows a screenshot to its owner and to administrators only', async () => {
    mocks.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.own.mockResolvedValue(null);
    expect((await ownImage(new Request('https://twings.test/x'), params(ID))).status).toBe(404);
    mocks.own.mockResolvedValue(`social/${ID}/evidence.jpg`);
    const mine = await ownImage(new Request('https://twings.test/x'), params(ID));
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toBe(PRIVATE);
    expect(mine.headers.get('content-type')).toBe('image/jpeg');
    expect((await adminImage(new Request('https://twings.test/x'), params(ID))).status).toBe(404);
    expect(mocks.adminKey).not.toHaveBeenCalled();
    mocks.viewer.mockResolvedValue({ userId: 'a1', isAdmin: true });
    mocks.adminKey.mockResolvedValue(`social/${ID}/evidence.jpg`);
    expect((await adminImage(new Request('https://twings.test/x'), params(ID))).status).toBe(200);
    mocks.viewer.mockResolvedValue({ userId: null });
    expect((await ownImage(new Request('https://twings.test/x'), params(ID))).status).toBe(401);
  });

  it('keeps the worker door shut without the secret', async () => {
    vi.stubEnv('SOCIAL_VERIFY_WORKER_SECRET', 'w'.repeat(40));
    const call = (fn: typeof workerClaim, auth?: string) => fn(new Request('https://twings.test/api/social-verify-worker/claim', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: '{}' }));
    for (const response of [await call(workerClaim), await call(workerEvidence), await call(workerClaim, 'Bearer nope')]) {
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe(PRIVATE);
    }
    expect(mocks.sql).not.toHaveBeenCalled();
    mocks.sql.mockResolvedValue(null);
    expect((await call(workerClaim, `Bearer ${'w'.repeat(40)}`)).status).toBe(503);
    const huge = await workerClaim(new Request('https://twings.test/api/social-verify-worker/claim', { method: 'POST', headers: { authorization: `Bearer ${'w'.repeat(40)}` }, body: 'x'.repeat(9000) }));
    expect(huge.status).toBe(413);
  });
});
