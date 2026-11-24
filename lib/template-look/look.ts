/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — the template style preference (founder decision 2026-11-25).
 *
 * Two sides share one small vocabulary:
 *   · a template is written for `any` buyer (every row today), or for the women's or the men's style;
 *   · an account has chosen `female`, `male`, or nothing yet.
 * Customer copy calls it a style ("여성 스타일" / "남성 스타일"), never a gender. It is never inferred from a photo or
 * anything else: only the person's own tap sets it.
 *
 * Pure and browser-safe: the list filter, the server route and the session endpoint all read this module.
 */

/** In display order: the women's style first everywhere (the product is mostly for women for now). */
export const TEMPLATE_LOOKS = ['female', 'male'] as const;
export type TemplateLook = (typeof TEMPLATE_LOOKS)[number];

/** A template's side: `any` is for everyone and is never hidden. */
export const TEMPLATE_AUDIENCES = ['any', ...TEMPLATE_LOOKS] as const;
export type TemplateAudience = (typeof TEMPLATE_AUDIENCES)[number];

/** The first-party cookie that carries the choice to static pages (not HttpOnly: the list island reads it). */
export const LOOK_COOKIE = 'tw_look';
export const LOOK_COOKIE_MAX_AGE_SECONDS = 365 * 86_400;

/** Under this many cards shown for the men's style, the list says honestly that there are few so far. */
export const FEW_TEMPLATES_THRESHOLD = 3;

export function isTemplateLook(value: unknown): value is TemplateLook {
  return typeof value === 'string' && (TEMPLATE_LOOKS as readonly string[]).includes(value);
}

/** A stored or attribute value as a template side; anything unknown is `any` (shown to everyone). */
export function toTemplateAudience(value: unknown): TemplateAudience {
  return isTemplateLook(value) ? value : 'any';
}

/**
 * The choice from a `Cookie` header or `document.cookie`; null when absent or not one of the two values. The value is
 * a closed vocabulary, so a tampered cookie can only pick a style, never inject anything.
 */
export function readLookCookie(cookieHeader: string | null | undefined): TemplateLook | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== LOOK_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return isTemplateLook(value) ? value : null;
  }
  return null;
}

/** The route's body: `{ look }` with one of the two styles or null (clear); anything else is refused. */
export function parseLookBody(body: unknown): { ok: true; look: TemplateLook | null } | { ok: false } {
  if (typeof body !== 'object' || body === null || !('look' in body)) return { ok: false };
  const look = (body as { look: unknown }).look;
  if (look === null) return { ok: true, look: null };
  return isTemplateLook(look) ? { ok: true, look } : { ok: false };
}

/** Does this viewer's choice hide this template? Only a template written for the OTHER style is hidden. */
export function lookHides(template: TemplateAudience, viewer: TemplateLook | null): boolean {
  return viewer !== null && template !== 'any' && template !== viewer;
}
