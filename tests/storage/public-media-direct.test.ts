import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAGING_BUCKET, StorageObjectNotFound, type CopyRequest, type StorageDriver } from '@/lib/storage';
import { mimeForPublicKey, withPublicMediaDirect, type PublicMediaStore } from '@/lib/storage/public-media-direct';
import { PUBLIC_MEDIA_CACHE_CONTROL, type PublicMediaRead } from '@/lib/storage/public-media-sync';

const BODY = new TextEncoder().encode('x'.repeat(4096));
const keyFor = (bytes: Uint8Array, ext = 'mp4') => `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
const KEY = keyFor(BODY);
const COPY: CopyRequest = { fromKey: 'content/prompt/upload/a.mp4', toBucket: 'public-content', toKey: KEY };

function driverDouble(overrides: Partial<StorageDriver> = {}) {
  const copy = vi.fn<StorageDriver['copy']>(async () => 'copied');
  const read = vi.fn<StorageDriver['read']>(async () => BODY);
  const exists = vi.fn<StorageDriver['exists']>(async () => false);
  const driver = { name: 'supabase', servesSignedUrls: true, copy, read, exists, ...overrides } as unknown as StorageDriver;
  return { driver, copy, read, exists };
}

/** R2 and the public host behind it. `answer` replaces what the public host says for one test. */
function storeDouble(answer?: (key: string, range?: { start: number; end: number }) => PublicMediaRead) {
  const stored = new Map<string, { bytes: Uint8Array; mime: string; cacheControl: string }>();
  const store: PublicMediaStore = {
    has: vi.fn(async (key: string) => stored.has(key)),
    put: vi.fn(async (key, bytes, meta) => { stored.set(key, { bytes, ...meta }); }),
    publicGet: vi.fn(async (key, range) => {
      if (answer) return answer(key, range);
      const object = stored.get(key);
      if (!object) return { status: 404, contentType: null, contentRange: null, cacheControl: null, bytes: new Uint8Array() };
      if (!range) return { status: 200, contentType: object.mime, contentRange: null, cacheControl: object.cacheControl, bytes: object.bytes };
      return {
        status: 206,
        contentType: object.mime,
        contentRange: `bytes ${range.start}-${range.end}/${object.bytes.length}`,
        cacheControl: object.cacheControl,
        bytes: object.bytes.slice(range.start, range.end + 1),
      };
    }),
  };
  return { store, stored };
}

describe('withPublicMediaDirect', () => {
  it('writes a public file to R2 and never to the Supabase public bucket', async () => {
    const { driver, copy, read } = driverDouble();
    const { store, stored } = storeDouble();
    await expect(withPublicMediaDirect(driver, store).copy(COPY)).resolves.toBe('copied');
    expect(copy).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith(STAGING_BUCKET, COPY.fromKey);
    expect(stored.get(KEY)?.bytes).toEqual(BODY);
  });

  it('stores the type a browser needs and a cache header that is safe for a content address', async () => {
    const { driver } = driverDouble();
    const { store, stored } = storeDouble();
    await withPublicMediaDirect(driver, store).copy(COPY);
    expect(stored.get(KEY)).toMatchObject({ mime: 'video/mp4', cacheControl: PUBLIC_MEDIA_CACHE_CONTROL });
  });

  it('leaves every other bucket on Supabase', async () => {
    const { driver, copy } = driverDouble();
    const { store } = storeDouble();
    const request: CopyRequest = { ...COPY, toBucket: 'content-published' };
    await withPublicMediaDirect(driver, store).copy(request);
    expect(copy).toHaveBeenCalledWith(request);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('answers exists without reading the staged file when R2 already has the key', async () => {
    const { driver, read } = driverDouble();
    const { store, stored } = storeDouble();
    stored.set(KEY, { bytes: BODY, mime: 'video/mp4', cacheControl: PUBLIC_MEDIA_CACHE_CONTROL });
    await expect(withPublicMediaDirect(driver, store).copy(COPY)).resolves.toBe('exists');
    expect(read).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses bytes that do not match the key, without uploading them', async () => {
    const { driver } = driverDouble({ read: async () => new TextEncoder().encode('other bytes') });
    const { store } = storeDouble();
    await expect(withPublicMediaDirect(driver, store).copy(COPY)).rejects.toThrow(/do not match/);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses a key that is not a content address, which an immutable cache header would freeze', async () => {
    const { driver } = driverDouble();
    const { store } = storeDouble();
    await expect(withPublicMediaDirect(driver, store).copy({ ...COPY, toKey: 'temp-dm/a.mp4' })).rejects.toThrow(/content address/);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('passes on a missing staged file, which the publish flows already report', async () => {
    const missing = new StorageObjectNotFound(STAGING_BUCKET, COPY.fromKey);
    const { driver } = driverDouble({ read: async () => { throw missing; } });
    const { store } = storeDouble();
    await expect(withPublicMediaDirect(driver, store).copy(COPY)).rejects.toBe(missing);
  });

  it('fails the publish when the write fails, so no page points at a file that is not there', async () => {
    const { driver } = driverDouble();
    const { store } = storeDouble();
    vi.mocked(store.put).mockRejectedValue(new Error('put 500'));
    await expect(withPublicMediaDirect(driver, store).copy(COPY)).rejects.toThrow('put 500');
  });

  const good = (range?: { start: number; end: number }): PublicMediaRead => ({
    status: 206,
    contentType: 'video/mp4',
    contentRange: `bytes 0-${range!.end}/${BODY.length}`,
    cacheControl: PUBLIC_MEDIA_CACHE_CONTROL,
    bytes: BODY.slice(0, range!.end + 1),
  });

  it.each<[string, (range?: { start: number; end: number }) => PublicMediaRead]>([
    ['does not answer a range request', (range) => ({ ...good(range), status: 200 })],
    ['reports another size', (range) => ({ ...good(range), contentRange: `bytes 0-${range!.end}/1` })],
    ['serves the wrong type', (range) => ({ ...good(range), contentType: 'text/plain' })],
    ['does not keep the cache header', (range) => ({ ...good(range), cacheControl: 'no-store' })],
    ['returns other bytes', (range) => ({ ...good(range), bytes: new Uint8Array(range!.end + 1) })],
  ])('fails the publish when the public host %s', async (_label, answer) => {
    const { driver } = driverDouble();
    const { store } = storeDouble((_key, range) => answer(range));
    await expect(withPublicMediaDirect(driver, store).copy(COPY)).rejects.toThrow(/public media check failed/);
  });

  it('checks only the first bytes, so publishing a large film does not download it again', async () => {
    const { driver } = driverDouble();
    const { store } = storeDouble();
    await withPublicMediaDirect(driver, store).copy(COPY);
    expect(store.publicGet).toHaveBeenCalledTimes(1);
    expect(store.publicGet).toHaveBeenCalledWith(KEY, { start: 0, end: 1023 });
  });

  it('checks a file shorter than the probe', async () => {
    const small = new TextEncoder().encode('tiny');
    const { driver } = driverDouble({ read: async () => small });
    const { store } = storeDouble();
    const key = keyFor(small, 'png');
    await expect(withPublicMediaDirect(driver, store).copy({ ...COPY, toKey: key })).resolves.toBe('copied');
    expect(store.publicGet).toHaveBeenCalledWith(key, { start: 0, end: 3 });
  });

  it('answers read and exists for a public key from R2, where the file now lives', async () => {
    const { driver, read, exists } = driverDouble();
    const { store, stored } = storeDouble();
    stored.set(KEY, { bytes: BODY, mime: 'video/mp4', cacheControl: PUBLIC_MEDIA_CACHE_CONTROL });
    const direct = withPublicMediaDirect(driver, store);
    await expect(direct.read('public-content', KEY)).resolves.toEqual(BODY);
    await expect(direct.exists('public-content', KEY)).resolves.toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('answers not found for a public key R2 does not have', async () => {
    const { driver } = driverDouble();
    const { store } = storeDouble();
    await expect(withPublicMediaDirect(driver, store).read('public-content', KEY)).rejects.toBeInstanceOf(StorageObjectNotFound);
  });

  it('keeps reading staging and private buckets from Supabase', async () => {
    const { driver, read, exists } = driverDouble();
    const { store } = storeDouble();
    const direct = withPublicMediaDirect(driver, store);
    await direct.read(STAGING_BUCKET, 'content/a.mp4');
    await direct.exists('content-published', 'a.mp4');
    expect(read).toHaveBeenCalledWith(STAGING_BUCKET, 'content/a.mp4');
    expect(exists).toHaveBeenCalledWith('content-published', 'a.mp4');
    expect(store.publicGet).not.toHaveBeenCalled();
  });
});

describe('mimeForPublicKey', () => {
  it.each([
    ['a.mp4', 'video/mp4'],
    ['a.mov', 'video/quicktime'],
    ['a.webm', 'video/webm'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
    ['a.avif', 'image/avif'],
    ['a.mp3', 'audio/mpeg'],
    ['a.wav', 'audio/wav'],
    ['a.m4a', 'audio/mp4'],
    ['a.aac', 'audio/aac'],
    ['a.ogg', 'audio/ogg'],
    ['a.flac', 'audio/flac'],
  ])('%s is %s', (key, mime) => {
    expect(mimeForPublicKey(key)).toBe(mime);
  });

  it('falls back to a plain download for anything else', () => {
    expect(mimeForPublicKey('a.bin')).toBe('application/octet-stream');
    expect(mimeForPublicKey('no-extension')).toBe('application/octet-stream');
  });
});

describe('getStorage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@/lib/storage/supabase-driver');
    vi.doUnmock('@/lib/storage/r2-public');
  });

  async function load() {
    const { driver, copy } = driverDouble();
    const { store } = storeDouble();
    vi.resetModules();
    vi.doMock('@/lib/storage/supabase-driver', () => ({ createSupabaseStorageDriver: () => driver }));
    vi.doMock('@/lib/storage/r2-public', () => ({ createR2PublicMediaStore: () => store }));
    const { getStorage } = await import('@/lib/storage');
    return { getStorage, copy, store };
  }

  function cloud(): void {
    vi.stubEnv('PLAYBOOK_MODE', 'cloud');
    vi.stubEnv('STORAGE_DRIVER', 'supabase');
    vi.stubEnv('PUBLIC_MEDIA_BASE_URL', 'https://media.twings.app');
  }

  it('keeps publishing to Supabase until the R2 keys exist, so nothing breaks before they do', async () => {
    cloud();
    vi.stubEnv('R2_ACCOUNT_ID', '');
    const { getStorage, copy, store } = await load();
    await (await getStorage()).copy(COPY);
    expect(copy).toHaveBeenCalledWith(COPY);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('publishes to R2 once the keys exist', async () => {
    cloud();
    vi.stubEnv('R2_ACCOUNT_ID', 'account');
    vi.stubEnv('R2_ACCESS_KEY_ID', 'access');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('R2_PUBLIC_BUCKET', 'twings-media-apac');
    const { getStorage, copy, store } = await load();
    await (await getStorage()).copy(COPY);
    expect(copy).not.toHaveBeenCalled();
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it('sends explicit Content-Length on R2 PUT so Next.js patched fetch never triggers 411 Length Required', async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/storage/r2-public');
    const { createR2PublicMediaStore } = await import('@/lib/storage/r2-public');
    let capturedHeaders = new Headers();
    const origFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input instanceof Request) {
        const rewrapped = new Request(input.url, {
          method: input.method,
          headers: input.headers,
          body: input.body,
          // @ts-expect-error Node RequestInit duplex
          duplex: 'half',
        });
        capturedHeaders = rewrapped.headers;
      } else {
        capturedHeaders = new Headers(init?.headers);
      }
      return new Response('', { status: 200 });
    });
    try {
      const r2Store = createR2PublicMediaStore({
        accountId: 'account',
        accessKeyId: 'access',
        secretAccessKey: 'secret',
        bucket: 'twings-media-apac',
        mediaBaseUrl: 'https://media.twings.app',
      });
      await r2Store.put(KEY, BODY, { mime: 'image/webp', cacheControl: PUBLIC_MEDIA_CACHE_CONTROL });
      expect(capturedHeaders.get('content-length')).toBe(String(BODY.byteLength));
      expect(capturedHeaders.get('content-type')).toBe('image/webp');
      expect(capturedHeaders.get('cache-control')).toBe(PUBLIC_MEDIA_CACHE_CONTROL);
    } finally {
      vi.stubGlobal('fetch', origFetch);
    }
  });
});
