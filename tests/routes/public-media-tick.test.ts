import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/storage/public-media-runtime', () => ({ runPublicMediaSync: mocks.run }));

import { GET, POST, maxDuration } from '@/app/api/public-media/tick/route';

const SECRET = 'fixture-private-cron';
const request = (secret?: string) => new Request('https://twings.app/api/public-media/tick', {
  headers: secret ? { authorization: `Bearer ${secret}` } : {},
});

describe('public media tick', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET);
    mocks.run.mockReset().mockResolvedValue({ verified: ['a.mp4'], failed: [], waiting: [], deferred: ['b.mp4'] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('refuses an unset or wrong secret before reading anything', async () => {
    expect((await GET(request(SECRET.replace('f', 'g')))).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request(''))).status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('reports counts, private and uncached, with a budget inside the function limit', async () => {
    const response = await GET(request(SECRET));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await response.json()).toEqual({ ok: true, configured: true, verified: 1, failed: [], waiting: 0, deferred: 1 });
    expect(mocks.run.mock.calls[0]![0]).toBeLessThan(maxDuration * 1000);
  });

  it('answers calmly while R2 is not configured', async () => {
    mocks.run.mockResolvedValue(null);
    const response = await GET(request(SECRET));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, configured: false });
  });

  it('never exposes a failure detail', async () => {
    mocks.run.mockRejectedValue(new Error('private-key https://private.invalid'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await GET(request(SECRET));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":false,"code":"sync_failed"}');
    warn.mockRestore();
  });
});
