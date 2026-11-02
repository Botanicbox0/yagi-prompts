'use client';

import { useEffect, useState } from 'react';
import {
  noticeSigninHref,
  parseNoticeCode,
  stripNoticeParams,
  type NoticeCode,
  type NoticeLabels,
} from './notice-codes';

/**
 * Design review F2 — the band that renders what the auth redirects only ever said in the URL.
 *
 * `/auth/signin` and `/auth/callback` come back with `?error=oauth` / `?error=oauth_unconfigured`,
 * and the login gate bounces to `?signin=1&next=…` — all three landed on a page that showed
 * nothing. This mounts ONCE in the marketing layout and reads `location.search` in an effect,
 * which is what lets landing and pricing stay static (§3.1): the server render is empty, the
 * band exists only in the browser, and only for the three known codes. Everything else —
 * including an absent query string, the overwhelmingly common case — renders nothing.
 *
 * After display the handled parameters leave the URL (`history.replaceState`) so a reload or a
 * copied link does not replay a stale outcome. The pure half (code parsing, the dictionary
 * seam) lives in `./notice-codes.ts`, importable by the SERVER layout — a function exported
 * from this file would be a client reference the layout cannot call.
 */

/**
 * Presentational half, exported for tests: a §5 hairline band pinned under the 64px nav —
 * light surface, the accent as a left rule, one sentence, a dismiss.
 */
export function NoticeBand({
  code,
  labels,
  onDismiss,
  signinHref = null,
}: {
  code: NoticeCode;
  labels: NoticeLabels;
  onDismiss: () => void;
  /** The door, with the page the reader was heading to as its return (see `noticeSigninHref`). */
  signinHref?: string | null;
}) {
  const message =
    code === 'oauth'
      ? labels.oauth
      : code === 'oauth_unconfigured'
        ? labels.oauthUnconfigured
        : labels.signin;

  return (
    <div
      role="status"
      data-notice={code}
      // Fixed chrome over sections of either theme, so the light ink pair is pinned rather than
      // section-reactive; z-40 sits under the nav (z-50) and its overlay (z-[55]).
      className="fixed inset-x-0 top-16 z-40 border-b border-black/12 bg-white text-black"
    >
      <div className="mx-auto flex max-w-shell items-start justify-between gap-6 px-gutter py-3">
        <div className="border-l-2 border-blue pl-4">
          {/* The code stays machine-readable in `data-notice`; readers see only the sentence. */}
          <p className="text-[0.9375rem] leading-snug">{message}</p>
          {signinHref && (
            <a href={signinHref} data-notice-signin className="text-accent mt-2 inline-block font-label text-eyebrow uppercase">
              {labels.signIn} →
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 py-1 font-label text-eyebrow uppercase opacity-70 hover:opacity-100"
        >
          {labels.dismiss}
        </button>
      </div>
    </div>
  );
}

export function Notice({ labels, locale }: { labels: NoticeLabels; locale: string }) {
  const [code, setCode] = useState<NoticeCode | null>(null);
  const [signinHref, setSigninHref] = useState<string | null>(null);

  useEffect(() => {
    const found = parseNoticeCode(window.location.search);
    if (found === null) return;
    setCode(found);
    const { pathname, hash } = window.location;
    // The gate (and, since audit P1-5, a failed OAuth round trip) sent `next` along; keep it as
    // the sign-in's return before the URL is cleaned.
    setSigninHref(noticeSigninHref(found, window.location.search, pathname, locale));
    window.history.replaceState(null, '', `${pathname}${stripNoticeParams(window.location.search)}${hash}`);
  }, [locale]);

  if (code === null) return null;
  return <NoticeBand code={code} labels={labels} signinHref={signinHref} onDismiss={() => setCode(null)} />;
}
