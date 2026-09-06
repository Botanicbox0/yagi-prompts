'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * While a render is queued or running, re-render the server page every few seconds so the
 * status moves without the reader touching anything. `router.refresh()` re-runs the RSC, which
 * is also what nudges the queue (the page polls the provider for a film) — no client state, no
 * websocket, nothing to keep in step with the row.
 */
export function AutoRefresh({ everyMs = 6000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
