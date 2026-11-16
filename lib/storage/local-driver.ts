import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PublishedBucket } from '@/lib/content/schemas';
import {
  STAGING_BUCKET,
  StorageObjectNotFound,
  type Bucket,
  type CopyOutcome,
  type CopyRequest,
  type PrivateObjectStore,
  type StorageDriver,
  isPrivateObjectKey,
} from './index';

/**
 * Local-filesystem driver used by dev and the vitest/seed acceptance path.
 * Root defaults to `.storage/` (gitignored). Implements the §6 bucket semantics exactly —
 * including `upsert: false` and the absence of any delete path — so the Supabase driver is a
 * swap, not a rewrite.
 */

function bucketRoot(root: string, bucket: Bucket): string {
  return join(root, bucket);
}

function objectPath(root: string, bucket: Bucket, key: string): string {
  // Keys are authored, never user-supplied at runtime; still, refuse traversal outright.
  const full = resolve(join(bucketRoot(root, bucket), key));
  const base = resolve(bucketRoot(root, bucket));
  if (full !== base && !full.startsWith(base + (process.platform === 'win32' ? '\\' : '/'))) {
    throw new Error(`illegal storage key: ${key}`);
  }
  return full;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function createLocalStorageDriver(rootDir?: string): StorageDriver {
  const root = resolve(rootDir ?? process.env.STORAGE_LOCAL_ROOT ?? '.storage');

  // Private objects live under `.storage/private/`, apart from every bucket (lib/storage/index.ts).
  const privatePath = (key: string): string => {
    if (!isPrivateObjectKey(key)) throw new Error('illegal private object key');
    const base = resolve(join(root, 'private'));
    const full = resolve(join(base, key));
    if (!full.startsWith(base + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('illegal private object key');
    return full;
  };
  const privateObjects: PrivateObjectStore = {
    async put(key, bytes) {
      const path = privatePath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async read(key) {
      const path = privatePath(key);
      if (!(await fileExists(path))) throw new StorageObjectNotFound('private', key);
      return new Uint8Array(await readFile(path));
    },
    async delete(key) {
      await rm(privatePath(key), { force: true });
    },
    async signedUrl() {
      return null;
    },
  };

  return {
    name: 'local',
    privateObjects,
    // `.storage/` is a directory on disk; nothing serves it over HTTP. The gateway streams instead.
    servesSignedUrls: false,

    /** No service to PUT to — the client posts the file inline, as it always did. */
    async signedUploadUrl() {
      return null;
    },

    async signedStagingUrl() { return null; },

    async putStaging(key, bytes, _contentType) {
      const path = objectPath(root, STAGING_BUCKET, key);
      await mkdir(dirname(path), { recursive: true });
      // A retried upload may not replace an attachment whose hash/version was already approved.
      try { await writeFile(path, bytes, { flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    },

    async releaseStaging(key: string) {
      await rm(objectPath(root, STAGING_BUCKET, key), { force: true });
    },

    async exists(bucket: Bucket, key: string) {
      return fileExists(objectPath(root, bucket, key));
    },

    async read(bucket: Bucket, key: string) {
      const path = objectPath(root, bucket, key);
      if (!(await fileExists(path))) throw new StorageObjectNotFound(bucket, key);
      return new Uint8Array(await readFile(path));
    },

    async copy({ fromKey, toBucket, toKey }: CopyRequest): Promise<CopyOutcome> {
      const target = objectPath(root, toBucket, toKey);
      // upsert:false — content-addressed keys make an existing object identical by construction.
      if (await fileExists(target)) return 'exists';
      const source = objectPath(root, STAGING_BUCKET, fromKey);
      if (!(await fileExists(source))) throw new StorageObjectNotFound(STAGING_BUCKET, fromKey);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(source));
      return 'copied';
    },

    async signedUrl(bucket: PublishedBucket, key: string, expiresInSeconds: number) {
      const expiresAt = Date.now() + expiresInSeconds * 1000;
      return `/.storage/${bucket}/${key}?expires=${expiresAt}`;
    },

    publicUrl(key: string) {
      return `/.storage/public-content/${key}`;
    },
  };
}
