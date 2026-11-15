import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), check: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/billing/toss-runtime', () => ({ isSameOrigin: (request: Request) => request.headers.get('origin') === new URL(request.url).origin }));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({ name: 'local', put: async () => {}, read: async () => new Uint8Array(), url: async () => null }) }));
vi.mock('@/lib/identity/photo-check-service', () => ({ selfiePhotoCheck: mocks.check }));
import { POST } from '@/app/api/identity/selfie/[id]/check/route';

/** The advisory photo check's HTTP surface: off by default, owner only, always private. */
const ID = '10000000-0000-4000-8000-000000000001';
const call = (origin = 'https://twings.test') => POST(new Request(`https://twings.test/api/identity/selfie/${ID}/check`, { method: 'POST', headers: { origin } }), { params: Promise.resolve({ id: ID }) });
const PRIVATE = 'private, no-store';

describe('POST /api/identity/selfie/[id]/check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TWINGS_PHOTO_CHECK', 'on');
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    mocks.viewer.mockResolvedValue({ userId: 'u1', isAdmin: false });
    mocks.sql.mockResolvedValue({});
    mocks.check.mockResolvedValue({ ok: true, check: { status: 'check', issues: ['dark'] } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is 404 while the flag is off or the key is missing, before any lookup', async () => {
    for (const [flag, key] of [['', 'test-key'], ['off', 'test-key'], ['on', '']]) {
      vi.stubEnv('TWINGS_PHOTO_CHECK', flag!);
      vi.stubEnv('GEMINI_API_KEY', key!);
      const response = await call();
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, code: 'off' });
      expect(response.headers.get('cache-control')).toBe(PRIVATE);
    }
    expect(mocks.viewer).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('needs a session and the same origin', async () => {
    mocks.viewer.mockResolvedValue({ userId: null });
    const anonymous = await call();
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe(PRIVATE);
    expect((await call('https://evil.example')).status).toBe(403);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('answers the verdict, or null for no result', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(PRIVATE);
    expect(await response.json()).toEqual({ ok: true, check: { status: 'check', issues: ['dark'] } });
    expect(mocks.check.mock.calls[0]![1]).toBe('u1');
    expect(mocks.check.mock.calls[0]![2]).toBe(ID);
    expect(typeof mocks.check.mock.calls[0]![0].check).toBe('function');
    mocks.check.mockResolvedValue({ ok: true, check: null });
    expect(await (await call()).json()).toEqual({ ok: true, check: null });
  });

  it('is 404 for a photo that is not the viewer’s, or before the migration', async () => {
    mocks.check.mockResolvedValue({ ok: false, code: 'not_found' });
    const missing = await call();
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, code: 'not_found' });
    mocks.check.mockResolvedValue({ ok: false, code: 'off' });
    expect(await (await call()).json()).toEqual({ ok: false, code: 'off' });
  });

  it('is 503 without a database or on an unexpected error', async () => {
    mocks.sql.mockResolvedValue(null);
    expect((await call()).status).toBe(503);
    mocks.sql.mockResolvedValue({});
    mocks.check.mockRejectedValue(new Error('boom'));
    expect((await call()).status).toBe(503);
  });
});
