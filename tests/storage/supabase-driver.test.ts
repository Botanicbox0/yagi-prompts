import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseStorageDriver } from '@/lib/storage/supabase-driver';
import { StorageObjectNotFound } from '@/lib/storage';

/**
 * M7 — the production driver's CONTRACT, against a recording double.
 *
 * The live project is smoke-tested separately (`npm run cloud:smoke`); what belongs here is the
 * behaviour that must hold whatever the network says, and that a cloud round trip would prove
 * slowly and flakily:
 *
 *   · `copy` is upsert:false in both of its failure shapes — key already there, and a race that
 *     puts it there between the check and the copy. Both are SUCCESS ('exists'), never overwrite;
 *   · a missing SOURCE is `StorageObjectNotFound`, not a generic error, because the publish
 *     pipeline distinguishes them;
 *   · signed URLs are clamped to ≤60s no matter what the caller asks for (§3.3);
 *   · `publicUrl` is only ever built for `public-content`;
 *   · `servesSignedUrls` is true, which is what makes the media gateway redirect instead of
 *     streaming the bytes through the app server.
 */

type StorageError = { message: string; statusCode?: string };

interface FakeBucketState {
  objects: Map<string, { body: string; contentType: string }>;
}

interface Call {
  op: string;
  bucket: string;
  key: string;
  extra?: string;
}

