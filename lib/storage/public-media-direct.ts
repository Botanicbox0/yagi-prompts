import { createHash } from 'node:crypto';
import { STAGING_BUCKET, StorageObjectNotFound, type StorageDriver } from './index';
import { PUBLIC_MEDIA_CACHE_CONTROL, type PublicMediaSyncDeps } from './public-media-sync';

/**
 * docs/BRAND-MOAT-AND-STORAGE.md — once the R2 keys exist, a public file is written straight to R2 and
 * never lands in the Supabase public bucket. Every publish flow goes through `StorageDriver.copy`, so
 * this is the one place that has to know. A failed write or check throws, so the publish shows an error
 * instead of a page pointing at a file that is not there. Every other bucket stays on Supabase.
 */
export type PublicMediaStore = Pick<PublicMediaSyncDeps, 'put' | 'publicGet'> & {
  has(key: string): Promise<boolean>;
};

const CONTENT_ADDRESS = /^([0-9a-f]{64})(\.[a-z0-9]+)?$/;
const CHECK_BYTES = 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

/** `CopyRequest` carries no type, and R2 serves back what it is given. The key's extension decides. */
export function mimeForPublicKey(key: string): string {
  const extension = /\.([a-z0-9]+)$/.exec(key)?.[1];
  return (extension && MIME_BY_EXTENSION[extension]) || 'application/octet-stream';
}

/** Asks for the first bytes through the address a visitor uses, so publishing a film never downloads it. */
async function checkOnPublicHost(store: PublicMediaStore, key: string, bytes: Uint8Array, mime: string): Promise<void> {
  const end = Math.min(CHECK_BYTES, bytes.length) - 1;
  const part = await store.publicGet(key, { start: 0, end });
  const problem =
    part.status !== 206 ? `status ${part.status}`
    : part.contentRange !== `bytes 0-${end}/${bytes.length}` ? `range ${part.contentRange}`
    : !part.contentType?.startsWith(mime) ? `type ${part.contentType}`
    : !part.cacheControl?.includes('immutable') ? `cache ${part.cacheControl}`
    : Buffer.compare(part.bytes, bytes.subarray(0, end + 1)) !== 0 ? 'other bytes'
    : null;
  if (problem) throw new Error(`public media check failed: ${key} — ${problem}`);
}

export function withPublicMediaDirect(driver: StorageDriver, store: PublicMediaStore): StorageDriver {
  return {
    ...driver,

    async copy(request) {
      if (request.toBucket !== 'public-content') return driver.copy(request);
      const { fromKey, toKey } = request;
      const address = CONTENT_ADDRESS.exec(toKey);
      if (!address) throw new Error(`public media key is not a content address: ${toKey}`);

      // An identical content-addressed key is already the right bytes, as on Supabase.
      if (await store.has(toKey)) return 'exists';

      const bytes = await driver.read(STAGING_BUCKET, fromKey);
      if (bytes.length === 0) throw new Error(`public media file is empty: ${fromKey}`);
      if (createHash('sha256').update(bytes).digest('hex') !== address[1]) {
        throw new Error(`public media bytes do not match the key: ${toKey}`);
      }

      const mime = mimeForPublicKey(toKey);
      await store.put(toKey, bytes, { mime, cacheControl: PUBLIC_MEDIA_CACHE_CONTROL });
      await checkOnPublicHost(store, toKey, bytes, mime);
      return 'copied';
    },

    async read(bucket, key) {
      if (bucket !== 'public-content') return driver.read(bucket, key);
      const response = await store.publicGet(key);
      if (response.status === 404) throw new StorageObjectNotFound(bucket, key);
      if (response.status !== 200) throw new Error(`public media read failed: ${key} — status ${response.status}`);
      return response.bytes;
    },

    exists(bucket, key) {
      return bucket === 'public-content' ? store.has(key) : driver.exists(bucket, key);
    },
  };
}
