import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RenderObjectNotFound,
  assertRenderKey,
  createLocalRenderStore,
  createR2RenderStore,
  extensionFor,
  getRenderStore,
  resetRenderStore,
  type RenderStore,
} from '@/lib/renders/store';

describe('the local render store', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'playbook-render-store-'));
  });
  afterEach(async () => {
    resetRenderStore();
    await rm(root, { recursive: true, force: true });
  });

  it('writes, overwrites in place, reads back, and mints no url (the gateway streams)', async () => {
    const store = createLocalRenderStore(root);
    const key = '11111111-1111-4111-8111-111111111111/result.jpg';
    await store.put(key, new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(await store.read(key)).toEqual(new Uint8Array([1, 2, 3]));
    await store.put(key, new Uint8Array([4]), 'image/jpeg');
    expect(await store.read(key)).toEqual(new Uint8Array([4]));
    expect(await store.url(key, 600)).toBeNull();
    await expect(store.read('22222222-2222-4222-8222-222222222222/result.jpg')).rejects.toBeInstanceOf(RenderObjectNotFound);
  });

  it('refuses any key that is not {uuid}/{name}.{ext}', () => {
    expect(() => assertRenderKey('../etc/passwd')).toThrow(/illegal render key/);
    expect(() => assertRenderKey('11111111-1111-4111-8111-111111111111/../x.jpg')).toThrow(/illegal render key/);
    expect(() => assertRenderKey('11111111-1111-4111-8111-111111111111/result.jpg')).not.toThrow();
  });

  it('names files by their type', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('video/mp4')).toBe('mp4');
    expect(extensionFor('application/x-unknown')).toBe('bin');
  });

  it('stores, overwrites, reads, signs download URLs, and deletes renders in R2 private bucket', async () => {
    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const fakeFetcher: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname.replace(/^\/twings-private-apac\//, ''));
      if (req.method === 'HEAD') {
        const hit = objects.get(path);
        return hit ? new Response(null, { status: 200 }) : new Response(null, { status: 404 });
      }
      if (req.method === 'PUT') {
        objects.set(path, {
          bytes: new Uint8Array(await req.arrayBuffer()),
          contentType: req.headers.get('content-type') || 'application/octet-stream',
        });
        return new Response(null, { status: 200 });
      }
      if (req.method === 'GET') {
        const hit = objects.get(path);
        if (!hit) return new Response('NotFound', { status: 404 });
        return new Response(Buffer.from(hit.bytes), { status: 200, headers: { 'Content-Type': hit.contentType } });
      }
      if (req.method === 'DELETE') {
        objects.delete(path);
        return new Response(null, { status: 204 });
      }
      return new Response('Unsupported', { status: 405 });
    };

    const fallback: RenderStore = {
      name: 'supabase',
      put: async () => {},
      read: async (k) => {
        if (k === '33333333-3333-4333-8333-333333333333/selfie.png') return new Uint8Array([9, 8, 7]);
        throw new RenderObjectNotFound(k);
      },
      url: async (k) => {
        if (k === '33333333-3333-4333-8333-333333333333/selfie.png') return 'https://supabase.legacy/signed';
        throw new RenderObjectNotFound(k);
      },
    };

    const r2Store = createR2RenderStore(
      {
        accountId: 'acc123',
        accessKeyId: 'AKIA123',
        secretAccessKey: 'SECRET123',
        bucket: 'twings-private-apac',
      },
      { fetcher: fakeFetcher, legacyFallback: fallback },
    );

    expect(r2Store.name).toBe('r2');
    const key = '11111111-1111-4111-8111-111111111111/result.mp4';
    await r2Store.put(key, new Uint8Array([10, 20]), 'video/mp4');
    expect(objects.has(`renders/${key}`)).toBe(true);
    expect(await r2Store.read(key)).toEqual(new Uint8Array([10, 20]));

    // Overwrite in place on retry
    await r2Store.put(key, new Uint8Array([30, 40, 50]), 'video/mp4');
    expect(await r2Store.read(key)).toEqual(new Uint8Array([30, 40, 50]));

    // Signed URL with seekable 600s TTL + attachment filename
    const signed = await r2Store.url(key, 600, { download: '트윙스-영상.mp4' });
    expect(signed).toContain('https://acc123.r2.cloudflarestorage.com/twings-private-apac/renders/');
    expect(signed).toContain('X-Amz-Expires=600');
    expect(signed).toContain('response-content-disposition=');

    // Legacy fallback & missing key
    expect(await r2Store.read('33333333-3333-4333-8333-333333333333/selfie.png')).toEqual(new Uint8Array([9, 8, 7]));
    await expect(r2Store.read('44444444-4444-4444-8444-444444444444/selfie.png')).rejects.toBeInstanceOf(
      RenderObjectNotFound,
    );

    await r2Store.delete?.(key);
    expect(objects.has(`renders/${key}`)).toBe(false);
  });

  it('resolves getRenderStore() to R2 when R2_PRIVATE_BUCKET is configured in cloud mode', async () => {
    const prev = { ...process.env };
    try {
      process.env.PLAYBOOK_MODE = 'cloud';
      process.env.DATABASE_URL = 'postgres://user:pass@db.example:5432/postgres';
      process.env.R2_ACCOUNT_ID = 'acc123';
      process.env.R2_PRIVATE_BUCKET = 'twings-private-apac';
      process.env.R2_PRIVATE_ACCESS_KEY_ID = 'AKIA123';
      process.env.R2_PRIVATE_SECRET_ACCESS_KEY = 'SECRET123';
      delete process.env.STORAGE_DRIVER;
      resetRenderStore();
      const resolved = await getRenderStore();
      expect(resolved.name).toBe('r2');
    } finally {
      process.env = prev;
      resetRenderStore();
    }
  });
});
