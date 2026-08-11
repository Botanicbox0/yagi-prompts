import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PublishedBucket } from '@/lib/content/schemas';
import {
  STAGING_BUCKET,
  StorageObjectNotFound,
  type Bucket,
  type CopyOutcome,
  type CopyRequest,
  type StorageDriver,
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

  return {
    name: 'local',

    async putStaging(key, bytes, _contentType) {
      const path = objectPath(root, STAGING_BUCKET, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
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
