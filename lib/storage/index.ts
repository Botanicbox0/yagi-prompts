import type { PublishedBucket } from '@/lib/content/schemas';

/**
 * PLAN §6 — asset lifecycle behind one interface.
 *
 *   content              private  revision-scoped staging: content/rev/{revision_id}/{uuid}.{ext}
 *   public-content       PUBLIC   heroes + `public` blocks of showcase revisions
 *   content-published    private  every other published block
 *   artifacts-published  private  workflow files
 *
 * Write-once posture, enforced by the shape of this interface:
 *   · `copy()` is upsert:false — an existing identical key is SUCCESS, never an overwrite.
 *   · there is deliberately **no delete method**. v1 ships no delete path for published objects;
 *     GC of unreferenced keys is a post-launch task with reference checks.
 *   · serving never touches staging.
 */

export const STAGING_BUCKET = 'content' as const;
export type StagingBucket = typeof STAGING_BUCKET;
export type Bucket = StagingBucket | PublishedBucket;

export type CopyOutcome = 'copied' | 'exists';

export interface CopyRequest {
  /** Key inside the private `content` staging bucket. */
  fromKey: string;
  toBucket: PublishedBucket;
  /** Content-addressed: `{sha256}.{ext}`. */
  toKey: string;
}

export interface StorageDriver {
  readonly name: string;
  /**
   * Does `signedUrl()` return a URL an outside host will honour on its own?
   *
   * Supabase: yes — the gateway redirects there and the object never touches the app server.
   * Local: no — `.storage/` is a directory, not a service, so the gateway streams the bytes itself
   * after verifying its own ≤60s token (lib/media/token.ts). The authorization chain, the expiry
   * window and the `no-store` posture are identical either way; only the last hop differs.
   */
  readonly servesSignedUrls: boolean;
  /** Upload staging bytes (admin uploads in M4; fixtures in the seed script). */
  putStaging(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  exists(bucket: Bucket, key: string): Promise<boolean>;
  read(bucket: Bucket, key: string): Promise<Uint8Array>;
  /** Phase B of publication. Idempotent: identical key already present => 'exists'. */
  copy(request: CopyRequest): Promise<CopyOutcome>;
  /** ≤60s signed URL against a private published bucket (§3.3 media gateway). */
  signedUrl(bucket: PublishedBucket, key: string, expiresInSeconds: number): Promise<string>;
  /** Stable URL for an object in the PUBLIC bucket only. */
  publicUrl(key: string): string;
}

export class StorageObjectNotFound extends Error {
  constructor(bucket: string, key: string) {
    super(`storage object not found: ${bucket}/${key}`);
    this.name = 'StorageObjectNotFound';
  }
}

/**
 * Driver selection.
 *
 * `local` (default in dev/test) writes under `.storage/` — see local-driver.ts.
 * `supabase` is a later-milestone task; see supabase-driver.ts.
 */
export async function getStorage(): Promise<StorageDriver> {
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver === 'supabase') {
    const { createSupabaseStorageDriver } = await import('./supabase-driver');
    return createSupabaseStorageDriver();
  }
  const { createLocalStorageDriver } = await import('./local-driver');
  return createLocalStorageDriver();
}
