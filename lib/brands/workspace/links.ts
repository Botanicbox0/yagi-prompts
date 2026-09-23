import { publicHref } from '@/lib/routing/request-surface';

/**
 * The brand studio's link to the face setup on the consumer site. It goes through `/auth/signin`, which
 * returns a signed-in visitor straight to `next` and otherwise signs them in on twings.app first, in the
 * workspace language. On brand.twings.app it is absolute (the page lives on twings.app); on local and
 * preview hosts it stays relative, so testing never jumps to production.
 */
export function studioIdentityHref(kind: 'portrait' | 'verify', locale: string, brandHost: boolean): string {
  const next = `/identity/${kind}?locale=${encodeURIComponent(locale)}`;
  return publicHref(`/auth/signin?next=${encodeURIComponent(next)}&locale=${encodeURIComponent(locale)}`, brandHost);
}
