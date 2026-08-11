'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * PLAN §3.4 funnel — the two moments only the browser can observe.
 *
 * `navigator.sendBeacon` rather than `fetch`: it survives the page being closed or navigated away
 * from, which is exactly when a `hire_click` (a `mailto:` that hands the tab to the mail client)
 * and an abandoned locked page happen. It has no response and no error channel — which suits a
 * contract where analytics may never affect the page.
 *
 * Everything degrades to nothing: no `navigator`, no beacon support, a blocked request — the page
 * is unchanged. There is no fallback path, on purpose; a retry loop for analytics would be worse
 * than a missing row.
 */

const ENDPOINT = '/api/events';

function send(payload: Record<string, string>): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never.
  }
}

/**
 * `hit_lock` — fires ONCE per page, on mount, only when the server actually rendered a locked
 * block. The `ref` guard matters under React strict mode, where effects run twice in development.
 */
export function LockBeacon({ slug }: { slug: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    send({ type: 'hit_lock', slug, surface: 'detail' });
  }, [slug]);
  return null;
}

/**
 * `hire_click` — §3.1's B2B CTA, the item M1 deferred to "when the events client lands".
 *
 * Wraps the existing `mailto:` anchor rather than replacing it: the link keeps working with
 * JavaScript disabled, and the beacon is pure addition.
 */
export function HireClickBeacon({ children }: { children: ReactNode }) {
  return (
    <span
      onClick={() => send({ type: 'hire_click', surface: 'footer' })}
      // Keyboard users activate the anchor, not this wrapper — Enter on a link fires `click` too,
      // so this listener sees both without needing a role or a tabindex of its own.
      className="contents"
    >
      {children}
    </span>
  );
}
