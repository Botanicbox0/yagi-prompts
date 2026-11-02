import { publicMediaBaseUrl, publicMediaR2Config, publicStorageBaseUrl } from '@/lib/runtime-mode';
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

/** With the R2 keys set, new public files are written straight to R2, so every key lives there. */
const writesStraightToR2 = () => publicMediaR2Config() !== null;

/**
 * docs/BRAND-MOAT-AND-STORAGE.md — once public files are written straight to R2, every key is served
 * from the media host. Until then only a key in `PUBLIC_MEDIA_KEYS` is, because it was copied there and
 * read back byte for byte; any other key was published to Supabase and stays there. Listed keys have no
 * Supabase original any more, so `PUBLIC_MEDIA_BASE_URL` must stay set.
 */
export function publicContentUrl(
  key: string,
  baseUrl = publicStorageBaseUrl(),
  mediaBaseUrl = publicMediaBaseUrl(),
  copiedKeys: ReadonlySet<string> = PUBLIC_MEDIA_KEYS,
  direct = writesStraightToR2(),
): string | null {
  if (!isSupabaseConfigured(baseUrl)) return null;
  return copiedPublicMediaUrl(key, mediaBaseUrl, copiedKeys, direct) ?? `${baseUrl!.replace(/\/$/, '')}/storage/v1/object/public/public-content/${key}`;
}

/** The media-host address of a key on R2, or `null` when the key is still served from Supabase. */
export function copiedPublicMediaUrl(
  key: string,
  mediaBaseUrl = publicMediaBaseUrl(),
  copiedKeys: ReadonlySet<string> = PUBLIC_MEDIA_KEYS,
  direct = writesStraightToR2(),
): string | null {
  return mediaBaseUrl && (direct || copiedKeys.has(key)) ? `${mediaBaseUrl.replace(/\/$/, '')}/${key}` : null;
}

/**
 * Part of the key of every `unstable_cache` document that stores a `publicContentUrl` result. Those
 * documents survive deploys, so without this a switch of host would keep serving the old addresses
 * until the TTL or a tag revalidation.
 */
export function publicMediaCacheKey(
  mediaBaseUrl = publicMediaBaseUrl(),
  copiedKeys: ReadonlySet<string> = PUBLIC_MEDIA_KEYS,
  direct = writesStraightToR2(),
): string {
  if (!mediaBaseUrl) return 'media:supabase';
  return `media:${mediaBaseUrl}:${direct ? 'direct' : copiedKeys.size}`;
}
