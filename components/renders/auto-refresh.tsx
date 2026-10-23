'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { startRefreshLoop } from './refresh-schedule';

/**
 * While a render is queued or running, re-render the server page so the status moves without the
 * reader touching anything. `router.refresh()` re-runs the RSC, which is also what nudges the
 * queue (the page polls the provider for a film) — no client state, no websocket, nothing to keep
 * in step with the row. The rhythm (6s → 15s after two minutes, paused while hidden) lives in
 * `refresh-schedule.ts`.
 */
export function AutoRefresh({ since }: { since?: string }) {
  const router = useRouter();
  useEffect(() => {
    const parsed = since ? Date.parse(since) : NaN;
    const start = Number.isFinite(parsed) ? parsed : Date.now();
    return startRefreshLoop(() => router.refresh(), {
      isHidden: () => document.visibilityState === 'hidden',
      onVisibilityChange: (listener) => {
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      },
      now: () => Date.now(),
    }, start);
  }, [router, since]);
  return null;
}
