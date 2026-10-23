import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), save: vi.fn(), library: vi.fn(), update: vi.fn(), remove: vi.fn(), own: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/billing/toss-runtime', () => ({ isSameOrigin: (request: Request) => request.headers.get('origin') === new URL(request.url).origin }));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({ name: 'local', put: async () => {}, read: mocks.read, url: async () => null }) }));
vi.mock('@/lib/identity/selfie-service', async original => ({
  ...(await original<object>()), saveSelfie: mocks.save, selfieLibrary: mocks.library, updateSelfie: mocks.update, deleteSelfie: mocks.remove, ownSelfie: mocks.own,
}));
import { DELETE, GET, PATCH, POST } from '@/app/api/identity/selfie/route';
import { GET as image } from '@/app/api/identity/selfie/[id]/image/route';

/**
 * docs/IDENTITY-SELFIE.md §4 — the library's HTTP surface: owner-only, same-origin writes, bounded
 * bodies, every answer `private, no-store`, and the limit read from IDENTITY_SELFIE_LIMIT.
 */
const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const item = (id: string, isDefault: boolean) => ({ id, width: 320, height: 400, createdAt: '2026-10-22T00:00:00.000Z', imageUrl: `/api/identity/selfie/${id}/image`, label: isDefault ? null : '안경', isDefault, lastUsedAt: null });
const LIBRARY = { limit: 10, defaultId: ID, items: [item(ID, true), item(OTHER, false)] };
const request = (method: string, body?: BodyInit, origin = 'https://twings.test', headers: Record<string, string> = {}) =>
  new Request('https://twings.test/api/identity/selfie', { method, headers: { origin, ...headers }, body });
const json = (method: string, body: unknown, origin?: string) => request(method, typeof body === 'string' ? body : JSON.stringify(body), origin, { 'content-type': 'application/json' });
const photoForm = (extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.set('photo', new File([new Uint8Array(1200)], 'selfie.jpg', { type: 'image/jpeg' }));
  form.set('consent', 'yes');
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
};
const imageOf = (id: string) => image(new Request('https://twings.test/x'), { params: Promise.resolve({ id }) });
const PRIVATE = 'private, no-store';

