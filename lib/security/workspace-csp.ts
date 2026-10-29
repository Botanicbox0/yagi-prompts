import { isAdminPath, isBrandPath, type Surface } from '@/lib/routing/surfaces';

/**
 * The workspace pages' Content-Security-Policy: brand.twings.app, admin.twings.app, and `/brand` ·
 * `/admin` wherever they are served (local, preview). An admin's session reaches studio writes from
 * these pages (`/admin/do`, `/api/brand-workspace/studio`), so a script that was not ours must not run.
 *
 *   · script-src: a fresh nonce per request plus 'strict-dynamic'. Next.js reads the nonce from the
 *     request's CSP header and stamps its own scripts; scripts those load (chunks, `next/script`,
 *     the Toss SDK) inherit trust. Inline handlers, injected `<script>` and `javascript:` URLs do not.
 *     `next dev` needs eval for fast refresh, so only a non-production build adds 'unsafe-eval'.
 *   · object-src 'none', base-uri 'none': no plugin content, no `<base>` hijack of relative URLs.
 *   · frame-ancestors 'none': no page of these hosts runs inside anyone's frame (none embeds itself).
 *   · form-action 'self': forms post only to this origin. Sign-in is a link, not a form, so the OAuth
 *     redirect chain is unaffected.
 *
 * Deliberately NOT set: connect-src / img-src / frame-src allow lists and Trusted Types. They do not
 * stop the threat these pages carry (an injected script calling same-origin admin endpoints), and a
 * wrong list would silently break signed uploads, stored media or the payment widget in production
 * where local mode cannot exercise them. docs/BRAND-STAFF-ACCESS.md "보안" keeps the reasoning.
 */
export const NONCE_HEADER = 'x-nonce';

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function workspaceCsp(nonce: string, production = process.env.NODE_ENV === 'production'): string {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic'${production ? '' : " 'unsafe-eval'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** Every response of the two workspace hosts, and the workspace paths on any other host. */
export function needsWorkspaceCsp(surface: Surface, pathname: string): boolean {
  return surface === 'admin' || surface === 'brand' || isAdminPath(pathname) || isBrandPath(pathname);
}
