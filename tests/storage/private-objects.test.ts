import { describe, expect, it } from 'vitest';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isPrivateObjectKey } from '@/lib/storage';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { createR2PrivateStorageDriver } from '@/lib/storage/r2-private';

/** Private objects (lib/storage/index.ts): durable, deletable, outside staging (which expires) and published. */
const ORG = '0f0e0d0c-0000-4000-8000-000000000001';
const KEY = `orgs/${ORG}/studio/documents/0f0e0d0c-0000-4000-8000-000000000002`;

describe('private object keys', () => {
  it('take only orgs/{uuid}/… with safe segments', () => {
    expect(isPrivateObjectKey(KEY)).toBe(true);
    for (const bad of ['staging/x', `orgs/${ORG}`, `orgs/not-a-uuid/studio/x`, `orgs/${ORG}/studio/../x`, `orgs/${ORG}/studio//x`, `/orgs/${ORG}/studio/x`]) {
      expect(isPrivateObjectKey(bad)).toBe(false);
    }
  });
});

describe('the local driver', () => {
  it('puts, reads and deletes under .storage/private, refusing any other key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'twings-private-objects-'));
    try {
      const store = createLocalStorageDriver(dir).privateObjects!;
      await store.put(KEY, new Uint8Array([1, 2, 3]), 'application/pdf');
      expect(await store.read(KEY)).toEqual(new Uint8Array([1, 2, 3]));
      expect(await store.signedUrl(KEY, 60)).toBeNull();
      await store.delete(KEY);
      await store.delete(KEY);
      await expect(store.read(KEY)).rejects.toThrow('not found');
      await expect(store.put('staging/x.pdf', new Uint8Array([1]), 'application/pdf')).rejects.toThrow('illegal');
    } finally {
      if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('twings-private-objects-')) throw Error('Unsafe fixture cleanup');
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the R2 driver', () => {
  it('writes at the bucket root (not staging/ or published/), deletes, and signs a short download', async () => {
    const calls: Array<{ method: string; path: string; query: string }> = [];
    const fetcher = (async (request: Request) => {
      const url = new URL(request.url);
      calls.push({ method: request.method, path: url.pathname, query: url.search });
      return new Response(request.method === 'GET' ? new Uint8Array([7]) : null, { status: 200 });
    }) as unknown as typeof fetch;
    const driver = createR2PrivateStorageDriver({ accountId: 'acct', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'private-bucket' } as never, { fetcher });
    const store = driver.privateObjects!;
    await store.put(KEY, new Uint8Array([1]), 'application/pdf');
    expect(await store.read(KEY)).toEqual(new Uint8Array([7]));
    await store.delete(KEY);
    const url = await store.signedUrl(KEY, 600);
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['PUT', `/private-bucket/${KEY}`],
      ['GET', `/private-bucket/${KEY}`],
      ['DELETE', `/private-bucket/${KEY}`],
    ]);
    expect(url).toContain(`/private-bucket/${KEY}?`);
    expect(url).toContain('X-Amz-Expires=60');
    expect(url).toContain('response-content-disposition=attachment');
    await expect(store.put('staging/x', new Uint8Array([1]), 'application/pdf')).rejects.toThrow('illegal');
  });
});
