'use client';

import { useEffect } from 'react';
import { STATIC_ERROR_COPY } from '@/components/app/static-error-copy';

/**
 * The last-resort boundary — and, in practice, the DEPLOYMENT-SKEW healer.
 *
 * The founder works in a long-lived admin tab while this repo deploys many times a day. A form
 * POST that lands after a deploy asks the browser to hydrate NEW HTML with chunk URLs its cache
 * resolved against the OLD deployment; the chunk 404s and Next collapses to the default white
 * "Application error: a client-side exception has occurred" — which reads as a broken product
 * and has now been reported twice from exactly this sequence (2026-08-13/14).
 *
 * A skew failure is not an application bug and is fully cured by one reload against the current
 * deployment, so that is literally what this does: detected chunk/module-load failures reload
 * ONCE (a sessionStorage latch stops a broken deploy from looping). Anything else renders a
 * designed panel instead of the browser-grey default, in a short static ko + en pair (the
 * dictionary and the locale resolver live in the layout this replaces). Styles are inline because this boundary
 * replaces the ROOT layout — when it renders, the stylesheet pipeline may be part of the wreck.
 *
 * (The real fix at the platform level is Vercel's skew protection, which the Hobby plan does not
 * include; this boundary is the honest Hobby-tier equivalent.)
 */

const RELOAD_LATCH = 'yagi-skew-reload';

function isChunkSkew(error: Error): boolean {
  const text = `${error.name} ${error.message}`;
  return /ChunkLoadError|Loading chunk|dynamically imported module|import\(\) failed|text\/html.*module script/i.test(
    text,
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!isChunkSkew(error)) return;
    // TIME-based latch, not a boolean: a boolean stayed set for the whole tab session, so the
    // SECOND skew of the day (each deploy makes a fresh one in a long-lived tab) showed the panel
    // instead of healing — which is how the founder met this screen. A loop is a reload within
    // seconds; distinct deploys are minutes apart, and each deserves its own silent reload.
    try {
      const last = Number(sessionStorage.getItem(RELOAD_LATCH) ?? 0);
      if (Date.now() - last > 15_000) {
        sessionStorage.setItem(RELOAD_LATCH, String(Date.now()));
        window.location.reload();
      }
    } catch {
      // Storage unavailable (rare) — fall through to the visible panel.
    }
  }, [error]);

  const { ko, en } = STATIC_ERROR_COPY;
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          background: '#F6F7F9',
          color: '#0E1013',
          fontFamily: "'Pretendard Variable', 'Apple SD Gothic Neo', 'Malgun Gothic', ui-sans-serif, system-ui, sans-serif",
          wordBreak: 'keep-all',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          boxSizing: 'border-box',
        }}
      >
        <div
          data-global-error
          style={{
            maxWidth: 460,
            width: '100%',
            background: '#FFFFFF',
            borderRadius: 24,
            border: '1px solid #DCDEE2',
            padding: '32px 28px',
            boxSizing: 'border-box',
          }}
        >
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#3063A7',
              margin: 0,
            }}
          >
            TWINGS
          </p>
          <h1 style={{ fontSize: 24, lineHeight: 1.3, fontWeight: 600, margin: '14px 0 0' }}>{ko.title}</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: '#41444D', margin: '10px 0 0' }}>{ko.body}</p>
          <div lang="en">
            <p style={{ fontSize: 16, lineHeight: 1.35, fontWeight: 600, margin: '20px 0 0' }}>{en.title}</p>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#41444D', margin: '6px 0 0' }}>{en.body}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                minHeight: 44,
                padding: '0 20px',
                borderRadius: 999,
                border: '1px solid #3875C5',
                background: '#3875C5',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {ko.reload} · {en.reload}
            </button>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: 44,
                padding: '0 20px',
                borderRadius: 999,
                border: '1px solid #C7CCD3',
                background: '#FFFFFF',
                color: '#0E1013',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {ko.retry} · {en.retry}
            </button>
          </div>
          {error.digest && (
            <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#5A5E66', marginTop: 18 }}>
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