function fakeClient(seed: Record<string, string[]> = {}) {
  const buckets = new Map<string, FakeBucketState>();
  const calls: Call[] = [];
  const forced = new Map<string, StorageError>();

  const bucketOf = (name: string): FakeBucketState => {
    if (!buckets.has(name)) buckets.set(name, { objects: new Map() });
    return buckets.get(name)!;
  };
  for (const [name, keys] of Object.entries(seed)) {
    for (const key of keys) bucketOf(name).objects.set(key, { body: key, contentType: 'text/plain' });
  }

  const from = (bucket: string) => ({
    async upload(key: string, body: Blob, options: { contentType: string; upsert: boolean }) {
      calls.push({ op: 'upload', bucket, key, extra: String(options.upsert) });
      const forcedError = forced.get(`upload:${key}`);
      if (forcedError) return { data: null, error: forcedError };
      if (bucketOf(bucket).objects.has(key) && !options.upsert) {
        return { data: null, error: { message: 'Duplicate', statusCode: '409' } };
      }
      bucketOf(bucket).objects.set(key, { body: await body.text(), contentType: options.contentType });
      return { data: { path: key }, error: null };
    },
    async exists(key: string) {
      calls.push({ op: 'exists', bucket, key });
      return { data: bucketOf(bucket).objects.has(key), error: null };
    },
    async download(key: string) {
      calls.push({ op: 'download', bucket, key });
      const object = bucketOf(bucket).objects.get(key);
      if (!object) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
      return { data: new Blob([object.body]), error: null };
    },
    async copy(fromKey: string, toKey: string, options?: { destinationBucket?: string }) {
      const target = options?.destinationBucket ?? bucket;
      calls.push({ op: 'copy', bucket: target, key: toKey, extra: fromKey });
      const forcedError = forced.get(`copy:${toKey}`);
      if (forcedError) return { data: null, error: forcedError };
      const source = bucketOf(bucket).objects.get(fromKey);
      if (!source) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
      bucketOf(target).objects.set(toKey, source);
      return { data: { path: toKey }, error: null };
    },
    async createSignedUrl(key: string, expiresIn: number) {
      calls.push({ op: 'sign', bucket, key, extra: String(expiresIn) });
      if (!bucketOf(bucket).objects.has(key)) {
        return { data: null, error: { message: 'Object not found', statusCode: '404' } };
      }
      return { data: { signedUrl: `https://p.supabase.co/${bucket}/${key}?token=x` }, error: null };
    },
    getPublicUrl(key: string) {
      calls.push({ op: 'public', bucket, key });
      return {
        data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/${bucket}/${key}` },
      };
    },
  });

  return {
    client: { storage: { from } } as unknown as SupabaseClient,
    calls,
    buckets,
    forceError(op: 'upload' | 'copy', key: string, error: StorageError) {
      forced.set(`${op}:${key}`, error);
    },
  };
}

describe('supabase storage driver', () => {
  it('declares the redirect contract the media gateway branches on', () => {
    const { client } = fakeClient();
    const driver = createSupabaseStorageDriver(client);
    expect(driver.name).toBe('supabase');
    expect(driver.servesSignedUrls).toBe(true);
  });

  it('writes staging with upsert:false', async () => {
    const fake = fakeClient();
    const driver = createSupabaseStorageDriver(fake.client);
    await driver.putStaging('rev/r1/a.png', new TextEncoder().encode('bytes'), 'image/png');

    expect(fake.calls).toContainEqual({
      op: 'upload',
      bucket: 'content',
      key: 'rev/r1/a.png',
      extra: 'false',
    });
    expect(await driver.exists('content', 'rev/r1/a.png')).toBe(true);
  });

  it('treats a re-uploaded staging key as done, not as an error', async () => {
    const fake = fakeClient({ content: ['rev/r1/a.png'] });
    const driver = createSupabaseStorageDriver(fake.client);
    await expect(
      driver.putStaging('rev/r1/a.png', new TextEncoder().encode('x'), 'image/png'),
    ).resolves.toBeUndefined();
  });

  it('surfaces a real upload failure', async () => {
    const fake = fakeClient();
    fake.forceError('upload', 'rev/r1/a.png', { message: 'quota exceeded', statusCode: '507' });
    const driver = createSupabaseStorageDriver(fake.client);
    await expect(
      driver.putStaging('rev/r1/a.png', new TextEncoder().encode('x'), 'image/png'),
    ).rejects.toThrow(/quota exceeded/);
  });

  it('copies staging → a published bucket', async () => {
    const fake = fakeClient({ content: ['rev/r1/a.png'] });
    const driver = createSupabaseStorageDriver(fake.client);

    const outcome = await driver.copy({
      fromKey: 'rev/r1/a.png',
      toBucket: 'content-published',
      toKey: 'sha.png',
    });

    expect(outcome).toBe('copied');
    expect(fake.buckets.get('content-published')?.objects.has('sha.png')).toBe(true);
    // The staging original is untouched — there is no move, and no delete path anywhere (§6).
    expect(fake.buckets.get('content')?.objects.has('rev/r1/a.png')).toBe(true);
  });

  it('upsert:false — an existing destination key is SUCCESS and no copy is attempted', async () => {
    const fake = fakeClient({ content: ['rev/r1/a.png'], 'content-published': ['sha.png'] });
    const driver = createSupabaseStorageDriver(fake.client);

    const outcome = await driver.copy({
      fromKey: 'rev/r1/a.png',
      toBucket: 'content-published',
      toKey: 'sha.png',
    });

    expect(outcome).toBe('exists');
    expect(fake.calls.filter((c) => c.op === 'copy')).toEqual([]);
  });

  it('upsert:false — a duplicate raised by a RACE is also success', async () => {
    const fake = fakeClient({ content: ['rev/r1/a.png'] });
    // The exists-check says no; the copy says "already there" — i.e. another publisher won.
    fake.forceError('copy', 'sha.png', { message: 'The resource already exists', statusCode: '409' });
    const driver = createSupabaseStorageDriver(fake.client);

    await expect(
      driver.copy({ fromKey: 'rev/r1/a.png', toBucket: 'content-published', toKey: 'sha.png' }),
    ).resolves.toBe('exists');
  });

  it('a missing staging source is StorageObjectNotFound', async () => {
    const fake = fakeClient();
    const driver = createSupabaseStorageDriver(fake.client);
    await expect(
      driver.copy({ fromKey: 'rev/r1/gone.png', toBucket: 'content-published', toKey: 'sha.png' }),
    ).rejects.toBeInstanceOf(StorageObjectNotFound);
  });

  it('a genuine copy failure is NOT swallowed as success', async () => {
    const fake = fakeClient({ content: ['rev/r1/a.png'] });
    fake.forceError('copy', 'sha.png', { message: 'network unreachable', statusCode: '500' });
    const driver = createSupabaseStorageDriver(fake.client);
    await expect(
      driver.copy({ fromKey: 'rev/r1/a.png', toBucket: 'content-published', toKey: 'sha.png' }),
    ).rejects.toThrow(/network unreachable/);
  });

  it('clamps signed URLs to the ≤60s gateway ceiling', async () => {
    const fake = fakeClient({ 'content-published': ['sha.png'] });
    const driver = createSupabaseStorageDriver(fake.client);

    await driver.signedUrl('content-published', 'sha.png', 3600);
    await driver.signedUrl('content-published', 'sha.png', 45);
    await driver.signedUrl('content-published', 'sha.png', 0);

    expect(fake.calls.filter((c) => c.op === 'sign').map((c) => c.extra)).toEqual(['60', '45', '1']);
  });

  it('signing a missing object is StorageObjectNotFound', async () => {
    const fake = fakeClient();
    const driver = createSupabaseStorageDriver(fake.client);
    await expect(driver.signedUrl('content-published', 'gone.png', 60)).rejects.toBeInstanceOf(
      StorageObjectNotFound,
    );
  });

  it('reads bytes back, and reports a missing object as not-found', async () => {
    const fake = fakeClient({ content: ['rev/r1/a.png'] });
    const driver = createSupabaseStorageDriver(fake.client);

    expect(new TextDecoder().decode(await driver.read('content', 'rev/r1/a.png'))).toBe(
      'rev/r1/a.png',
    );
    await expect(driver.read('content', 'nope.png')).rejects.toBeInstanceOf(StorageObjectNotFound);
  });

  it('builds public URLs only for public-content', async () => {
    const fake = fakeClient();
    const driver = createSupabaseStorageDriver(fake.client);

    expect(driver.publicUrl('sha.png')).toBe(
      'https://p.supabase.co/storage/v1/object/public/public-content/sha.png',
    );
    expect(fake.calls.filter((c) => c.op === 'public').every((c) => c.bucket === 'public-content'))
      .toBe(true);
  });

  it('exposes no delete method — write-once is a security property, not a policy', () => {
    const { client } = fakeClient();
    const driver = createSupabaseStorageDriver(client) as unknown as Record<string, unknown>;
    for (const forbidden of ['delete', 'remove', 'unlink', 'destroy']) {
      expect(driver[forbidden]).toBeUndefined();
    }
  });
});
