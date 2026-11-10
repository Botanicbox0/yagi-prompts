/**
 * Where studio results and library files live (docs/BRAND-STUDIO-V2.md §6).
 *
 * Production: the R2 public bucket behind `PUBLIC_MEDIA_BASE_URL`, under unguessable 256-bit random
 * keys (`st/<64 hex>.<ext>`). Nothing lists or indexes them; the key is the capability. Deleting a
 * result or an asset deletes the object. Not Supabase storage: its egress quota took sign-in down on
 * 2026-11-02. Private bucket + signed URLs is a later step (§14-4).
 *
 * Local / unconfigured: `.storage/content/st/…` through the existing local driver, served by
 * `/api/brand-studio/media/<key>`.
 */
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { publicMediaR2Config, type EnvLike, type PublicMediaR2Config } from '@/lib/runtime-mode';
import { STAGING_BUCKET, StorageObjectNotFound } from '@/lib/storage';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { createR2PublicMediaStore } from '@/lib/storage/r2-public';

export interface StudioMediaStore {
  readonly kind: 'r2' | 'local' | 'memory';
  /** Stores bytes under a fresh random key. */
  put(bytes: Uint8Array, mime: string): Promise<{ key: string }>;
  read(key: string): Promise<Uint8Array>;
  /** Removes the object; a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** A displayable address: absolute in production, the local gateway path otherwise. */
  url(key: string): string;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};
const MIMES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(EXTENSIONS).map(([m, e]) => [e, m]));

export const STUDIO_MEDIA_KEY = /^st\/[0-9a-f]{64}\.(?:png|jpg|webp|mp4|mov|mp3|wav)$/;

export function isStudioMediaKey(key: string): boolean {
  return STUDIO_MEDIA_KEY.test(key);
}

/** A fresh key for `mime`; throws for a type the studio never stores. */
export function newStudioMediaKey(mime: string): string {
  const ext = EXTENSIONS[mime];
  if (!ext) throw new Error(`studio media: unsupported type ${mime}`);
  return `st/${randomBytes(32).toString('hex')}.${ext}`;
}

export function mimeForStudioKey(key: string): string {
  const ext = /\.([a-z0-9]+)$/.exec(key)?.[1] ?? '';
  return MIMES[ext] ?? 'application/octet-stream';
}

function assertKey(key: string): void {
  if (!isStudioMediaKey(key)) throw new Error('studio media: illegal key');
}

/** Random keys are never rewritten, but a deleted object should leave the edge cache within the hour. */
const CACHE_CONTROL = 'public, max-age=3600';

export const LOCAL_MEDIA_ROUTE = '/api/brand-studio/media';

export function createLocalMediaStore(rootDir?: string): StudioMediaStore {
  const root = resolve(rootDir ?? process.env.STORAGE_LOCAL_ROOT ?? '.storage');
  const driver = createLocalStorageDriver(root);
  return {
    kind: 'local',
    async put(bytes, mime) {
      const key = newStudioMediaKey(mime);
      await driver.putStaging(key, bytes, mime);
      return { key };
    },
    async read(key) {
      assertKey(key);
      return driver.read(STAGING_BUCKET, key);
    },
    async delete(key) {
      assertKey(key);
      // The key regex already rules out traversal; the path is rebuilt the way the driver builds it.
      await rm(join(root, STAGING_BUCKET, ...key.split('/')), { force: true });
    },
    url: (key) => `${LOCAL_MEDIA_ROUTE}/${key}`,
  };
}

export function createR2MediaStore(env: EnvLike = process.env, forced?: PublicMediaR2Config | null): StudioMediaStore | null {
  const config = forced ?? publicMediaR2Config(env);
  if (!config) return null;
  const store = createR2PublicMediaStore(config);
  const base = config.mediaBaseUrl.replace(/\/$/, '');
  return {
    kind: 'r2',
    async put(bytes, mime) {
      const key = newStudioMediaKey(mime);
      await store.put(key, bytes, { mime, cacheControl: CACHE_CONTROL });
      return { key };
    },
    async read(key) {
      assertKey(key);
      const response = await store.publicGet(key);
      if (response.status === 404) throw new StorageObjectNotFound('studio', key);
      if (response.status !== 200) throw new Error(`studio media read ${response.status}`);
      return response.bytes;
    },
    async delete(key) {
      assertKey(key);
      await store.delete(key);
    },
    url: (key) => `${base}/${key}`,
  };
}

/**
 * Local mode hides the media host on purpose, so a laptop writes to `.storage/`. A live check against
 * the real provider from a laptop needs files the provider can fetch: `BRAND_STUDIO_MEDIA=r2` opts in
 * and reads the same five values directly. It writes into the real bucket, so it belongs in a one-off
 * shell or launch entry, never in a shared or deployed environment.
 */
function optedInR2Config(env: EnvLike): PublicMediaR2Config | null {
  if (env.BRAND_STUDIO_MEDIA?.trim() !== 'r2') return null;
  const value = (name: string) => env[name]?.trim() || null;
  const mediaBaseUrl = value('PUBLIC_MEDIA_BASE_URL');
  const accountId = value('R2_ACCOUNT_ID');
  const accessKeyId = value('R2_ACCESS_KEY_ID');
  const secretAccessKey = value('R2_SECRET_ACCESS_KEY');
  const bucket = value('R2_PUBLIC_BUCKET');
  if (!mediaBaseUrl?.startsWith('https://') || !accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, mediaBaseUrl };
}

/** R2 when the four keys and the media host are configured, else the local directory. */
export function createStudioMediaStore(env: EnvLike = process.env): StudioMediaStore {
  return createR2MediaStore(env, optedInR2Config(env)) ?? createLocalMediaStore();
}

/** In-memory store for tests and the fake provider path. */
export function createMemoryMediaStore(): StudioMediaStore & { objects: Map<string, { bytes: Uint8Array; mime: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    kind: 'memory',
    objects,
    async put(bytes, mime) {
      const key = newStudioMediaKey(mime);
      objects.set(key, { bytes: new Uint8Array(bytes), mime });
      return { key };
    },
    async read(key) {
      const hit = objects.get(key);
      if (!hit) throw new StorageObjectNotFound('studio', key);
      return hit.bytes;
    },
    async delete(key) {
      objects.delete(key);
    },
    url: (key) => `${LOCAL_MEDIA_ROUTE}/${key}`,
  };
}
