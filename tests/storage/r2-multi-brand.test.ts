import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { privateStorageR2Config, selectStorageDriver, type EnvLike } from '@/lib/runtime-mode';
import { STAGING_BUCKET, StorageObjectNotFound, type StorageDriver } from '@/lib/storage';
import { withPublicMediaDirect, type PublicMediaStore } from '@/lib/storage/public-media-direct';
import { PUBLIC_MEDIA_CACHE_CONTROL } from '@/lib/storage/public-media-sync';
import {
  assertSafeStorageKey,
  brandTenantStorageKey,
  buildMultiBrandR2CorsXml,
  buildMultiBrandR2LifecycleXml,
  createR2PrivateStorageDriver,
  parseBrandTenantKey,
} from '@/lib/storage/r2-private';

const CLOUD_BASE: EnvLike = {
  DATABASE_URL: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres',
  NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
};

const R2_PRIVATE_ENV: EnvLike = {
  ...CLOUD_BASE,
  R2_ACCOUNT_ID: 'acc1234567890abcdef',
  R2_ACCESS_KEY_ID: 'ak_test_123',
  R2_SECRET_ACCESS_KEY: 'sk_test_456',
  R2_PRIVATE_BUCKET: 'twings-private-apac',
};

describe('multi-brand R2 runtime selection', () => {
  it('stays on supabase when R2_PRIVATE_BUCKET is not set', () => {
    expect(privateStorageR2Config(CLOUD_BASE)).toBeNull();
    expect(selectStorageDriver(CLOUD_BASE)).toBe('supabase');
    expect(selectStorageDriver({ ...CLOUD_BASE, STORAGE_DRIVER: 's3' })).toBe('supabase');
  });

  it('switches cloud private storage to r2 when R2_PRIVATE_BUCKET and R2 credentials are present', () => {
    expect(privateStorageR2Config(R2_PRIVATE_ENV)).toEqual({
      accountId: 'acc1234567890abcdef',
      accessKeyId: 'ak_test_123',
      secretAccessKey: 'sk_test_456',
      bucket: 'twings-private-apac',
    });
    expect(selectStorageDriver(R2_PRIVATE_ENV)).toBe('r2');
  });

  it('never leaks cloud R2 private storage into PLAYBOOK_MODE=local unless explicitly overridden', () => {
    expect(privateStorageR2Config({ ...R2_PRIVATE_ENV, PLAYBOOK_MODE: 'local' })).toBeNull();
    expect(selectStorageDriver({ ...R2_PRIVATE_ENV, PLAYBOOK_MODE: 'local' })).toBe('local');
    expect(selectStorageDriver({ ...R2_PRIVATE_ENV, STORAGE_DRIVER: 'supabase' })).toBe('supabase');
  });

  it('prefers dedicated R2_PRIVATE_ACCESS_KEY_ID over shared R2_ACCESS_KEY_ID when supplied', () => {
    const cfg = privateStorageR2Config({
      ...R2_PRIVATE_ENV,
      R2_PRIVATE_ACCESS_KEY_ID: 'priv_ak',
      R2_PRIVATE_SECRET_ACCESS_KEY: 'priv_sk',
    });
    expect(cfg?.accessKeyId).toBe('priv_ak');
    expect(cfg?.secretAccessKey).toBe('priv_sk');
  });
});

describe('multi-brand tenant key isolation', () => {
  const ORG_A = 'd425c3b1-4066-4970-8a3b-93c52b3eef70';
  const ORG_B = 'f5a6993b-1951-497e-a4da-3f221892f85e';
  const FILE_UUID = '5c3915bc-9388-4b40-a413-f0c332ad0637';

  it('builds deterministic org-scoped keys and verifies tenant ownership', () => {
    const key = brandTenantStorageKey({
      organizationId: ORG_A,
      surface: 'rooms',
      ext: 'mp4',
      id: FILE_UUID,
      now: new Date('2026-11-12T00:00:00Z'),
    });
    expect(key).toBe(`orgs/${ORG_A}/rooms/2026-11/${FILE_UUID}.mp4`);
    expect(parseBrandTenantKey(key)).toEqual({
      organizationId: ORG_A,
      surface: 'rooms',
      yearMonth: '2026-11',
      filename: `${FILE_UUID}.mp4`,
    });
    expect(parseBrandTenantKey(key)?.organizationId === ORG_B).toBe(false);
  });

  it('rejects path traversal, empty segments, leading slashes, and control characters', () => {
    for (const bad of ['', '/a.mp4', 'a/../b.mp4', 'a//b.mp4', 'a\\b.mp4', 'orgs/x\u0000/a.mp4']) {
      expect(() => assertSafeStorageKey(bad)).toThrow(/illegal storage key/i);
    }
  });
});

