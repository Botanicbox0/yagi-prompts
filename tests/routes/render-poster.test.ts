import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/billing/toss-runtime', () => ({ isSameOrigin: (request: Request) => request.headers.get('origin') === new URL(request.url).origin }));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({ name: 'local', put: async () => {}, read: async () => new Uint8Array(), url: async () => null }) }));
// The body reader lives beside a server-only module; the route itself is what is under test.
vi.mock('server-only', () => ({}));
// The whole module: its real one pulls the render service behind savePosterFrame.
vi.mock('@/lib/renders/poster', () => ({ POSTER_MAX_BYTES: 300_000, savePosterFrame: mocks.save }));
import { POST } from '@/app/api/renders/[id]/poster/route';

/**
 * `POST /api/renders/[id]/poster` — same origin, a session, a JPEG body bounded as it arrives,
 * another person's render "not found", an existing frame 204. Every answer private.
 */
const POSTER_MAX_BYTES = 300_000;
const ID = '22222222-2222-4222-8222-222222222222';
const post = (body: BodyInit | null, { origin = 'https://twings.test', type = 'image/jpeg', id = ID, headers = {} as Record<string, string> } = {}) =>
  POST(new Request(`https://twings.test/api/renders/${id}/poster`, { method: 'POST', headers: { origin, 'content-type': type, ...headers }, body }), { params: Promise.resolve({ id }) });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('the share-frame upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer.mockResolvedValue({ userId: 'u1', isAdmin: false });
    mocks.sql.mockResolvedValue({});
    mocks.save.mockResolvedValue({ ok: true, stored: true });
  });

  it('refuses another origin, then the anonymous, before reading anything', async () => {
    const foreign = await post(JPEG, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('cache-control')).toBe('private, no-store');
    mocks.viewer.mockResolvedValue({ userId: null });
    expect((await post(JPEG)).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('takes only a JPEG body, bounded by what actually arrives, not the header', async () => {
    expect((await post(JPEG, { type: 'image/png' })).status).toBe(415);
    expect((await post(JPEG, { headers: { 'content-length': String(POSTER_MAX_BYTES + 1) } })).status).toBe(413);
    expect((await post(new Uint8Array(POSTER_MAX_BYTES + 1))).status).toBe(413);
    expect((await post(new Uint8Array(0))).status).toBe(422);
    expect((await post(JPEG, { id: 'not-a-render' })).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('stores a new frame (201), answers 204 when one is already there, and passes refusals through', async () => {
    const created = await post(JPEG, { type: 'image/jpeg; charset=binary' });
    expect(created.status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'u1' }), ID, JPEG);
    mocks.save.mockResolvedValue({ ok: true, stored: false });
    const again = await post(JPEG);
    expect(again.status).toBe(204);
    expect(again.headers.get('cache-control')).toBe('private, no-store');
    for (const [code, status] of [['not_found', 404], ['not_ready', 409], ['bad_image', 422], ['unavailable', 503]] as const) {
      mocks.save.mockResolvedValue({ ok: false, code });
      expect((await post(JPEG)).status).toBe(status);
    }
    mocks.save.mockRejectedValue(new Error('storage down'));
    expect((await post(JPEG)).status).toBe(503);
  });
});
