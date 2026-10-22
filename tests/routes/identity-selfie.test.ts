import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), save: vi.fn(), current: vi.fn(), own: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/billing/toss-runtime', () => ({ isSameOrigin: (request: Request) => request.headers.get('origin') === new URL(request.url).origin }));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({ name: 'local', put: async () => {}, read: mocks.read, url: async () => null }) }));
vi.mock('@/lib/identity/selfie-service', async original => ({ ...(await original<object>()), saveSelfie: mocks.save, currentSelfie: mocks.current, ownSelfie: mocks.own }));
import { GET, POST } from '@/app/api/identity/selfie/route';
import { GET as image } from '@/app/api/identity/selfie/[id]/image/route';

const ID = '10000000-0000-4000-8000-000000000001';
const request = (method: string, body?: BodyInit, origin = 'https://twings.test', headers: Record<string, string> = {}) =>
  new Request('https://twings.test/api/identity/selfie', { method, headers: { origin, ...headers }, body });
const photoForm = () => { const form = new FormData(); form.set('photo', new File([new Uint8Array(1200)], 'selfie.jpg', { type: 'image/jpeg' })); form.set('consent', 'yes'); return form; };

describe('selfie HTTP ownership and CSRF boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer.mockResolvedValue({ userId: 'u1', isAdmin: false });
    mocks.sql.mockResolvedValue({});
    mocks.current.mockResolvedValue({ id: ID, width: 320, height: 400, created_at: new Date('2026-10-22T00:00:00Z') });
  });
  it('refuses anonymous reads, writes and images, privately', async () => {
    mocks.viewer.mockResolvedValue({ userId: null });
    for (const response of [await GET(), await POST(request('POST', photoForm())), await image(new Request('https://twings.test/x'), { params: Promise.resolve({ id: ID }) })]) {
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('refuses cross-origin and oversized uploads before touching storage', async () => {
    expect((await POST(request('POST', photoForm(), 'https://evil.example'))).status).toBe(403);
    expect((await POST(request('POST', photoForm(), 'https://twings.test', { 'content-length': String(9_000_000) }))).status).toBe(413);
    const empty = new FormData(); empty.set('consent', 'yes');
    expect((await POST(request('POST', empty))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('saves with consent and answers the saved selfie as the studio expects it', async () => {
    mocks.save.mockResolvedValue({ ok: true, id: ID, replaced: false, unchanged: false });
    const response = await POST(request('POST', photoForm()));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, id: ID, selfie: { id: ID, imageUrl: `/api/identity/selfie/${ID}/image`, width: 320, height: 400 } });
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), 'u1', expect.objectContaining({ consent: true, mime: 'image/jpeg' }));
    mocks.save.mockResolvedValue({ ok: false, code: 'bad_photo' });
    expect((await POST(request('POST', photoForm()))).status).toBe(400);
    mocks.save.mockResolvedValue({ ok: false, code: 'rate_limited' });
    expect((await POST(request('POST', photoForm()))).status).toBe(429);
  });
  it('reads the current selfie and serves only the owner’s bytes', async () => {
    expect(await (await GET()).json()).toMatchObject({ ok: true, selfie: { id: ID } });
    mocks.own.mockResolvedValue(null);
    expect((await image(new Request('https://twings.test/x'), { params: Promise.resolve({ id: ID }) })).status).toBe(404);
    mocks.own.mockResolvedValue({ id: ID, input_key: `${ID}/selfie.png` });
    mocks.read.mockResolvedValue(new Uint8Array([137, 80]));
    const served = await image(new Request('https://twings.test/x'), { params: Promise.resolve({ id: ID }) });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.own).toHaveBeenCalledWith({}, 'u1', ID);
  });
});
