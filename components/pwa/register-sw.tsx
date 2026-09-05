'use client';

import { useEffect } from 'react';

/**
 * Registers `public/sw.js` once the page is idle (docs/TEMPLATES-IA.md §5). Production only: a
 * worker in `next dev` would sit between HMR and the browser for no reason. Failures are silent —
 * an install prompt is a bonus, never a dependency.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* installability is a bonus, never a dependency */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