describe('selfie library HTTP boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('IDENTITY_SELFIE_LIMIT', '10');
    mocks.viewer.mockResolvedValue({ userId: 'u1', isAdmin: false });
    mocks.sql.mockResolvedValue({});
    mocks.library.mockResolvedValue(LIBRARY);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('refuses anonymous reads, writes and images, privately and before any service call', async () => {
    mocks.viewer.mockResolvedValue({ userId: null });
    for (const response of [await GET(), await POST(request('POST', photoForm())), await PATCH(json('PATCH', { id: ID, isDefault: true })), await DELETE(json('DELETE', { id: ID })), await imageOf(ID)]) {
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe(PRIVATE);
    }
    for (const fn of [mocks.save, mocks.library, mocks.update, mocks.remove, mocks.own]) expect(fn).not.toHaveBeenCalled();
  });

  it('refuses cross-origin writes and oversized or malformed bodies before touching storage', async () => {
    for (const response of [await POST(request('POST', photoForm(), 'https://evil.example')), await PATCH(json('PATCH', { id: ID, isDefault: true }, 'https://evil.example')), await DELETE(json('DELETE', { id: ID }, 'https://evil.example'))]) {
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe(PRIVATE);
    }
    expect((await POST(request('POST', photoForm(), 'https://twings.test', { 'content-length': String(9_000_000) }))).status).toBe(413);
    const empty = new FormData(); empty.set('consent', 'yes');
    expect((await POST(request('POST', empty))).status).toBe(400);
    expect((await PATCH(json('PATCH', { id: ID, label: 'x'.repeat(5000) }))).status).toBe(413);
    expect((await PATCH(request('PATCH', '{"id":', 'https://twings.test', { 'content-length': '100000' }))).status).toBe(413);
    for (const body of ['{"id":', '[]', 'null', JSON.stringify({ id: ID, isDefault: true, extra: 1 }), JSON.stringify({ id: 7 }), JSON.stringify({ id: ID, isDefault: 'yes' })]) {
      const response = await PATCH(json('PATCH', body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, code: 'invalid' });
    }
    for (const body of ['', '{"id":', JSON.stringify({ id: ID, also: true })]) expect((await DELETE(json('DELETE', body))).status).toBe(400);
    for (const fn of [mocks.save, mocks.update, mocks.remove]) expect(fn).not.toHaveBeenCalled();
  });

  it('lists the library with the limit from the environment, capped at 10', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(PRIVATE);
    expect(await response.json()).toEqual({ ok: true, ...LIBRARY });
    expect(mocks.library).toHaveBeenCalledWith({}, 'u1', 10);
    vi.stubEnv('IDENTITY_SELFIE_LIMIT', '99');
    await GET();
    expect(mocks.library).toHaveBeenLastCalledWith({}, 'u1', 10);
    vi.stubEnv('IDENTITY_SELFIE_LIMIT', '');
    await GET();
    expect(mocks.library).toHaveBeenLastCalledWith({}, 'u1', 1);
    mocks.sql.mockResolvedValue(null);
    expect((await GET()).status).toBe(503);
  });

  it('saves with consent, passes a replacement through, and answers the saved photo and the library', async () => {
    mocks.save.mockResolvedValue({ ok: true, id: OTHER, replaced: false, unchanged: false });
    const created = await POST(request('POST', photoForm()));
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe(PRIVATE);
    expect(await created.json()).toEqual({ ok: true, id: OTHER, replaced: false, unchanged: false, selfie: item(OTHER, false), library: LIBRARY });
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10 }), 'u1', expect.objectContaining({ consent: true, mime: 'image/jpeg' }));
    expect(mocks.save.mock.lastCall?.[2]).not.toHaveProperty('replaceId');
    mocks.save.mockResolvedValue({ ok: true, id: ID, replaced: true, unchanged: false });
    await POST(request('POST', photoForm({ replaceId: OTHER })));
    expect(mocks.save).toHaveBeenLastCalledWith(expect.anything(), 'u1', expect.objectContaining({ replaceId: OTHER }));
    mocks.save.mockResolvedValue({ ok: true, id: ID, replaced: false, unchanged: true });
    expect((await POST(request('POST', photoForm()))).status).toBe(200);
    const statuses: Array<[string, number]> = [['consent_required', 400], ['bad_photo', 400], ['rate_limited', 429], ['limit_reached', 409], ['not_found', 404], ['sign_in_required', 401]];
    for (const [code, status] of statuses) {
      mocks.save.mockResolvedValue({ ok: false, code });
      const response = await POST(request('POST', photoForm()));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ ok: false, code });
      expect(response.headers.get('cache-control')).toBe(PRIVATE);
    }
  });

  it('PATCH sets the default or the label and answers the library; a stranger’s id is not found', async () => {
    mocks.update.mockResolvedValue({ ok: true });
    const response = await PATCH(json('PATCH', { id: OTHER, isDefault: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(PRIVATE);
    expect(await response.json()).toEqual({ ok: true, ...LIBRARY });
    expect(mocks.update).toHaveBeenLastCalledWith(expect.anything(), 'u1', { id: OTHER, isDefault: true });
    await PATCH(json('PATCH', { id: OTHER, label: '안경' }));
    expect(mocks.update).toHaveBeenLastCalledWith(expect.anything(), 'u1', { id: OTHER, label: '안경' });
    await PATCH(json('PATCH', { id: OTHER, label: null }));
    expect(mocks.update).toHaveBeenLastCalledWith(expect.anything(), 'u1', { id: OTHER, label: null });
    mocks.update.mockResolvedValue({ ok: false, code: 'not_found' });
    expect((await PATCH(json('PATCH', { id: OTHER, isDefault: true }))).status).toBe(404);
    mocks.update.mockResolvedValue({ ok: false, code: 'invalid' });
    expect((await PATCH(json('PATCH', { id: OTHER, label: 'x'.repeat(41) }))).status).toBe(400);
  });

  it('DELETE is soft and owner-bound, and answers the library with the new default', async () => {
    mocks.remove.mockResolvedValue({ ok: true });
    mocks.library.mockResolvedValue({ limit: 10, defaultId: OTHER, items: [item(OTHER, true)] });
    const response = await DELETE(json('DELETE', { id: ID }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(PRIVATE);
    expect(await response.json()).toEqual({ ok: true, limit: 10, defaultId: OTHER, items: [item(OTHER, true)] });
    expect(mocks.remove).toHaveBeenLastCalledWith(expect.anything(), 'u1', ID);
    mocks.remove.mockResolvedValue({ ok: false, code: 'not_found' });
    const missing = await DELETE(json('DELETE', { id: ID }));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe(PRIVATE);
  });

  it('serves only the owner’s bytes; a deleted or foreign photo is a 404', async () => {
    mocks.own.mockResolvedValue(null);
    expect((await imageOf(ID)).status).toBe(404);
    mocks.own.mockResolvedValue({ id: ID, input_key: `${ID}/selfie.png` });
    mocks.read.mockResolvedValue(new Uint8Array([137, 80]));
    const served = await imageOf(ID);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe(PRIVATE);
    expect(mocks.own).toHaveBeenCalledWith({}, 'u1', ID);
  });
});
