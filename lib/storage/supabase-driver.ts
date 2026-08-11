import type { StorageDriver } from './index';

/**
 * TODO (later milestone, blocked on the Supabase cloud project — PLAN §11 open item):
 * implement `StorageDriver` against Supabase Storage.
 *
 * Contract notes for whoever writes it, so the semantics do not drift from lib/storage/index.ts:
 *   · putStaging  → `storage.from('content').upload(key, bytes, { contentType, upsert: false })`
 *   · copy        → `storage.from('content').copy(fromKey, toKey, { destinationBucket: toBucket })`
 *                   Treat "Duplicate"/409 as `'exists'` — that is the upsert:false success case.
 *   · signedUrl   → `storage.from(bucket).createSignedUrl(key, expiresInSeconds)` with ≤60s.
 *                   Pass `{ download: filename }` for workflow files so the attachment disposition
 *                   survives the redirect (the local path sets the header itself).
 *   · publicUrl   → `storage.from('public-content').getPublicUrl(key).data.publicUrl`
 *   · servesSignedUrls → TRUE. The gateway then redirects to Supabase instead of streaming, and
 *                   `lib/media/token.ts` stops being the last hop — but the ≤60s window, the
 *                   full-chain authorization and the `private, no-store` headers are unchanged.
 *   · NO delete method. Do not add one; the write-once posture is a security property (§6).
 * All calls use the service-role client (lib/supabase/data-client.ts) — storage RLS is deny-all.
 */
export function createSupabaseStorageDriver(): StorageDriver {
  throw new Error(
    'STORAGE_DRIVER=supabase is not implemented yet (M0 ships the local driver only). ' +
      'See lib/storage/supabase-driver.ts and docs/SETUP.md.',
  );
}
