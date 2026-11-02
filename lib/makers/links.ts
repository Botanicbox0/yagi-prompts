import type { Locale } from '@/lib/i18n/config';

/**
 * docs/PLATFORM-2.0.md §7.5 — a maker's public page, `/{locale}/makers/{handle}`. Pure, like
 * `lib/prompts/links.ts`, so the card credit, the template page, the sitemap and the tests agree.
 * Handles are already `[a-z0-9_]` (0060), so no encoding is needed — and none is applied, so a
 * malformed value cannot smuggle a path segment in.
 */
export const MAKER_REST = '/makers';

export function makerRest(handle: string): string {
  return `${MAKER_REST}/${handle}`;
}

export function makerHref(locale: Locale, handle: string): string {
  return `/${locale}${makerRest(handle)}`;
}

const MEDIA_EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

/**
 * `/creative-media/{wrk_…}.{ext}` — a creative's work on public pages (edge-cacheable while the
 * profile is public; app/creative-media). The studio previews through `/api/makers/media/{id}`.
 */
export function makerWorkSrc(id: string, mime: string): string {
  return `/creative-media/${id}.${MEDIA_EXTENSION[mime] ?? 'jpg'}`;
}

/** The avatar's version is in the name, so a new photo is a new address and the old one can stay cached. */
export function makerAvatarSrc(handle: string, version: string): string {
  return `/creative-media/avatar-${handle}-${version}.jpg`;
}

/** The cover (0071) works like the avatar: a new picture is a new address. */
export function makerCoverSrc(handle: string, version: string): string {
  return `/creative-media/cover-${handle}-${version}.jpg`;
}

/** The studio's own previews (private while the profile is off): never cached outside the creative's tab. */
export function makerStudioMediaSrc(id: string): string {
  return `/api/makers/media/${id}`;
}

/** The short address a creative puts in a bio or a DM: `twings.app/@handle` (middleware sends it on). */
export function makerShortPath(handle: string): string {
  return `/@${handle}`;
}
