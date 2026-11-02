import { publicMediaBaseUrl, publicStorageBaseUrl } from '@/lib/runtime-mode';
import { PUBLIC_MEDIA_KEYS } from './public-media-keys';

/**
 * Public-bucket object → servable URL.
 *
 * Mirrors `defaultPublicUrl` in `lib/content/shape.ts`, but returns `null` when nothing serves the
 * public bucket over HTTP. `null` is the honest answer, not a failure: the bytes exist under
 * `.storage/`, but a card that emitted a project URL for them would render a broken image. Callers
 * fall back to the entitlement-checked gateway or the generated cover composition instead (see
 * `components/landing/card-cover.tsx`).
 *
 * M7: "nothing serves it" now has TWO causes, and the second is the reason the mode switch exists —
 *   1. no Supabase project configured at all (a fresh clone, CI);
 *   2. `PLAYBOOK_MODE=local` on a machine whose `.env.local` DOES carry cloud credentials. The
 *      objects were published into `.storage/`, never into the cloud bucket, so the project host
 *      would 400 on every one of them.
 * `publicStorageBaseUrl()` collapses both into `undefined`. Passing `baseUrl` explicitly (as the
 * unit tests do) bypasses the mode entirely and tests the pure string-building.
 *
 * SERVER-SIDE ONLY. `PLAYBOOK_MODE` is not a `NEXT_PUBLIC_` variable, so a `'use client'` module
 * importing this would resolve a different mode in the browser than the server used and desync the
 * markup. Every importer today is an RSC or a route handler; keep it that way.
 */

const PLACEHOLDER_HOST = 'YOUR-PROJECT';

export function isSupabaseConfigured(baseUrl = publicStorageBaseUrl()): boolean {
  return Boolean(baseUrl && baseUrl.startsWith('http') && !baseUrl.includes(PLACEHOLDER_HOST));
}

/**
 * docs/BRAND-MOAT-AND-STORAGE.md — a key listed in `PUBLIC_MEDIA_KEYS` was copied to R2 and read back
 * byte for byte, so it is served from the media host. Every other key, such as a template published
 * after the last sync, stays on Supabase. The Supabase original is kept, so unsetting
 * `PUBLIC_MEDIA_BASE_URL` and redeploying is the whole rollback.
 */
export function publicContentUrl(
  key: string,
  baseUrl = publicStorageBaseUrl(),
  mediaBaseUrl = publicMediaBaseUrl(),
  copiedKeys: ReadonlySet<string> = PUBLIC_MEDIA_KEYS,
): string | null {
  if (!isSupabaseConfigured(baseUrl)) return null;
  if (mediaBaseUrl && copiedKeys.has(key)) return `${mediaBaseUrl.replace(/\/$/, '')}/${key}`;
  return `${baseUrl!.replace(/\/$/, '')}/storage/v1/object/public/public-content/${key}`;
}

/**
 * Part of the key of every `unstable_cache` document that stores a `publicContentUrl` result. Those
 * documents survive deploys, so without this a switch of host would keep serving the old addresses
 * until the TTL or a tag revalidation.
 */
export function publicMediaCacheKey(
  mediaBaseUrl = publicMediaBaseUrl(),
  copiedKeys: ReadonlySet<string> = PUBLIC_MEDIA_KEYS,
): string {
  return mediaBaseUrl ? `media:${mediaBaseUrl}:${copiedKeys.size}` : 'media:supabase';
}
