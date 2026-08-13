'use client';

import { useEffect } from 'react';

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
 * designed panel instead of the browser-grey default. Styles are inline because this boundary
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

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#ffffff',
          color: '#000000',
          fontFamily: "'Pretendard Variable', ui-sans-serif, system-ui, sans-serif",
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: 460, padding: '0 24px' }}>
          <p
            style={{
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#0000EE',
              margin: 0,
            }}
          >
            YAGI PROMPTS
          </p>
          <h1
            style={{
              fontSize: 34,
              lineHeight: 1.05,
              fontWeight: 900,
              textTransform: 'uppercase',
              margin: '14px 0 0',
            }}
          >
            Something broke on the way here.
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.7, margin: '14px 0 0' }}>
            새로고침 한 번이면 대부분 해결됩니다. If it keeps happening, the button below is the
            same thing, done politely.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 22,
              padding: '10px 18px',
              border: '1px solid #000',
              background: 'transparent',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 22,
              marginLeft: 12,
              padding: '10px 18px',
              border: '1px solid rgba(0,0,0,0.25)',
              background: 'transparent',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, opacity: 0.4, marginTop: 18 }}>
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
