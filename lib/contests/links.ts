import type { Locale } from '@/lib/i18n/config';

/**
 * PLAN §14.2 — every path the contests surface uses, spelled once.
 *
 * Pure and dependency-free (no `server-only`, no env), exactly like `lib/prompts/links.ts`, so the
 * static listing, the dynamic detail page, the login-gated form, the sitemap and the tests all
 * speak the same grammar.
 *
 * The one shape worth noticing: the ENTRY FORM is nested under the contest
 * (`/contests/{slug}/submit`) and is unprefixed app surface, while the listing and the detail are
 * locale-prefixed public surface. A form that is scoped to one contest cannot be a top-level route
 * without carrying the contest in a query string, and a query string is not a resource.
 */

export const CONTESTS_REST = '/contests';
export const ADMIN_CONTESTS_PATH = '/admin/contests';

export function contestsHref(locale: Locale | string): string {
  return `/${locale}${CONTESTS_REST}`;
}

export function contestHref(locale: Locale | string, slug: string): string {
  return `/${locale}${CONTESTS_REST}/${slug}`;
}

/** Path without the locale prefix — what the locale toggle and hreflang alternates need. */
export function contestRest(slug: string): string {
  return `${CONTESTS_REST}/${slug}`;
}

/** §14.2 — login-gated, `no-store`, `noindex`; unprefixed, like `/prompts/submit`. */
export function contestSubmitPath(slug: string): string {
  return `${CONTESTS_REST}/${slug}/submit`;
}

/** The admin preview of an unpublished contest — the ONLY way a draft detail page renders. */
export function adminContestPreviewPath(slug: string): string {
  return `${ADMIN_CONTESTS_PATH}/${slug}/preview`;
}

// ---------------------------------------------------------------------------
// media refs
// ---------------------------------------------------------------------------

export const CONTEST_MEDIA_KINDS = ['poster', 'video', 'logo'] as const;
export type ContestMediaKind = (typeof CONTEST_MEDIA_KINDS)[number];

/**
 * `{contestId}:{poster|video}` — the same "ref" grammar `lib/prompts/links.ts` uses, and for the
 * same reason: one route, one authorization rule, two kinds of object hanging off one row.
 */
export function contestMediaRef(id: string, kind: ContestMediaKind): string {
  return `${id}:${kind}`;
}

export function contestMediaPath(ref: string): string {
  return `/api/contests/media/${encodeURIComponent(ref)}`;
}
