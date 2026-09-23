import type { Locale } from '@/lib/i18n/config';
import { MEDIA_KINDS, type MediaKind, type TemplateMedium } from './schemas';

/**
 * Every path the template surface uses, spelled once (docs/TEMPLATES-IA.md §2).
 *
 * Pure and dependency-free (no `server-only`, no env) so the static listings, the detail page, the
 * route handlers, the sitemap and the tests all speak the same grammar — the same reason
 * `lib/content/media-ref.ts` and `lib/billing/links.ts` exist.
 *
 * History: this file was the PROMPTS surface's grammar (`/prompts`, `/prompts/[slug]`,
 * `/prompts/submit`). On 2026-09-05 the founder retired the prompt site — a prompt is now the
 * private recipe inside a TEMPLATE — so the public paths became `/video`, `/image` and `/t/[slug]`,
 * and `next.config.ts` 308s the old ones onto them. The `prompt*` names below are kept as aliases so
 * the admin editor, the account page and the tests did not all have to be renamed on the same day.
 */

/** The two tabs — the catalogue's first split is what a template PRODUCES. */
export const TEMPLATE_LISTING_REST: Record<TemplateMedium, string> = { video: '/video', image: '/image' };
/** One template's public page, which is also where it is made. */
export const TEMPLATE_REST = '/t';

export const ADMIN_PROMPTS_PATH = '/admin/prompts';
export const ADMIN_PROMPT_NEW_PATH = `${ADMIN_PROMPTS_PATH}/new`;

/** Retired (2026-09-05): redirected to the video catalogue by `next.config.ts`. Kept for the redirect table. */
export const PROMPT_SUBMIT_PATH = '/prompts/submit';

export function adminPromptPath(id: string): string {
  return `${ADMIN_PROMPTS_PATH}/${encodeURIComponent(id)}`;
}

export function templatesHref(locale: Locale | string, medium: TemplateMedium = 'video'): string {
  return `/${locale}${TEMPLATE_LISTING_REST[medium]}`;
}

/** Path without the locale prefix — what the locale toggle and hreflang alternates need. */
export function templateRest(slug: string): string {
  return `${TEMPLATE_REST}/${slug}`;
}

export function templateHref(locale: Locale | string, slug: string): string {
  return `/${locale}${templateRest(slug)}`;
}

// Aliases from the prompts era — same pages, new names (see the header note).
export const promptsHref = (locale: Locale | string): string => templatesHref(locale, 'video');
export const promptHref = templateHref;

/** The copy endpoint answers 410 since 2026-09-05; the path stays so the client button can name it. */
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
