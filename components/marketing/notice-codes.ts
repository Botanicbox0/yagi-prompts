import type { Dictionary } from '@/lib/i18n/dictionaries';
import { normalizeReturnPath, safeReturnPath } from '@/lib/auth/return-path';

/**
 * Design review F2 — the notice band's pure half, shared across the boundary.
 *
 * `notice.tsx` is a client component, and a function exported through a `'use client'` module
 * is a client REFERENCE — the server layout cannot call it (the build refuses). The dictionary
 * seam and the code parsing live here, directive-free, so the layout builds the labels on the
 * server and the band parses the URL in the browser from the same module.
 */

export type NoticeCode = 'oauth' | 'oauth_unconfigured' | 'signin';

export interface NoticeLabels {
  oauth: string;
  oauthUnconfigured: string;
  signin: string;
  dismiss: string;
  /** The sign-in door itself, beside the sentence that says to use it. */
  signIn: string;
}

/** The dictionary → props seam, so the client bundle never carries both locales. */
export function noticeLabels(dict: Dictionary): NoticeLabels {
  return {
    oauth: dict.notice.oauth,
    oauthUnconfigured: dict.notice.oauthUnconfigured,
    signin: dict.notice.signin,
    dismiss: dict.notice.dismiss,
    signIn: dict.auth.signIn,
  };
}

/** ONLY the known codes; the error outranks the gate when a URL carries both. */
export function parseNoticeCode(search: string): NoticeCode | null {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (error === 'oauth') return 'oauth';
  if (error === 'oauth_unconfigured') return 'oauth_unconfigured';
  if (params.get('signin') === '1') return 'signin';
  return null;
}

/**
 * The URL after the band has said its piece. `next` leaves with `signin` — it belongs to the
 * same gate redirect — while parameters this band never read stay untouched.
 */
export function stripNoticeParams(search: string): string {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (error === 'oauth' || error === 'oauth_unconfigured') {
    params.delete('error');
    // The failed round trip's return path (audit P1-5) belongs to the same redirect.
    params.delete('next');
  }
  if (params.get('signin') === '1') {
    params.delete('signin');
    params.delete('next');
  }
  const out = params.toString();
  return out === '' ? '' : `?${out}`;
}

/**
 * The band's sign-in door, or none.
 *
 *   · `signin` (the login gate): the gated page the gate sent along, else this page;
 *   · `oauth` / `oauth_unconfigured` (a cancelled or failed round trip, audit P1-5): a retry that
 *     keeps the page the reader was heading to — only when the redirect carried a SAFE `next`.
 *
 * Every value goes through the same-origin path validator; `//evil`, `/\evil` and encoded
 * separators never become an href.
 */
export function noticeSigninHref(code: NoticeCode, search: string, pathname: string, locale: string): string | null {
  const next = new URLSearchParams(search).get('next');
  let target: string | null;
  if (code === 'signin') target = safeReturnPath(next ?? pathname, pathname);
  else target = next === null ? null : normalizeReturnPath(next);
  return target === null ? null : `/auth/signin?next=${encodeURIComponent(target)}&locale=${locale}`;
}
