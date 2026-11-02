import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_MEDIA_KEYS } from '@/lib/content/public-media-keys';

const mocks = vi.hoisted(() => ({ row: null as unknown, read: vi.fn() }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/prompts/repo', () => ({ loadPromptById: async () => mocks.row }));
vi.mock('@/lib/storage', async (original) => ({
  ...(await original<typeof import('@/lib/storage')>()),
  getStorage: async () => ({ read: mocks.read }),
}));

import { GET } from '@/app/api/prompts/media/[ref]/route';
import { StorageObjectNotFound } from '@/lib/storage';

const MEDIA = 'https://media.twings.app';
const SUPABASE = 'https://project.supabase.co';
const [COPIED_KEY] = [...PUBLIC_MEDIA_KEYS] as [string];
const NEW_KEY = `${'e'.repeat(64)}.mp4`;
const BYTES = new Uint8Array([1, 2, 3]);

function published(key: string): void {
  mocks.row = {
    status: 'published',
    audience: 'public',
    slug: 'prom-queen',
    media: { video: { staging_key: 'rev/a.mp4', sha256: 'a'.repeat(64), published_key: key, bucket: 'public-content', mime: 'video/mp4' } },
  };
}

const get = (query = '') => GET(
  new Request(`https://twings.app/api/prompts/media/id:video${query}`),
  { params: Promise.resolve({ ref: 'id:video' }) },
);

describe('prompt media route', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    mocks.read.mockReset().mockResolvedValue(BYTES);
    fetchMock.mockReset().mockImplementation(async () => new Response(BYTES, { status: 200, headers: { 'Content-Length': '3' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PLAYBOOK_MODE', 'cloud');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    vi.stubEnv('PUBLIC_MEDIA_BASE_URL', MEDIA);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('?download=1 on a key that is on R2', () => {
    beforeEach(() => published(COPIED_KEY));

    it('reads the media host and never the Supabase original, which may be gone', async () => {
      mocks.read.mockRejectedValue(new StorageObjectNotFound('public-content', COPIED_KEY));
      const response = await get('?download=1');
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${MEDIA}/${COPIED_KEY}`);
      expect(mocks.read).not.toHaveBeenCalled();
    });

    it('still arrives as an attachment named after the template', async () => {
      const response = await get('?download=1');
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="prom-queen.mp4"');
      expect(response.headers.get('content-type')).toBe('video/mp4');
      expect(response.headers.get('content-length')).toBe('3');
    });

    it('answers 404 when the media host has no such file', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
      const response = await get('?download=1');
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it.each([
      ['answers an error', async () => new Response(null, { status: 502 })],
      ['cannot be reached', async () => { throw new Error('private upstream detail'); }],
    ])('answers 500 when the media host %s', async (_name, upstream) => {
      fetchMock.mockImplementation(upstream);
      const response = await get('?download=1');
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('{"error":"storage_error"}');
    });
  });

  it('reads Supabase on ?download=1 while a key is not on R2 yet', async () => {
    published(NEW_KEY);
    const response = await get('?download=1');
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith('public-content', NEW_KEY);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="prom-queen.mp4"');
  });

  it('reads the media host on ?download=1 for any key once files are written straight to R2', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'account');
    vi.stubEnv('R2_ACCESS_KEY_ID', 'access');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('R2_PUBLIC_BUCKET', 'twings-media-apac');
    published(NEW_KEY);
    const response = await get('?download=1');
    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${MEDIA}/${NEW_KEY}`);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('reads Supabase on ?download=1 with no media host configured', async () => {
    vi.stubEnv('PUBLIC_MEDIA_BASE_URL', '');
    published(COPIED_KEY);
    const response = await get('?download=1');
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith('public-content', COPIED_KEY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still redirects a plain request to the media host', async () => {
    published(COPIED_KEY);
    const response = await get();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${MEDIA}/${COPIED_KEY}`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
