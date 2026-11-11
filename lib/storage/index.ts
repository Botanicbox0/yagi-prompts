import type { PublishedBucket } from '@/lib/content/schemas';
import { privateStorageR2Config, publicMediaR2Config, selectStorageDriver } from '@/lib/runtime-mode';

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
  /**
   * A one-shot URL the BROWSER may PUT a staging object to, or `null` when the driver cannot mint
   * one (founder report, 2026-08-15).
   *
   * Why this exists: Vercel refuses a serverless request whose body exceeds ~4.5MB — a `413
   * PAYLOAD_TOO_LARGE` produced by the platform BEFORE any of our code runs. A 57.7MB export
   * therefore could not reach `POST /admin/do` at all, no matter what our own caps said. The bytes
   * have to skip the app server entirely, which is exactly what a signed upload URL is for.
   *
   * `null` from the local driver is not a gap: `.storage/` is a directory rather than a service, so
   * there is nothing to PUT to — and `next start` has no gateway limit to route around either. The
   * client falls back to posting the file inline, which is what it has always done.
   */
  signedUploadUrl(key: string, contentType: string): Promise<string | null>;
  /** Private workspace attachments only, after current membership authorization. Never public.
   * Cloud callers redirect to this <=60s capability to keep videos outside Vercel response limits.
   * Optional for existing driver doubles; local returns null and the authenticated route streams.
   */
  signedStagingUrl?(key: string, expiresInSeconds: number): Promise<string | null>;
  /** Release an ephemeral staging object after its permanent copy is verified. Never touches published buckets. */
  releaseStaging?(key: string): Promise<void>;
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
 * Driver selection — M7 routes it through the one mode switch (`lib/runtime-mode.ts`).
 *
 * `local` writes under `.storage/`; `supabase` talks to the project's buckets with the service-role
 * key; `r2` uses the dedicated private R2 bucket (`R2_PRIVATE_BUCKET`) with optional legacy read/sign
 * fallback to Supabase for pre-migration brand attachments.
 *
 * With the public R2 keys set, public files go straight to R2 (docs/BRAND-MOAT-AND-STORAGE.md).
 */
export async function getStorage(): Promise<StorageDriver> {
  const mode = selectStorageDriver(process.env);
  if (mode === 'r2') {
    const priv = privateStorageR2Config(process.env);
    if (priv !== null) {
      const { createR2PrivateStorageDriver } = await import('./r2-private');
      const pubR2 = publicMediaR2Config();
      const hasSupabaseLegacy = Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
      );
      const legacyFallback = hasSupabaseLegacy
        ? (await import('./supabase-driver')).createSupabaseStorageDriver()
        : undefined;
      const driver = createR2PrivateStorageDriver(priv, {
        ...(pubR2 ? { publicMediaBaseUrl: pubR2.mediaBaseUrl } : {}),
        ...(legacyFallback ? { legacyFallback } : {}),
      });
      if (pubR2 === null) return driver;
      const { createR2PublicMediaStore } = await import('./r2-public');
      const { withPublicMediaDirect } = await import('./public-media-direct');
      return withPublicMediaDirect(driver, createR2PublicMediaStore(pubR2));
    }
  }
  if (mode === 'supabase' || mode === 'r2') {
    const { createSupabaseStorageDriver } = await import('./supabase-driver');
    const driver = createSupabaseStorageDriver();
    const r2 = publicMediaR2Config();
    if (r2 === null) return driver;
    const { createR2PublicMediaStore } = await import('./r2-public');
    const { withPublicMediaDirect } = await import('./public-media-direct');
    return withPublicMediaDirect(driver, createR2PublicMediaStore(r2));
  }
  const { createLocalStorageDriver } = await import('./local-driver');
  return createLocalStorageDriver();
}
