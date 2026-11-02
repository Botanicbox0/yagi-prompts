import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claims: {} as Record<string, unknown>,
  signed: vi.fn(async () => 'https://storage.example/signed'),
  read: vi.fn(async () => new Uint8Array([1])),
  serves: true,
}));

vi.mock('@/lib/auth/viewer', () => ({ getViewer: vi.fn() }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: vi.fn() }));
vi.mock('@/lib/media/token', () => ({
  mintMediaToken: vi.fn(),
  verifyMediaToken: vi.fn(() => ({ ok: true, claims: mocks.claims })),
}));
vi.mock('@/lib/storage', async (original) => ({
  ...(await original<typeof import('@/lib/storage')>()),
  getStorage: async () => ({ servesSignedUrls: mocks.serves, signedStagingUrl: mocks.signed, read: mocks.read }),
}));

import { GET } from '@/app/api/admin/media/[ref]/route';
import { STAGING_BUCKET } from '@/lib/storage';

const clip = { ref: 'admin:x', bucket: STAGING_BUCKET, key: 'k.mp4', mime: 'video/mp4' };
const hit = () =>
  GET(new Request('http://x/api/admin/media/x?t=token'), { params: Promise.resolve({ ref: 'x' }) });

describe('admin media delivery', () => {
  beforeEach(() => {
    mocks.serves = true;
    mocks.claims = clip;
    mocks.read.mockClear();
  });

  it('sends a clip to signed storage so its size never meets the function response limit', async () => {
    const response = await hit();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://storage.example/signed');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('keeps streaming a named attachment, and on a driver with no signing service', async () => {
    mocks.claims = { ...clip, filename: 'a.pdf' };
    expect((await hit()).status).toBe(200);
    mocks.claims = clip;
    mocks.serves = false;
    expect((await hit()).status).toBe(200);
  });
});
