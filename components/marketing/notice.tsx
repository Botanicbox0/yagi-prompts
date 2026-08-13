'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';

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
 * copied link does not replay a stale outcome.
 */

export type NoticeCode = 'oauth' | 'oauth_unconfigured' | 'signin';

export interface NoticeLabels {
  oauth: string;
  oauthUnconfigured: string;
  signin: string;
  dismiss: string;
}

/** The dictionary → props seam, so the client bundle never carries both locales. */
export function noticeLabels(dict: Dictionary): NoticeLabels {
  return {
    oauth: dict.notice.oauth,
    oauthUnconfigured: dict.notice.oauthUnconfigured,
    signin: dict.notice.signin,
    dismiss: dict.notice.dismiss,
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
  if (error === 'oauth' || error === 'oauth_unconfigured') params.delete('error');
  if (params.get('signin') === '1') {
    params.delete('signin');
    params.delete('next');
  }
  const out = params.toString();
  return out === '' ? '' : `?${out}`;
}

/** The mono label is the CODE, verbatim — locale-invariant, like every §5 code chip. */
const CODE_LABEL: Record<NoticeCode, string> = {
  oauth: 'error=oauth',
  oauth_unconfigured: 'error=oauth_unconfigured',
  signin: 'signin',
};

/**
 * Presentational half, exported for tests: a §5 hairline band pinned under the 64px nav —
 * light surface, the accent as a left rule, mono code label, one sentence, a dismiss.
 */
export function NoticeBand({
  code,
  labels,
  onDismiss,
}: {
  code: NoticeCode;
  labels: NoticeLabels;
  onDismiss: () => void;
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
          <p className="font-mono text-[0.7rem] tracking-[0.08em] uppercase opacity-50">
            {CODE_LABEL[code]}
          </p>
          <p className="mt-1 text-[0.9375rem] leading-snug">{message}</p>
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

export function Notice({ labels }: { labels: NoticeLabels }) {
  const [code, setCode] = useState<NoticeCode | null>(null);

  useEffect(() => {
    const found = parseNoticeCode(window.location.search);
    if (found === null) return;
    setCode(found);
    const { pathname, hash } = window.location;
    window.history.replaceState(null, '', `${pathname}${stripNoticeParams(window.location.search)}${hash}`);
  }, []);

  if (code === null) return null;
  return <NoticeBand code={code} labels={labels} onDismiss={() => setCode(null)} />;
}
