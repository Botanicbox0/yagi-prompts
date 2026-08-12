import type { Locale } from '@/lib/i18n/config';
import { MEDIA_KINDS, type MediaKind } from './schemas';

/**
 * PLAN §13.2 — every path the prompts surface uses, spelled once.
 *
 * Pure and dependency-free (no `server-only`, no env) so the static gallery, the dynamic detail
 * page, the route handlers, the sitemap and the tests all speak the same grammar — the same reason
 * `lib/content/media-ref.ts` and `lib/billing/links.ts` exist.
 */

export const PROMPTS_REST = '/prompts';
/** §13.2: the submission form is UNPREFIXED app surface (login, no-store, noindex). */
export const PROMPT_SUBMIT_PATH = '/prompts/submit';
export const ADMIN_PROMPTS_PATH = '/admin/prompts';

export function promptsHref(locale: Locale | string): string {
  return `/${locale}${PROMPTS_REST}`;
}

export function promptHref(locale: Locale | string, slug: string): string {
  return `/${locale}${PROMPTS_REST}/${slug}`;
}

/** Path without the locale prefix — what the locale toggle and hreflang alternates need. */
export function promptRest(slug: string): string {
  return `${PROMPTS_REST}/${slug}`;
}

export function promptCopyPath(id: string): string {
  return `/api/prompts/copy/${id}`;
}

// ---------------------------------------------------------------------------
// media refs
// ---------------------------------------------------------------------------

/**
 * `{promptId}:{poster|video}` — the same "ref" grammar `lib/content/media-ref.ts` uses for
 * `{revisionId}:hero`, and for the same reason: one route, one authorization path, two kinds of
 * object hanging off one row.
 */
export function promptMediaRef(id: string, kind: MediaKind): string {
  return `${id}:${kind}`;
}

export interface ParsedPromptMediaRef {
  id: string;
  kind: MediaKind;
}

/** `null` for anything malformed — the caller answers 404, never a guess. */
export function parsePromptMediaRef(raw: string): ParsedPromptMediaRef | null {
  const ref = raw.trim();
  const at = ref.lastIndexOf(':');
  if (at <= 0) return null;
  const id = ref.slice(0, at);
  const kind = ref.slice(at + 1);
  if (id.length === 0 || id.includes('/') || id.includes(':')) return null;
  if (!(MEDIA_KINDS as readonly string[]).includes(kind)) return null;
  return { id, kind: kind as MediaKind };
}

export function promptMediaPath(ref: string): string {
  return `/api/prompts/media/${encodeURIComponent(ref)}`;
}
