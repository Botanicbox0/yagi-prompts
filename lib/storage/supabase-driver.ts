import type { SupabaseClient } from '@supabase/supabase-js';
import type { PublishedBucket } from '@/lib/content/schemas';
import { createServiceClient } from '@/lib/supabase/service-client';
import {
  STAGING_BUCKET,
  StorageObjectNotFound,
  type Bucket,
  type CopyOutcome,
  type CopyRequest,
  type StorageDriver,
} from './index';

/**
 * M7 — the production half of `lib/storage/`. Same interface as the local driver, same §6 posture:
 *
 *   · `putStaging` writes into the private `content` bucket with `upsert:false`.
 *   · `copy` is the publish step. Content-addressed destination keys make an existing object
 *     identical BY CONSTRUCTION, so "already there" is success, never an overwrite — proven twice
 *     over: an exists-check first, and the duplicate error treated as `'exists'` if two publishes
 *     race between the check and the copy.
 *   · `signedUrl` is ≤60s, and `servesSignedUrls` is TRUE, so the media gateway redirects instead
 *     of streaming: authorized bytes never transit the app server. The authorization chain, the
 *     expiry window and the `private, no-store` headers are identical to the local path — only the
 *     last hop differs.
 *   · `publicUrl` is the one URL that needs no capability, and only for `public-content`
 *     (§6 disclosure doctrine: anything ever served from there is permanently disclosed).
 *   · There is still NO delete method, and there must never be one: write-once is a security
 *     property, not a convenience. (The smoke script deletes its own STAGING probe with its own
 *     client — staging is not published content, and it does not go through this interface.)
 *
 * Storage RLS is deny-all (migration 0101), so every call here is service-role.
 */

/** Supabase reports a would-be overwrite as 409 / "Duplicate" / "resource already exists". */
function isDuplicate(error: { message?: string; statusCode?: string; status?: number }): boolean {
  const status = String(error.statusCode ?? error.status ?? '');
  if (status === '409') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('duplicate') || message.includes('already exists');
}

function isMissing(error: { message?: string; statusCode?: string; status?: number }): boolean {
  const status = String(error.statusCode ?? error.status ?? '');
  if (status === '404') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('not found') || message.includes('does not exist');
}

export function createSupabaseStorageDriver(client?: SupabaseClient): StorageDriver {
  // Lazy: constructing the client reads the service-role key, and a driver may be built (e.g. by a
  // health check) on a process that never touches an object.
  let memo: SupabaseClient | null = client ?? null;
  const db = (): SupabaseClient => (memo ??= createServiceClient());

  return {
    name: 'supabase',
    servesSignedUrls: true,

    async signedStagingUrl(key, expiresInSeconds) {
      const expiresIn = Number.isFinite(expiresInSeconds) ? Math.max(1, Math.min(Math.floor(expiresInSeconds), 60)) : 60;
      // Redirect response headers do not follow the browser to storage. Sign the download
      // disposition at the final byte response, so untrusted uploads cannot become documents.
      const { data, error } = await db().storage.from(STAGING_BUCKET).createSignedUrl(key, expiresIn, { download: true });
      if (error || !data) {
        if (!error || isMissing(error)) throw new StorageObjectNotFound(STAGING_BUCKET, key);
        throw new Error('private attachment signing failed');
      }
      return data.signedUrl;
    },

    async putStaging(key, bytes, contentType) {
      const { error } = await db()
        .storage.from(STAGING_BUCKET)
        // `Blob` rather than the raw Uint8Array: supabase-js needs a length it can send, and this
        // is the one form that behaves identically under Node 22 and the Next server runtime.
        .upload(key, new Blob([new Uint8Array(bytes)], { type: contentType }), {
          contentType,
          upsert: false,
        });
      // Staging keys carry a uuid, so a duplicate here means the same upload was retried — the
      // bytes are already where the caller wanted them.
      if (error && !isDuplicate(error)) {
        throw new Error(`storage upload failed: ${STAGING_BUCKET}/${key} — ${error.message}`);
      }
    },

    async releaseStaging(key: string) {
      const { error } = await db().storage.from(STAGING_BUCKET).remove([key]);
      if (error && !isMissing(error)) {
        throw new Error(`storage releaseStaging failed: ${STAGING_BUCKET}/${key} — ${error.message}`);
      }
    },

    /**
     * `createSignedUploadUrl` — the browser PUTs the bytes straight to Supabase (2026-08-15).
     *
     * One key, one URL, `upsert:false` semantics inherited from the staging bucket: the key carries
     * a uuid, so a replayed URL can only rewrite the object the same admin just created. The token
     * is short-lived and scoped to that single path, which is why handing it to the browser is safe
     * in a way that handing out the service-role key would never be.
     */
    async signedUploadUrl(key: string, _contentType: string) {
      const { data, error } = await db().storage.from(STAGING_BUCKET).createSignedUploadUrl(key);
      if (error || !data) {
        throw new Error(`signed upload url failed: ${key} — ${error?.message ?? 'no url'}`);
      }
      return data.signedUrl;
    },

    async exists(bucket: Bucket, key: string) {
      const { data, error } = await db().storage.from(bucket).exists(key);
      if (error && !isMissing(error)) {
        throw new Error(`storage exists failed: ${bucket}/${key} — ${error.message}`);
      }
      return data === true;
    },

    async read(bucket: Bucket, key: string) {
      const { data, error } = await db().storage.from(bucket).download(key);
      if (error || !data) {
        if (!error || isMissing(error)) throw new StorageObjectNotFound(bucket, key);
        throw new Error(`storage download failed: ${bucket}/${key} — ${error.message}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    async copy({ fromKey, toBucket, toKey }: CopyRequest): Promise<CopyOutcome> {
      const storage = db().storage;

      // upsert:false, part 1 — an identical content-addressed key is already the right bytes.
      const { data: present } = await storage.from(toBucket).exists(toKey);
      if (present === true) return 'exists';

      const { error } = await storage
        .from(STAGING_BUCKET)
        .copy(fromKey, toKey, { destinationBucket: toBucket });
      if (!error) return 'copied';

      // part 2 — someone else published the same object between the check and the copy.
      if (isDuplicate(error)) return 'exists';
      if (isMissing(error)) throw new StorageObjectNotFound(STAGING_BUCKET, fromKey);
      throw new Error(
        `storage copy failed: ${STAGING_BUCKET}/${fromKey} → ${toBucket}/${toKey} — ${error.message}`,
      );
    },

    async signedUrl(bucket: PublishedBucket, key: string, expiresInSeconds: number) {
      // The ≤60s ceiling is the gateway's contract (§3.3); clamp here too so no caller can widen it.
      const expiresIn = Math.max(1, Math.min(Math.floor(expiresInSeconds), 60));
      const { data, error } = await db().storage.from(bucket).createSignedUrl(key, expiresIn);
      if (error || !data) {
        if (!error || isMissing(error)) throw new StorageObjectNotFound(bucket, key);
        throw new Error(`storage sign failed: ${bucket}/${key} — ${error.message}`);
      }
      return data.signedUrl;
    },

    publicUrl(key: string) {
      // `https://{ref}.supabase.co/storage/v1/object/public/public-content/{key}` — the same string
      // `lib/content/asset-url.ts` builds for the shapers, via the SDK so the two cannot drift.
      return db().storage.from('public-content').getPublicUrl(key).data.publicUrl;
    },
  };
}