describe('createR2PrivateStorageDriver', () => {
  function fakeFetch(initial: Record<string, Uint8Array> = {}) {
    const objects = new Map<string, { bytes: Uint8Array; headers: Record<string, string> }>();
    for (const [k, v] of Object.entries(initial)) {
      objects.set(k, { bytes: v, headers: { 'content-type': 'application/octet-stream' } });
    }
    const calls: Array<{ method: string; url: string; headers: Headers }> = [];

    const fetcher: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const u = new URL(req.url);
      const pathKey = decodeURIComponent(u.pathname.replace(/^\/twings-private-apac\//, ''));
      calls.push({ method: req.method, url: req.url, headers: req.headers });

      if (req.method === 'HEAD') {
        const hit = objects.get(pathKey);
        if (!hit) return new Response(null, { status: 404 });
        return new Response(null, {
          status: 200,
          headers: { 'content-length': String(hit.bytes.byteLength), ...hit.headers },
        });
      }
      if (req.method === 'PUT') {
        const buf = new Uint8Array(await req.arrayBuffer());
        objects.set(pathKey, {
          bytes: buf,
          headers: {
            'content-type': req.headers.get('content-type') ?? 'application/octet-stream',
            'cache-control': req.headers.get('cache-control') ?? '',
          },
        });
        return new Response('', { status: 200 });
      }
      if (req.method === 'GET') {
        const hit = objects.get(pathKey);
        if (!hit) return new Response('NotFound', { status: 404 });
        return new Response(Buffer.from(hit.bytes), { status: 200, headers: hit.headers });
      }
      if (req.method === 'DELETE') {
        const existed = objects.delete(pathKey);
        return new Response(null, { status: existed ? 204 : 404 });
      }
      return new Response('Unsupported', { status: 405 });
    };

    return { fetcher, objects, calls };
  }

  const CONFIG = {
    accountId: 'acc1234567890abcdef',
    accessKeyId: 'ak_test_123',
    secretAccessKey: 'sk_test_456',
    bucket: 'twings-private-apac',
  };

  it('preserves write-once posture on published methods while offering releaseStaging', async () => {
    const { fetcher, objects } = fakeFetch();
    const driver = createR2PrivateStorageDriver(CONFIG, { fetcher });
    const record = driver as unknown as Record<string, unknown>;
    for (const forbidden of ['delete', 'remove', 'unlink', 'destroy']) {
      expect(record[forbidden]).toBeUndefined();
    }

    const body = new TextEncoder().encode('hello');
    await driver.putStaging('staging/rooms/a.txt', body, 'text/plain');
    // Retry must not overwrite
    await driver.putStaging('staging/rooms/a.txt', new TextEncoder().encode('tampered'), 'text/plain');
    expect(await driver.read(STAGING_BUCKET, 'staging/rooms/a.txt')).toEqual(body);

    await driver.releaseStaging!('staging/rooms/a.txt');
    expect(objects.size).toBe(0);
    // Missing key on releaseStaging is idempotent
    await expect(driver.releaseStaging!('staging/rooms/a.txt')).resolves.toBeUndefined();
  });

  it('mints S3 presigned PUT (900s) and attachment-forced presigned GET (<=60s)', async () => {
    const key = 'orgs/d425c3b1-4066-4970-8a3b-93c52b3eef70/rooms/2026-11/5c3915bc-9388-4b40-a413-f0c332ad0637.mp4';
    const { fetcher } = fakeFetch({ [`staging/${key}`]: new Uint8Array([1, 2, 3]) });
    const driver = createR2PrivateStorageDriver(CONFIG, { fetcher });

    const putUrl = await driver.signedUploadUrl(key, 'video/mp4');
    expect(putUrl).toContain('https://acc1234567890abcdef.r2.cloudflarestorage.com/twings-private-apac/staging/');
    expect(putUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(putUrl).toContain('X-Amz-Expires=900');

    const getUrl = await driver.signedStagingUrl!(key, 3600);
    expect(getUrl).toContain('X-Amz-Expires=60');
    expect(getUrl).toContain('response-content-disposition=attachment');

    await expect(driver.signedStagingUrl!('orgs/missing/file.mp4', 60)).rejects.toBeInstanceOf(StorageObjectNotFound);
  });

  it('falls back seamlessly to legacy Supabase driver when an older brand attachment is not yet in R2', async () => {
    const { fetcher } = fakeFetch();
    const legacyBytes = new TextEncoder().encode('morphic-legacy-pdf');
    const legacy = {
      exists: vi.fn(async (_b: string, k: string) => k === 'brands/deb648e9/doc.pdf'),
      read: vi.fn(async (_b: string, k: string) => {
        if (k === 'brands/deb648e9/doc.pdf') return legacyBytes;
        throw new StorageObjectNotFound('content', k);
      }),
      signedStagingUrl: vi.fn(async (k: string) =>
        k === 'brands/deb648e9/doc.pdf' ? 'https://legacy.supabase.co/signed/doc.pdf' : null,
      ),
      signedUrl: vi.fn(async () => 'https://legacy.supabase.co/pub-priv'),
    } as unknown as StorageDriver;

    const driver = createR2PrivateStorageDriver(CONFIG, { fetcher, legacyFallback: legacy });
    expect(await driver.exists(STAGING_BUCKET, 'brands/deb648e9/doc.pdf')).toBe(true);
    expect(await driver.read(STAGING_BUCKET, 'brands/deb648e9/doc.pdf')).toEqual(legacyBytes);
    expect(await driver.signedStagingUrl!('brands/deb648e9/doc.pdf', 60)).toBe(
      'https://legacy.supabase.co/signed/doc.pdf',
    );
  });
});

describe('automatic staging release on verified R2 publish', () => {
  const BODY = new TextEncoder().encode('v'.repeat(2048));
  const HASH = createHash('sha256').update(BODY).digest('hex');
  const PUB_KEY = `${HASH}.mp4`;

  it('releases prompt staging file after R2 206 verification succeeds, never on failure, and keeps playbook rev staging', async () => {
    const releaseStaging = vi.fn(async () => undefined);
    const baseDriver = {
      name: 'supabase',
      servesSignedUrls: true,
      read: vi.fn(async () => BODY),
      exists: vi.fn(async () => true),
      copy: vi.fn(async () => 'copied' as const),
      releaseStaging,
    } as unknown as StorageDriver;

    let shouldFailProbe = true;
    const store: PublicMediaStore = {
      has: vi.fn(async () => false),
      put: vi.fn(async () => undefined),
      publicGet: vi.fn(async (_k, range) => ({
        status: shouldFailProbe ? 500 : 206,
        contentType: 'video/mp4',
        contentRange: `bytes 0-${range!.end}/${BODY.byteLength}`,
        cacheControl: PUBLIC_MEDIA_CACHE_CONTROL,
        bytes: BODY.subarray(0, range!.end + 1),
      })),
    };

    const direct = withPublicMediaDirect(baseDriver, store);

    // 1. Probe fails -> must NOT release staging!
    await expect(
      direct.copy({ fromKey: 'content/prompt/upload/abc.mp4', toBucket: 'public-content', toKey: PUB_KEY }),
    ).rejects.toThrow(/public media check failed/);
    expect(releaseStaging).not.toHaveBeenCalled();

    // 2. Probe succeeds -> releases prompt staging key automatically!
    shouldFailProbe = false;
    await expect(
      direct.copy({ fromKey: 'content/prompt/upload/abc.mp4', toBucket: 'public-content', toKey: PUB_KEY }),
    ).resolves.toBe('copied');
    expect(releaseStaging).toHaveBeenCalledWith('content/prompt/upload/abc.mp4');

    // 3. Playbook revision staging (`content/rev/...`) is kept for draft cloning!
    releaseStaging.mockClear();
    await expect(
      direct.copy({ fromKey: 'content/rev/r1/abc.mp4', toBucket: 'public-content', toKey: PUB_KEY }),
    ).resolves.toBe('copied');
    expect(releaseStaging).not.toHaveBeenCalled();
  });
});

describe('multi-brand R2 CORS and Lifecycle configuration XML', () => {
  it('generates valid S3 CORS and Lifecycle XML covering brand/admin origins, Range headers, 1d multipart abort, and 7d staging expiry', () => {
    const cors = buildMultiBrandR2CorsXml();
    expect(cors).toContain('<AllowedOrigin>https://twings.app</AllowedOrigin>');
    expect(cors).toContain('<AllowedOrigin>https://brand.twings.app</AllowedOrigin>');
    expect(cors).toContain('<AllowedOrigin>https://admin.twings.app</AllowedOrigin>');
    expect(cors).toContain('<AllowedMethod>PUT</AllowedMethod>');
    expect(cors).toContain('<ExposeHeader>Content-Range</ExposeHeader>');

    const lifecycle = buildMultiBrandR2LifecycleXml({ includeStagingExpiry: true });
    expect(lifecycle).toContain('<DaysAfterInitiation>1</DaysAfterInitiation>');
    expect(lifecycle).toContain('<Prefix>staging/</Prefix>');
    expect(lifecycle).toContain('<Prefix>content/prompt/</Prefix>');
    expect(lifecycle).toContain('<Days>7</Days>');
  });
});
